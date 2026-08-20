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

// GC reaps sessions whose pane no longer exists on the tmux server AND
// that have been idle longer than idleThreshold. paneExists is called
// per-session with the session's (paneID, socketPath).
//
// idleThreshold must be > 0; zero means "no idle threshold".
func (r *Registry) GC(idleThreshold time.Duration, paneExists func(paneID, socketPath string) bool) GCResult {
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
		stale := now.Sub(s.LastEventAt) > idleThreshold
		paneDead := s.TmuxPane != "" && paneExists != nil && !paneExists(s.TmuxPane, s.TmuxSocket)
		if stale && paneDead {
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
