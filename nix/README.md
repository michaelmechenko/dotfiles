# NixOS desktop bootstrap

This is a Linux-only first-stage profile for `mishka` on host `nixos`.
The Mac configuration is not sourced or modified. The installed NixOS revision
is pinned in `flake.nix`; `flake.lock` also pins Home Manager.

## Ownership and scope

- `hosts/nixos/configuration.nix` and `hardware-configuration.nix`: captured
  installer configuration. Keep filesystem identifiers and `stateVersion` intact.
- `modules/desktop.nix`: NixOS Hyprland/UWSM/portal/PAM/hardware integration.
- `home/desktop.nix`: Hyprland Lua, Waybar, launcher, notifications, lock/idle.
- `home/apps.nix`: applications, LibreWolf browser and explicit file-type defaults.
- `home/wallpaper.nix`: immutable Monet artwork, Hyprpaper and Hyprlock backgrounds.
- `home/source-identity.nix`: build-bound live-source inventory and activation guard.
- `home/icons.nix`: Breeze Dark selection; targeted GTK/KDE icon settings.
- `home/terminal.nix`: shared Ghostty, zsh, prompt, tmux/sidebar, nnn, and Neovim.
- `home/pi.nix`: Pi runtime, public resources, pinned dependencies, and writable seeds.
- `home/palette.nix`: consumes canonical `theme/palettes/vague.json` roles,
  references, and overrides. No second hand-maintained palette.

Plasma/SDDM, networking, audio, firewall, SSH, and disk layout are preserved.
SDDM automatically logs `mishka` into Hyprland (managed by UWSM) at startup,
without a login password prompt. Anyone powering on the PC can access the desktop;
any disk-encryption prompt is unaffected. Logging out returns to SDDM, where
Plasma remains available.
No automatic updates, garbage collection, passwordless sudo, disk changes,
or reboot are introduced. SSH password authentication is not changed by this
bootstrap; harden it separately after verifying persistent key access.

## Intended rendering and behavior

- A 34px top Waybar on every monitor: Apps, each workspace label followed by
  its running window icons;
  centered clock; volume, network, Bluetooth, tray and session menu on the right.
  The session menu (also Super-Shift-Escape) offers Lock, Sleep, Log out, Restart,
  and Shut down. Sleep runs `systemctl suspend`; Hypridle requests locking before
  sleep. The session stays in RAM and still requires power. Hypridle has no idle
  timeout, so inactivity does not lock the session or power off the displays;
  manual locking and locking before explicit sleep remain enabled.
- Active workspace: lavender on the highlight surface; inactive: muted UI
  text on chrome; urgent workspace: rose. The focused window icon has a thin
  icon-width lavender line below it. Offline/muted states say so in text.
