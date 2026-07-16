#!/usr/bin/env bash

input=$(cat)

# ANSI helpers
rgb() { printf '\033[38;2;%d;%d;%dm' "$1" "$2" "$3"; }
reset='\033[0m'

# Theme colors (see COLORS.md — reuse roles, no new hex)
color_muted=$(rgb 101 106 128)    # #656a80 - dir, model, context %, worktree, added-dirs
color_branch=$(rgb 187 157 189)   # #BB9DBD - git branch, added, PR approved
color_dirty=$(rgb 243 190 124)    # #F3BE7C - modified (yellow), PR pending
color_delete=$(rgb 216 100 126)   # #D8647E - deleted, PR changes-requested

# Extract JSON fields (all native — no extra git/gh calls needed for worktree/repo/PR)
model_name=$(echo "$input" | jq -r '.model.display_name')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
repo_name=$(echo "$input" | jq -r '.workspace.repo.name // empty')
git_worktree=$(echo "$input" | jq -r '.workspace.git_worktree // empty')
added_n=$(echo "$input" | jq -r '(.workspace.added_dirs // []) | length')
added_names=$(echo "$input" | jq -r '(.workspace.added_dirs // []) | map(sub("/+$";"") | sub(".*/";"")) | join(", ")')
ctx_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
pr_number=$(echo "$input" | jq -r '.pr.number // empty')
pr_state=$(echo "$input" | jq -r '.pr.review_state // empty')

# Project label: the PRIMARY (main checkout) dir name, so a worktree still shows the project's
# directory rather than the worktree folder. Fall back to repo name, then current-dir basename.
primary_dir=""
common=$(git -C "$current_dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
case "$common" in */.git) main_root=$(dirname "$common") ;; *) main_root="" ;; esac
case "$main_root" in *"/.claude/worktrees/"*) main_root="${main_root%%/.claude/worktrees/*}" ;; esac
[[ -n "$main_root" ]] && primary_dir=$(basename "$main_root")
proj="${primary_dir:-${repo_name:-$(basename "$current_dir")}}"

# Model: strip context label, lowercase
model_str=$(echo "$model_name" | sed -E 's/ \([0-9]+[mMkK] context\)//g' | tr '[:upper:]' '[:lower:]')

# Git branch (full — no truncation) + dirty counts
branch=""; dirty=""
if git -C "$current_dir" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$current_dir" branch --show-current 2>/dev/null)
  added=0; deleted=0; changed=0
  while IFS= read -r line; do
    x="${line:0:1}"; y="${line:1:1}"
    [[ "$x" == "A" || "$y" == "A" || "$x" == "?" ]] && ((added++)) || true
    [[ "$x" == "D" || "$y" == "D" ]] && ((deleted++)) || true
    [[ "$x" == "M" || "$y" == "M" || "$x" == "R" || "$y" == "R" ]] && ((changed++)) || true
  done < <(git -C "$current_dir" status --porcelain 2>/dev/null)
  [[ $added   -gt 0 ]] && dirty+="${color_branch}+${added}${reset}"
  [[ $changed -gt 0 ]] && { [[ -n "$dirty" ]] && dirty+=" "; dirty+="${color_dirty}~${changed}${reset}"; }
  [[ $deleted -gt 0 ]] && { [[ -n "$dirty" ]] && dirty+=" "; dirty+="${color_delete}-${deleted}${reset}"; }
fi

# PR badge color + glyph by review state
pr_badge=""
if [[ -n "$pr_number" ]]; then
  case "$pr_state" in
    approved)           pr_col="$color_branch"; pr_glyph=" ✓approved" ;;
    changes_requested)  pr_col="$color_delete"; pr_glyph=" ✗changes" ;;
    pending)            pr_col="$color_dirty";  pr_glyph=" •pending" ;;
    draft)              pr_col="$color_muted";  pr_glyph=" ◦draft" ;;
    *)                  pr_col="$color_muted";  pr_glyph="" ;;
  esac
  pr_badge="${pr_col}PR#${pr_number}${pr_glyph}${reset}"
fi

# Line 1 — location: proj  ⑂worktree  branch  dirty  +N dir(s)
line1="${color_muted}${proj}${reset}"
[[ -n "$git_worktree" ]]        && line1+="  ${color_muted}⑂${git_worktree}${reset}"
[[ -n "$branch" ]]              && line1+="  ${color_branch}${branch}${reset}"
[[ -n "$dirty" ]]               && line1+="  ${dirty}"
if [[ "${added_n:-0}" -gt 0 && -n "$added_names" ]]; then
  line1+="  ${color_muted}+ ${added_names}${reset}"
fi

# Line 2 — session: model  [ctx%]  PR badge
line2="${color_muted}${model_str}${reset}"
[[ -n "$ctx_used" ]] && line2+="  ${color_muted}[${ctx_used}%]${reset}"
[[ -n "$pr_badge" ]] && line2+="  ${pr_badge}"

printf '%b\n' "$line1"
printf '%b'   "$line2"
