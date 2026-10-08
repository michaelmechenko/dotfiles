#!/usr/bin/env bash
# Run on the NixOS PC after building ./result; never activates the system.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -s) == Linux ]] || { echo 'Run this check on the NixOS PC.' >&2; exit 1; }
test -x result/bin/switch-to-configuration
nix_eval() {
  nix --extra-experimental-features 'nix-command flakes' eval --raw ".#nixosConfigurations.nixos.config.$1"
}
# Do not accidentally validate a different checkout generation from ./result.
expected_system=$(nix_eval system.build.toplevel)
[[ $(readlink -e result) == "$expected_system" ]] || {
  echo 'STOP: result is stale; rebuild this unchanged checkout before checking.' >&2
  exit 1
}
home_package=$(nix_eval home-manager.users.mishka.home.activationPackage)
home_path=$(nix_eval home-manager.users.mishka.home.path)
sessions=$(nix_eval services.displayManager.sessionData.desktops)
export PATH="$home_path/bin:$PWD/result/sw/bin:$PATH"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
files="$home_package/home-files"
# The selected icon theme must be available before GTK/KDE settings are activated.
[[ $(nix_eval home-manager.users.mishka.gtk.iconTheme.name) == breeze-dark ]]
test -f "$home_path/share/icons/breeze-dark/index.theme"
test -x "$home_path/bin/app-focus"
python3 nix/home/app-focus-test.py
lua nix/home/workspaces-test.lua
lua nix/home/scratch-terminal-test.lua
lua nix/home/scratch-sidra-test.lua
[[ $("$home_path/bin/nwg-dock-hyprland" -v) == 'nwg-dock-hyprland version 0.4.11' ]]
bash nix/home/dock-seed-test.sh
# The painted panel is separate from the transparent layer-shell detectors.
dock_css="$files/.config/nwg-dock-hyprland/style.css"
rg -q '^#box \{' "$dock_css"
rg -q 'background: transparent;' "$dock_css"
rg -q 'border: 2px solid' "$dock_css"
rg -q 'outline-offset: -1px;' "$dock_css"
rg -q '^menu, tooltip \{' "$dock_css"
# Alias desktop entries must be hidden from launchers but usable by the dock.
for alias in md.obsidian.Obsidian dolphin com.mitchellh.ghostty.scratch; do
  entry="$files/.local/share/applications/$alias.desktop"
  [[ -f "$entry" ]]
  rg -q '^NoDisplay=true$' "$entry"
  rg -q '^Exec=' "$entry"
  rg -q '^Icon=' "$entry"
done
scratch_entry="$files/.local/share/applications/com.mitchellh.ghostty.scratch.desktop"
normal_ghostty_entry="$home_path/share/applications/com.mitchellh.ghostty.desktop"
test -f "$normal_ghostty_entry"
test -f "$home_path/share/icons/breeze-dark/apps/48/yakuake.svg"
python3 - "$scratch_entry" "$normal_ghostty_entry" <<'PY'
import configparser
import sys
def entry(path):
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(path)
    return parser["Desktop Entry"]
scratch, normal = map(entry, sys.argv[1:])
assert scratch["Type"] == "Application" and scratch["Name"] == "Scratch Terminal"
assert scratch["Icon"] == "yakuake" and scratch["StartupWMClass"] == "com.mitchellh.ghostty.scratch"
assert scratch["NoDisplay"] == "true" and scratch["Terminal"] == "false"
assert scratch["Exec"] == "ghostty --class=com.mitchellh.ghostty.scratch --gtk-single-instance=true"
assert "Actions" not in scratch
assert normal["Icon"] != scratch["Icon"]
assert "com.mitchellh.ghostty.scratch" not in normal["Exec"]
PY
[[ $(rg -c 'uwsm app -- nwg-dock-hyprland -d -p bottom -a center -i 40 -mb 8 -hd 0 -nolauncher' "$files/.config/hypr/hyprland.lua") == 1 ]]
test -x "$home_path/bin/blender"
test -x "$home_path/bin/obsidian"
test -f "$home_path/share/applications/blender.desktop"
test -f "$home_path/share/applications/obsidian.desktop"
# Theme icon dimensions must match their directories; ASAR assets retain the full logo.
python3 - "$home_path" "$PWD/nix/assets/discordlogo.png" <<'PY'
import json
from pathlib import Path
import struct
import sys
home = Path(sys.argv[1])
expected = Path(sys.argv[2]).read_bytes()
for size in (16, 22, 24, 32, 48, 64, 128, 256, 512):
    data = (home / f"share/icons/hicolor/{size}x{size}/apps/legcord.png").read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">2I", data[16:24]) == (size, size)
