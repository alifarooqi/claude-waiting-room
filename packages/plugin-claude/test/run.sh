#!/bin/sh
# plugin-claude script tests — pure POSIX sh, no bashisms.
# Covers wr-session (SessionStart context) and wr-open (launcher JSON
# contract) including the fake-game happy path and failure modes.
set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) || exit 1
plugin=$(CDPATH='' cd -- "$here/.." && pwd) || exit 1

tmp=$(mktemp -d "${TMPDIR:-/tmp}/wr-plugin-test.XXXXXX") || exit 1
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/fakebin"

pass=0
fail=0

check() { # desc haystack needle
    desc=$1
    haystack=$2
    needle=$3
    case "$haystack" in
        *"$needle"*)
            pass=$((pass + 1))
            printf 'ok   %s\n' "$desc"
            ;;
        *)
            fail=$((fail + 1))
            printf 'FAIL %s (wanted %s in: %s)\n' "$desc" "$needle" "$haystack"
            ;;
    esac
}

# --- wr-session ---------------------------------------------------------------

out=$(printf '%s' '{"session_id":"abc-123-def","hook_event_name":"SessionStart"}' | "$plugin/bin/wr-session")
check "wr-session reports session id" "$out" '"additionalContext":"waiting-room session_id: abc-123-def'
"$plugin/bin/wr-session" >/dev/null 2>&1 </dev/null
check "wr-session exit code 0" "$?" "0"

out=$(printf '%s' '{"hook_event_name":"SessionStart"}' | "$plugin/bin/wr-session"; printf x)
check "wr-session silent without session_id" "$out" "x"

out=$(printf '%s' '{"session_id":"evil;rm -rf /","hook_event_name":"SessionStart"}' | "$plugin/bin/wr-session"; printf x)
check "wr-session rejects hostile session ids" "$out" "x"

out=$("$plugin/bin/wr-session" < /dev/null; printf x)
check "wr-session silent with no stdin" "$out" "x"

# --- wr-open: failure modes ----------------------------------------------------

out=$("$plugin/bin/wr-open" 2>/dev/null)
check "wr-open missing arg" "$out" '"reason":"missing-arg"'
"$plugin/bin/wr-open" >/dev/null 2>&1
check "wr-open always exits 0" "$?" "0"

out=$("$plugin/bin/wr-open" nosuchgame 2>/dev/null)
check "wr-open game-not-installed" "$out" '"reason":"game-not-installed"'

out=$("$plugin/bin/wr-open" nosuchgame 'bad;session' 2>/dev/null)
check "wr-open rejects hostile session id" "$out" '"reason":"game-not-installed"'

# A game that exists but a hostile session id must still be refused.
cat > "$tmp/fakebin/waiting-room-okgame" <<'EOF'
#!/bin/sh
sleep 30
EOF
chmod +x "$tmp/fakebin/waiting-room-okgame"
out=$(PATH="$tmp/fakebin:$PATH" "$plugin/bin/wr-open" okgame 'bad session' 2>/dev/null)
check "wr-open invalid-session-id" "$out" '"reason":"invalid-session-id"'

# --- wr-open: happy path with a fake bridge -----------------------------------

cat > "$tmp/fakebin/waiting-room-webgame" <<EOF
#!/bin/sh
# Simulated web bridge: records env, prints ready-line, idles.
printf 'session_seen=%s\nterm_app=%s\n' "\${WAITING_ROOM_SESSION:-none}" "\${WAITING_ROOM_TERMINAL_APP:-none}" >> "$tmp/webgame.env"
printf '{"ok":true,"url":"http://127.0.0.1:9911/t/faketoken123/","port":9911,"activity":"WebGame","opened":true}\n'
sleep 30
EOF
chmod +x "$tmp/fakebin/waiting-room-webgame"

out=$(PATH="$tmp/fakebin:$PATH" "$plugin/bin/wr-open" webgame sess-xyz-42 2>/dev/null)
check "wr-open ok" "$out" '"ok":true,"game":"webgame"'
check "wr-open url passthrough" "$out" '"url":"http://127.0.0.1:9911/t/faketoken123/"'
check "wr-open opened passthrough" "$out" '"opened":true'
check "wr-open session echo" "$out" '"session":"sess-xyz-42"'
check "wr-open reports pid" "$out" '"pid":'

envfile=$(cat "$tmp/webgame.env" 2>/dev/null)
check "child received WAITING_ROOM_SESSION" "$envfile" "session_seen=sess-xyz-42"

# --- wr-open: instant crash ------------------------------------------------------

cat > "$tmp/fakebin/waiting-room-crashgame" <<'EOF'
#!/bin/sh
printf 'boom: simulated crash\n' >&2
exit 3
EOF
chmod +x "$tmp/fakebin/waiting-room-crashgame"

out=$(PATH="$tmp/fakebin:$PATH" "$plugin/bin/wr-open" crashgame 2>/dev/null)
check "wr-open launch-failed" "$out" '"reason":"launch-failed"'

# --- teardown: kill fake bridges still idling -----------------------------------

pkill -f 'waiting-room-(webgame|okgame)' 2>/dev/null

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
