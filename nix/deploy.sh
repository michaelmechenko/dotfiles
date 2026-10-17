#!/usr/bin/env bash
# Explicit public inventory, verified staging, recoverable promotion. Never activate.
set -euo pipefail

host=${NIXOS_HOST:-mishka@10.0.0.74}
identity=${NIXOS_IDENTITY:-$HOME/.ssh/nixos-desktop}
target=${NIXOS_CONFIG_DIR:-/home/mishka/nixos-config}
root=$(cd "$(dirname "$0")/.." && pwd)
# Remote command arguments are restricted rather than interpolated as shell source.
[[ $target == /* && $target != / && $target =~ ^[a-zA-Z0-9_./-]+$ ]] || {
  echo 'STOP: NIXOS_CONFIG_DIR must be an absolute path without shell characters.' >&2
  exit 1
}
ssh_cmd=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -i "$identity")
printf -v rsync_ssh '%q ' "${ssh_cmd[@]}"
local_stage=$(mktemp -d)
trap 'rm -rf "$local_stage"' EXIT
# Destination is a fresh child. Only Git-tracked, policy-allowed files can enter.
python3 "$root/nix/public-source.py" snapshot "$root" "$local_stage/source" "$@"
remote_stage=$("${ssh_cmd[@]}" "$host" "python3 - remote-stage '$target'" < "$root/nix/public-source.py")
[[ $remote_stage =~ ^[a-zA-Z0-9_./-]+$ && $remote_stage == "${target%/*}/.${target##*/}.incoming-"* ]] || {
  echo 'STOP: invalid staging path from remote host.' >&2
  exit 1
}
rsync -a -e "$rsync_ssh" "$local_stage/source/" "$host:$remote_stage/"
# Execute the local reviewed helper through stdin, never a helper from the old target.
"${ssh_cmd[@]}" "$host" "python3 - promote '$remote_stage' '$target'" < "$root/nix/public-source.py"
printf 'Verified public snapshot: %s:%s (previous retained; no activation).\n' "$host" "$target"
