#!/usr/bin/env bash

input=$(cat)

# ANSI truecolor helpers
rgb() { printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"; }
reset='\033[0m'

# Theme colors (from nvim highlight groups)
color_dir=$(rgb 174 174 209)      # #AEAED1 - session/user color
color_branch=$(rgb 139 169 193)   # #8BA9C1 - git branch
color_model=$(rgb 96 96 121)      # #606079 - model
color_dirty=$(rgb 243 190 124)    # #F3BE7C - git changes (GitSignsChange / yellow)
color_add=$(rgb 187 157 189)      # #BB9DBD - GitSignsAdd
color_delete=$(rgb 216 100 126)   # #D8647E - GitSignsDelete
color_ctx_ok=$(rgb 187 157 189)   # #BB9DBD - context % low
color_ctx_warn=$(rgb 243 190 124) # #F3BE7C - context % mid
color_ctx_high=$(rgb 216 100 126) # #D8647E - context % high
color_style=$(rgb 216 100 126)    # #D8647E - output style (path color)

# Extract information from JSON
model_name=$(echo "$input" | jq -r '.model.display_name')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
output_style=$(echo "$input" | jq -r '.output_style.name')

# Get current working directory basename
dir_name=$(basename "$current_dir")

# Get git information if in a git repository
git_info=""
if git -C "$current_dir" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$current_dir" branch --show-current 2>/dev/null)
  [[ ${#branch} -gt 20 ]] && branch="${branch:0:20}…"
  if [[ -n "$branch" ]]; then
    # Count staged/unstaged adds, deletes, changes
    added=0; deleted=0; changed=0
    while IFS= read -r line; do
      x="${line:0:1}"; y="${line:1:1}"
      # staged or unstaged add
      [[ "$x" == "A" || "$y" == "A" || "$x" == "?" ]] && ((added++)) || true
      # staged or unstaged delete
      [[ "$x" == "D" || "$y" == "D" ]] && ((deleted++)) || true
      # staged or unstaged modify
      [[ "$x" == "M" || "$y" == "M" || "$x" == "R" || "$y" == "R" ]] && ((changed++)) || true
    done < <(git -C "$current_dir" status --porcelain 2>/dev/null)

    dirty=""
    [[ $added   -gt 0 ]] && dirty+="${color_add}+${added}${reset}"
    [[ $changed -gt 0 ]] && { [[ -n "$dirty" ]] && dirty+=" "; dirty+="${color_dirty}~${changed}${reset}"; }
    [[ $deleted -gt 0 ]] && { [[ -n "$dirty" ]] && dirty+=" "; dirty+="${color_delete}-${deleted}${reset}"; }
    [[ -n "$dirty" ]] && dirty=" $dirty"

    # Check if in a linked worktree (not the main worktree)
    worktree_info=""
    git_dir=$(cd "$(git -C "$current_dir" rev-parse --git-dir 2>/dev/null)" && pwd)
    git_common_dir=$(cd "$(git -C "$current_dir" rev-parse --git-common-dir 2>/dev/null)" && pwd)
    if [[ "$git_dir" != "$git_common_dir" ]]; then
      worktree_path=$(git -C "$current_dir" rev-parse --show-toplevel 2>/dev/null)
      worktree_name=$(basename "$worktree_path")
      worktree_info=" ⎇ $worktree_name"
    fi

    git_info="${color_branch}${branch}${worktree_info}${reset}${dirty}"
  fi
fi

# Calculate context window usage (relative to auto-compact threshold ~80%)
context_info=""
usage=$(echo "$input" | jq '.context_window.current_usage')
if [ "$usage" != "null" ]; then
  current=$(echo "$usage" | jq '.input_tokens + .output_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
  size=$(echo "$input" | jq '.context_window.context_window_size')

  # Auto-compact triggers at ~80% of context window
  compact_threshold=$((size * 80 / 100))

  pct=$((current * 100 / compact_threshold))
  if [ "$pct" -gt 100 ]; then pct=100; fi

  # Color by urgency
  if   [ "$pct" -ge 80 ]; then ctx_color="$color_ctx_high"
  elif [ "$pct" -ge 50 ]; then ctx_color="$color_ctx_warn"
  else                          ctx_color="$color_ctx_ok"
  fi

  context_info="${ctx_color}${pct}%${reset}"
fi

# Build status line using printf for color support
out="${color_dir}${dir_name}${reset}"

if [[ -n "$git_info" ]]; then
  out+=" (${git_info})"
fi

out+=" ${color_model}[${model_name}]${reset}"

if [[ "$output_style" != "default" && "$output_style" != "null" ]]; then
  out+=" ${color_style}{${output_style}}${reset}"
fi

if [[ -n "$context_info" ]]; then
  out+=" ${context_info}"
fi

printf "%b" "$out"
