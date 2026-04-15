#!/usr/bin/env bash

input=$(cat)

# ANSI helpers
rgb() { printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"; }
reset='\033[0m'

# Theme colors
color_muted=$(rgb 130 130 130)    # #828282 - dir, model, context %
color_sep=$(rgb 70 70 70)         # #464646 - separators (darker)
color_branch=$(rgb 139 169 193)   # #8BA9C1 - git branch
color_dirty=$(rgb 243 190 124)    # #F3BE7C - modified (yellow)
color_add=$(rgb 187 157 189)      # #BB9DBD - added
color_delete=$(rgb 216 100 126)   # #D8647E - deleted

sep="${color_sep} * ${reset}"

# Extract JSON fields
model_name=$(echo "$input" | jq -r '.model.display_name')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
ctx_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Directory: just basename
dir_name=$(basename "$current_dir")

# Model: strip context label, lowercase
model_str=$(echo "$model_name" | sed -E 's/ \([0-9]+[mMkK] context\)//g' | tr '[:upper:]' '[:lower:]')

# Context % usage
ctx_pct=""
if [[ -n "$ctx_used" ]]; then
  ctx_pct=" ${color_muted}[${ctx_used}%]${reset}"
fi

# Git branch + dirty counts
git_info=""
if git -C "$current_dir" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$current_dir" branch --show-current 2>/dev/null)
  [[ ${#branch} -gt 20 ]] && branch="${branch:0:20}…"
  if [[ -n "$branch" ]]; then
    added=0; deleted=0; changed=0
    while IFS= read -r line; do
      x="${line:0:1}"; y="${line:1:1}"
      [[ "$x" == "A" || "$y" == "A" || "$x" == "?" ]] && ((added++)) || true
      [[ "$x" == "D" || "$y" == "D" ]] && ((deleted++)) || true
      [[ "$x" == "M" || "$y" == "M" || "$x" == "R" || "$y" == "R" ]] && ((changed++)) || true
    done < <(git -C "$current_dir" status --porcelain 2>/dev/null)

    dirty=""
    [[ $added   -gt 0 ]] && dirty+="${color_add}+${added}${reset}"
    [[ $changed -gt 0 ]] && { [[ -n "$dirty" ]] && dirty+=" "; dirty+="${color_dirty}~${changed}${reset}"; }
    [[ $deleted -gt 0 ]] && { [[ -n "$dirty" ]] && dirty+=" "; dirty+="${color_delete}-${deleted}${reset}"; }

    git_info="${color_branch}${branch}${reset}"
    [[ -n "$dirty" ]] && git_info+=" (${dirty})"
  fi
fi

# Assemble: dir * git * model [ctx%]
out="${color_muted}${dir_name}${reset}"
if [[ -n "$git_info" ]]; then
  out+="${sep}${git_info}"
fi
out+="${sep}${color_muted}${model_str}${reset}${ctx_pct}"

printf "%b" "$out"
