#!/usr/bin/env bash
set -euo pipefail

# Read hook input from stdin
input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt' | tr '[:upper:]' '[:lower:]')

# Load skill rules
rules_path="$HOME/.config/claude/skills/skill-rules.json"
[[ -f "$rules_path" ]] || exit 0

matched=""

# Check each skill
for skill in $(jq -r '.skills | keys[]' "$rules_path"); do
  found=0

  # Keyword matching (case-insensitive substring)
  while IFS= read -r kw; do
    kw_lower=$(echo "$kw" | tr '[:upper:]' '[:lower:]')
    if [[ "$prompt" == *"$kw_lower"* ]]; then
      found=1
      break
    fi
  done < <(jq -r ".skills[\"$skill\"].promptTriggers.keywords[]? // empty" "$rules_path")

  # Intent pattern matching (regex)
  if [[ $found -eq 0 ]]; then
    while IFS= read -r pattern; do
      if echo "$prompt" | grep -iqE "$pattern" 2>/dev/null; then
        found=1
        break
      fi
    done < <(jq -r ".skills[\"$skill\"].promptTriggers.intentPatterns[]? // empty" "$rules_path")
  fi

  if [[ $found -eq 1 ]]; then
    priority=$(jq -r ".skills[\"$skill\"].priority // \"medium\"" "$rules_path")
    matched="${matched}${priority}|${skill}\n"
  fi
done

# Output suggestions if any matched
if [[ -n "$matched" ]]; then
  # Sort by priority: high first, then medium, then low
  sorted=$(echo -e "$matched" | sort -t'|' -k1,1 | sed 's/^[^|]*|//')

  echo "--- SKILL ACTIVATION ---"
  echo "Matched skills for this prompt:"
  while IFS= read -r skill; do
    [[ -z "$skill" ]] && continue
    echo "  -> $skill"
  done <<< "$sorted"
  echo ""
  echo "ACTION: Use the Skill tool to load these before responding."
  echo "------------------------"
fi

exit 0
