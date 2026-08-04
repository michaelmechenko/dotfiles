/**
 * ask_user - Lets the model ask a single multiple-choice question.
 *
 * - 2 to 5 model-provided options, plus an always-present "Write my own answer" option
 * - Popup UI: arrow keys or number keys to pick, Enter to confirm
 * - "Write my own answer" opens an inline editor (Esc returns to the options)
 * - Esc on the options dismisses the question (the model is told you declined)
 *
 * Concurrency: tool calls run in parallel by default, so the model can call
 * ask_user more than once in the same batch. Each call opens a focus-stealing
 * ctx.ui.custom() overlay; without serialization, simultaneous calls race for
 * focus and only the last-opened one is answerable, while earlier ones resolve
 * as "cancelled" out from under the user. A module-level queue makes concurrent
 * calls show one at a time instead of stacking.
 */

import { getPackageDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { frameText, toolCallFrame, toolResultFrame } from "../tool-display/frame.js";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Cause, Effect, Exit } from "effect";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Type, type Static } from "typebox";
import {
  ASK_USER_PARAMETER_DESCRIPTIONS,
  ASK_USER_PROMPT_GUIDELINES,
  ASK_USER_PROMPT_SNIPPET,
  ASK_USER_TOOL_DESCRIPTION,
  buildAskUserResultMessage,
} from "./prompt.ts";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;

const OptionSchema = Type.Object({
  label: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.optionLabel,
  }),
  description: Type.Optional(
    Type.String({
      description: ASK_USER_PARAMETER_DESCRIPTIONS.optionDescription,
    }),
  ),
});

const AskUserParams = Type.Object({
  context: Type.Optional(Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.context,
  })),
  question: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.question,
  }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description: ASK_USER_PARAMETER_DESCRIPTIONS.options,
  }),
});

export type AskUserInput = Static<typeof AskUserParams>;

interface AskUserDetails {
  context?: string;
  question: string;
  options: string[];
  answer: string | null;
  wasCustom: boolean;
  images?: ImageContent[];
  cancelled: boolean;
}

type SelectionResult = {
  answer: string;
  wasCustom: boolean;
  index?: number;
  images?: ImageContent[];
} | null;

type ClipboardImageReader = () => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
type ClipboardTextReader = () => Promise<string | null>;

async function readClipboardImage(): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const modulePath = join(getPackageDir(), "dist", "utils", "clipboard-image.js");
  const module = await import(pathToFileURL(modulePath).href) as { readClipboardImage: ClipboardImageReader };
  return module.readClipboardImage();
}

async function readClipboardText(): Promise<string | null> {
  const modulePath = join(getPackageDir(), "dist", "utils", "clipboard.js");
  const module = await import(pathToFileURL(modulePath).href) as { readClipboardText: ClipboardTextReader };
  return module.readClipboardText();
}

interface DisplayOption {
  label: string;
  description?: string;
  isOther?: boolean;
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Serializes concurrent ask_user overlays. Each call awaits the previous
// call's turn before opening its own popup; `release` (set in `finally`)
// lets the next queued call proceed.
let queueTail: Promise<void> = Promise.resolve();
let pendingCount = 0;

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const reply = (
        text: string,
        answer: string | null = null,
        wasCustom = false,
        images: ImageContent[] = [],
      ) => ({
        content: [
          { type: "text" as const, text },
          ...images,
        ],
        details: {
          context: params.context,
          question: params.question,
          options: params.options.map((o) => o.label),
          answer,
          wasCustom,
          images: images.length > 0 ? images : undefined,
          cancelled: answer === null,
        } satisfies AskUserDetails,
      });

      if (
        params.options.length < MIN_OPTIONS ||
        params.options.length > MAX_OPTIONS
      ) {
        throw new Error(
          `ask_user requires between ${MIN_OPTIONS} and ${MAX_OPTIONS} options (got ${params.options.length}). Retry with a valid number of options.`,
        );
      }

      if (ctx.mode !== "tui") {
        return reply(buildAskUserResultMessage({ kind: "no-ui" }));
      }

      if (signal?.aborted) {
        return reply(buildAskUserResultMessage({ kind: "cancelled" }));
      }

      // Claim a queue slot before doing anything else so a concurrent call
      // waits its turn instead of opening a competing overlay.
      pendingCount += 1;
      const position = pendingCount;
      const myTurn = queueTail;
      let release: () => void = () => {};
      queueTail = new Promise<void>((resolve) => {
        release = resolve;
      });

      if (position > 1) {
        onUpdate?.({
          content: [
            { type: "text", text: "Waiting for a previous question to be answered..." },
          ],
          details: {
            context: params.context,
            question: params.question,
            options: params.options.map((o) => o.label),
            answer: null,
            wasCustom: false,
            cancelled: false,
          } satisfies AskUserDetails,
        });
      }

