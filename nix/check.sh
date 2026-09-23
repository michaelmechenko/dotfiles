#!/usr/bin/env bash
# Run on the NixOS PC after building ./result; never activates the system.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(uname -s) == Linux ]] || { echo 'Run this check on the NixOS PC.' >&2; exit 1; }
test -x result/bin/switch-to-configuration
nix_eval() {
  nix --extra-experimental-features 'nix-command flakes' eval --raw ".#nixosConfigurations.nixos.config.$1"
}
home_package=$(nix_eval home-manager.users.mishka.home.activationPackage)
home_path=$(nix_eval home-manager.users.mishka.home.path)
sessions=$(nix_eval services.displayManager.sessionData.desktops)
export PATH="$home_path/bin:$PWD/result/sw/bin:$PATH"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
files="$home_package/home-files"

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
mkdir -p "$test_home/.config"
ln -s "$files/.config/tmux.conf" "$test_home/.config/tmux.conf"
ln -s "$files/.config/theme" "$test_home/.config/theme"
ln -s "$files/.config/tmux_scripts" "$test_home/.config/tmux_scripts"
socket="nixos-bootstrap-check-$$"
HOME="$test_home" tmux -L "$socket" -f "$files/.config/tmux.conf" \
  new-session -d -s validation 'sleep 3'
[[ $(tmux -L "$socket" show-options -gv prefix) == C-Space ]]
[[ $(tmux -L "$socket" show-options -gv extended-keys-format) == csi-u ]]

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
test -d "$files/.config/pi-config/agent/extensions/web-tools/node_modules/linkedom"
test -f "$files/.config/pi-config/agent/themes/active.json"

printf '\nExisting home files that need backups on activation:\n'
while IFS= read -r -d '' source; do
  relative=${source#"$files/"}
  target="$HOME/$relative"
  managed_target=$(readlink "$target" 2>/dev/null || true)
  if [[ -e "$target" ]] && ! cmp -s "$source" "$target" \
      && [[ $managed_target != /nix/store/*-home-manager-files/* ]]; then
    printf '%s\n' "$relative"
    if [[ -e "$HOME/$relative.before-home-manager" ]]; then
      printf 'STOP: backup already exists; resolve it before activation.\n' >&2
      exit 1
    fi
  fi
done < <(find -L "$files" -type f -print0)
printf '\nStatic/runtime config checks passed. No system activation performed.\n'
printf 'Pending: real Hyprland login, rendering, lock/unlock, sharing, and logout.\n'
