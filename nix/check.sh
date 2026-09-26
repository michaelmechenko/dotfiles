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
configured_home=$(nix_eval home-manager.users.mishka.home.homeDirectory)
[[ $HOME == "$configured_home" ]] || { echo 'Run this check as the configured user.' >&2; exit 1; }
live_paths=(
  zshrc tmux.conf nvim pi-config/agent/AGENTS.md
  pi-config/agent/agents pi-config/agent/prompts pi-config/agent/skills
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
for relative in ghostty/config oh-my-posh/config.json theme/active/tmux/colors.conf \
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

[[ $(pi --version) == 0.86.1 ]]
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
