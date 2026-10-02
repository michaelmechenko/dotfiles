# NixOS desktop bootstrap

This is a Linux-only first-stage profile for `mishka` on host `nixos`.
The Mac configuration is not sourced or modified. The installed NixOS revision
is pinned in `flake.nix`; `flake.lock` also pins Home Manager.

## Ownership and scope

- `hosts/nixos/configuration.nix` and `hardware-configuration.nix`: captured
  installer configuration. Keep filesystem identifiers and `stateVersion` intact.
- `modules/desktop.nix`: NixOS Hyprland/UWSM/portal/PAM/hardware integration.
- `home/desktop.nix`: Hyprland Lua, Waybar, launcher, notifications, lock/idle.
- `home/apps.nix`: Blender, Obsidian, Sidra, Helium, Legcord, Dolphin and MIME defaults.
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

- A 34px top Waybar on every monitor: Apps, workspaces, running app icons;
  centered clock; volume, network, Bluetooth, tray and session menu on the right.
  The session menu (also Super-Shift-Escape) offers Lock, Sleep, Log out, Restart,
  and Shut down. Sleep runs `systemctl suspend`; Hypridle requests locking before
  sleep. The session stays in RAM and still requires power. Hypridle has no idle
  timeout, so inactivity does not lock the session or power off the displays;
  manual locking and locking before explicit sleep remain enabled.
- Active workspace/app: lavender on the highlight surface; inactive: muted UI
  text on chrome; urgent workspace: rose. Offline/muted states say so in text.
- Focused window: lavender border; unfocused: subtle divider border. Eight-pixel
  corners, no transparency or blur. Restrained 150–250ms window/fade/workspace
  animations are enabled. `misc.vrr = 2` enables variable refresh rate only
  with fullscreen windows on displays supporting adaptive sync; ordinary
  windowed use keeps VRR off. Other fullscreen behavior follows Hyprland defaults.
- Both monitors use 2560×1440 at nominal 180 Hz and 100% scale, top-aligned:
  Samsung Odyssey G50SF (`DP-1`) is on the left at `0x0`, using its advertised
  179.98 Hz mode; Acer XZ322QU V3 (`DP-2`) is on the right at `2560x0`, at 180 Hz.
  Other outputs retain preferred-mode, automatic-position, automatic-scale fallback.
  After activation, verify refresh rates, pointer crossing, Waybar and window
  placement, fullscreen behavior, and persistence across the next login.
- Notifications: chrome/text/lavender; critical messages persist with rose borders.
  Lock screen: solid canvas and centered password input on every monitor.
- Only Hyprland starts Waybar, mako, hypridle, the secrets component of
  gnome-keyring, and its polkit agent. UWSM owns their lifetime; they must not
  follow the user back into Plasma or replace Plasma's wallet.

Waybar retains its running-window taskbar. A separate nwg-dock-hyprland dock
provides pinned applications at the bottom edge (see below).

## Applications and shared workflows

- Sidra uses its pinned upstream flake so CastLabs Electron/Widevine remains
  unmodified. Helium uses the pinned official Linux 0.17.2.1 release with its
  sandbox intact. Grimoire Mod Manager uses the pinned official 1.28.1 AppImage;
  update its version, URL, and hash together in `nix/packages/grimoire.nix`.
  Legcord, Dolphin/Ark, Steam, Gamescope, and Gamemode are Nix-owned.
  `packages/legcord.nix` replaces only Legcord's packaged desktop/window and fixed
  Discord tray icons with `assets/discordlogo.png`; it does not change the version.
  Legcord's mutable `storage/settings.json` uses `tray = "dsc-tray"` (not dynamic)
  and `customIcon` pointing at the supplied logo. Preferences remain app-owned,
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
- tmux 3.7b comes from the package-only tools pin. The full shared config and Go
  sidebar use Linux clipboard/open/reveal/system-stat adapters while retaining the
  existing macOS branches.
- Neovim uses the shared Lua configuration with a Nix-owned plugin tree, parsers,
  language servers, formatters, and native build dependencies. Lazy cannot install
  missing plugins and Mason/parser auto-install is disabled on NixOS.