- Focused window: lavender border; unfocused: subtle divider border. Eight-pixel
  corners, no transparency or blur. Restrained 150–250ms window/fade/workspace
  animations are enabled. `misc.vrr = 2` enables variable refresh rate only
  with fullscreen windows on displays supporting adaptive sync; ordinary
  windowed use keeps VRR off. Super-F toggles maximization within the monitor's
  usable area, respecting the bar's reserved space; press it again to restore.
  Application-native fullscreen controls remain unchanged. Other fullscreen
  behavior follows Hyprland defaults. Win+Shift+grave (` / ~) toggles
  `winkeytoggle`: Win shortcuts and Win+mouse move/resize are released to the app,
  except that same restoration chord. Active and inactive borders turn rose
  (`accent-primary`); press again to restore shortcuts, active lavender
  (`accent-secondary`) and inactive `divider-subtle`. Media keys and Print Screen
  remain active. This is a
  session-wide manual toggle, not tied to fullscreen or app exit; configuration
  reload and login restore normal mode. Native fullscreen may hide borders;
  the toggle does not force decorations or change fullscreen geometry.
  Hyprland 0.55.4 omits the submap from mouse events, so the submap hook explicitly
  disables/re-enables the original mouse-binding handles rather than consuming
  clicks in a no-op. `winkeytoggle-test.lua` checks config lifecycle;
  `winkeytoggle-input-test.py` uses a private headless compositor to check actual
  pointer delivery, window geometry and rendered border pixels. `nix/check.sh`
  supplies its pinned dependencies; set `WINKEYTOGGLE_KEEP_ARTIFACTS=1` to retain
  successful screenshots/logs (failures always retain their private artifacts).
- Both monitors use 2560×1440 at nominal 180 Hz and 100% scale, top-aligned:
  Samsung Odyssey G50SF (`DP-1`) is on the left at `0x0`, using its advertised
  179.98 Hz mode; Acer XZ322QU V3 (`DP-2`) is on the right at `2560x0`, at 180 Hz.
  Other outputs retain preferred-mode, automatic-position, automatic-scale fallback.
  After activation, verify refresh rates, pointer crossing, Waybar and window
  placement, fullscreen behavior, and persistence across the next login.
- Notifications: chrome/text/lavender; critical messages persist with rose borders.
  Lock screen: blurred/dimmed Monet artwork and centered password input on every monitor.
- Only Hyprland starts Waybar, mako, hypridle, hyprpaper, the secrets component of
  gnome-keyring, and its polkit agent. UWSM owns their lifetime; they must not
  follow the user back into Plasma or replace Plasma's wallet.

Waybar's native Hyprland workspace taskbar groups running windows beside their
workspace labels: `1* [Helium] [Ghostty] 2* [Steam] [Grimoire] [Dolphin]`.
Each monitor shows only its own workspaces, including populated inactive ones;
empty inactive and special workspaces stay hidden. Icons remain 20px grayscale
Breeze Dark images with window-title tooltips. Clicking a label switches workspace;
left-clicking an icon focuses that exact window through Hyprland's Lua dispatcher.
Other mouse buttons have no window action. Native window order is retained, without
focus-triggered reordering or application deduplication. The focused icon has a
20px-wide, 1px-thick lavender line below it, independent of the active workspace
background. Icons stay vertically centered; the line leaves 2px of clearance above the bar's
bottom edge without shifting icons when focus changes.
A separate nwg-dock-hyprland dock provides pinned applications at the bottom edge
(see below). After activation, check both monitors' groups, focus/hover/urgent and
empty states, multiple windows of one app, window moves/open/close, and crowded
layouts; verify icon clicks from inactive workspaces as well as label clicks.

## Wallpaper and default applications

The desktop and lock screen share the immutable `assets/wallpapers/monet1.jpg`
(3648×2736), copied unchanged from
`/home/mishka/Documents/extras extras/wallpapers_artwork/monet1.jpg`.
Hyprpaper 0.8.4 uses a wildcard wallpaper block with `fit_mode = cover`: each
monitor shows its own centered crop, not half of a spanning panorama. On a
2560×1440 output the scaled image is 2560×1920, cropping 240px above/below.
Check that the lower lily band remains satisfactory. The original file is untouched.

Hyprlock uses that same store image on every output with three blur passes,
blur size 8 and brightness 0.75. Canvas remains its load-failure fallback; the
existing password field and manual/pre-sleep locking policy remain unchanged.
No clock, extra idle timeout, Plasma wallpaper, or SDDM greeter change is added.
Home Manager generates Hyprpaper configuration with `package = null` so it
does not create a generic graphical-session unit. Hyprland starts one explicit
store binary through UWSM; logout must stop it before entering Plasma.

The explicit MIME table in `home/apps.nix` sets:

| Content | Default |
| --- | --- |
| Web links, HTML/XHTML | LibreWolf (`librewolf.desktop`) |
| Common images, including SVG/WebP/AVIF | Gwenview |
| PDF, EPUB, DjVu and comic books | Okular's format-specific desktop entries |
| Audio/video | VLC |
| Archives | Ark |
| Text, Markdown and selected code/config formats | Zed |
| Directories | Dolphin |

Defaults are also added associations, not removed associations, so other
Open With choices remain available. Do not replace the table with `image/*`
wildcards or all MIME claims from every package. LibreWolf/Gwenview/Okular/VLC
are explicit packages even when Plasma happens to provide some of them.
LibreWolf uses the existing package pin; profiles/preferences are app-owned,
with no browser data migration. Helium, Firefox, Super-B and existing dock pins
are retained. No office suite or mailto client is assumed.

Home Manager declares the existing Desktop, Documents, Downloads, Music,
Pictures, Projects, Public, Templates and Videos locations. It does not create
or move directories. Preserve unknown local user-dir keys before taking ownership.

## Applications and shared workflows

- Sidra uses its pinned upstream flake so CastLabs Electron/Widevine remains
  unmodified. Helium uses the pinned official Linux 0.17.2.1 release with its
  sandbox intact. Grimoire Mod Manager uses the pinned official 1.28.1 AppImage;
  update its version, URL, and hash together in `nix/packages/grimoire.nix`.
  Legcord, Dolphin/Ark, Steam, Gamescope, and Gamemode are Nix-owned.
  `packages/legcord.nix` replaces only Legcord's packaged desktop/window and fixed
  Discord tray icons with `assets/discordlogo.png`; it does not change the version.
  This copy trims the supplied PNG's large transparent margins and retains a 2%
  inset, so the artwork fills roughly 96% of the icon instead of 60%. Theme icons
  are resampled to their declared `16x16` through `512x512` sizes; window/tray assets
  retain the full-resolution source. A native GTK menu test prevents oversized
  dock context-menu images caused by a high-resolution PNG in a `256x256` folder.
  The original
  `~/Documents/discordlogo.png` is unchanged. Legcord's mutable
  `storage/settings.json` uses `tray = "dsc-tray"` (not dynamic) and `customIcon`
  pointing at `~/.dotfiles/nix/assets/discordlogo.png`. Preferences remain app-owned,
  not whole-file managed by Nix. Fully quit/reopen Legcord after activation;
  restart the dock/Waybar if they retain cached icons. Waybar remains grayscale.
  Plasma's settings app is available for shared/KDE settings; `wdisplays` owns live
  monitor layout changes in Hyprland because KDE's display KCM requires KWin.
  Likewise, KDE's mouse KCM cannot query Hyprland input devices: Piper/ratbagd owns
  supported Logitech gaming-mouse DPI, polling, button, and onboard-profile settings,
  while Hyprland's declarative `input` block owns pointer acceleration.
- Blender and Obsidian use the existing Nixpkgs pin (5.1.1 and 1.13.7 respectively
  at introduction). Obsidian uses the existing unfree-package policy. No vault,
  account, sync subscription, MIME default, or Blender GPU backend is configured.
- Steam has 32/64-bit graphics support. Proton behavior, game ownership, and
  Deadlock compatibility remain runtime acceptance items, not build guarantees.
- tmux 3.7c comes from the existing package-only tools pin. The 3.8 override
  was removed after reported popup/rendering regressions; shared configuration
  and session state are retained. Inactive panes use background-only styling on
  3.7c; the shared 35% dimming gate remains available only on supported 3.8 builds.
  The full shared config and Go sidebar retain Linux and macOS adapters.
  Version changes require a full server restart or reboot; reload is not enough.
- Neovim uses the shared Lua configuration with a Nix-owned plugin tree, parsers,
  language servers, formatters, and native build dependencies. Lazy cannot install
  missing plugins and Mason/parser auto-install is disabled on NixOS.
- Pi 0.99.2 is a narrow package-only pin. All extensions and their dependencies
  are Nix-owned; guidance resources use the live links described below. The pinned
  pi-ast-grep and pi-intercom@0.16.0 workspace is seeded locally, while reviewed
  `michaelmechenko/pi-lens` and `michaelmechenko/pi-btw` revisions are fixed-output
  package directories in the generated settings. Their optional skills are not
  loaded. Lens grammars and runtime dependencies are store-backed, install/refresh
  paths are disabled, mutation and context-injection hard disables are exported,
  and normal startup requires no package download.

Pi settings, keybindings, extension/skill toggles, auth, sessions, package state,
and caches remain writable in `~/.config/pi-config/agent`. Home Manager seeds
settings, keybindings, and the npm workspace only when absent; it never deploys
Mac auth/session/cache state. Seeding preflights all paths, rejects dangling links
and partial npm state, and honors Home Manager dry-run through its run wrapper.
A complete initialized workspace is never merged or reset; back it up and resolve
reported collisions explicitly. The active generated theme is store-backed. Existing writable
Pi settings/npm state needs a separate, backed-up package migration; rebuilding does not
replace it. MCP uses Pi's built-in `$PI_CODING_AGENT_DIR/mcp.json` support, not an adapter.
Intercom retains upstream automatic incoming-turn/steering and no-send-confirmation defaults.

## Desktop icons and shortcuts

Breeze Dark is selected for GTK 3/4, Dolphin/KDE, Fuzzel, GNOME dconf and the
20px Waybar running-window taskbar. Home Manager changes only the GTK icon keys
in the existing writable settings files, the KDE `Icons/Theme` key and the dconf
icon-theme key; other fonts, cursors, colors and widget settings are preserved.
Application icons use their native desktop-entry artwork when available. The
HackerNoonPixel build sources under `packages/pixel-icons*` are retained for
reference but are not installed, selected or required to build the desktop.
Waybar's text-only controls and active/inactive/hover palette styling are unchanged.

Home Manager enables KDE's Qt platform integration (`QT_QPA_PLATFORMTHEME=kde`)
for shell and systemd/UWSM application launches. This makes Dolphin's file and
folder labels follow the existing Breeze Dark palette instead of Qt's default
black text; it does not replace writable KDE/GTK color or widget preferences.
After approved activation, start a fresh Hyprland session and fully close/reopen
Dolphin so launchers and application processes inherit the setting. Opening another
window in an old Dolphin process is insufficient.

Hyprland sets keyboard repeat to 50 repeats/second after a 250ms delay. Super-Ctrl
+A/Z/S/X runs `app-focus` to focus the most recently used mapped window of LibreWolf,
Ghostty, Dolphin or Obsidian across workspaces/monitors, or launches the application
through UWSM if no window exists. The existing Super-B/E/Return launchers still
open new windows. The helper does not launch on Hyprland query failure and retries
a stale window address once. Ctrl-Shift-V remains Ghostty's clipboard paste key.

After approved activation, reopen Dolphin/Fuzzel and restart Waybar to clear icon
caches. Check folder/launcher icons and active, inactive and hovered taskbar icons
on both monitors; verify live repeat settings and test each shortcut with an open
window on another workspace and with no matching window.

## Floating scratch terminal

`home/scratch-terminal.lua` binds Super-Shift-F to one native Hyprland special
workspace, `special:terminal`. First use launches Ghostty through UWSM with the
separate `com.mitchellh.ghostty.scratch` app ID, floating and centered at 70% of
the initial monitor's width and height. It reuses the existing desktop styling.
Later presses hide/show the same terminal; its shell, cwd, scrollback and jobs
remain alive while hidden. Invoking it on the other focused monitor transfers
that terminal there instead of creating a second one. Geometry is set on initial
mapping, not recalculated for differently sized monitors after transfer.

A Home Manager-owned hidden desktop entry matches that scratch app ID and uses
Breeze's installed `yakuake` SVG icon. The scratch terminal has distinct artwork
in the dock and Waybar; ordinary Ghostty keeps its original icon. The dock keeps
native colors and Waybar retains its grayscale rendering. No Yakuake package,
new launcher entry or default dock pin is added. After approved activation,
refresh the dock/Waybar if they cached the old icon; do not close or restart the
scratch terminal to refresh it, since that would discard its running state.
The isolated GTK fixture resolves and renders the icon at 20px and 40px; verify
actual dock/taskbar matching, active/inactive/hover states and unchanged normal
Ghostty icons on both monitors after activation.

Silent placement and a small in-process Lua launch guard preserve the latest
show/hide request during startup without launching twice when an empty hidden
workspace is recreated. There is no polling or additional service. Ordinary
Ghostty launch/focus shortcuts remain separate. Closing the window or exiting
its shell discards that state; a later invocation launches a fresh terminal.
Logout/reboot persistence is not provided. If the launch command fails before a
window maps, correct the launch failure and reload the Hyprland configuration
before retrying; the guard deliberately does not retry a possibly slow launch.
Do not reload while its first launch is pending, since configuration-local state
is reset on reload.

The Lua fixtures exercise configuration and delayed-map toggle sequences without
touching the desktop. After approved activation, verify real focus and initial
geometry, shell-variable/cwd/job retention across hide/show, restoration of the
underlying workspace, both monitor directions, workspace switching, fullscreen
interaction, rapid first-use double/triple presses, and close/crash recovery.
Confirm only one scratch client exists and normal Super-Return/Super-Ctrl-Z still
operate on ordinary Ghostty windows. Fixture success is not live acceptance.

## Sidra scratchpad

Super-Shift-B adopts Sidra's existing ordinary main window into `special:sidra`
on the focused monitor. It becomes floating and centered at 70% of that monitor's
logical width/height; initial adoption leaves fullscreen/maximized mode. Subsequent
presses show/focus or hide the same window, preserving playback and application
state. Invoking it on the other monitor transfers the scratchpad; later toggles
preserve its size. Super-B still opens Helium and Super-Shift-F remains the
independent Ghostty scratch terminal.

There is no second Sidra instance or altered app ID/icon. With no mapped main
window, the shortcut launches `uwsm app -- sidra` once while pending and adopts
the resulting map according to the latest show/hide request. Sidra's own
close-to-tray setting is unchanged: when unmapped, the shortcut invokes its
ordinary singleton launcher to reveal it. Closing/exiting or ending the desktop
session has normal app-owned semantics; this is not logout/reboot recovery.
External dock/Fuzzel launches remain ordinary until explicitly adopted; reload
does not move an already running ordinary window. Launch failure before mapping
requires correcting the failure and reloading configuration before retrying;
avoid reload during a pending launch, just as with the terminal.

After approved activation, test current-window adoption without restarting Sidra,
hide/show playback retention, both monitor directions, cold launch/rapid toggles,
close-to-tray and full-exit recovery, fullscreen interaction and the unchanged
terminal shortcut. Pure Lua fixtures do not replace these live checks.

## Autohiding dock and grayscale Waybar icons

`home/dock.nix` installs locally pinned nwg-dock-hyprland 0.4.11 for Hyprland
0.55 Lua dispatcher compatibility. Hyprland starts one UWSM-owned instance after
session finalization: bottom, centered, 40px native-color icons, 8px bottom margin,
autohiding, with no extra launcher or permanently reserved bottom space. Bottom
hotspots on both outputs reveal the same dock on the hovered monitor. `-hd 0`
disables the upstream 20ms approach-speed gate: reaching the centered 2px bottom
hotspot reveals the dock even when the pointer approaches slowly. The hotspot
remains dock-width, not monitor-wide; visible dock geometry is unchanged. Native
running/multiple-window indicators sit above the icons: one lavender dot for
one open window and two for multiple windows. Closed pins retain a transparent
indicator row above the icon, preserving alignment. A small local package patch
moves the bottom-dock row; the SVG fill comes from `accent-secondary`, preserving
its shape/outline and other dock placements. Upstream disables its focused-window
underline in autohide mode. Panel padding is 6px above/on each side and 11px
below, balancing the 5px indicator row without changing button hit areas or the
8px external screen margin. The top Waybar layout is unchanged.

The dock panel, right-click menus/submenus and tooltips share the desktop's
opaque `surface-chrome`, 2px `divider-subtle` borders, 8px corners and Waybar's
13px Lilex font. Only `#box` paints the panel: top-level reveal detector windows
stay transparent. Hover/pressed states use `surface-highlight`; an inset lavender
outline marks keyboard focus without changing button size. Menu selection uses
lavender text. No blur, shadows, gradients or icon desaturation are added.
`nix/check.sh` runs `home/dock-style-test.py` under isolated GTK3/Xvfb using a
pinned Nix test environment, generated CSS, the canonical palette, a temporary
render directory and packaged icon/indicator paths. It checks widget colors,
state allocations, transparent detectors, 16px menu images and rasterized SVG
indicators: zero/one/two dots, lavender pixels above the button, and unchanged
icon alignment through closed/single/multiple-window transitions. It saves
representative dock/menu/tooltip renders. After approved
activation and dock restart, compare idle/hover/focus, single/multiple-window,
menu/submenu and tooltip states on both monitors; verify slow edge reveal and
that hidden detectors draw nothing. These fixtures do not replace live checks.

Activation seeds Helium, Ghostty, Dolphin and Obsidian only when
`$XDG_CACHE_HOME/nwg-dock-pinned` (default `~/.cache/nwg-dock-pinned`) is absent.
The file stays writable: right-click pin/unpin changes survive rebuilds. Existing
files and symlinks are never replaced. Hidden desktop aliases resolve Obsidian's
and Dolphin's window classes without duplicating launcher entries. Validate
Dolphin's live Wayland class and pin association when first testing the dock.

### Reordering dock apps

This dock version does not implement drag-to-reorder. Pinned apps appear
left-to-right in the line order of `~/.cache/nwg-dock-pinned` (or
`$XDG_CACHE_HOME/nwg-dock-pinned`). Back up the file, edit the existing app/desktop
IDs into the desired order, one per line, then restart the dock before any further
pin/unpin interaction. Its in-memory pin list could otherwise overwrite your edit.
Pin an unpinned running app first if you want a fixed position; remaining unpinned
apps follow the pins, ordered by workspace ID and class.

For a deliberate dock-only restart from the Hyprland session:

```sh
# Matches only the dock executable (including its Nix wrapper), not this shell.
pkill -f '^/[^ ]*/(\\.nwg-dock-hyprland-wrapped|nwg-dock-hyprland)( |$)' || true
uwsm app -- nwg-dock-hyprland -d -p bottom -a center -i 40 -mb 8 -hd 0 -nolauncher
```

Restarting the dock does not close its applications. Neither rebuilds nor this
scratchpad configuration reorder or replace an existing pin file.

The local `packages/waybar-grayscale.patch` desaturates private pixbuf copies in
Waybar's taskbar loader and SNI tray image updater before Cairo rendering. This
covers theme icons, absolute paths and app-provided tray pixmaps in the current
layout, including later updates. Shape, alpha and icon sizes are retained; text,
hover/active backgrounds and urgent colors are unchanged. GTK3's CSS icon effects
cannot provide this guarantee. Breeze Dark folders, launcher icons and dock icons
remain colored; this is not a global icon-theme change. Review the patch when
Waybar is updated or new image modules are enabled. A build-time RGB/RGBA fixture
tests the shared conversion helper, including alpha and source-copy preservation.

Build and run `bash nix/check.sh` before activation. After separate approval,
verify colored dock pins in closed/running/multiple-window/hover states, reveal and
hide on both outputs, menus, cross-workspace activation, fullscreen and monitor
reconnection. Inspect Waybar named/path/pixmap/attention/fallback icons and
active/inactive/hover states on both outputs using isolated colored test icons;
check grayscale RGB channels and transparent edges rather than relying on CSS
parsing. Log out into Plasma and check that neither dock nor Waybar remains.

## Monitor-owned workspaces

`home/workspaces.lua` binds on-demand numeric workspace IDs `101..109` to Samsung
DP-1 and `201..209` to Acer DP-2. Waybar displays these as `1*..9*` and `1^..9^`
using `format-icons`; Hyprland keeps their numeric names. IDs `101` and `201`
(labels `1*` and `1^`) are the fresh-login defaults. Super-number focuses a
primary workspace; Super-Ctrl-number focuses a secondary workspace.

Hyprland chooses slide direction by internal ID, not the displayed label. The
ordered positive IDs make a higher index enter from the right and a lower index
enter from the left, regardless of creation order. Workspace wraparound is
explicitly disabled so it cannot reverse the end-to-end transition.
Adding Shift moves the focused window there and follows it. Super-Shift-W toggles
only the focused window between DP-1 and DP-2, using the destination's currently
active workspace, and follows it. It no-ops without a focused window or when its
output is not DP-1/DP-2. These bindings no-op when the target output is absent.
Super-Shift-period (`>`) and Super-Shift-comma (`<`) move the focused window to
the next/previous numbered workspace on its monitor and follow it. Super-semicolon
and Super-apostrophe focus the previous/next numbered workspace on the active
monitor, even without a focused window. These non-repeating shortcuts include
empty destinations, stop at indices 1 and 9, and never cross monitor ranges.
They no-op on legacy/special workspaces, while a scratchpad is shown on the
acting monitor, or when source/destination ownership no longer matches the
connected monitor. Existing direct-number bindings remain available.

Super-equals/minus sends horizontal relative resize deltas of +25/-25 logical
pixels; adding Shift selects vertical deltas. Hold to repeat. These are native
Hyprland resize operations: floating windows grow/shrink, while dwindle moves
split boundaries, so a positive delta can shrink a focused right/bottom tile.
A lone tiled window or an axis without a split cannot resize; fullscreen windows
are rejected by the native dispatcher. No automatic floating, sign-correction,
or layout-setting changes are applied. The eight new shortcuts use physical US
XKB keycodes (equals 21, minus 20, period 60, comma 59, semicolon 47, apostrophe 48),
so Shift cannot turn the configured key into an unmatched punctuation keysym.
The existing physical Super+left/right drag/resize bindings remain unchanged;
middle-mouse remapping is deferred.

Existing named/numeric workspaces and windows are not renamed or relocated on
reload. Each Waybar shows only its output's populated or active workspaces in ID
order; empty inactive workspaces have no persistent buttons. Unmapped legacy
names remain readable and clickable, but their negative IDs retain the old
animation ordering. Old named workspaces and new numeric workspaces can temporarily
show identical labels. Move old windows manually using the Shift-number bindings;
the bar keeps legacy workspaces accessible until they are emptied. Super-Shift-W
continues to use the destination's active workspace, including a legacy one.
Monitor reconnection can cause Hyprland to reassign monitor-bound workspaces;
test this explicitly.

`packages/waybar-hyprland-lua.patch` repairs built-in workspace clicks for the
Lua-configured Hyprland 0.55 session. Waybar 0.15's old `dispatch workspace 1`
request is invalid under the Lua dispatcher. The patch sends safely quoted Lua
focus/toggle dispatchers and reports failed replies. It also prevents partial
numeric parsing from treating `1*` or `1^` placeholders as numeric workspace 1.
This patch targets this Lua session, not legacy Hyprland configurations; recheck
it when Waybar is upgraded. Existing grayscale patches remain separate.

Build-time tests cover numeric/named/empty-placeholder/special selectors,
move-to-current-monitor semantics and hostile-name escaping. Lua tests cover all
41 workspace bindings, ordered numeric IDs, adjacent stepping across empty
workspaces, endpoint no-ops, bidirectional moves, monitor/special-workspace guards
and nonpersistent rules. Generated-config tests execute all four resize bindings
and check their delta signs, axes, relative sizing and repeat options. After activation approval, verify incoming/outgoing slides
for higher/lower indices on both outputs, including `1` to `9` and back. Verify
that empty inactive buttons disappear, populated inactive and empty active
buttons remain, and labels match their numeric click targets. Check monitor
ownership, all shortcuts, both move directions, disconnected outputs and
fresh-login defaults. Physically test the punctuation shortcuts and resize repeat
on both monitors, including left/right, top/bottom and mixed tiled splits, lone
tiles, floating windows, minimum sizes, fullscreen and different pointer
positions. Verify workspace focus/move-and-follow, endpoint no-ops, empty
workspace visibility and unchanged scratchpads. Do not migrate live windows
automatically. Parsing and fixture tests alone do not establish actual rendered
click or physical-key behavior.

## Configuration ownership

`~/.dotfiles` is the single Git checkout; `~/.config` is the runtime tree.
Home Manager owns every deployed link. Do not layer manual links, Stow, or a
bidirectional copy job on top of it.

| Ownership | Paths under `~/.config` | Applying changes |
| --- | --- | --- |
| Live source links into the same paths under `~/.dotfiles` | `zshrc`, `tmux.conf`, `nvim`, `zed`, `pi-config/agent/AGENTS.md`, `pi-config/agent/agents`, `pi-config/agent/prompts`, `pi-config/agent/skills`, `pi-config/agent/pi-lens-global.json` | Edit the source; reload/restart the application |
| Store-backed configuration and packages | Ghostty, Linux desktop, `oh-my-posh`, active themes, tmux scripts/plugins/sidebar, nnn plugins, shell helpers, all Pi extensions and Neovim dependencies | Build, check, then deliberately activate |
| Local writable state | Pi settings/keybindings/auth/sessions/npm/cache, `zshrc.local`, application state | Leave local; never import whole runtime directories into Git or Nix |

The nine live links use `mkOutOfStoreSymlink` with an absolute home-derived
`~/.dotfiles` path. Keep this checkout in place; do not point links at temporary
worktrees. Directory links pick up new guidance/Lua files without a rebuild.
Changes to the link declarations themselves still require activation.

A source edit, branch switch, or Git update is immediately visible through these
links, even before a build. Review updates first. Reload tmux with its existing
reload binding, open a new shell for zsh, and restart Neovim/Pi as appropriate.
The compiled sidebar and Pi extension code are deliberately **not** live-linked.
On macOS, `tmux-sidebar-build` recompiles `mm-sidebar` on demand after a Go source
change. On NixOS, `MM_SIDEBAR_BIN` points at the store-built package instead: edit,
rebuild, run `nix/check.sh`, then activate only after approval before expecting the
new binary in tmux. Reloading tmux alone cannot replace that store binary. Pi
settings and keybindings remain local seeded copies, not source links.

## Build and activate

The PC's normal source checkout is `~/.dotfiles`. Review its status before pulling
published changes there. Git excludes auth, sessions, caches, logs, and
machine-local `zshrc.local`; private runtime state stays outside the checkout.
Never use `git add .` against the live `~/.config` tree.

`/home/mishka/nixos-config` remains an allowlisted deployment snapshot and
recovery/build staging path. `nix/deploy.sh` creates a fresh snapshot using
`public-source.py`: only Git-tracked paths within the public allowlist enter it,
with private/runtime path components and conventional credential filenames
(`.env`, key/certificate files, credential files) denied even if accidentally tracked.
Git tracking and the subtree policy are not a content-level secret scanner: review
public source contents before adding them.
No broad recursive rsync include is used. The exact `.public-source.json`
inventory covers file bytes, executable bits, directories and relative symlink
targets; missing/extra files, changed types and retargeted links stop deployment.

SSH keeps strict host-key checks. A fresh sibling is transferred and verified
before promotion; the current target is rechecked under a promotion lock and
retained as `nixos-config.previous`. There is no automatic backup deletion.
Promotion is two renames, not an atomic exchange: a failed second rename restores
the original when possible; a process/machine crash between renames can leave
only `.previous` in place. Preserve it and recover explicitly. Failed incoming
directories and stale locks are retained for investigation, not deleted blindly.
Existing legacy snapshots without the new inventory are refused: preserve and
move them aside with approval before the first new-format deployment. A retained
`.previous` must likewise be preserved/rotated deliberately before another run.
Remote Python 3 and rsync are required. Deployment never activates the system.
Never feed the entire live Mac config tree to a `path:` flake or archive operation.
The snapshot is **not** a self-contained runtime backup once live links are used:
even a generation built there links to `~/.dotfiles`, not to the snapshot.
Keep the matching canonical checkout available for recovery. The following is a
remote snapshot operation, not the local configuration update command:

```sh
bash nix/deploy.sh
# For approved untracked additions, repeat: --include nix/path/to/file
```

Override `NIXOS_HOST`, `NIXOS_IDENTITY`, or `NIXOS_CONFIG_DIR` only when the
corresponding deployment endpoint changes.

On the PC, build and validate without changing the running system:

```sh
cd ~/.dotfiles
git status --short
# Pull only after reviewing/preserving local changes:
git pull --ff-only
nix --extra-experimental-features 'nix-command flakes' build \
  .#nixosConfigurations.nixos.config.system.build.toplevel --out-link result
bash nix/check.sh
```

Keep the source unchanged between build, check, and activation; rebuild and
recheck after any edit. `check.sh` refuses a `result` from a different evaluated
system, verifies the live targets and retained packaged dependencies, and reports
migration collisions. Builds and checks do not activate the running system.
The built generation contains `~/.config/nixos/live-source.json`, generated from
its immutable source inputs. Both checking and Home Manager's pre-write activation
guard compare the nine live sources against it, rejecting extra paths before
hashing content. Empty untracked directories have no live source content and are
ignored by live-source comparison (snapshot inventories remain exact).
Source edits need rebuilding before a later activation; rollback
to a guarded generation also requires its matching sources. This guard does not
make live sources immutable or back them up.

New files are invisible to Git flakes until explicitly staged. Without staging,
create a bounded public-only snapshot, naming each reviewed new file explicitly:

```sh
work=$(mktemp -d)
python3 nix/public-source.py snapshot "$PWD" "$work/source" \\
  --include nix/home/wallpaper.nix # repeat --include for EVERY reviewed new file
nix --extra-experimental-features 'nix-command flakes' build \\
  "path:$work/source#nixosConfigurations.nixos.config.system.build.toplevel" \\
  --out-link "$work/result"
NIXOS_FLAKE="path:$work/source" NIXOS_RESULT="$work/result" bash nix/check.sh
```

Never substitute the entire live config tree for that snapshot. A staged/public
snapshot must include all new modules, helpers, tests and the Monet asset; do not
activate a partial export. Keep the exact checked snapshot/result for deliberate
activation and preserve its inventory. No build/check command above activates it.

Checks include disposable-HOME MIME queries, generated background assertions,
synthetic export/promotion and Pi seed failures, and `pi-config/check.mjs`.
`nixos-pi-load-check` imports the pinned SDK and verifies enabled extension and
local npm/Lens/BTW tool registrations in isolation, offline, without creating a
session or emitting session_start. `pi --help` is not extension-load coverage.

### tmux version changes

Build and run `bash nix/check.sh` before deliberate deployment. Use
`nixos-rebuild boot` for a next-reboot version change; it does not replace the
currently running tmux server. Save application work before rebooting. No
session-state rollback or automatic snapshot restore is required by the package
change. After reboot, confirm both `tmux -V` and
`tmux display-message -p '#{version}'` report 3.7c.

If you choose to restore a snapshot, validate its layout format first: 3.8 can
accept legacy 3.7 layouts, but 3.7c does not accept 3.8 JSON layouts. Preserve any
original snapshot rather than assuming backward compatibility. Snapshots do not
preserve running processes or unsaved buffers.

### First migration from recursive store links

Any existing real directories `nvim`, `zed` and
`pi-config/agent/{agents,prompts,skills}` may contain recursively deployed store links. The new generation uses one live
source-directory link for each. Do not remove these directories manually.

1. Save an owner-only backup outside `~/.config` and `~/.dotfiles`, preserving
   symlinks, the affected directories, Pi settings/keybindings, and the current
   system/Home Manager generation identities. Inventory unmanaged files first.
2. Build and run `bash nix/check.sh`. Each directory's `.before-home-manager`
   sibling must be absent, including dangling symlinks. Stop for any unmanaged
   entry; reconcile it explicitly instead of hiding it behind a directory link.
3. After approval, activate the reviewed generation. Home Manager checks for
   collisions, removes obsolete managed leaves, moves each real directory to
   its `.before-home-manager` sibling, then installs its replacement link.
   Keep the separate backup: obsolete managed leaves are cleaned **before**
   these sibling backups are made. The transition is not transactional.
4. Check `systemctl status home-manager-mishka.service`, resolve each live link,
   open a new shell, and test tmux/Neovim/Pi. Confirm settings/keybindings remain
   writable and unchanged. Keep all backups until recovery is no longer needed.

Do **not** run the full Home Manager activation script as a harmless test:
its profile/service actions are not a substitute for isolated fixtures. Pi and
dock seeds use the pinned dry-run wrapper; this is not an activation permission.
The file-link transition can instead be exercised in a disposable HOME using
only the pinned collision/cleanup/link operations, without service/profile hooks.

For the first NixOS bootstrap activation, save work and install the generation for the next boot:

```sh
sudo nixos-rebuild boot --flake /home/mishka/.dotfiles#nixos \
  --option experimental-features 'nix-command flakes'
```

This leaves the current desktop session alone. Reboot when ready; SDDM automatically
starts **Hyprland (managed by UWSM)** for `mishka`. After logging out, select that
same entry for manual login, or Plasma as a fallback. Home Manager activation
runs as part of the new NixOS generation;
existing managed files are backed up with `.before-home-manager`, not overwritten.
If that backup name already exists, activation stops instead of replacing it.

After first boot, use the same flake with `nixos-rebuild switch` for deliberate
updates. `/etc/nixos/configuration.nix` remains the original recovery configuration;
plain `nixos-rebuild` without `--flake` will not build this repository's profile.
Do not change `system.stateVersion` or `home.stateVersion` to upgrade packages.

## Recovery and acceptance

If only Hyprland is broken, select Plasma at SDDM. System generations can otherwise
be rolled back with `sudo nixos-rebuild switch --rollback` or the boot menu, but
**first check whether the old generation predates the live-directory migration**.

An old recursive generation can follow a new directory link and write into the
Git checkout. Before activating **or booting** such a generation:

1. Save any newer source/local changes independently. Confirm that each of the
   five directory targets (including Zed) is still a symlink resolving to its expected path in
   `~/.dotfiles`, and that its preserved directory backup is available.
2. With explicit approval, detach only those five symlinks themselves (`unlink`,
   never a recursive removal or a path with a trailing slash), then restore the
   corresponding backed-up real directories. Check all paths before changing any.
   Do not move anything out of the source checkout or overwrite newer local data.
3. Only then activate the previous generation. Home Manager can recreate any
   old managed leaves removed during the forward migration. The four standalone
   file links do not have the directory-traversal hazard.

Once both generations use the same live-link layout, the representation change
no longer applies. However, **Nix rollback never restores live source edits**:
recover those separately through reviewed Git changes, without a hard reset.
A generation rollback is not a backup of mutable home data either. Keep the
private pre-migration backup and `.before-home-manager` directories until you
explicitly choose to retire this recovery route.

Before treating this profile as daily-driver ready:

1. Log into Hyprland/UWSM. Verify the bar, launcher, Ghostty, Dolphin, browser,
   focus/fullscreen, monitor resolution/refresh, and expected scaling. Test LibreWolf
   Super-Ctrl-A with no window, multiple windows and a window on the other monitor;
   verify its actual class, HTTP/HTTPS/HTML defaults, and unchanged Super-B/Helium.
   Open JPEG/PNG/WebP, PDF/EPUB, MP4/MP3, ZIP and text/Markdown in Dolphin.
2. Check `hyprctl configerrors`, notifications (`notify-send test`), clipboard,
   screenshot selection/cancellation, volume, Wi-Fi, Bluetooth, and USB mounting.
3. Lock with Super-Ctrl-L and unlock with the user password; then test explicit
   suspend/resume and confirm the session locks before sleep. Leave the machine
   idle past the former 10-minute timeout and confirm it does not lock. Inspect
   Monet cropping on both desktops and blur/dim/password readability on both lock
   surfaces; test failed authentication, successful unlock and monitor reconnect.
4. Test microphone and portal file selection/screen sharing. Compare Vulkan
   device selection with the RX 9060 XT; the CPU's iGPU also exists.
5. Log out using the session menu, return to Plasma, and verify there is no
   leftover Waybar/mako/hypridle/hyprpaper/polkit process from Hyprland.

Build and parse checks are supplementary: real desktop rendering and interactive
behavior require the user-selected session. They are not implied by a successful
`nix build`. See `../KEYBINDS.md` for the Linux bootstrap key reference.
