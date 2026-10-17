# Called only through Home Manager's run wrapper (which skips dry-runs).
set -euo pipefail
[[ -z ${DRY_RUN:-} ]] || exit 0
agent=$1
settings=$2
keybindings=$3
runtime=$4
fail() { printf 'STOP: Pi seed collision at %s; preserve it and resolve explicitly.\n' "$1" >&2; exit 1; }
# Reject symlink ancestors as well as leaf collisions, before any write.
parent=$agent
while [[ $parent != / && $parent != . ]]; do
  [[ ! -L $parent ]] || fail "$parent"
  [[ ! -e $parent || -d $parent ]] || fail "$parent"
  parent=$(dirname "$parent")
done
for name in settings.json keybindings.json; do
  path="$agent/$name"
  [[ ! -L $path ]] || fail "$path"
  [[ ! -e $path || -f $path ]] || fail "$path"
done
npm="$agent/npm"
[[ ! -L $npm ]] || fail "$npm"
if [[ -e $npm ]]; then
  [[ -d $npm ]] || fail "$npm"
  # A complete initialized workspace is user-owned; a partial one is not ours
  # to merge, reset, or diagnose by reading its contents.
  for name in package.json package-lock.json node_modules; do
    [[ ! -L $npm/$name ]] || fail "$npm/$name"
  done
  [[ -f $npm/package.json && -f $npm/package-lock.json && -d $npm/node_modules ]] || fail "$npm"
fi
umask 077
mkdir -p "$agent"
# noclobber protects creation if a file appears after preflight.
if [[ ! -e $agent/settings.json ]]; then
  (set -o noclobber; cat "$settings" > "$agent/settings.json")
fi
if [[ ! -e $agent/keybindings.json ]]; then
  (set -o noclobber; cat "$keybindings" > "$agent/keybindings.json")
fi
if [[ ! -e $npm ]]; then
  stage=$(mktemp -d "$agent/.npm-seed.XXXXXX")
  trap 'rm -rf "$stage"' EXIT
  cp -r "$runtime/." "$stage/"
  chmod -R u+w "$stage"
  # -T refuses to silently nest into a directory created concurrently; -n
  # refuses replacement. Detect a refused rename instead of claiming success.
  mv -Tn "$stage" "$npm"
  [[ ! -d $stage ]] || fail "$npm"
  trap - EXIT
fi
