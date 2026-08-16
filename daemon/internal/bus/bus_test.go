package bus

import (
	"sync"
	"testing"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// collectingSink records everything sent to it.
type collectingSink struct {
	mu   sync.Mutex
	msgs []any
}

func (s *collectingSink) Send(msg any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.msgs = append(s.msgs, msg)
	return nil
}

func (s *collectingSink) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.msgs)
}

// blockingSink forces the pump to stall (unbuffered channel), which is how
// we exercise the overflow -> dropped+resync path.
type blockingSink struct{ ch chan any }

func (s *blockingSink) Send(msg any) error { s.ch <- msg; return nil }

func waitFor(t *testing.T, s *collectingSink, n int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if s.len() >= n {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d messages, got %d", n, s.len())
}

func TestRoutingAnyVsBound(t *testing.T) {
	b := New()
	bound := &collectingSink{}
	any := &collectingSink{}
	b.Subscribe("session", "s1", bound, nil)
	b.Subscribe("any", "", any, nil)

	b.Publish("s2", wire.StateChangeMsg("s2", wire.StateWorking, wire.StateNeedsAttention, "Stop"))
	waitFor(t, any, 1)
	if bound.len() != 0 {
		t.Fatalf("bound subscriber must not receive other sessions' events")
	}

	b.Publish("s1", wire.StateChangeMsg("s1", wire.StateWorking, wire.StateNeedsAttention, "Stop"))
	waitFor(t, bound, 1)
	waitFor(t, any, 2)
}

func TestUnsubscribeStopsDelivery(t *testing.T) {
	b := New()
	sink := &collectingSink{}
	sub := b.Subscribe("any", "", sink, nil)
	b.Unsubscribe(sub)
	b.Publish("s1", wire.StateChangeMsg("s1", wire.StateUnknown, wire.StateWorking, ""))
	time.Sleep(50 * time.Millisecond)
	if sink.len() != 0 {
		t.Fatalf("unsubscribed sink still received %d messages", sink.len())
	}
}

func TestSlowConsumerGetsDroppedAndResync(t *testing.T) {
	b := New()
	sink := &blockingSink{ch: make(chan any)}

	var resyncs int
	var mu sync.Mutex
	sub := b.Subscribe("session", "s1", sink, func(*Sub) {
		mu.Lock()
		resyncs++
		mu.Unlock()
	})
	defer b.Unsubscribe(sub)

	// Flood past the 64-frame buffer while the pump is stalled on send #1.
	for i := 0; i < 100; i++ {
		b.Publish("s1", wire.StateChangeMsg("s1", wire.StateWorking, wire.StateNeedsAttention, "Stop"))
	}

	// Unblock the pump; it must first deliver a dropped warning, then
	// invoke the resync callback, then resume streaming.
	sawDropped := false
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !sawDropped {
		select {
		case msg := <-sink.ch:
			if _, ok := msg.(wire.DroppedMessage); ok {
				sawDropped = true
			}
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !sawDropped {
		t.Fatal("expected a dropped warning after overflow")
	}
	// Give the resync callback a moment to run after the dropped notice.
	time.Sleep(100 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if resyncs == 0 {
		t.Fatal("expected the resync callback to fire after a drop")
	}
}
