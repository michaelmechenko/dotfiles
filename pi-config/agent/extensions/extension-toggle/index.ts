import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type OverlayHandle,
  type OverlayOptions,
  type TUI,
} from "@earendil-works/pi-tui";
import { bottomBorder, combineColumns, divider, fit, frameLine, topBorder } from "./render";
import {
  assertToggleableScope,
  buildSourceOptions,
  filterExtensionOptions,
  isSourceEnabled,
  scopeLabel,
  toggleAllPackageResources,
  toggleTopLevelResourcePaths,
  type ExtensionOption,
  type FilteredExtensionOption,
} from "./utils";

const COMMAND_NAME = "extension-toggle";
const FLOATING_WINDOW_SHORTCUT = Key.ctrl("e");

export interface ExtensionToggleSelection {
  option: ExtensionOption;
  enabled: boolean;
}

const OPEN_FLOATING_WINDOW = "open-floating-window";
type SelectExtensionTogglesResult =
  | ExtensionToggleSelection[]
  | null
  | typeof OPEN_FLOATING_WINDOW;
type VisibleRowCount = number | (() => number);

function originLabel(option: ExtensionOption): string {
  return option.origin === "package" ? "package" : "top-level";
}

/**
 * Two-pane list + details picker, styled and driven like skill-toggle's
 * SkillToggleOverlay: live search-as-you-type (no explicit search mode),
 * space stages a toggle in a draft map, ctrl+s applies and closes.
 */