- Pi 0.86.1 is a narrow package-only pin. All extensions and their dependencies
  are Nix-owned; guidance resources use the live links described below. The pinned
  pi-ast-grep and pi-mcp-adapter workspace is seeded locally, while reviewed
  `michaelmechenko/pi-lens` and `michaelmechenko/pi-btw` revisions are fixed-output
  package directories in the generated settings. Their optional skills are not
  loaded. Lens grammars and runtime dependencies are store-backed, install/refresh
  paths are disabled, mutation and context-injection hard disables are exported,
  and normal startup requires no package download.

Pi settings, keybindings, extension/skill toggles, auth, sessions, package state,
and caches remain writable in `~/.config/pi-config/agent`. Home Manager seeds
settings, keybindings, and the npm workspace only when absent; it never deploys
Mac auth/session/cache state. The active generated theme is store-backed.

## Desktop icons and shortcuts

Breeze Dark is selected for GTK 3/4, Dolphin/KDE, Fuzzel, GNOME dconf and the
20px Waybar running-window taskbar. Home Manager changes only the GTK icon keys
in the existing writable settings files, the KDE `Icons/Theme` key and the dconf
icon-theme key; other fonts, cursors, colors and widget settings are preserved.
Application icons use their native desktop-entry artwork when available. The
HackerNoonPixel build sources under `packages/pixel-icons*` are retained for
reference but are not installed, selected or required to build the desktop.
Waybar's text-only controls and active/inactive/hover palette styling are unchanged.

Hyprland sets keyboard repeat to 50 repeats/second after a 250ms delay. Super-Ctrl
+A/Z/S/X runs `app-focus` to focus the most recently used mapped window of Helium,
Ghostty, Dolphin or Obsidian across workspaces/monitors, or launches the application
through UWSM if no window exists. The existing Super-B/E/Return launchers still
open new windows. The helper does not launch on Hyprland query failure and retries
a stale window address once. Ctrl-Shift-V remains Ghostty's clipboard paste key.

After approved activation, reopen Dolphin/Fuzzel and restart Waybar to clear icon
caches. Check folder/launcher icons and active, inactive and hovered taskbar icons
on both monitors; verify live repeat settings and test each shortcut with an open
window on another workspace and with no matching window.

## Autohiding dock and grayscale Waybar icons

`home/dock.nix` installs locally pinned nwg-dock-hyprland 0.4.11 for Hyprland
0.55 Lua dispatcher compatibility. Hyprland starts one UWSM-owned instance after
session finalization: bottom, centered, 40px native-color icons, 8px bottom margin,
autohiding, with no extra launcher or permanently reserved bottom space. Bottom
hotspots on both outputs reveal the same dock on the hovered monitor. Native
running/multiple-window indicators remain; upstream disables its focused-window
underline in autohide mode. The top Waybar layout and existing shortcuts remain.

Activation seeds Helium, Ghostty, Dolphin and Obsidian only when
`$XDG_CACHE_HOME/nwg-dock-pinned` (default `~/.cache/nwg-dock-pinned`) is absent.
The file stays writable: right-click pin/unpin changes survive rebuilds. Existing
files and symlinks are never replaced. Hidden desktop aliases resolve Obsidian's
and Dolphin's window classes without duplicating launcher entries. Validate
Dolphin's live Wayland class and pin association when first testing the dock.

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
37 bindings, ordered numeric IDs, bidirectional moves, monitor guards and
nonpersistent rules. After activation approval, verify incoming/outgoing slides
for higher/lower indices on both outputs, including `1` to `9` and back. Verify
that empty inactive buttons disappear, populated inactive and empty active
buttons remain, and labels match their numeric click targets. Check monitor
ownership, all shortcuts, both move directions, disconnected outputs and
fresh-login defaults. Do not migrate live windows automatically.
Parsing and fixture tests alone do not establish actual rendered click behavior.

## Configuration ownership

`~/.dotfiles` is the single Git checkout; `~/.config` is the runtime tree.
Home Manager owns every deployed link. Do not layer manual links, Stow, or a
bidirectional copy job on top of it.

