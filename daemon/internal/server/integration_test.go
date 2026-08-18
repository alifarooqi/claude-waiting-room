//go:build integration

// Real-tmux integration tests. Every tmux call is scoped to a private
// server socket (tmux -S <tmpdir>/srv) so the user's tmux is never touched.
// Run with: make integration   (requires tmux on PATH).

package server

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/lifecycle"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/tmux"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// tmuxHarness drives a private tmux server.
type tmuxHarness struct {
	socket  string
	session string
}

func newTmuxHarness(t *testing.T) *tmuxHarness {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	h := &tmuxHarness{
		socket:  filepath.Join(t.TempDir(), "srv"),
		session: "wrt",
	}
	// A session with two side-by-side panes (Claude pane + activity pane).
	h.run(t, "new-session", "-d", "-s", h.session, "-x", "120", "-y", "30")
	h.run(t, "split-window", "-h", "-t", h.session)
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-S", h.socket, "kill-server").Run()
	})
	return h
}

func (h *tmuxHarness) run(t *testing.T, args ...string) string {
	t.Helper()
	full := append([]string{"-S", h.socket}, args...)
	out, err := exec.Command("tmux", full...).CombinedOutput()
	if err != nil {
		t.Fatalf("tmux %v: %v: %s", args, err, out)
	}
	return string(out)
}

func (h *tmuxHarness) panes(t *testing.T) []string {
	t.Helper()
	out := h.run(t, "list-panes", "-t", h.session, "-F", "#{pane_id}")
	var panes []string
	for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
		if l != "" {
			panes = append(panes, l)
		}
	}
	return panes
}

func (h *tmuxHarness) focusedPane(t *testing.T) string {
	t.Helper()
	return strings.TrimSpace(h.run(t, "display-message", "-p", "-t", h.session, "#{pane_id}"))
}

func waitFocused(t *testing.T, h *tmuxHarness, want string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		if got := h.focusedPane(t); got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("focused pane = %s, want %s", h.focusedPane(t), want)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// TestIntegrationFocusSwap is the M3 definition-of-done: with a real tmux
// server, Claude halting snaps focus to the Claude pane and Claude resuming
// pushes focus back to the bound activity pane.
func TestIntegrationFocusSwap(t *testing.T) {
	h := newTmuxHarness(t)
	panes := h.panes(t)
	if len(panes) != 2 {
		t.Fatalf("want 2 panes, got %v", panes)
	}
	claudePane, activityPane := panes[0], panes[1]

	// Daemon on a temp UDS socket, wired to real tmux.
	dir := t.TempDir()
	uds := filepath.Join(dir, "d.sock")
	info := filepath.Join(dir, "daemon.info")
	logger := log.New(io.Discard, "", 0)
	core := NewCore("test", logger, tmux.NewShell)
	srv := New(Options{SocketPath: uds, InfoPath: info, Version: "test", Log: logger}, core)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = srv.Run(ctx) }()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !lifecycle.DaemonAlive(uds, 100*time.Millisecond) {
		time.Sleep(10 * time.Millisecond)
	}

	// The activity subscribes (auto mode) from the activity pane.
	sub, err := net.DialTimeout("unix", uds, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	subR := bufio.NewReader(sub)
	sendLine(t, sub, &wire.SubscribeMessage{
		Envelope: wire.Env("subscribe"), Mode: "auto",
		ActivityID: "int-test", ActivityPane: activityPane, TmuxSocket: h.socket,
	})
	drainLine(t, sub, subR) // hello
	drainLine(t, sub, subR) // ack

	// The "Claude" emitter, as the hooks would fire it: pane + socket.
	emit := func(event string, seq int64) {
		t.Helper()
		em, err := net.DialTimeout("unix", uds, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		defer em.Close()
		emR := bufio.NewReader(em)
		sendLine(t, em, &wire.EmitMessage{
			Envelope: wire.Env("emit"), Event: event, SessionID: "int-s1", Seq: seq,
			TS: time.Now().UTC(), TmuxPane: claudePane, TmuxSocket: h.socket,
		})
		drainLine(t, em, emR) // hello
		ack, ok := drainUntilAck(t, em, emR)
		if !ok || !ack {
			t.Fatalf("emit %s not acked (ok=%v)", event, ack)
		}
	}

	// Claude starts working -> focus moves to the activity pane.
	emit(wire.EventAgentWorking, time.Now().UnixNano())
	waitFocused(t, h, activityPane)

	// Claude halts -> focus snaps back to the Claude pane.
	emit(wire.EventAgentNeedsAttention, time.Now().UnixNano())
	waitFocused(t, h, claudePane)

	// And the cycle repeats.
	emit(wire.EventAgentWorking, time.Now().UnixNano())
	waitFocused(t, h, activityPane)
}

func sendLine(t *testing.T, conn net.Conn, msg any) {
	t.Helper()
	line, err := wire.Encode(msg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Write(line); err != nil {
		t.Fatal(err)
	}
}

func drainLine(t *testing.T, conn net.Conn, r *bufio.Reader) wire.Message {
	t.Helper()
	m, err := drain(t, conn, r, func(wire.Message) bool { return true })
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func drainUntilAck(t *testing.T, conn net.Conn, r *bufio.Reader) (bool, bool) {
	t.Helper()
	m, err := drain(t, conn, r, func(m wire.Message) bool {
		_, ok := m.(*wire.AckMessage)
		return ok
	})
	if err != nil {
		return false, false
	}
	ack, ok := m.(*wire.AckMessage)
	return ack.Ok, ok
}

func drain(t *testing.T, conn net.Conn, r *bufio.Reader, pred func(wire.Message) bool) (wire.Message, error) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		_ = conn.SetReadDeadline(deadline)
		raw, err := r.ReadBytes('\n')
		if err != nil {
			return nil, fmt.Errorf("read: %w", err)
		}
		m, err := wire.Decode(raw)
		if err != nil {
			continue
		}
		if pred(m) {
			return m, nil
		}
	}
}