export class ExtensionToggleList implements Component {
  private readonly desired = new Map<number, boolean>();
  private search = "";
  private selectedIndex = 0;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly options: ExtensionOption[],
    private readonly done: (result: ExtensionToggleSelection[] | null) => void,
    private readonly bodyHeightHint: VisibleRowCount = 12,
    private readonly floatingShortcutFooterHint: string | undefined = undefined,
  ) {
    for (let i = 0; i < options.length; i++) {
      this.desired.set(i, isSourceEnabled(options[i].resources));
    }
  }

  invalidate(): void {}

  private get bodyHeight(): number {
    const value =
      typeof this.bodyHeightHint === "function" ? this.bodyHeightHint() : this.bodyHeightHint;
    return Number.isFinite(value) ? Math.max(4, Math.floor(value)) : 12;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.done(null);
      return;
    }

    if (matchesKey(data, Key.ctrl("s"))) {
      this.submit();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.moveSelection(-1);
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.moveSelection(1);
      return;
    }

    if (matchesKey(data, Key.space)) {
      const row = this.getSelectedOption();
      if (row) {
        this.desired.set(row.originalIndex, !(this.desired.get(row.originalIndex) ?? false));
        this.tui.requestRender();
      }
      return;
    }

    if (matchesKey(data, Key.backspace)) {
      if (this.search.length > 0) {
        this.search = Array.from(this.search).slice(0, -1).join("");
        this.selectedIndex = 0;
        this.tui.requestRender();
      }
      return;
    }

    if (isPrintableInput(data)) {
      this.search += data;
      this.selectedIndex = 0;
      this.tui.requestRender();
    }
  }

  private submit(): void {
    this.done(
      this.options
        .map((option, index) => ({
          option,
          enabled: this.desired.get(index) ?? isSourceEnabled(option.resources),
          changed: (this.desired.get(index) ?? isSourceEnabled(option.resources)) !== isSourceEnabled(option.resources),
        }))
        .filter((selection) => selection.changed)
        .map(({ option, enabled }) => ({ option, enabled })),
    );
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 2);
    const bodyHeight = this.bodyHeight;
    const leftWidth = Math.max(28, Math.floor((innerWidth - 1) * 0.55));
    const rightWidth = Math.max(24, innerWidth - leftWidth - 1);

    const header = this.renderHeader(innerWidth);
    const search = frameLine(
      this.theme,
      this.theme.fg("muted", `Search: ${this.search || "(type to filter)"}`),
      innerWidth,
    );
    const body = combineColumns(
      this.renderList(leftWidth, bodyHeight),
      this.renderDetails(rightWidth, bodyHeight),
      leftWidth,
      rightWidth,
      this.theme.fg("borderMuted", "│"),
    ).map((line) => frameLine(this.theme, line, innerWidth));

    const controlHints = [
      "type search",
      "↑↓ move",
      "space toggle",
      "ctrl+s apply + reload",
      ...(this.floatingShortcutFooterHint ? [this.floatingShortcutFooterHint] : []),
      "? help",
    ];
    const footer = [
      frameLine(this.theme, this.theme.fg("dim", controlHints.join(" · ")), innerWidth),
      frameLine(this.theme, this.theme.fg("dim", "esc cancel"), innerWidth),
    ];

    return [
      topBorder(this.theme, innerWidth),
      frameLine(this.theme, header, innerWidth),
      search,
      divider(this.theme, innerWidth),
      ...body,
      divider(this.theme, innerWidth),
      ...footer,
      bottomBorder(this.theme, innerWidth),
    ];
  }

  private renderHeader(innerWidth: number): string {
    const title = this.theme.fg("accent", this.theme.bold("Pi Extension Toggle"));
    const enabled = this.options.filter((_option, index) => this.desired.get(index) ?? false).length;
    const changed = this.getChangedCount();
    const summary = this.theme.fg(
      "muted",
      `${this.options.length} sources • ${enabled} enabled • ${changed} changed`,
    );
    const gap = Math.max(1, innerWidth - visibleLength(title) - visibleLength(summary));
    return `${title}${" ".repeat(gap)}${summary}`;
  }

  private renderList(width: number, height: number): string[] {
    const lines: string[] = [];
    const filtered = this.getFilteredOptions();

    if (filtered.length === 0) {
      lines.push(this.theme.fg("dim", "No matching sources"));
      return pad(lines, height);
    }

    this.selectedIndex = clamp(this.selectedIndex, 0, filtered.length - 1);
    const visibleCount = Math.max(4, Math.floor(height / 2));
    const start = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(visibleCount / 2), Math.max(0, filtered.length - visibleCount)),
    );
    const end = Math.min(filtered.length, start + visibleCount);

    for (let i = start; i < end; i += 1) {
      const row = filtered[i]!;
      const option = row.option;
      const enabledNow = isSourceEnabled(option.resources);
      const desired = this.desired.get(row.originalIndex) ?? enabledNow;
      const selected = i === this.selectedIndex;
      const changed = desired !== enabledNow;
      const marker = selected ? "›" : " ";
      const box = desired ? "◼" : "□";
      const changedMark = changed ? this.theme.fg("accent", " *") : "";
      const label = `${marker} ${box} ${option.label}${changedMark}`;
      lines.push(selected ? this.theme.fg("accent", this.theme.bold(fit(label, width))) : fit(label, width));
      lines.push(
        this.theme.fg(
          "dim",
          fit(`    ${scopeLabel(option.scope)} ${originLabel(option)} — ${desired ? "enabled" : "disabled"}`, width),
        ),
      );
    }

    return pad(lines, height);
  }

  private renderDetails(width: number, height: number): string[] {
    const option = this.getSelectedOption()?.option;
    const lines: string[] = [];
    if (!option) {
      lines.push(this.theme.fg("dim", "No source selected"));
      return pad(lines, height);
    }

    const enabledNow = isSourceEnabled(option.resources);
    const index = this.getSelectedOption()?.originalIndex ?? -1;
    const desired = this.desired.get(index) ?? enabledNow;

    lines.push(this.theme.fg("accent", this.theme.bold(option.label)));
    lines.push("");
    lines.push(`${this.theme.fg("muted", "Current:")} ${enabledNow ? "enabled" : "disabled"}`);
    lines.push(
      `${this.theme.fg("muted", "Desired:")} ${desired ? "enabled" : "disabled"}${desired !== enabledNow ? this.theme.fg("accent", " (changed)") : ""}`,
    );
    lines.push(`${this.theme.fg("muted", "Scope:")} ${scopeLabel(option.scope)}`);
    lines.push(`${this.theme.fg("muted", "Origin:")} ${originLabel(option)}`);
    if (option.resourceType) {
      lines.push(`${this.theme.fg("muted", "Type:")} ${option.resourceType}`);
    }
    lines.push(`${this.theme.fg("muted", "Source key:")} ${option.sourceKey}`);
    lines.push("");
    lines.push(this.theme.fg("muted", `Resource path${option.resources.length > 1 ? "s" : ""}:`));
    for (const resource of option.resources) {
      lines.push(...wrap(resource.path, width));
    }

    return pad(lines, height);
  }

  private moveSelection(delta: number): void {
    const filtered = this.getFilteredOptions();
    if (filtered.length === 0) return;
    this.selectedIndex = clamp(this.selectedIndex + delta, 0, filtered.length - 1);
    this.tui.requestRender();
  }

  private getFilteredOptions(): FilteredExtensionOption[] {
    return filterExtensionOptions(this.options, this.search);
  }

  private getSelectedOption(): FilteredExtensionOption | undefined {
    return this.getFilteredOptions()[this.selectedIndex];
  }

  private getChangedCount(): number {
    return this.options.filter((option, index) => (this.desired.get(index) ?? isSourceEnabled(option.resources)) !== isSourceEnabled(option.resources)).length;
  }
}