assert "Icon=legcord\n" in (home / "share/applications/legcord.desktop").read_text()
with (home / "share/lib/legcord/resources/app.asar").open("rb") as archive:
    _, header_size, _, json_size = struct.unpack("<4I", archive.read(16))
    assets = json.loads(archive.read(json_size))["files"]["assets"]["files"]
    for name in ("desktop.png", "dsc-tray.png"):
        entry = assets[name]
        archive.seek(8 + header_size + int(entry["offset"]))
        assert archive.read(entry["size"]) == expected, name
print("Legcord: correctly sized theme icons and full-resolution window/tray assets passed.")
PY
configured_home=$(nix_eval home-manager.users.mishka.home.homeDirectory)
[[ $HOME == "$configured_home" ]] || { echo 'Run this check as the configured user.' >&2; exit 1; }
live_paths=(
  zshrc tmux.conf nvim zed pi-config/agent/AGENTS.md
  pi-config/agent/agents pi-config/agent/prompts pi-config/agent/skills
  pi-config/agent/pi-lens-global.json
)
for relative in "${live_paths[@]}"; do
  source="$configured_home/.dotfiles/$relative"
  [[ -r $source && -L "$files/.config/$relative" ]]
  [[ $(readlink -e "$files/.config/$relative") == "$(readlink -e "$source")" ]]
done
# Reject accidental expansion of the live-link set, without following directory
# links into the user's checkout or enumerating private runtime state.
python3 - "$files" "${live_paths[@]}" <<'PY'
import os
from pathlib import Path
import sys
root = Path(sys.argv[1])
expected = {'.config/' + path for path in sys.argv[2:]}
actual = set()
for directory, directories, files in os.walk(root, followlinks=False):
    for name in directories + files:
        path = Path(directory) / name
        if path.is_symlink() and not str(path.resolve()).startswith('/nix/store/'):
            actual.add(str(path.relative_to(root)))
