#!/usr/bin/env bash
set -euo pipefail
seed="$(cd "$(dirname "$0")" && pwd)/dock-seed.sh"
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
export HOME="$fixture/home"
unset XDG_CACHE_HOME
bash "$seed"
pins="$HOME/.cache/nwg-dock-pinned"
[[ $(wc -l < "$pins") == 4 ]]
[[ $(stat -c %a "$pins") == 600 ]]
printf 'custom\n' > "$pins"
bash "$seed"
[[ $(cat "$pins") == custom ]]
export XDG_CACHE_HOME="$fixture/other-cache"
bash "$seed"
[[ -f "$XDG_CACHE_HOME/nwg-dock-pinned" ]]
rm "$XDG_CACHE_HOME/nwg-dock-pinned"
ln -s "$fixture/absent" "$XDG_CACHE_HOME/nwg-dock-pinned"
bash "$seed"
[[ -L "$XDG_CACHE_HOME/nwg-dock-pinned" && ! -e "$fixture/absent" ]]
echo 'Dock pin seed: missing/default, preservation, XDG override and dangling symlink checks passed.'
