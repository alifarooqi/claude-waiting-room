package session

import (
	"testing"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

func mkEmit(session, event string, seq int64, pane string) *wire.EmitMessage {
	return &wire.EmitMessage{
		Envelope:  wire.Env("emit"),
		Event:     event,
		SessionID: session,
		Seq:       seq,
		TS:        time.Now(),
		TmuxPane:  pane,
	}
}

func TestWorkingToAttentionCycle(t *testing.T) {
	r := New()

	up := r.Apply(mkEmit("s1", wire.EventAgentWorking, 10, "%1"))
	if !up.Valid || !up.Changed || up.From != wire.StateUnknown || up.To != wire.StateWorking {
		t.Fatalf("first apply: %+v", up)
	}

	up = r.Apply(mkEmit("s1", wire.EventAgentNeedsAttention, 20, "%1"))
	if !up.Changed || up.From != wire.StateWorking || up.To != wire.StateNeedsAttention {
		t.Fatalf("stop apply: %+v", up)
	}

	up = r.Apply(mkEmit("s1", wire.EventAgentWorking, 30, "%1"))
	if !up.Changed || up.From != wire.StateNeedsAttention || up.To != wire.StateWorking {
		t.Fatalf("resume apply: %+v", up)
	}
}

func TestHeartbeatRefreshesWithoutChange(t *testing.T) {
	r := New()
	r.Apply(mkEmit("s1", wire.EventAgentWorking, 10, "%1"))
	up := r.Apply(mkEmit("s1", wire.EventAgentHeartbeat, 20, "%1"))
	if up.Changed {
		t.Fatalf("heartbeat must not emit a state change: %+v", up)
	}
	s, _ := r.Get("s1")
	if s.State != wire.StateWorking {
		t.Fatalf("state = %v", s.State)
	}
}

func TestStaleSeqIgnored(t *testing.T) {
	r := New()
	r.Apply(mkEmit("s1", wire.EventAgentWorking, 50, "%1"))
	// A late-arriving Stop with an older seq must not flip the state back.
	up := r.Apply(mkEmit("s1", wire.EventAgentNeedsAttention, 30, "%1"))
	if up.Changed || up.To != wire.StateWorking {
		t.Fatalf("stale apply should be a no-op: %+v", up)
	}
}

func TestTieBreakWorkingWins(t *testing.T) {
	r := New()
	r.Apply(mkEmit("s1", wire.EventAgentNeedsAttention, 50, "%1"))
	// Exact tie: a fresh WORKING declaration beats a held Stop.
	up := r.Apply(mkEmit("s1", wire.EventAgentWorking, 50, "%1"))
	if !up.Changed || up.To != wire.StateWorking {
		t.Fatalf("tie should let working win: %+v", up)
	}
}

func TestTieBreakAttentionDoesNotWin(t *testing.T) {
	r := New()
	r.Apply(mkEmit("s1", wire.EventAgentWorking, 50, "%1"))
	up := r.Apply(mkEmit("s1", wire.EventAgentNeedsAttention, 50, "%1"))
	if up.Changed {
		t.Fatalf("tie must not let attention override working: %+v", up)
	}
}

func TestPaneSelfRegistration(t *testing.T) {
	r := New()
	r.Apply(mkEmit("s1", wire.EventAgentWorking, 10, "%7"))
	s, ok := r.Get("s1")
	if !ok || s.TmuxPane != "%7" {
		t.Fatalf("pane not registered: %+v", s)
	}
	// A later emit from a different pane (Claude moved) updates it...
	r.Apply(mkEmit("s1", wire.EventAgentWorking, 20, "%9"))
	s, _ = r.Get("s1")
	if s.TmuxPane != "%9" {
		t.Fatalf("pane not updated: %+v", s)
	}
	// ...but an empty pane never wipes a known one (emit outside tmux).
	r.Apply(mkEmit("s1", wire.EventAgentHeartbeat, 30, ""))
	s, _ = r.Get("s1")
	if s.TmuxPane != "%9" {
		t.Fatalf("pane should persist: %+v", s)
	}
}

func TestMultiSessionIsolation(t *testing.T) {
	r := New()
	r.Apply(mkEmit("s1", wire.EventAgentWorking, 10, "%1"))
	r.Apply(mkEmit("s2", wire.EventAgentNeedsAttention, 10, "%2"))
	s1, _ := r.Get("s1")
	s2, _ := r.Get("s2")
	if s1.State != wire.StateWorking || s2.State != wire.StateNeedsAttention {
		t.Fatalf("sessions interfered: s1=%v s2=%v", s1.State, s2.State)
	}
}

func TestUnknownEventRejected(t *testing.T) {
	r := New()
	up := r.Apply(mkEmit("s1", "agent_meltdown", 10, ""))
	if up.Valid {
		t.Fatal("unknown event must be rejected")
	}
}

func TestMostRecent(t *testing.T) {
	r := New()
	r.Apply(mkEmit("s1", wire.EventAgentWorking, 10, "%1"))
	time.Sleep(2 * time.Millisecond) // ensure distinguishable LastEventAt
	r.Apply(mkEmit("s2", wire.EventAgentWorking, 10, "%2"))
	got, ok := r.MostRecent()
	if !ok || got.ID != "s2" {
		t.Fatalf("MostRecent = %+v ok=%v", got, ok)
	}
}