      await myTurn;

      try {
        if (signal?.aborted) {
          return reply(buildAskUserResultMessage({ kind: "cancelled" }));
        }

        const allOptions: DisplayOption[] = [
          ...params.options,
          { label: "Write my own answer…", isOther: true },
        ];

        const showQuestion = (uiSignal: AbortSignal) =>
          ctx.ui.custom<SelectionResult>((tui, theme, _kb, done) => {
            let optionIndex = 0;
            let editMode = false;
            let cachedLines: string[] | undefined;
            let pastedImages: ImageContent[] = [];

            let settled = false;

            function finish(result: SelectionResult) {
              if (settled) return;
              settled = true;
              uiSignal.removeEventListener("abort", cancel);
              done(result);
            }

            function cancel() {
              finish(null);
            }

            uiSignal.addEventListener("abort", cancel, { once: true });
            if (uiSignal.aborted) queueMicrotask(cancel);

            const editorTheme: EditorTheme = {
              borderColor: (s) => theme.fg("accent", s),
              selectList: {
                selectedPrefix: (t) => theme.fg("accent", t),
                selectedText: (t) => theme.fg("accent", t),
                description: (t) => theme.fg("muted", t),
                scrollInfo: (t) => theme.fg("dim", t),
                noMatch: (t) => theme.fg("warning", t),
              },
            };
            const editor = new Editor(tui, editorTheme);

            editor.onSubmit = (value) => {
              const trimmed = value.trim();
              if (trimmed) {
                finish({ answer: trimmed, wasCustom: true, images: pastedImages });
              } else {
                editMode = false;
                editor.setText("");
                refresh();
              }
            };

            function refresh() {
              cachedLines = undefined;
              tui.requestRender();
            }

            function selectOption(index: number) {
              const selected = allOptions[index];
              if (selected.isOther) {
                optionIndex = index;
                editMode = true;
                refresh();
              } else {
                finish({
                  answer: selected.label,
                  wasCustom: false,
                  index: index + 1,
                });
              }
            }

            async function pasteClipboard(): Promise<void> {
              try {
                const image = await readClipboardImage();
                if (image) {
                  pastedImages = [...pastedImages, {
                    type: "image",
                    data: Buffer.from(image.bytes).toString("base64"),
                    mimeType: image.mimeType,
                  }];
                  editor.insertTextAtCursor("[Pasted image]");
                } else {
                  const text = await readClipboardText();
                  if (text) editor.insertTextAtCursor(text);
                }
                refresh();
              } catch {
                // Match the regular prompt: ignore clipboard access failures.
              }
            }

            function handleInput(data: string) {
              if (editMode) {
                if (matchesKey(data, Key.ctrl("v"))) {
                  void pasteClipboard();
                  return;
                }
                if (matchesKey(data, Key.escape)) {
                  editMode = false;
                  editor.setText("");
                  refresh();
                  return;
                }
                editor.handleInput(data);
                refresh();
                return;
              }

              if (matchesKey(data, Key.up)) {
                optionIndex =
                  (optionIndex - 1 + allOptions.length) % allOptions.length;
                refresh();
                return;
              }
              if (matchesKey(data, Key.down)) {
                optionIndex = (optionIndex + 1) % allOptions.length;
                refresh();
                return;
              }

              // Number keys jump straight to an option
              if (
                data.length === 1 &&
                data >= "1" &&
                data <= String(allOptions.length)
              ) {
                selectOption(Number(data) - 1);
                return;
              }

              if (matchesKey(data, Key.enter)) {
                selectOption(optionIndex);
                return;
              }

              if (matchesKey(data, Key.escape)) {
                finish(null);
              }
            }

            function render(width: number): string[] {
              if (cachedLines) return cachedLines;

              const lines: string[] = [];
              const add = (s: string) => lines.push(truncateToWidth(s, width));

              const title = " Question ";
              add(
                theme.fg(
                  "accent",
                  `─${title}${"─".repeat(Math.max(0, width - title.length - 1))}`,
                ),
              );
              if (params.context) {
                for (const line of wrapText(params.context, Math.max(10, width - 2))) {
                  add(` ${theme.fg("muted", line)}`);
                }
                lines.push("");
              }
              for (const line of wrapText(
                params.question,
                Math.max(10, width - 2),
              )) {
                add(` ${theme.fg("text", theme.bold(line))}`);
              }
              lines.push("");

              for (let i = 0; i < allOptions.length; i++) {
                const opt = allOptions[i];
                const selected = i === optionIndex;
                const prefix = selected ? theme.fg("accent", " ❯ ") : "   ";
                const marker = opt.isOther ? "✎" : `${i + 1}.`;
                const label = `${marker} ${opt.label}`;

                if (selected || (opt.isOther && editMode)) {
                  add(prefix + theme.fg("accent", label));
                } else {
                  add(prefix + theme.fg(opt.isOther ? "muted" : "text", label));
                }

                if (opt.description) {
                  if (selected) {
                    for (const line of wrapText(opt.description, Math.max(10, width - 6))) {
                      add(`      ${theme.fg("muted", line)}`);
                    }
                  } else {
                    add(`      ${theme.fg("muted", opt.description)}`);
                  }
                }
              }

              if (editMode) {
                lines.push("");
                add(theme.fg("muted", ` Your answer${pastedImages.length ? ` (${pastedImages.length} image${pastedImages.length === 1 ? "" : "s"} attached)` : ""}:`));
                for (const line of editor.render(width - 2)) {
                  add(` ${line}`);
                }
              }

              lines.push("");
              if (editMode) {
                add(theme.fg("dim", " Enter submit • Esc back to options"));
              } else {
                add(
                  theme.fg(
                    "dim",
                    ` ↑↓ or 1-${allOptions.length} select • Enter confirm • Esc dismiss`,
                  ),
                );
              }
              add(theme.fg("accent", "─".repeat(width)));

              cachedLines = lines;
              return lines;
            }

            return {
              render,
              invalidate: () => {
                cachedLines = undefined;
              },
              handleInput,
              dispose: () => {
                uiSignal.removeEventListener("abort", cancel);
              },
            };
          });

        const uiExit = await Effect.runPromiseExit(
          Effect.tryPromise(showQuestion),
          signal ? { signal } : undefined,
        );

        if (Exit.isFailure(uiExit)) {
          if (Cause.hasInterruptsOnly(uiExit.cause)) {
            return reply(buildAskUserResultMessage({ kind: "cancelled" }));
          }
          const [first] = Cause.prettyErrors(uiExit.cause);
          throw new Error(first?.message ?? Cause.pretty(uiExit.cause));
        }

        const result = uiExit.value;

        if (!result) {
          return reply(buildAskUserResultMessage({ kind: "dismissed" }));
        }

        if (result.wasCustom) {
          return reply(
            buildAskUserResultMessage({
              kind: "custom",
              answer: result.answer,
            }),
            result.answer,
            true,
            result.images,
          );
        }

        return reply(
          buildAskUserResultMessage({
            kind: "selected",
            answer: result.answer,
            index: result.index,
          }),
          result.answer,
        );
      } finally {
        pendingCount -= 1;
        release();
      }
    },

    renderCall(args, theme, context) {
      let text = theme.fg("warning", "○ ") + theme.fg("toolTitle", theme.bold("ask_user "));
      text += theme.fg(
        "muted",
        typeof args.question === "string" ? args.question : "",
      );
      const opts = Array.isArray(args.options)
        ? (args.options as DisplayOption[])
        : [];
      if (opts.length > 0) {
        const numbered = opts.map((o, i) => `${i + 1}. ${o.label}`);
        text += `\n${theme.fg("dim", `  ${numbered.join("  ")}`)}`;
      }
      return frameText(context?.lastComponent ?? new Text("", 0, 0), (width) =>
        toolCallFrame(theme, width, text, { pending: true }),
      );
    },

    renderResult(result, _options, theme, context) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return frameText(context?.lastComponent ?? new Text("", 0, 0), (width) =>
          toolResultFrame(theme, width, [first?.type === "text" ? first.text : ""]),
        );
      }

      if (details.cancelled || details.answer === null) {
        return frameText(context?.lastComponent ?? new Text("", 0, 0), (width) =>
          toolResultFrame(theme, width, [theme.fg("warning", "✗ dismissed")]),
        );
      }

      if (details.wasCustom) {
        const attachment = details.images?.length ? ` + ${details.images.length} image${details.images.length === 1 ? "" : "s"}` : "";
        const answer = theme.fg("success", "✓ ") + theme.fg("muted", "(wrote) ") + theme.fg("accent", `${details.answer}${attachment}`);
        return frameText(context?.lastComponent ?? new Text("", 0, 0), (width) =>
          toolResultFrame(theme, width, [answer]),
        );
      }

      const idx = details.options.indexOf(details.answer) + 1;
      const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer;
      return frameText(context?.lastComponent ?? new Text("", 0, 0), (width) =>
        toolResultFrame(theme, width, [theme.fg("success", "✓ ") + theme.fg("accent", display)]),
      );
    },
  });
}
