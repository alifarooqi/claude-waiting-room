package server

import (
	"log"
	"testing"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/focus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

func TestJanitorSweepsStaleIdle(t *testing.T) {
	core := NewCore("test", log.New(nil, "", 0), focus.Noop{})
	core.reg.Apply(&wire.EmitMessage{
		Envelope: wire.Env("emit"), Event: wire.EventAgentWorking,
		SessionID: "s1", Seq: 1, TS: time.Now().UTC(),
	})
	core.reg.SetLastEventAtForTest("s1", time.Now().Add(-10*time.Minute))

	j := NewJanitor(core.reg, core.bus)
	j.SetTimings(0, 5*time.Minute)
	if got := j.Sweep(); got != 1 {
		t.Fatalf("Sweep reaped %d, want 1", got)
	}
	s, _ := core.reg.Get("s1")
	if s.State != wire.StateUnknown {
		t.Fatalf("state after reap = %s, want unknown", s.State)
	}
}

func TestJanitorKeepsFreshSessions(t *testing.T) {
	core := NewCore("test", log.New(nil, "", 0), focus.Noop{})
	core.reg.Apply(&wire.EmitMessage{
		Envelope: wire.Env("emit"), Event: wire.EventAgentWorking,
		SessionID: "fresh", Seq: 1, TS: time.Now().UTC(),
	})
	j := NewJanitor(core.reg, core.bus)
	j.SetTimings(0, 5*time.Minute)
	if got := j.Sweep(); got != 0 {
		t.Fatalf("Sweep reaped %d fresh sessions, want 0", got)
	}
	s, _ := core.reg.Get("fresh")
	if s.State != wire.StateWorking {
		t.Fatalf("fresh session was wrongly reaped: %s", s.State)
	}
}
