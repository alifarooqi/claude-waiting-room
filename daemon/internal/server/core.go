package server

import (
	"fmt"
	"log"
	"os"
	"sync"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/bus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/session"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/tmux"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// TmuxFactory builds a tmux controller bound to a socket path ("" = the
// default server). Tests substitute fakes; nil disables tmux entirely
// (degraded mode: pause/resume still works, focus is skipped).
type TmuxFactory func(socketPath string) tmux.Controller

// Core is the daemon's message handler: it folds emits into the session
// registry, drives the bus, binds activities to sessions by tmux window
// topology, and switches focus on every state transition.
//
// Separation of concerns: focus-switching is the daemon's job (tmux);
// pause/resume is the activity's job (SDK callbacks).
type Core struct {
	version string
	reg     *session.Registry
	bus     *bus.Bus
	factory TmuxFactory
	log     *log.Logger

	mu   sync.Mutex
	subs map[bus.Sink]*bus.Sub
}

// NewCore creates a handler. Pass a nil factory to run without tmux.
func NewCore(version string, logger *log.Logger, factory TmuxFactory) *Core {
	if logger == nil {
		logger = log.New(os.Stderr, "", log.LstdFlags)
	}
	return &Core{
		version: version,
		reg:     session.New(),
		bus:     bus.New(),
		factory: factory,
		log:     logger,
		subs:    make(map[bus.Sink]*bus.Sub),
	}
}

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
	// Focus + rebinding shell out to tmux; never delay the ack path.
	go c.afterEmit(m, upd)
}

// afterEmit runs post-emit work off the connection goroutine: rebind
// unbound auto activities (a Claude session may have appeared in their
// window) and switch focus on state transitions.
func (c *Core) afterEmit(m *wire.EmitMessage, upd session.Update) {
	c.rebindUnbound(m.TmuxSocket)
	if upd.Changed {
		c.applyFocus(m.SessionID, upd.To)
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

	// Resolve the binding:
	//   - explicit session id wins;
	//   - "auto" binds by tmux window topology — the session whose Claude
	//     pane shares the activity's window (multiple candidates → most
	//     recently active; none → unbound, follows everything until a
	//     session appears and rebinds).
	//   - "any" follows everything.
	bound := m.SessionID
	if mode == "auto" {
		bound = c.resolveAutoBind(m.ActivityPane, m.TmuxSocket)
	}

	sub := c.bus.Subscribe(bus.SubOpts{
		Mode:         mode,
		BoundSession: bound,
		ActivityPane: m.ActivityPane,
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
	c.log.Printf("subscribe activity=%s mode=%s bound=%q pane=%q", m.ActivityID, mode, bound, m.ActivityPane)
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
			TmuxPane:    s.TmuxPane,
			TmuxSession: s.TmuxSession,
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

// resolveAutoBind implements window-topology binding: find the tmux window
// containing the activity's pane, then the session whose Claude pane shares
// that window. Falls back to most-recent when tmux is unavailable.
func (c *Core) resolveAutoBind(activityPane, socket string) string {
	if c.factory == nil || activityPane == "" {
		return c.mostRecentID()
	}
	ctrl := c.factory(socket)
	if ctrl == nil || !ctrl.Available() {
		return c.mostRecentID()
	}
	panes, err := ctrl.ListPanes()
	if err != nil {
		c.log.Printf("auto-bind: tmux unavailable (%v); falling back to most-recent", err)
		return c.mostRecentID()
	}

	window := ""
	for _, p := range panes {
		if p.ID == activityPane {
			window = p.WindowID
			break
		}
	}
	if window == "" {
		return "" // activity pane doesn't exist: stay unbound
	}

	var candidates []session.Session
	for _, s := range c.reg.List() {
		if s.TmuxPane == "" {
			continue
		}
		for _, p := range panes {
			if p.ID == s.TmuxPane && p.WindowID == window {
				candidates = append(candidates, s)
				break
			}
		}
	}
	switch len(candidates) {
	case 0:
		return "" // no Claude in this window yet: unbound until one appears
	case 1:
		return candidates[0].ID
	default:
		// Multiple Claude panes share the window: bind the most recently
		// active one.
		best := candidates[0]
		for _, s := range candidates[1:] {
			if s.LastEventAt.After(best.LastEventAt) {
				best = s
			}
		}
		return best.ID
	}
}

// rebindUnbound gives unbound "auto" subscriptions another chance to bind
// now that a fresh emit may have registered a Claude pane in their window.
func (c *Core) rebindUnbound(socket string) {
	if c.factory == nil {
		return
	}
	c.mu.Lock()
	type pending struct {
		sink bus.Sink
		sub  *bus.Sub
	}
	var work []pending
	for sk, sub := range c.subs {
		if sub.Mode == "auto" && sub.BoundSession == "" {
			work = append(work, pending{sk, sub})
		}
	}
	c.mu.Unlock()

	for _, w := range work {
		if sid := c.resolveAutoBind(w.sub.ActivityPane, socket); sid != "" {
			c.bus.Rebind(w.sub, sid)
			c.log.Printf("auto-bind activity=%s -> session=%s", w.sub.ActivityID, sid)
			c.snapshotInto(w.sink, sid)
		}
	}
}

// applyFocus switches tmux focus on a state transition:
//   - NEEDS_ATTENTION: focus the session's Claude pane (the whole point).
//   - WORKING: focus the bound activity's pane (Claude resumed; go play).
func (c *Core) applyFocus(sessionID string, to wire.State) {
	if c.factory == nil {
		return
	}
	s, ok := c.reg.Get(sessionID)
	if !ok {
		return
	}

	var pane string
	switch to {
	case wire.StateNeedsAttention:
		pane = s.TmuxPane
	case wire.StateWorking:
		pane = c.activityPaneFor(sessionID)
	default:
		return
	}
	if pane == "" {
		return
	}

	ctrl := c.factory(s.TmuxSocket)
	if ctrl == nil || !ctrl.Available() {
		c.log.Printf("focus skipped: tmux unavailable")
		return
	}
	if err := ctrl.FocusPane(pane); err != nil {
		c.log.Printf("focus pane %s: %v", pane, err)
	} else {
		c.log.Printf("focus %s -> %s", to, pane)
	}
}

// activityPaneFor returns the pane of an activity bound to the session.
func (c *Core) activityPaneFor(sessionID string) string {
	for _, sub := range c.listSubs() {
		if sub.BoundSession == sessionID && sub.ActivityPane != "" {
			return sub.ActivityPane
		}
	}
	return ""
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
