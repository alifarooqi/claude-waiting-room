package session

import (
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// GCResult is the outcome of a reaping sweep.
type GCResult struct {
	// Reaped is the number of sessions moved to UNKNOWN.
	Reaped int
}

// GC reaps sessions that have been idle longer than idleThreshold, marking
// them UNKNOWN. v2 dropped the pane-existence check (sessions are no
// longer anchored to tmux panes — they're keyed by Claude's session_id
// alone).
//
// idleThreshold must be > 0; zero means "no idle threshold".
func (r *Registry) GC(idleThreshold time.Duration) GCResult {
	if idleThreshold <= 0 {
		return GCResult{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	var reaped int
	for _, s := range r.sessions {
		if s.State == wire.StateUnknown {
			continue
		}
		if now.Sub(s.LastEventAt) > idleThreshold {
			s.State = wire.StateUnknown
			reaped++
		}
	}
	return GCResult{Reaped: reaped}
}

// SetLastEventAtForTest rewinds LastEventAt (test helper).
func (r *Registry) SetLastEventAtForTest(id string, t time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.sessions[id]; ok {
		s.LastEventAt = t
	}
}
