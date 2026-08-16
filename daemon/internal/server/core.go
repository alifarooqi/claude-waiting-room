package server

import (
	"fmt"
	"log"
	"os"
	"sync"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/bus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/session"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// Core is the daemon's message handler: it folds emits into the session
// registry, drives the bus, and answers subscriptions with snapshots.
type Core struct {
	reg  *session.Registry
	bus  *bus.Bus
	log  *log.Logger
	mu   sync.Mutex
	subs map[bus.Sink]*bus.Sub
}

// NewCore creates a handler with an empty registry and bus.
func NewCore(logger *log.Logger) *Core {
	if logger == nil {
		logger = log.New(os.Stderr, "", log.LstdFlags)
	}
	return &Core{
		reg:  session.New(),
		bus:  bus.New(),
		log:  logger,
		subs: make(map[bus.Sink]*bus.Sub),
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

	// Resolve the binding. Explicit session wins; "any" and unbound "auto"
	// follow everything. Until tmux topology arrives (M3), "auto" binds to
	// the most-recently-active session.
	bound := m.SessionID
	if mode == "auto" {
		if latest, ok := c.reg.MostRecent(); ok {
			bound = latest.ID
		} else {
			bound = ""
		}
	}

	sub := c.bus.Subscribe(mode, bound, sink, func(s *bus.Sub) { c.snapshotInto(sink, s.BoundSession) })
	c.mu.Lock()
	c.subs[sink] = sub
	c.mu.Unlock()

	_ = sink.Send(wire.Ack(true, ""))
	c.snapshotInto(sink, bound)
}

func (c *Core) handleUnsubscribe(sink bus.Sink) {
	c.mu.Lock()
	sub := c.subs[sink]
	delete(c.subs, sink)
	c.mu.Unlock()
	c.bus.Unsubscribe(sub)
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

func reasonOf(m *wire.EmitMessage) string {
	if m.Meta != nil {
		if r, ok := m.Meta["reason"].(string); ok && r != "" {
			return r
		}
	}
	return m.Event
}
