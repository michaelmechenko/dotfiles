import { getPackageDir, keyHint, SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, truncateToWidth } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readRecalibrationClipboardPaste, RECALIBRATION_IMAGE_MARKER, type ClipboardImage, type ClipboardReaders, type RecalibrationDraft } from "./recalibration-draft.ts";

export { buildRecalibrationMessage } from "./recalibration-draft.ts";

type ClipboardImageReader = () => Promise<ClipboardImage | null>;
type ClipboardTextReader = () => Promise<string | null>;

async function readClipboardImage(): Promise<ClipboardImage | null> {
	const modulePath = join(getPackageDir(), "dist", "utils", "clipboard-image.js");
	const module = await import(pathToFileURL(modulePath).href) as { readClipboardImage: ClipboardImageReader };
	return module.readClipboardImage();
}

async function readClipboardText(): Promise<string | null> {
	const modulePath = join(getPackageDir(), "dist", "utils", "clipboard.js");
	const module = await import(pathToFileURL(modulePath).href) as { readClipboardText: ClipboardTextReader };
	return module.readClipboardText();
}

const systemClipboardReaders: ClipboardReaders = { readImage: readClipboardImage, readText: readClipboardText };

async function editInExternalEditor(command: string, content: string): Promise<string | undefined> {
	const directory = mkdtempSync(join(tmpdir(), "pi-editor-"));
	const filePath = join(directory, "prompt.md");
	try {
		writeFileSync(filePath, content, "utf-8");
		const [editor, ...editorArgs] = command.split(" ");
		if (!editor) return undefined;
		process.stdout.write(`Launching external editor: ${command}\nPi will resume when the editor exits.\n`);
		const exitCode = await new Promise<number | null>((resolve) => {
			const child = spawn(editor, [...editorArgs, filePath], { stdio: "inherit", shell: process.platform === "win32" });
			child.on("error", () => resolve(null));
			child.on("close", (code) => resolve(code));
		});
		return exitCode === 0 ? readFileSync(filePath, "utf-8").replace(/\n$/, "") : undefined;
	} finally {
		try { rmSync(directory, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
	}
}

/** TUI-only draft editor that preserves Pi editor semantics and adds image-aware clipboard paste. */
export async function promptForRecalibration(ctx: ExtensionContext, agentDir: string, title = "Recalibrate this plan:"): Promise<RecalibrationDraft | undefined> {
	if (ctx.mode !== "tui") {
		const text = await ctx.ui.editor(title, "");
		return text?.trim() ? { text, images: [] } : undefined;
	}
	const externalEditorCommand = SettingsManager.create(ctx.cwd, agentDir).getExternalEditorCommand();
	return ctx.ui.custom<RecalibrationDraft | undefined>((tui, theme, keybindings, done) => {
		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		const editor = new Editor(tui, editorTheme);
		let images: RecalibrationDraft["images"] = [];
		let settled = false;
		const finish = (draft: RecalibrationDraft | undefined) => {
			if (settled) return;
			settled = true;
			done(draft);
		};
		const refresh = () => tui.requestRender();
		editor.onSubmit = (text) => finish({ text, images });
		const pasteClipboard = async () => {
			try {
				const paste = await readRecalibrationClipboardPaste(systemClipboardReaders);
				if (settled || !paste) return;
				if (paste.kind === "image") {
					images = [...images, paste.image];
					editor.insertTextAtCursor(RECALIBRATION_IMAGE_MARKER);
				} else editor.insertTextAtCursor(paste.text);
				refresh();
			} catch {
				// Match Pi's main editor: clipboard access failures are non-fatal.
			}
		};
		const openExternalEditor = async () => {
			const content = editor.getExpandedText();
			tui.stop();
			try {
				const edited = await editInExternalEditor(externalEditorCommand, content);
				if (!settled && edited !== undefined) editor.setText(edited);
			} finally {
				tui.start();
				tui.requestRender(true);
			}
		};
		return {
			get focused() { return editor.focused; },
			set focused(value: boolean) { editor.focused = value; },
			render(width: number) {
				return [
					truncateToWidth(theme.fg("accent", theme.bold(title)), width),
					...editor.render(width),
					"",
					truncateToWidth(theme.fg("muted", `${images.length ? `${images.length} image${images.length === 1 ? "" : "s"} attached • ` : ""}${keyHint("tui.select.confirm", "submit")} • ${keyHint("tui.input.newLine", "newline")} • ${keyHint("app.clipboard.pasteImage", "paste image/text")} • ${keyHint("app.editor.external", "external editor")} • ${keyHint("tui.select.cancel", "cancel")}`), width),
				];
			},
			invalidate() { editor.invalidate(); },
			handleInput(data: string) {
				if (keybindings.matches(data, "tui.select.cancel")) return finish(undefined);
				if (keybindings.matches(data, "app.clipboard.pasteImage")) { void pasteClipboard(); return; }
				if (keybindings.matches(data, "app.editor.external")) { void openExternalEditor(); return; }
				editor.handleInput(data);
				refresh();
			},
		};
	});
}
