import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, type OverlayHandle } from "@earendil-works/pi-tui";
import { AtomicSkillChangeWriter } from "./apply/writer.ts";
import { DefaultSkillTogglePlanner } from "./apply/planner.ts";
import { DefaultSkillLocator } from "./discovery/skill-locator.ts";
import { MinimalFrontmatterPatcher } from "./frontmatter/patcher.ts";
import { SimpleFrontmatterCodec } from "./frontmatter/parser.ts";
import { DefaultSkillInventory } from "./inventory/loader.ts";
import { NodeFileSystem } from "./ports/fs.ts";
import { runToggleSkillsCommand } from "./command.ts";

export default function piSkillToggle(pi: ExtensionAPI) {
  const fs = new NodeFileSystem();
  const codec = new SimpleFrontmatterCodec();
  const patcher = new MinimalFrontmatterPatcher();
  const locator = new DefaultSkillLocator(fs);
  const inventory = new DefaultSkillInventory(locator, fs, codec);
  const planner = new DefaultSkillTogglePlanner(fs, codec, patcher);
  const writer = new AtomicSkillChangeWriter(fs);

  // Shared persistent floating instance for both /skill-toggle and ctrl+shift+e
  // (mirrors extension-toggle's toggleFloatingWindow): a second ctrl+shift+e
  // press hides the open picker instead of stacking a new one; a further
  // press restores it with staged toggles intact.
  let handle: OverlayHandle | null = null;
  let inflight: Promise<void> | null = null;

  async function toggleSkillWindow(ctx: ExtensionContext): Promise<void> {
    if (handle) {
      if (handle.isHidden()) {
        handle.setHidden(false);
        handle.focus();
      } else {
        handle.setHidden(true);
      }
      return;
    }

    if (inflight) {
      return;
    }

    // ctx.waitForIdle() is only available on ExtensionCommandContext (command
    // invocations), not the plain ExtensionContext passed to shortcut
    // handlers — same capability-guard pattern used for ctx.reload().
    const waitForIdle = (ctx as { waitForIdle?: () => Promise<void> }).waitForIdle;
    if (typeof waitForIdle === "function") {
      await waitForIdle();
    }

    inflight = runToggleSkillsCommand(ctx, { inventory, planner, writer }, {
      onHandle: (h) => {
        handle = h;
      },
      onToggleShortcut: () => {
        handle?.setHidden(true);
      },
    }).finally(() => {
      handle = null;
      inflight = null;
    });

    await inflight;
  }

  pi.registerCommand("skill-toggle", {
    description: "Toggle whether skills are agent-invocable or manual-only",
    handler: async (_args, ctx) => toggleSkillWindow(ctx),
  });

  pi.registerShortcut(Key.ctrlShift("e"), {
    description: "Open skill toggle",
    handler: async (ctx) => toggleSkillWindow(ctx),
  });
}
