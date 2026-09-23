#!/usr/bin/env bash
# Deploy the public, allowlisted NixOS source snapshot. Never copies private state.
set -euo pipefail

host=${NIXOS_HOST:-mishka@10.0.0.74}
identity=${NIXOS_IDENTITY:-$HOME/.ssh/nixos-desktop}
target=${NIXOS_CONFIG_DIR:-/home/mishka/nixos-config}
root=$(cd "$(dirname "$0")/.." && pwd)
ssh_cmd=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -i "$identity")
rsync_ssh="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -i $identity"
manifest=.deployed-sha256

# A manifest records exactly what the prior deployment wrote. Refuse to replace
# PC-side edits; reconcile them explicitly instead.
if "${ssh_cmd[@]}" "$host" "test -f '$target/$manifest'"; then
  "${ssh_cmd[@]}" "$host" "cd '$target' && sha256sum -c '$manifest' --quiet" || {
    printf 'STOP: %s contains edits since the last deployment. Reconcile them first.\n' "$target" >&2
    exit 1
  }
fi

args=(
  -a --delete-delay --exclude result --exclude "$manifest"
  --exclude node_modules --exclude auth.json --exclude sessions --exclude npm
  --include /flake.nix --include /flake.lock --include /zshrc --include /tmux.conf
  --include '/nix/***' --include '/nvim/***' --include '/tmux_scripts/***'
  --include '/tmux_plugins/***' --include '/nnn/***'
  --include /qol_scripts/ --include /qol_scripts/copy --include /qol_scripts/pasta
  --include /pi-config/ --include /pi-config/agent/
  --include /pi-config/agent/AGENTS.md --include /pi-config/agent/settings.json
  --include /pi-config/agent/keybindings.json --include '/pi-config/agent/agents/***'
  --include '/pi-config/agent/extensions/***' --include '/pi-config/agent/prompts/***'
  --include '/pi-config/agent/skills/***'
  --include /theme/ --include /theme/palettes/ --include /theme/palettes/vague.json
  --include /theme/bundles/ --include '/theme/bundles/vague/***'
  --include /ohmyposh/ --include /ohmyposh/base.json
  --exclude '/*'
)
rsync "${args[@]}" -e "$rsync_ssh" "$root/" "$host:$target/"

"${ssh_cmd[@]}" "$host" "cd '$target' && {
  find flake.nix flake.lock zshrc tmux.conf nix nvim tmux_scripts tmux_plugins nnn \\
    qol_scripts/copy qol_scripts/pasta pi-config/agent/AGENTS.md \\
    pi-config/agent/settings.json pi-config/agent/keybindings.json \\
    pi-config/agent/agents pi-config/agent/extensions pi-config/agent/prompts \\
    pi-config/agent/skills theme/palettes/vague.json theme/bundles/vague \\
    ohmyposh/base.json \\
    -type f -print0 | sort -z | xargs -0 sha256sum > '$manifest.tmp'
  mv '$manifest.tmp' '$manifest'
}"
printf 'Deployed allowlisted snapshot to %s:%s\n' "$host" "$target"
