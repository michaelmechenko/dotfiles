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
printf '%s\n' "$PWD|$PI_PLAN_PROVIDER|$PI_PLAN_MODEL|$PI_PLAN_THINKING" > "$PLAN_MODE_RESULT"
if node --experimental-strip-types --input-type=module -e "import { consumeExecutionPacket } from '$PLAN_MODE_ROOT/execution-handoff.ts'; const packet = consumeExecutionPacket(process.env.PLAN_MODE_AGENT_DIR, process.env.PI_PLAN_HANDOFF); if (!packet || packet.source.tmuxSession !== 'source') process.exit(1);" > "$PLAN_MODE_RESULT.consume" 2>&1; then
	printf '0' > "$PLAN_MODE_RESULT.status"
else
	printf '1' > "$PLAN_MODE_RESULT.status"
fi
rm -f "$PI_PLAN_HANDOFF"
EOF
chmod +x "$tmp/bin/pi"
export PATH="$tmp/bin:$PATH"

handoff=$(node --experimental-strip-types --input-type=module -e "import { writeExecutionPacket } from '$root/execution-handoff.ts'; import { applyPlanUpdate, createPlanState } from '$root/plan-state.ts'; const plan = applyPlanUpdate(createPlanState(), { goal: 'Smoke', steps: ['Verify handoff'] }); process.stdout.write(writeExecutionPacket(process.env.PLAN_MODE_AGENT_DIR, { version: 1, plan, markdown: '# Plan\\n', source: { sessionId: 'source-id', cwd: process.cwd(), tmuxSession: 'source' }, model: { provider: 'stub', model: 'stub-model', thinkingLevel: 'low' } }));")

tmux -L "$socket" -f /dev/null new-session -d -s source -c "$workdir"
tmux -L "$socket" set-option -g remain-on-exit on
tmux -L "$socket" new-window -t source -c "$workdir" \
	-e "PI_PLAN_HANDOFF=$handoff" \
	-e 'PI_PLAN_PROVIDER=stub' \
	-e 'PI_PLAN_MODEL=stub-model' \
	-e 'PI_PLAN_THINKING=low' \
	'pi --provider "$PI_PLAN_PROVIDER" --model "$PI_PLAN_MODEL" --thinking "$PI_PLAN_THINKING"'

for _ in $(seq 1 40); do
	[ -f "$result" ] && [ -f "$result.consume" ] && [ -f "$result.status" ] && break
	sleep 0.05
done
[ "$(cat "$result")" = "$workdir|stub|stub-model|low" ]
[ "$(cat "$result.status")" = "0" ]
[ ! -s "$result.consume" ]
[ ! -e "$handoff" ]
printf '%s\n' 'tmux handoff smoke test passed'
