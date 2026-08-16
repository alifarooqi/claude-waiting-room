package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/config"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/lifecycle"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// splitEmitArgs lets the single positional <event> appear before its flags
// (`emit agent_working --reason stop`) — Go's flag package alone would stop
// parsing at the first positional and silently ignore the flags after it.
func splitEmitArgs(args []string) (event string, flagArgs []string) {
	// Flags whose value is a separate token (vs. `--flag=value`).
	valueFlags := map[string]bool{"--reason": true, "--session": true}
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case valueFlags[a] && i+1 < len(args):
			flagArgs = append(flagArgs, a, args[i+1])
			i++
		case strings.HasPrefix(a, "-"):
			flagArgs = append(flagArgs, a)
		case event == "":
			event = a
		default:
			flagArgs = append(flagArgs, a) // unexpected; let flag.Parse complain
		}
	}
	return event, flagArgs
}

// runEmit implements `waiting-room emit <event>` — the one-shot client
// invoked by Claude Code hooks.
//
// Fail-open contract (non-negotiable): if the daemon is unreachable, exit 0
// silently. Hooks must never block or error Claude. `--strict` (CI/testing
// only) turns failures into exit 1.
func runEmit(args []string) int {
	fs := flag.NewFlagSet("emit", flag.ContinueOnError)
	reason := fs.String("reason", "", "why the event fired (stop, notification, …)")
	sessionFlag := fs.String("session", "", "session id (default: session_id from the stdin payload)")
	strict := fs.Bool("strict", false, "fail loudly when the daemon is unreachable (CI/testing)")
	verbose := fs.Bool("verbose", false, "log what happened to stderr")

	event, flagArgs := splitEmitArgs(args)
	if err := fs.Parse(flagArgs); err != nil {
		return 2
	}
	if event == "" {
		fmt.Fprintln(os.Stderr, "usage: waiting-room emit <agent_working|agent_needs_attention|agent_heartbeat> [--reason r] [--session id]")
		return 2
	}
	if _, ok := wire.StateForEvent(event); !ok {
		fmt.Fprintf(os.Stderr, "waiting-room: unknown event %q\n", event)
		return 2
	}

	// The hook payload arrives as JSON on stdin. Skip reading when stdin is
	// an interactive terminal (manual use) so we never block.
	payload := map[string]any{}
	if st, err := os.Stdin.Stat(); err == nil && st.Mode()&os.ModeCharDevice == 0 {
		if raw, err := io.ReadAll(os.Stdin); err == nil && len(raw) > 0 {
			_ = json.Unmarshal(raw, &payload) // best effort: fields are optional
		}
	}

	sid := *sessionFlag
	if sid == "" {
		sid, _ = payload["session_id"].(string)
	}
	if sid == "" {
		if *strict {
			fmt.Fprintln(os.Stderr, "waiting-room: no session id (use --session or pipe a hook payload)")
			return 1
		}
		return 0 // fail open: nothing to report
	}

	meta := map[string]any{}
	if h, ok := payload["hook_event_name"].(string); ok && h != "" {
		meta["hook"] = h
	}
	if cwd, ok := payload["cwd"].(string); ok && cwd != "" {
		meta["cwd"] = cwd
	}
	if *reason != "" {
		meta["reason"] = *reason
	}

	msg := &wire.EmitMessage{
		Envelope:  wire.Env("emit"),
		Event:     event,
		SessionID: sid,
		Seq:       time.Now().UnixNano(), // per-session monotonic stamp
		TS:        time.Now().UTC(),
		TmuxPane:  os.Getenv("TMUX_PANE"), // self-registers the session's pane
		Meta:      meta,
	}

	socketPath := discoverSocket()
	if !sendEmit(socketPath, msg) {
		if *strict {
			fmt.Fprintf(os.Stderr, "waiting-room: daemon unreachable at %s\n", socketPath)
			return 1
		}
		if *verbose {
			fmt.Fprintf(os.Stderr, "waiting-room: daemon unreachable at %s (event dropped, fail-open)\n", socketPath)
		}
		return 0
	}
	if *verbose {
		fmt.Fprintf(os.Stderr, "waiting-room: emitted %s for session %s\n", event, sid)
	}
	return 0
}

// discoverSocket resolves the daemon socket: $WAITING_ROOM_SOCKET, then the
// info file, then the default path.
func discoverSocket() string {
	if p := os.Getenv("WAITING_ROOM_SOCKET"); p != "" {
		return p
	}
	cfg, err := config.Default()
	if err != nil {
		return ""
	}
	if in, err := lifecycle.ReadInfo(cfg.InfoPath); err == nil && in.SocketPath != "" {
		return in.SocketPath
	}
	return cfg.SocketPath
}

// sendEmit dials with a short timeout, retries once, sends the event, and
// waits for the ack. Returns false when the daemon is unreachable.
func sendEmit(path string, msg *wire.EmitMessage) bool {
	if path == "" {
		return false
	}
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			time.Sleep(200 * time.Millisecond)
		}
		conn, err := net.DialTimeout("unix", path, 800*time.Millisecond)
		if err != nil {
			continue
		}
		if sendAndAck(conn, msg) {
			return true
		}
	}
	return false
}

func sendAndAck(conn net.Conn, msg *wire.EmitMessage) bool {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))

	line, err := wire.Encode(msg)
	if err != nil {
		return false
	}
	if _, err := conn.Write(line); err != nil {
		return false
	}
	r := bufio.NewReader(conn)
	for {
		raw, err := r.ReadBytes('\n')
		if err != nil {
			return false
		}
		m, err := wire.Decode(raw)
		if err != nil {
			continue
		}
		if ack, ok := m.(*wire.AckMessage); ok {
			return ack.Ok
		}
		// skip hello/other server messages
	}
}