function isPrintableInput(data: string): boolean {
  return data.length > 0 && !data.includes("\x1b") && !data.includes("\r") && !data.includes("\n") && data >= " ";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pad(lines: string[], height: number): string[] {
  const padded = [...lines];
  while (padded.length < height) padded.push("");
  return padded.slice(0, height);
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function visibleLength(input: string): number {
  return input.replace(/\x1b\[[0-9;]*m/g, "").length;
}

class ExtensionToggleHelpOverlay implements Component {
  constructor(
    private readonly theme: Theme,
    private readonly shortcutHelp: string,
    private readonly onClose: () => void,
    private readonly onToggleShortcut: () => void,
  ) {}

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, FLOATING_WINDOW_SHORTCUT)) {
      this.onClose();
      this.onToggleShortcut();
      return;
    }

    if (
      data === "?" ||
      matchesKey(data, Key.question) ||
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("s")) ||
      matchesKey(data, Key.ctrl("c"))
    ) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth < 3) {
      return [truncateToWidth("?", safeWidth, "")];
    }

    const innerWidth = safeWidth - 2;
    const fitLine = (line: string): string => {
      const fitted =
        visibleWidth(line) > innerWidth
          ? truncateToWidth(line, innerWidth, "...")
          : line;
      return `${fitted}${" ".repeat(Math.max(0, innerWidth - visibleWidth(fitted)))}`;
    };
    const accent = (text: string) => this.theme.fg("accent", text);
    const dim = (text: string) => this.theme.fg("dim", text);
    const content = [
      accent("Extension Toggle Help"),
      "",
      `${accent("Ctrl+E")} ${this.shortcutHelp}`,
      `${accent("?")} close this help overlay`,
      `${accent("type")} to search (live filter, no search mode)`,
      `${accent("↑/↓")} move selection`,
      `${accent("Space")} stage enable/disable`,
      `${accent("Backspace")} remove search text`,
      `${accent("Ctrl+S")} apply staged changes + reload`,
      `${accent("Esc")} cancel`,
      "",
      dim("This help is a second overlay stacked above the picker."),
    ];

    return [
      `╭${"─".repeat(innerWidth)}╮`,
      ...content.map((line) => `│${fitLine(line)}│`),
      `╰${"─".repeat(innerWidth)}╯`,
    ];
  }
}

class ExtensionToggleOverlay implements Component {
  private helpHandle: OverlayHandle | null = null;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly inner: ExtensionToggleList,
    private readonly onToggleShortcut: () => void,
    private readonly shortcutHelp: string,
  ) {}

  invalidate(): void {
    this.inner.invalidate();
  }

  dispose(): void {
    this.hideHelp();
  }

  private hideHelp(): void {
    this.helpHandle?.hide();
    this.helpHandle = null;
  }

  private showHelp(): void {
    if (this.helpHandle) {
      this.helpHandle.focus();
      return;
    }

    const component = new ExtensionToggleHelpOverlay(
      this.theme,
      this.shortcutHelp,
      () => this.hideHelp(),
      this.onToggleShortcut,
    );
    this.helpHandle = this.tui.showOverlay(component, {
      anchor: "center",
      width: 64,
      maxHeight: "80%",
      margin: 2,
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, FLOATING_WINDOW_SHORTCUT)) {
      this.onToggleShortcut();
      return;
    }

    if (data === "?" || matchesKey(data, Key.question)) {
      this.showHelp();
      return;
    }

    this.inner.handleInput(data);
  }

  render(width: number): string[] {
    return this.inner.render(Math.max(0, width));
  }
}

interface SelectExtensionTogglesOptions {
  overlay?: boolean;
  onHandle?: (handle: OverlayHandle) => void;
  onToggleShortcut?: () => void;
}