assert actual == expected, f'Unexpected live-link set: missing={expected - actual}, extra={actual - expected}'
PY
# These must remain store-backed, not acquire a second live dependency model.
for relative in nwg-dock-hyprland/style.css ghostty/config oh-my-posh/config.json theme/active/tmux/colors.conf \
    tmux_scripts tmux_plugins nnn/plugins pi-config/agent/extensions \
    pi-config/agent/themes/active.json; do
  [[ $(readlink -e "$files/.config/$relative") == /nix/store/* ]]
done
for relative in settings.json keybindings.json auth.json sessions npm; do
  [[ ! -e "$files/.config/pi-config/agent/$relative" && ! -L "$files/.config/pi-config/agent/$relative" ]]
done

test -f "$sessions/share/wayland-sessions/plasma.desktop"
test -f "$sessions/share/wayland-sessions/hyprland-uwsm.desktop"
Hyprland --verify-config -c "$files/.config/hypr/hyprland.lua"
python3 - "$files/.config/waybar/config" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    bars = json.load(source)
bar = bars[0] if isinstance(bars, list) else bars
workspaces = bar['hyprland/workspaces']
assert 'on-click' not in workspaces
assert workspaces['all-outputs'] is False
assert workspaces['move-to-monitor'] is False
assert workspaces['sort-by'] == 'id'
assert bar['modules-left'] == ['custom/menu', 'hyprland/workspaces']
assert 'wlr/taskbar' not in bar
assert workspaces['format'] == '{icon} {windows}'
assert not workspaces.get('show-special', False)
assert workspaces['disable-scroll'] is True
taskbar = workspaces['workspace-taskbar']
assert taskbar == {
    'enable': True,
    'format': '{icon}',
    'icon-size': 20,
    'icon-theme': 'breeze-dark',
    'update-active-window': True,
    'active-window-position': 'none',
    'on-click-window': "if [ {button} = 1 ]; then hyprctl dispatch \"hl.dsp.focus({ window = 'address:{address}' })\"; fi",
}
assert workspaces['format-icons'] == {
    **{str(100 + i): f'{i}*' for i in range(1, 10)},
    **{str(200 + i): f'{i}^' for i in range(1, 10)},
}  # No state/default override may mask labels of legacy workspaces.
assert not workspaces.get('persistent-only', False)
assert not workspaces.get('persistent-workspaces')
assert not workspaces.get('active-only', False)  # Keep populated inactive workspaces visible.
PY
ghostty +validate-config --config-file="$files/.config/ghostty/config"
zsh -n "$files/.config/zsh/.zshrc"
zsh -n "$files/.config/zshrc"
# Parse every Lua module without starting Lazy or writing plugin state.
find -L "$files/.config/nvim" -type f -name '*.lua' -print0 | xargs -0 luac -p

# Use an isolated HOME/socket; the short-lived session exits naturally and
# cannot touch the user's live tmux server or mutable plugin state.
test_home=$(mktemp -d)
trap 'rm -rf "$test_home"' EXIT
mkdir -p "$test_home/.config" "$test_home/runtime" "$test_home/tmp"
chmod 700 "$test_home/runtime"
# Build only the pinned native test environment; the fixture is read from this
# checkout, so newly added tests need not be staged for flakes to include them.
dock_fixture=$(nix --extra-experimental-features 'nix-command flakes' build \
  --impure --no-link --print-out-paths --expr '
  let
    p = (builtins.getFlake (toString ./.)).nixosConfigurations.nixos.pkgs;
    python = p.python3.withPackages (x: [ x.pygobject3 x.pillow ]);
    paths = p.lib.makeSearchPath "lib/girepository-1.0" (map p.lib.getLib [
      p.gtk3 p.gdk-pixbuf p.pango p.at-spi2-core p.gobject-introspection
      p.harfbuzz p.glib
    ]);
  in p.writeShellScript "dock-gtk-fixture" "
    export GI_TYPELIB_PATH=${paths}
    export GDK_BACKEND=x11
    exec ${p.xvfb-run}/bin/xvfb-run -a ${python}/bin/python3 \"$@\" ${p.hicolor-icon-theme}/share/icons
  "')
HOME="$test_home" XDG_CONFIG_HOME="$test_home/.config" \
  XDG_CACHE_HOME="$test_home/cache" XDG_RUNTIME_DIR="$test_home/runtime" \
  SCRATCH_DESKTOP_ENTRY="$scratch_entry" NORMAL_GHOSTTY_DESKTOP_ENTRY="$normal_ghostty_entry" \
  "$dock_fixture" nix/home/dock-style-test.py "$dock_css" \
    theme/palettes/vague.json "$test_home/dock-renders" \
    "$home_path/share/nwg-dock-hyprland/images" "$home_path/share/icons"
ln -s "$files/.config/tmux.conf" "$test_home/.config/tmux.conf"
ln -s "$files/.config/theme" "$test_home/.config/theme"
ln -s "$files/.config/tmux_scripts" "$test_home/.config/tmux_scripts"
# env -i also removes inherited TMUX/TMUX_PANE and live session variables.
# A private socket avoids the live server even when this check runs inside tmux.
socket="$test_home/tmux.sock"
isolated=(env -i HOME="$test_home" PATH="$home_path/bin:$PWD/result/sw/bin:/usr/bin:/bin"
  XDG_CONFIG_HOME="$test_home/.config" XDG_DATA_HOME="$test_home/data"
  XDG_STATE_HOME="$test_home/state" XDG_CACHE_HOME="$test_home/cache"
  XDG_RUNTIME_DIR="$test_home/runtime" TMPDIR="$test_home/tmp")
"${isolated[@]}" tmux -S "$socket" -f "$files/.config/tmux.conf" \
  new-session -d -s validation 'sleep 3'
[[ $("${isolated[@]}" tmux -S "$socket" show-options -gv prefix) == C-Space ]]
[[ $("${isolated[@]}" tmux -S "$socket" show-options -gv extended-keys-format) == csi-u ]]
# Let the fixture exit naturally before removing its socket/HOME.
sleep 4

# Neovim must start from the Nix-owned plugin tree without cloning into its
# writable data directory. Keep HOME isolated because theme-selector uses ~/.
plugin_path=$(nix_eval home-manager.users.mishka.home.sessionVariables.NVIM_PLUGIN_PATH)
lazy_path=$(nix_eval home-manager.users.mishka.home.sessionVariables.NVIM_LAZY_PATH)
treesitter_path=$(nix_eval home-manager.users.mishka.home.sessionVariables.NVIM_TREESITTER_RTP)
ln -s "$files/.config/nvim" "$test_home/.config/nvim"
# theme was already linked for the isolated tmux test above.
output=$(env -i HOME="$test_home" PATH="$home_path/bin:/usr/bin:/bin" \
  XDG_CONFIG_HOME="$test_home/.config" XDG_DATA_HOME="$test_home/data" \
  XDG_STATE_HOME="$test_home/state" XDG_CACHE_HOME="$test_home/cache" \
  NIXOS_DECLARATIVE_NVIM=1 NVIM_PLUGIN_PATH="$plugin_path" \
  NVIM_LAZY_PATH="$lazy_path" NVIM_TREESITTER_RTP="$treesitter_path" \
  nvim --headless '+lua assert(vim.g.colors_name == "vague")' +qa 2>&1)
[[ -z $output ]]
[[ ! -d "$test_home/data/nvim/lazy" ]]

expected_pi=$(nix --extra-experimental-features 'nix-command flakes' eval --raw \
  .#nixosConfigurations.nixos.config.home-manager.users.mishka.home.packages \
  --apply 'packages: (builtins.head (builtins.filter (package: (package.pname or "") == "pi-coding-agent") packages)).version')
[[ $(pi --version) == "$expected_pi" ]]
for extension in ask-user diff pretty web-tools; do
  test -d "$files/.config/pi-config/agent/extensions/$extension/node_modules"
done
test -d "$files/.config/pi-config/agent/extensions/web-tools/node_modules/linkedom"
test -f "$files/.config/pi-config/agent/themes/active.json"

printf '\nLive-link directory transitions (never remove these directories by hand):\n'
for relative in nvim pi-config/agent/agents pi-config/agent/prompts pi-config/agent/skills; do
  target="$HOME/.config/$relative"
  if [[ -d $target && ! -L $target ]]; then
    printf '%s -> %s.before-home-manager\n' "$target" "$target"
    [[ ! -e $target.before-home-manager && ! -L $target.before-home-manager ]] || {
      echo 'STOP: migration backup already exists; preserve and resolve it first.' >&2
      exit 1
    }
    # Only store-managed leaves can be relocated automatically. Do not hide
    # local files or links beneath a new source-directory link.
    while IFS= read -r -d '' entry; do
      [[ -L $entry && $(readlink "$entry") == /nix/store/*-home-manager-files/* ]] || {
        printf 'STOP: unmanaged migration entry: %s\n' "$entry" >&2
        exit 1
      }
    done < <(find "$target" -mindepth 1 ! -type d -print0)
  fi
done

printf '\nExisting home files that need backups on activation:\n'
while IFS= read -r -d '' source; do
  relative=${source#"$files/"}
  target="$HOME/$relative"
  managed_target=$(readlink "$target" 2>/dev/null || true)
  if [[ -e "$target" ]] && ! cmp -s "$source" "$target" \
      && [[ $managed_target != /nix/store/*-home-manager-files/* ]]; then
    printf '%s\n' "$relative"
    if [[ -e "$HOME/$relative.before-home-manager" || -L "$HOME/$relative.before-home-manager" ]]; then
      printf 'STOP: backup already exists; resolve it before activation.\n' >&2
      exit 1
    fi
  fi
done < <(find -L "$files" -type f -print0)
printf '\nStatic/runtime config checks passed. No system activation performed.\n'
printf 'Pending: real Hyprland login, rendering, lock/unlock, sharing, and logout.\n'