| Ownership | Paths under `~/.config` | Applying changes |
| --- | --- | --- |
| Live source links into the same paths under `~/.dotfiles` | `zshrc`, `tmux.conf`, `nvim`, `pi-config/agent/AGENTS.md`, `pi-config/agent/agents`, `pi-config/agent/prompts`, `pi-config/agent/skills`, `pi-config/agent/pi-lens-global.json` | Edit the source; reload/restart the application |
| Store-backed configuration and packages | Ghostty, Linux desktop, `oh-my-posh`, active themes, tmux scripts/plugins/sidebar, nnn plugins, shell helpers, all Pi extensions and Neovim dependencies | Build, check, then deliberately activate |
| Local writable state | Pi settings/keybindings/auth/sessions/npm/cache, `zshrc.local`, application state | Leave local; never import whole runtime directories into Git or Nix |

The eight live links use `mkOutOfStoreSymlink` with an absolute home-derived
`~/.dotfiles` path. Keep this checkout in place; do not point links at temporary
worktrees. Directory links pick up new guidance/Lua files without a rebuild.
Changes to the link declarations themselves still require activation.

A source edit, branch switch, or Git update is immediately visible through these
links, even before a build. Review updates first. Reload tmux with its existing
reload binding, open a new shell for zsh, and restart Neovim/Pi as appropriate.
The compiled sidebar and Pi extension code are deliberately **not** live-linked.
Pi settings and keybindings remain local seeded copies, not source links.

## Build and activate

The PC's normal source checkout is `~/.dotfiles`. Review its status before pulling
published changes there. Git excludes auth, sessions, caches, logs, and
machine-local `zshrc.local`; private runtime state stays outside the checkout.
Never use `git add .` against the live `~/.config` tree.

`/home/mishka/nixos-config` remains an allowlisted deployment snapshot and
recovery/build staging path. `nix/deploy.sh` verifies its previous SHA-256
manifest and refuses to overwrite PC-side edits before updating the allowlist.
Never feed the entire live Mac config tree to a `path:` flake or archive operation.
The snapshot is **not** a self-contained runtime backup once live links are used:
even a generation built there links to `~/.dotfiles`, not to the snapshot.
Keep the matching canonical checkout available for recovery. The following is a
remote snapshot operation, not the local configuration update command:

```sh
bash nix/deploy.sh
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

### First migration from recursive store links

The existing real directories `nvim` and `pi-config/agent/{agents,prompts,skills}`
contain recursively deployed store links. The new generation uses one live
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

Do **not** run the full Home Manager activation script as a harmless dry-run:
existing custom activation actions include direct writes not guarded by `run`.
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
   four directory targets is still a symlink resolving to its expected path in
   `~/.dotfiles`, and that its preserved directory backup is available.
2. With explicit approval, detach only those four symlinks themselves (`unlink`,
   never a recursive removal or a path with a trailing slash), then restore the
   corresponding backed-up real directories. Check all paths before changing any.
   Do not move anything out of the source checkout or overwrite newer local data.
3. Only then activate the previous generation. Home Manager can recreate any
   old managed leaves removed during the forward migration. The three standalone
   file links do not have the directory-traversal hazard.

Once both generations use the same live-link layout, the representation change
no longer applies. However, **Nix rollback never restores live source edits**:
recover those separately through reviewed Git changes, without a hard reset.
A generation rollback is not a backup of mutable home data either. Keep the
private pre-migration backup and `.before-home-manager` directories until you
explicitly choose to retire this recovery route.

Before treating this profile as daily-driver ready:

1. Log into Hyprland/UWSM. Verify the bar, launcher, Ghostty, Dolphin, browser,
   focus/fullscreen, monitor resolution/refresh, and expected scaling.
2. Check `hyprctl configerrors`, notifications (`notify-send test`), clipboard,
   screenshot selection/cancellation, volume, Wi-Fi, Bluetooth, and USB mounting.
3. Lock with Super-Ctrl-L and unlock with the user password; then test explicit
   suspend/resume and confirm the session locks before sleep. Leave the machine
   idle past the former 10-minute timeout and confirm it does not lock.
4. Test microphone and portal file selection/screen sharing. Compare Vulkan
   device selection with the RX 9060 XT; the CPU's iGPU also exists.
5. Log out using the session menu, return to Plasma, and verify there is no
   leftover Waybar/mako/hypridle/polkit process from Hyprland.

Build and parse checks are supplementary: real desktop rendering and interactive
behavior require the user-selected session. They are not implied by a successful
`nix build`. See `../KEYBINDS.md` for the Linux bootstrap key reference.
