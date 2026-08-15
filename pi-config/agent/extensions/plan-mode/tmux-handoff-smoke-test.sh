#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d "${TMPDIR%/}/plan-mode-tmux.XXXXXX")
socket="plan-mode-smoke-$$"
cleanup() {
	tmux -L "$socket" kill-server 2>/dev/null || true
	rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

agent_dir="$tmp/agent"
workdir="$tmp/work"
result="$tmp/result"
mkdir -p "$tmp/bin" "$workdir"
export PLAN_MODE_AGENT_DIR="$agent_dir" PLAN_MODE_RESULT="$result" PLAN_MODE_ROOT="$root"
cat > "$tmp/bin/pi" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$PWD|$PI_PLAN_PROVIDER|$PI_PLAN_MODEL|$PI_PLAN_THINKING" >> "$PLAN_MODE_RESULT"
if node --experimental-strip-types --input-type=module -e "import { consumeExecutionPacket } from '$PLAN_MODE_ROOT/execution-handoff.ts'; const packet = consumeExecutionPacket(process.env.PLAN_MODE_AGENT_DIR, process.env.PI_PLAN_HANDOFF); if (!packet || packet.source.tmuxSession !== 'source') process.exit(1);" >> "$PLAN_MODE_RESULT.consume" 2>&1; then
	printf '0\n' >> "$PLAN_MODE_RESULT.status"
else
	printf '1\n' >> "$PLAN_MODE_RESULT.status"
fi
EOF
chmod +x "$tmp/bin/pi"
export PATH="$tmp/bin:$PATH"

packet() {
	node --experimental-strip-types --input-type=module -e "import { writeExecutionPacket } from '$root/execution-handoff.ts'; import { applyPlanUpdate, createPlanState } from '$root/plan-state.ts'; const plan = applyPlanUpdate(createPlanState(), { goal: 'Smoke', steps: ['Verify handoff'] }); process.stdout.write(writeExecutionPacket(process.env.PLAN_MODE_AGENT_DIR, { version: 1, plan, markdown: '# Plan\\n', source: { sessionId: 'source-id', cwd: process.cwd(), tmuxSession: 'source' }, model: { provider: 'stub', model: 'stub-model', thinkingLevel: 'low' } }));"
}

tmux -L "$socket" -f /dev/null new-session -d -s source -c "$workdir"
tmux -L "$socket" set-option -g remain-on-exit on
pane=$(tmux -L "$socket" display-message -p '#{pane_id}')
window=$(tmux -L "$socket" display-message -p '#{window_id}')

handoff=$(packet)
tmux -L "$socket" new-window -d -t source -c "$workdir" \
	-e "PI_PLAN_HANDOFF=$handoff" -e 'PI_PLAN_PROVIDER=stub' -e 'PI_PLAN_MODEL=stub-model' -e 'PI_PLAN_THINKING=low' \
	'pi --provider "$PI_PLAN_PROVIDER" --model "$PI_PLAN_MODEL" --thinking "$PI_PLAN_THINKING"'
[ "$(tmux -L "$socket" display-message -p '#{pane_id}')" = "$pane" ]
[ "$(tmux -L "$socket" display-message -p '#{window_id}')" = "$window" ]

handoff=$(packet)
tmux -L "$socket" split-window -d -h -t "$window" -c "$workdir" \
	-e "PI_PLAN_HANDOFF=$handoff" -e 'PI_PLAN_PROVIDER=stub' -e 'PI_PLAN_MODEL=stub-model' -e 'PI_PLAN_THINKING=low' \
	'pi --provider "$PI_PLAN_PROVIDER" --model "$PI_PLAN_MODEL" --thinking "$PI_PLAN_THINKING"'
[ "$(tmux -L "$socket" display-message -p '#{pane_id}')" = "$pane" ]
[ "$(tmux -L "$socket" display-message -p '#{window_id}')" = "$window" ]

for _ in $(seq 1 40); do
	[ "$(wc -l < "$result" 2>/dev/null || printf 0)" -eq 2 ] && [ "$(wc -l < "$result.status" 2>/dev/null || printf 0)" -eq 2 ] && break
	sleep 0.05
done
[ "$(sort "$result" | uniq)" = "$workdir|stub|stub-model|low" ]
[ "$(sort "$result.status" | uniq)" = "0" ]
[ ! -s "$result.consume" ]
[ "$(find "$agent_dir/plan-handoffs" -type f | wc -l)" -eq 0 ]
printf '%s\n' 'tmux pane/window handoff smoke test passed'
