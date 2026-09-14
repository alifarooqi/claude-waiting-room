package server

import (
	"fmt"
	"log"
	"os"
	"sync"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/bus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/focus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/session"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// Core is the daemon's message handler: it folds emits into the session
// registry, drives the bus, and triggers OS-level focus recovery on
// every state transition.
//
// Separation of concerns: focus recovery is the daemon's job (via the
// focus.Controller); pause/resume is the activity's job (SDK callbacks).
type Core struct {
	version string
	reg     *session.Registry
	bus     *bus.Bus
	focuser focus.Controller
	log     *log.Logger

	mu   sync.Mutex
	subs map[bus.Sink]*bus.Sub

	// focusMu serializes focus operations. applyFocus re-reads the
	// session state under this lock so a stale transition (e.g. a Stop
	// racing an immediate UserPromptSubmit) can never override a newer
	// focus — last state wins, regardless of goroutine scheduling.
	focusMu sync.Mutex
}

// NewCore creates a handler. focuser may be a focus.Noop{} for tests
// that don't care about focus recovery.
func NewCore(version string, logger *log.Logger, focuser focus.Controller) *Core {
	if logger == nil {
		logger = log.New(os.Stderr, "", log.LstdFlags)
	}
	if focuser == nil {
		focuser = focus.Noop{}
	}
	return &Core{
		version: version,
		reg:     session.New(),
		bus:     bus.New(),
		focuser: focuser,
		log:     logger,
		subs:    make(map[bus.Sink]*bus.Sub),
	}
}

// Accessors for the janitor and other internal collaborators.
func (c *Core) Registry() *session.Registry { return c.reg }
func (c *Core) Bus() *bus.Bus               { return c.bus }

// Handle dispatches one decoded client message.
func (c *Core) Handle(sink bus.Sink, msg wire.Message) {
	switch m := msg.(type) {
	case *wire.EmitMessage:
		c.handleEmit(sink, m)
	case *wire.SubscribeMessage:
		c.handleSubscribe(sink, m)
	case *wire.UnsubscribeMessage:
		c.handleUnsubscribe(sink)
	case *wire.StatusRequestMessage:
		c.handleStatus(sink)
	case *wire.FocusRequestMessage:
		c.handleFocusRequest(sink)
	case *wire.PingMessage:
		_ = sink.Send(wire.PongMsg())
	default:
		// wire.Decode already rejects unknown types; this covers
		// server-only message kinds arriving from a client.
		c.log.Printf("ignored unexpected message type %T", m)
	}
}

// Closed drops every subscription bound to a dead connection.
func (c *Core) Closed(sink bus.Sink) {
	c.bus.UnregisterSink(sink)
	c.mu.Lock()
	delete(c.subs, sink)
	c.mu.Unlock()
}

func (c *Core) handleEmit(sink bus.Sink, m *wire.EmitMessage) {
	upd := c.reg.Apply(m)
	if !upd.Valid {
		_ = sink.Send(wire.Ack(false, "unknown event: "+m.Event))
		return
	}
	_ = sink.Send(wire.Ack(true, ""))
	c.log.Printf("emit session=%s event=%s state=%s", m.SessionID, m.Event, upd.To)
	if upd.Changed {
		c.bus.Publish(m.SessionID,
			wire.StateChangeMsg(m.SessionID, upd.From, upd.To, reasonOf(m)))
	}
	// Focus recovery is best-effort; never delay the ack path.
	go c.applyFocus(upd.To)
}

// applyFocus triggers OS-level focus recovery when Claude needs attention.
// The working→needs_attention transition is the trigger.
func (c *Core) applyFocus(to wire.State) {
	if to != wire.StateNeedsAttention {
		return
	}
	c.focusMu.Lock()
	defer c.focusMu.Unlock()
	if err := c.focuser.FocusClaude(); err != nil {
		// focuser already logged; do nothing more here.
		_ = err
	}
}

func (c *Core) handleSubscribe(sink bus.Sink, m *wire.SubscribeMessage) {
	mode := m.Mode
	if mode == "" {
		mode = "auto"
	}
	if mode != "auto" && mode != "any" && mode != "session" {
		_ = sink.Send(wire.Ack(false, fmt.Sprintf("invalid mode: %q", mode)))
		return
	}

	// Resolve binding:
	//   - explicit session id wins;
	//   - "any" follows everything;
	//   - "auto" binds to the most recently active session (v2 has no
	//     tmux topology to anchor on). If no session is registered
	//     yet, the subscription stays unbound and follows the next emit.
	bound := m.SessionID
	if mode == "auto" {
		bound = c.mostRecentID()
	}

	sub := c.bus.Subscribe(bus.SubOpts{
		Mode:         mode,
		BoundSession: bound,
		ActivityID:   m.ActivityID,
		Title:        m.Title,
		Sink:         sink,
		OnResync:     func(s *bus.Sub) { c.snapshotInto(sink, s.BoundSession) },
	})
	c.mu.Lock()
	c.subs[sink] = sub
	c.mu.Unlock()

	_ = sink.Send(wire.Ack(true, ""))
	c.snapshotInto(sink, bound)
	c.log.Printf("subscribe activity=%s mode=%s bound=%q", m.ActivityID, mode, bound)
}

func (c *Core) handleUnsubscribe(sink bus.Sink) {
	c.mu.Lock()
	sub := c.subs[sink]
	delete(c.subs, sink)
	c.mu.Unlock()
	c.bus.Unsubscribe(sub)
}

func (c *Core) handleStatus(sink bus.Sink) {
	sessions := c.reg.List()
	out := make([]wire.SessionStatus, 0, len(sessions))
	for _, s := range sessions {
		st := wire.SessionStatus{
			SessionID:   s.ID,
			State:       s.State,
			LastEventAt: s.LastEventAt,
		}
		for _, sub := range c.listSubs() {
			if sub.BoundSession == s.ID && sub.ActivityID != "" {
				st.BoundActivities = append(st.BoundActivities, sub.ActivityID)
			}
		}
		out = append(out, st)
	}
	_ = sink.Send(wire.StatusResponseMessage{
		Envelope:      wire.Env("status"),
		ServerVersion: c.version,
		Sessions:      out,
	})
}

// snapshotInto sends the current state of the bound session (or unknown).
func (c *Core) snapshotInto(sink bus.Sink, bound string) {
	state := wire.StateUnknown
	sid := bound
	if bound != "" {
		if s, ok := c.reg.Get(bound); ok {
			state = s.State
		}
	} else if latest, ok := c.reg.MostRecent(); ok {
		sid, state = latest.ID, latest.State
	}
	_ = sink.Send(wire.SnapshotMsg(sid, state))
}

// handleFocusRequest imperatively focuses the user's terminal (e.g. when
// the activity quits and the user clicks back to Claude).
func (c *Core) handleFocusRequest(sink bus.Sink) {
	go c.applyFocus(wire.StateNeedsAttention)
	_ = sink.Send(wire.Ack(true, ""))
}

func (c *Core) listSubs() []*bus.Sub {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]*bus.Sub, 0, len(c.subs))
	for _, sub := range c.subs {
		out = append(out, sub)
	}
	return out
}

func (c *Core) mostRecentID() string {
	if s, ok := c.reg.MostRecent(); ok {
		return s.ID
	}
	return ""
}

func reasonOf(m *wire.EmitMessage) string {
	if m.Meta != nil {
		if r, ok := m.Meta["reason"].(string); ok && r != "" {
			return r
		}
	}
	return m.Event
}
