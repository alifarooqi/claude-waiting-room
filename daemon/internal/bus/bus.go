// Package bus implements the daemon's in-memory pub/sub: it fans out
// state changes to subscribed activity clients without ever blocking the
// publisher. Slow consumers get dropped events plus a resync snapshot
// instead of stalling the daemon.
package bus

import (
	"sync"
	"sync/atomic"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// Sink is where subscription messages are written. Implemented by the
// server's connection wrapper; a write error means the client is gone.
type Sink interface {
	Send(msg any) error
}

// subBufferSize is the per-subscriber buffer. Events are human-scale (a few
// per minute), so 64 frames is generous; overflowing it means the consumer
// is stalled and should be dropped+resynced rather than blocking the bus.
const subBufferSize = 64

// Sub is one activity subscription.
type Sub struct {
	// Mode is the subscription binding mode: "auto" | "any" | "session".
	Mode string
	// BoundSession is the resolved session id this subscription follows.
	// Empty means "follow everything" (unbound auto, or explicit any).
	BoundSession string

	ch       chan any
	overflow atomic.Bool
	sink     Sink
	done     chan struct{}
	onResync func(*Sub)
	stopOnce sync.Once
}

// matches reports whether a state change for sessionID should reach this sub.
func (s *Sub) matches(sessionID string) bool {
	if s.Mode == "any" || s.BoundSession == "" {
		return true
	}
	return s.BoundSession == sessionID
}

// Bus fans out published messages to matching subscriptions.
type Bus struct {
	mu   sync.Mutex
	subs map[*Sub]struct{}
}

// New creates an empty bus.
func New() *Bus {
	return &Bus{subs: make(map[*Sub]struct{})}
}

// Subscribe registers a subscription and starts its pump goroutine, which
// drains the buffer and writes to the sink. onResync (optional) is invoked
// after events were dropped so the caller can push a fresh snapshot.
func (b *Bus) Subscribe(mode, boundSession string, sink Sink, onResync func(*Sub)) *Sub {
	s := &Sub{
		Mode:         mode,
		BoundSession: boundSession,
		ch:           make(chan any, subBufferSize),
		sink:         sink,
		done:         make(chan struct{}),
		onResync:     onResync,
	}
	b.mu.Lock()
	b.subs[s] = struct{}{}
	b.mu.Unlock()
	go s.pump()
	return s
}

// Unsubscribe removes a subscription and stops its pump.
func (b *Bus) Unsubscribe(s *Sub) {
	if s == nil {
		return
	}
	b.mu.Lock()
	delete(b.subs, s)
	b.mu.Unlock()
	s.stopOnce.Do(func() { close(s.done) })
}

// UnregisterSink removes every subscription writing to the given sink
// (used when a client connection dies).
func (b *Bus) UnregisterSink(sink Sink) {
	b.mu.Lock()
	var doomed []*Sub
	for s := range b.subs {
		if s.sink == sink {
			doomed = append(doomed, s)
		}
	}
	b.mu.Unlock()
	for _, s := range doomed {
		b.Unsubscribe(s)
	}
}

// Publish fans a message out to all matching subscriptions. It never
// blocks: if a subscriber's buffer is full, the event is dropped and the
// subscriber is flagged for a dropped+resync notice.
func (b *Bus) Publish(sessionID string, msg any) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for s := range b.subs {
		if !s.matches(sessionID) {
			continue
		}
		select {
		case s.ch <- msg:
		default:
			s.overflow.Store(true)
		}
	}
}

// pump drains the subscription buffer into the sink. On write error the
// pump exits; the server notices the dead connection and unregisters.
func (s *Sub) pump() {
	for {
		select {
		case <-s.done:
			return
		case msg := <-s.ch:
			if s.overflow.CompareAndSwap(true, false) {
				_ = s.sink.Send(wire.DroppedMsg(s.BoundSession))
				if s.onResync != nil {
					s.onResync(s)
				}
			}
			if err := s.sink.Send(msg); err != nil {
				return
			}
		}
	}
}
