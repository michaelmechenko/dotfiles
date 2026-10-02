# Seed mutable dock state once; never replace an existing file or symlink.
cache="${XDG_CACHE_HOME:-$HOME/.cache}"
pins="$cache/nwg-dock-pinned"
if [[ ! -e "$pins" && ! -L "$pins" ]]; then
  mkdir -p "$cache"
  # noclobber also protects a file created between the check and the write.
  (umask 077; set -o noclobber; printf '%s\n' helium com.mitchellh.ghostty dolphin md.obsidian.Obsidian > "$pins")
fi
