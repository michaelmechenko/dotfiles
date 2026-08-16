#!/bin/sh
# Regression coverage for exact PID registry joins and legacy fallback.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tmux-pi-session-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/sessions/--Users-mishka-.config--" "$tmp/state"

cat >"$tmp/bin/pgrep" <<'EOF'
#!/bin/sh
case "$*" in
  *"-P 200"*) echo 201 ;;
esac
EOF
cat >"$tmp/bin/ps" <<'EOF'
#!/bin/sh
case "$*" in
  *"args="*)
    case "$*" in
      *"-p 100"*) printf '/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js\n' ;;
      *"-p 200"*) printf 'zsh\n' ;;
      *"-p 201"*) printf 'pi\n' ;;
      *"-p 300"*) printf 'pi\n' ;;
    esac ;;
  *)
    case "$*" in
      *"-p 100"*) printf 'node\n' ;;
      *"-p 200"*) printf 'zsh\n' ;;
      *"-p 201"*) printf 'pi\n' ;;
      *"-p 300"*) printf 'pi\n' ;;
    esac ;;
esac
EOF
cat >"$tmp/bin/lsof" <<'EOF'
#!/bin/sh
case "$*" in
  *"-p 100"*|*"-p 200"*|*"-p 201"*) printf 'p1\nn/Users/mishka/.config\n' ;;
  *"-p 300"*) printf 'p1\nn/Users/mishka/.config\n' ;;
esac
EOF
chmod +x "$tmp/bin/pgrep" "$tmp/bin/ps" "$tmp/bin/lsof"

sessions="$tmp/sessions/--Users-mishka-.config--"
: >"$sessions/pi_a.jsonl"
: >"$sessions/pi_b.jsonl"
printf '{"pid":100,"sessionId":"exact-self","sessionFile":"%s/pi_a.jsonl","cwd":"/Users/mishka/.config"}\n' "$sessions" >"$tmp/state/100.json"
printf '{"pid":201,"sessionId":"exact-child","sessionFile":"%s/pi_b.jsonl","cwd":"/Users/mishka/.config"}\n' "$sessions" >"$tmp/state/201.json"
printf '{"pid":300,"sessionId":"stale","sessionFile":"%s/pi_a.jsonl","cwd":"/Users/mishka/other"}\n' "$sessions" >"$tmp/state/300.json"

resolve() {
  PATH="$tmp/bin:$PATH" PI_SESS_DIR="$tmp/sessions" PI_STATE_DIR="$tmp/state" "$root/tmux_scripts/tmux-pi-session" "$@"
}
assert_eq() {
  [ "$1" = "$2" ] || { printf 'wanted: %s\ngot:    %s\n' "$2" "$1" >&2; exit 1; }
}

self=$(resolve --exact 100 | awk -F '\t' '{print $4}')
child=$(resolve --exact 200 | awk -F '\t' '{print $4}')
assert_eq "$self" exact-self
assert_eq "$child" exact-child

# Same cwd, distinct exact records: the historical newest-file heuristic cannot
# recover this distinction, while the PID registry can.
[ "$self" != "$child" ]

# A record whose cwd does not match the live process is not trusted. Exact mode
# fails; compatibility mode is still allowed to use the explicitly legacy path.
if resolve --exact 300 >/dev/null 2>&1; then
  echo 'stale record unexpectedly accepted' >&2
  exit 1
fi
legacy=$(resolve 300 | awk -F '\t' '{print $4}')
assert_eq "$legacy" b

printf 'tmux-pi-session tests passed\n'