const extensionToggleOverlayOptions: OverlayOptions = {
  anchor: "center",
  width: "92%",
  maxHeight: "88%",
  minWidth: 86,
};

function getResponsiveOverlayVisibleRows(termRows: number): number {
  const verticalMargins = 4;
  const overlayChromeLines = 8;
  const maxOverlayHeight = Math.min(
    Math.floor(termRows * 0.82),
    Math.max(1, termRows - verticalMargins),
  );
  return Math.max(1, maxOverlayHeight - overlayChromeLines);
}

async function selectExtensionToggles(
  ctx: ExtensionContext,
  options: ExtensionOption[],
  uiOptions: SelectExtensionTogglesOptions = {},
): Promise<SelectExtensionTogglesResult> {
  return await ctx.ui.custom<SelectExtensionTogglesResult>(
    (tui, theme, _kb, done) => {
      const floatingShortcutFooterHint =
        !uiOptions.overlay && uiOptions.onToggleShortcut ? "ctrl+e float" : undefined;

      const component = new ExtensionToggleList(
        tui,
        theme,
        options,
        done,
        uiOptions.overlay ? () => getResponsiveOverlayVisibleRows(tui.terminal.rows) : 12,
        floatingShortcutFooterHint,
      );

      const handleToggleShortcut = () => {
        if (uiOptions.overlay) {
          uiOptions.onToggleShortcut?.();
          return;
        }

        done(OPEN_FLOATING_WINDOW);
        setTimeout(() => uiOptions.onToggleShortcut?.(), 0);
      };

      return new ExtensionToggleOverlay(
        tui,
        theme,
        component,
        handleToggleShortcut,
        uiOptions.overlay ? "hide/show the floating window" : "open floating window",
      );
    },
    uiOptions.overlay
      ? {
          overlay: true,
          overlayOptions: extensionToggleOverlayOptions,
          onHandle: uiOptions.onHandle,
        }
      : undefined,
  );
}

export async function discoverExtensionResources(
  ctx: Pick<ExtensionCommandContext, "cwd">,
) {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(ctx.cwd, agentDir);
  const packageManager = new DefaultPackageManager({
    cwd: ctx.cwd,
    agentDir,
    settingsManager,
  });
  const resolvedPaths = await packageManager.resolve();

  return {
    agentDir,
    settingsManager,
    extensions: resolvedPaths.extensions,
    skills: resolvedPaths.skills,
    prompts: resolvedPaths.prompts,
    themes: resolvedPaths.themes,
  };
}

function applyExtensionToggle(
  settingsManager: SettingsManager,
  option: ExtensionOption,
  enabled: boolean,
): boolean {
  const first = option.resources[0];
  if (!first) return false;
  assertToggleableScope(first.metadata.scope);

  if (option.origin === "package") {
    const settings =
      first.metadata.scope === "project"
        ? settingsManager.getProjectSettings()
        : settingsManager.getGlobalSettings();
    const result = toggleAllPackageResources(
      settings.packages,
      option.sourceKey,
      enabled,
    );

    if (!result.changed) {
      return false;
    }

    if (first.metadata.scope === "project") {
      settingsManager.setProjectPackages(result.packages);
    } else {
      settingsManager.setPackages(result.packages);
    }
    return true;
  }

  // origin === "top-level" — toggle this individual local resource
  const settings =
    first.metadata.scope === "project"
      ? settingsManager.getProjectSettings()
      : settingsManager.getGlobalSettings();
  const resourceType = option.resourceType;
  if (!resourceType) return false;

  const updatedPaths = toggleTopLevelResourcePaths(
    settings[resourceType],
    option.sourceKey,
    enabled,
  );

  if (first.metadata.scope === "project") {
    switch (resourceType) {
      case "extensions":
        settingsManager.setProjectExtensionPaths(updatedPaths);
        break;
      case "skills":
        settingsManager.setProjectSkillPaths(updatedPaths);
        break;
      case "prompts":
        settingsManager.setProjectPromptTemplatePaths(updatedPaths);
        break;
      case "themes":
        settingsManager.setProjectThemePaths(updatedPaths);
        break;
    }
  } else {
    switch (resourceType) {
      case "extensions":
        settingsManager.setExtensionPaths(updatedPaths);
        break;
      case "skills":
        settingsManager.setSkillPaths(updatedPaths);
        break;
      case "prompts":
        settingsManager.setPromptTemplatePaths(updatedPaths);
        break;
      case "themes":
        settingsManager.setThemePaths(updatedPaths);
        break;
    }
  }
  return true;
}

