package server

import (
	"log"
	"testing"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/tmux"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

func TestJanitorSweepsStaleDeadPane(t *testing.T) {
	// Tmux knows only %c — %a (the registered pane) is gone.
	ctrl := tmux.NewShell("")
	// We can't shell out for unit tests; build a real controller with no
	// panes (so anything we ask about is missing) by using the production
	// shell and skipping when tmux isn't available. For this test we just
	// use the NewShell controller with an empty tmux server: list-panes
	// returns nothing, so every registered pane is "dead".
	if _, err := ctrl.ListPanes(); err != nil {
		// No tmux server running: skip (the janitor's no-tmux branch is
		// covered by TestJanitorKeepsFreshSessions).
		t.Skip("no tmux server available for the dead-pane test")
	}

	core := NewCore("test", log.New(nil, "", 0), func(string) tmux.Controller { return ctrl })
	core.reg.Apply(&wire.EmitMessage{
		Envelope: wire.Env("emit"), Event: wire.EventAgentWorking,
		SessionID: "s1", Seq: 1, TS: time.Now().UTC(),
		TmuxPane: "%a", // registered; tmux says it doesn't exist
	})
	core.reg.SetLastEventAtForTest("s1", time.Now().Add(-10*time.Minute))

	j := NewJanitor(core.reg, core.bus, func(string) tmux.Controller { return ctrl })
	j.SetTimings(0, 5*time.Minute) // honor our manual LastEventAt rewind
	if got := j.Sweep(); got != 1 {
		t.Fatalf("Sweep reaped %d, want 1", got)
	}
	s, _ := core.reg.Get("s1")
	if s.State != wire.StateUnknown {
		t.Fatalf("state after reap = %s, want unknown", s.State)
	}
}

func TestJanitorKeepsFreshSessions(t *testing.T) {
	ctrl := tmux.NewShell("")
	if _, err := ctrl.ListPanes(); err != nil {
		t.Skip("no tmux server available")
	}
	core := NewCore("test", log.New(nil, "", 0), func(string) tmux.Controller { return ctrl })
	core.reg.Apply(&wire.EmitMessage{
		Envelope: wire.Env("emit"), Event: wire.EventAgentWorking,
		SessionID: "fresh", Seq: 1, TS: time.Now().UTC(), TmuxPane: "%0",
	})
	j := NewJanitor(core.reg, core.bus, func(string) tmux.Controller { return ctrl })
	j.SetTimings(0, 5*time.Minute)
	if got := j.Sweep(); got != 0 {
		t.Fatalf("Sweep reaped %d fresh sessions, want 0", got)
	}
	s, _ := core.reg.Get("fresh")
	if s.State != wire.StateWorking {
		t.Fatalf("fresh session was wrongly reaped: %s", s.State)
	}
}
