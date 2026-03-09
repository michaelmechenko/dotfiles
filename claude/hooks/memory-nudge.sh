#!/bin/bash
CONTEXT=$(cat)

STRONG_PATTERNS="fixed|workaround|gotcha|that's wrong|check again|we already|should have|discovered|realized|turns out"
WEAK_PATTERNS="error|bug|issue|problem|fail"

if echo "$CONTEXT" | grep -qiE "$STRONG_PATTERNS"; then
    cat << 'EOF'
This session involved fixes or discoveries. Update memory files in ~/.claude/rules/ if you learned something non-obvious:
  - memory-preferences.md for user preferences
  - memory-decisions.md for architectural/design decisions (include date)
  - memory-sessions.md for substantive work completed
EOF
elif echo "$CONTEXT" | grep -qiE "$WEAK_PATTERNS"; then
    echo 'If you learned something non-obvious this session, update the relevant memory file in ~/.claude/rules/.'
fi

exit 0