interface RunExtensionToggleOptions extends SelectExtensionTogglesOptions {
  reload?: () => Promise<void> | void;
}

async function runExtensionToggle(
  ctx: ExtensionContext,
  uiOptions: RunExtensionToggleOptions = {},
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("extension-toggle requires interactive mode", "error");
    return;
  }

  const { agentDir, settingsManager, extensions, skills, prompts, themes } =
    await discoverExtensionResources(ctx);
  const options = buildSourceOptions(extensions, skills, prompts, themes, {
    cwd: ctx.cwd,
    agentDir,
  });

  if (options.length === 0) {
    ctx.ui.notify("No toggleable sources found", "info");
    return;
  }

  const selectedOptions = await selectExtensionToggles(ctx, options, uiOptions);

  if (selectedOptions === OPEN_FLOATING_WINDOW) {
    return;
  }

  if (selectedOptions === null) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }

  if (selectedOptions.length === 0) {
    ctx.ui.notify("No changes selected", "info");
    return;
  }

  const changedOptions: ExtensionToggleSelection[] = [];
  for (const selected of selectedOptions) {
    const changed = applyExtensionToggle(
      settingsManager,
      selected.option,
      selected.enabled,
    );

    if (changed) {
      changedOptions.push(selected);
    }
  }

  if (changedOptions.length === 0) {
    ctx.ui.notify(
      "Could not update settings for the selected sources",
      "error",
    );
    return;
  }

  await settingsManager.flush();
  const errors = settingsManager.drainErrors();
  if (errors.length > 0) {
    for (const error of errors) {
      ctx.ui.notify(
        `Failed to write ${error.scope} settings: ${error.error.message}`,
        "error",
      );
    }
    return;
  }

  const enabledCount = changedOptions.filter(
    (selection) => selection.enabled,
  ).length;
  const disabledCount = changedOptions.length - enabledCount;
  const summary = [
    enabledCount > 0 ? `${enabledCount} enabled` : undefined,
    disabledCount > 0 ? `${disabledCount} disabled` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");

  ctx.ui.notify(
    `Updated ${changedOptions.length} source(s): ${summary}`,
    "info",
  );

  if (!uiOptions.reload) {
    ctx.ui.notify("Change saved. Run /reload later to apply it.", "info");
    return;
  }

  const reload = await ctx.ui.confirm(
    "Reload now?",
    "Reload now so the change takes effect immediately?",
  );

  if (!reload) {
    ctx.ui.notify("Change saved. Run /reload later to apply it.", "info");
    return;
  }

  await uiOptions.reload();
}

async function extensionToggleHandler(
  ctx: ExtensionCommandContext,
  openFloatingWindow?: () => void,
) {
  await ctx.waitForIdle();
  await runExtensionToggle(ctx, {
    reload: () => ctx.reload(),
    onToggleShortcut: openFloatingWindow,
  });
}

export default function (pi: ExtensionAPI) {
  let floatingWindowHandle: OverlayHandle | null = null;
  let floatingWindowPromise: Promise<void> | null = null;

  async function toggleFloatingWindow(ctx: ExtensionContext): Promise<void> {
    if (floatingWindowHandle) {
      if (floatingWindowHandle.isHidden()) {
        floatingWindowHandle.setHidden(false);
        floatingWindowHandle.focus();
      } else {
        floatingWindowHandle.setHidden(true);
      }
      return;
    }

    if (floatingWindowPromise) {
      return;
    }

    floatingWindowPromise = runExtensionToggle(ctx, {
      overlay: true,
      onHandle: (handle) => {
        floatingWindowHandle = handle;
      },
      onToggleShortcut: () => {
        floatingWindowHandle?.setHidden(true);
      },
    }).finally(() => {
      floatingWindowHandle = null;
      floatingWindowPromise = null;
    });

    await floatingWindowPromise;
  }

  pi.registerShortcut(FLOATING_WINDOW_SHORTCUT, {
    description: "Toggle extension options floating window",
    handler: async (ctx) => toggleFloatingWindow(ctx),
  });

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Enable or disable installed Pi extensions, skills, prompts, and themes",
    handler: async (_args, ctx) =>
      extensionToggleHandler(ctx, () => {
        void toggleFloatingWindow(ctx);
      }),
  });
}
