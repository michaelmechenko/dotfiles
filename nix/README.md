# NixOS desktop bootstrap

This is a Linux-only first-stage profile for `mishka` on host `nixos`.
The Mac configuration is not sourced or modified. The installed NixOS revision
is pinned in `flake.nix`; `flake.lock` also pins Home Manager.

## Ownership and scope

- `hosts/nixos/configuration.nix` and `hardware-configuration.nix`: captured
  installer configuration. Keep filesystem identifiers and `stateVersion` intact.
- `modules/desktop.nix`: NixOS Hyprland/UWSM/portal/PAM/hardware integration.
- `home/desktop.nix`: Hyprland Lua, Waybar, launcher, notifications, lock/idle.
- `home/apps.nix`: Sidra, Helium, Legcord, Dolphin integrations and MIME defaults.
- `home/terminal.nix`: shared Ghostty, zsh, prompt, tmux/sidebar, nnn, and Neovim.
- `home/pi.nix`: Pi runtime, public resources, pinned dependencies, and writable seeds.
- `home/palette.nix`: consumes canonical `theme/palettes/vague.json` roles,
  references, and overrides. No second hand-maintained palette.

Plasma/SDDM, networking, audio, firewall, SSH, and disk layout are preserved.
No automatic updates, garbage collection, passwordless sudo, disk changes,
or reboot are introduced. SSH password authentication is not changed by this
bootstrap; harden it separately after verifying persistent key access.

## Intended rendering and behavior

- A 34px top Waybar on every monitor: Apps, workspaces, running app icons;
  centered clock; volume, network, Bluetooth, tray and session menu on the right.
- Active workspace/app: lavender on the highlight surface; inactive: muted UI
  text on chrome; urgent workspace: rose. Offline/muted states say so in text.
- Focused window: lavender border; unfocused: subtle divider border. Eight-pixel
  corners, no transparency or blur. Restrained 150–250ms window/fade/workspace
  animations are enabled. Fullscreen follows Hyprland defaults.
- Monitor mode/scale are auto-detected. Test native resolution and 100%/150%
  scaling, several open apps, long titles, fullscreen, and disconnected network.
- Notifications: chrome/text/lavender; critical messages persist with rose borders.
  Lock screen: solid canvas and centered password input on every monitor.
- Only Hyprland starts Waybar, mako, hypridle, the secrets component of
  gnome-keyring, and its polkit agent. UWSM owns their lifetime; they must not
  follow the user back into Plasma or replace Plasma's wallet.

The bar is a clickable taskbar, not a macOS global File/Edit menu or an
animated auto-hiding dock. A separate dock can be chosen after the baseline works.

## Applications and shared workflows

- Sidra uses its pinned upstream flake so CastLabs Electron/Widevine remains
  unmodified. Helium uses the pinned official Linux 0.17.2.1 release with its
  sandbox intact. Grimoire Mod Manager uses the pinned official 1.28.1 AppImage;
  update its version, URL, and hash together in `nix/packages/grimoire.nix`.
  Legcord, Dolphin/Ark, Steam, Gamescope, and Gamemode are Nix-owned.
  Plasma's settings app is available for shared/KDE settings; `wdisplays` owns live
  monitor layout changes in Hyprland because KDE's display KCM requires KWin.
  Likewise, KDE's mouse KCM cannot query Hyprland input devices: Piper/ratbagd owns
  supported Logitech gaming-mouse DPI, polling, button, and onboard-profile settings,
  while Hyprland's declarative `input` block owns pointer acceleration.
- Steam has 32/64-bit graphics support. Proton behavior, game ownership, and
  Deadlock compatibility remain runtime acceptance items, not build guarantees.
- tmux 3.7b comes from the package-only tools pin. The full shared config and Go
  sidebar use Linux clipboard/open/reveal/system-stat adapters while retaining the
  existing macOS branches.
- Neovim uses the shared Lua configuration with a Nix-owned plugin tree, parsers,
  language servers, formatters, and native build dependencies. Lazy cannot install
  missing plugins and Mason/parser auto-install is disabled on NixOS.
- Pi 0.86.1 is a narrow package-only pin. All extensions and their dependencies
  are Nix-owned; guidance resources use the live links described below. The pinned pi-lsp,
  pi-ast-grep, and pi-mcp-adapter workspace is seeded locally, so normal startup
  does not need an npm install. pi-lsp is patched to honor `PI_CODING_AGENT_DIR`.

Pi settings, keybindings, extension/skill toggles, auth, sessions, package state,
and caches remain writable in `~/.config/pi-config/agent`. Home Manager seeds
settings, keybindings, and the npm workspace only when absent; it never deploys
Mac auth/session/cache state. The active generated theme is store-backed.

## Configuration ownership

`~/.dotfiles` is the single Git checkout; `~/.config` is the runtime tree.
Home Manager owns every deployed link. Do not layer manual links, Stow, or a
bidirectional copy job on top of it.

| Ownership | Paths under `~/.config` | Applying changes |
| --- | --- | --- |
| Live source links into the same paths under `~/.dotfiles` | `zshrc`, `tmux.conf`, `nvim`, `pi-config/agent/AGENTS.md`, `pi-config/agent/agents`, `pi-config/agent/prompts`, `pi-config/agent/skills` | Edit the source; reload/restart the application |
| Store-backed configuration and packages | Ghostty, Linux desktop, `oh-my-posh`, active themes, tmux scripts/plugins/sidebar, nnn plugins, shell helpers, all Pi extensions and Neovim dependencies | Build, check, then deliberately activate |
| Local writable state | Pi settings/keybindings/auth/sessions/npm/cache, `zshrc.local`, application state | Leave local; never import whole runtime directories into Git or Nix |

The seven live links use `mkOutOfStoreSymlink` with an absolute home-derived
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

This leaves the current desktop session alone. Reboot when ready. In SDDM choose
**Hyprland (managed by UWSM)**, not the unmanaged Hyprland entry. Plasma remains
available. Home Manager activation runs as part of the new NixOS generation;
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
3. Lock with Super-Ctrl-L and unlock with the user password; test idle locking
   and suspend/resume. Do not rely on locking until this succeeds.
4. Test microphone and portal file selection/screen sharing. Compare Vulkan
   device selection with the RX 9060 XT; the CPU's iGPU also exists.
5. Log out using the session menu, return to Plasma, and verify there is no
   leftover Waybar/mako/hypridle/polkit process from Hyprland.

Build and parse checks are supplementary: real desktop rendering and interactive
behavior require the user-selected session. They are not implied by a successful
`nix build`. See `../KEYBINDS.md` for the Linux bootstrap key reference.
