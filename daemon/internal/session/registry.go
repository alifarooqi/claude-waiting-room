// Package session maintains the per-Claude-session state registry: one
// entry per simultaneously running Claude Code instance, keyed by the
// stable session_id from hook payloads. This is where multi-instance
// correctness and seq-ordered transitions live.
package session

import (
	"sync"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// Session is the daemon's record of one Claude Code session.
type Session struct {
	ID string
	// State is the current agent state.
	State wire.State
	// LastSeq is the highest applied per-session sequence number.
	LastSeq int64
	// TmuxPane is the tmux pane Claude runs in, self-registered from
	// $TMUX_PANE by the emit client ("" when not under tmux).
	TmuxPane string
	// TmuxSession is the tmux session name (filled by the tmux controller in M3).
	TmuxSession string
	// TmuxSocket is the tmux server socket path parsed from $TMUX
	// ("" = default server); used to scope tmux commands.
	TmuxSocket  string
	FirstSeenAt time.Time
	LastEventAt time.Time
}

// Update is the result of applying an emit message.
type Update struct {
	// Session is the session record after application.
	Session Session
	// From and To are the state before/after (equal when nothing changed).
	From, To wire.State
	// Changed is true when the state actually transitioned.
	Changed bool
	// Valid is false when the event name was unrecognized (rejected).
	Valid bool
}

// Registry is a concurrency-safe collection of sessions.
type Registry struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

// New creates an empty registry.
func New() *Registry {
	return &Registry{sessions: make(map[string]*Session)}
}

// Apply folds an emit message into the registry.
//
// Ordering: each event carries a per-session monotonic seq (the emit client
// uses unix-nano timestamps). Events with seq < LastSeq are stale and
// ignored. On an exact tie, a WORKING declaration beats a held
// needs_attention — a fresh prompt is the newer intent (Stop/UserPromptSubmit
// race guard).
func (r *Registry) Apply(m *wire.EmitMessage) Update {
	newState, ok := wire.StateForEvent(m.Event)
	if !ok {
		return Update{Valid: false}
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	s, exists := r.sessions[m.SessionID]
	if !exists {
		now := time.Now()
		s = &Session{ID: m.SessionID, State: wire.StateUnknown, FirstSeenAt: now, LastEventAt: now}
		r.sessions[m.SessionID] = s
	}

	switch {
	case m.Seq < s.LastSeq:
		// Stale, out-of-order delivery. Ignore entirely.
		return Update{Valid: true, Session: *s, From: s.State, To: s.State}
	case m.Seq == s.LastSeq && !(newState == wire.StateWorking && s.State == wire.StateNeedsAttention):
		// Tie: only a fresh WORKING declaration beats a held Stop.
		return Update{Valid: true, Session: *s, From: s.State, To: s.State}
	}

	from := s.State
	s.LastSeq = m.Seq
	s.LastEventAt = time.Now()
	if m.TmuxPane != "" {
		s.TmuxPane = m.TmuxPane
	}
	if m.TmuxSession != "" {
		s.TmuxSession = m.TmuxSession
	}
	if m.TmuxSocket != "" {
		s.TmuxSocket = m.TmuxSocket
	}
	if newState != s.State {
		s.State = newState
	}
	return Update{Valid: true, Session: *s, From: from, To: s.State, Changed: from != s.State}
}

// Get returns a copy of the session with the given id.
func (r *Registry) Get(id string) (Session, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[id]
	if !ok {
		return Session{}, false
	}
	return *s, true
}

// MostRecent returns a copy of the session with the latest LastEventAt.
// Used for "auto" subscription binding until tmux topology arrives (M3).
func (r *Registry) MostRecent() (Session, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var best *Session
	for _, s := range r.sessions {
		if best == nil || s.LastEventAt.After(best.LastEventAt) {
			best = s
		}
	}
	if best == nil {
		return Session{}, false
	}
	return *best, true
}

// List returns copies of all sessions.
func (r *Registry) List() []Session {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Session, 0, len(r.sessions))
	for _, s := range r.sessions {
		out = append(out, *s)
	}
	return out
}
