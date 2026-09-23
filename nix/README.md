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
- Pi 0.86.1 is a narrow package-only pin. Public extensions/skills/prompts and
  dependency-bearing local extensions are Nix-owned. The pinned pi-lsp,
  pi-ast-grep, and pi-mcp-adapter workspace is seeded locally, so normal startup
  does not need an npm install. pi-lsp is patched to honor `PI_CODING_AGENT_DIR`.

Pi settings, keybindings, extension/skill toggles, auth, sessions, package state,
and caches remain writable in `~/.config/pi-config/agent`. Home Manager seeds
settings, keybindings, and the npm workspace only when absent; it never deploys
Mac auth/session/cache state. The active generated theme is store-backed.

## Build and activate

The deployment is an allowlisted snapshot at `/home/mishka/nixos-config` on
the PC. It includes the flake/Nix modules plus only the public shared config and
source trees required by the Linux profile. It is not a clone of the Mac's live
`~/.config`; node_modules, auth, sessions, caches, logs, SSH material, browser
profiles, Steam state, and machine-local `zshrc.local` are excluded. Local source
of truth remains this repository. `nix/deploy.sh` verifies the previous SHA-256
manifest and refuses to overwrite PC-side edits before updating the allowlist.
Never feed the entire live Mac config tree to a `path:` flake or archive operation.

```sh
bash nix/deploy.sh
```

Override `NIXOS_HOST`, `NIXOS_IDENTITY`, or `NIXOS_CONFIG_DIR` only when the
corresponding deployment endpoint changes.

On the PC, build and validate without changing the running system:

```sh
cd /home/mishka/nixos-config
nix --extra-experimental-features 'nix-command flakes' build \
  .#nixosConfigurations.nixos.config.system.build.toplevel --out-link result
bash nix/check.sh
```

For the first activation, save work and install the generation for the next boot:

```sh
sudo nixos-rebuild boot --flake /home/mishka/nixos-config#nixos \
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

At boot, select the previous NixOS generation if necessary. If only Hyprland is
broken, select Plasma at SDDM. From a working terminal, `sudo nixos-rebuild switch
--rollback` restores the preceding system generation. A rollback is not a home-data
backup: inspect Home Manager's `.before-home-manager` files if reverting user files.

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
