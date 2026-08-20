package server

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/bus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/session"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// Janitor keeps the registry honest: every gcInterval it scans for stale
// sessions (no event for idleLimit) whose tmux pane is gone, marks them
// UNKNOWN, and broadcasts the transition. Activities on dead connections
// are removed the moment their sink write fails (Closed hook).
type Janitor struct {
	mu         sync.Mutex
	reg        *session.Registry
	bus        *bus.Bus
	factory    TmuxFactory
	gcInterval time.Duration
	idleLimit  time.Duration
	log        *log.Logger
}

func NewJanitor(reg *session.Registry, b *bus.Bus, factory TmuxFactory) *Janitor {
	return &Janitor{
		reg:        reg,
		bus:        b,
		factory:    factory,
		gcInterval: 60 * time.Second,
		idleLimit:  5 * time.Minute,
		log:        log.New(nil, "", 0),
	}
}

// SetLogging overrides the logger (defaults to discarded).
func (j *Janitor) SetLogging(l *log.Logger) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.log = l
}

// SetTimings overrides the sweep interval and idle limit (for tests).
func (j *Janitor) SetTimings(gcInterval, idleLimit time.Duration) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if gcInterval > 0 {
		j.gcInterval = gcInterval
	}
	if idleLimit > 0 {
		j.idleLimit = idleLimit
	}
}

// Run blocks until ctx is canceled, sweeping every gcInterval.
func (j *Janitor) Run(ctx context.Context) {
	t := time.NewTicker(j.gcInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			j.Sweep()
		}
	}
}

// Sweep runs one GC pass. Exposed so it can be unit-tested without a ticker.
func (j *Janitor) Sweep() int {
	j.mu.Lock()
	factory := j.factory
	log := j.log
	j.mu.Unlock()

	paneExists := func(paneID, socketPath string) bool {
		if factory == nil || socketPath == "" {
			return true // no tmux or unknown socket: don't reap (safer default)
		}
		ctrl := factory(socketPath)
		if ctrl == nil || !ctrl.Available() {
			return true
		}
		return ctrl.PaneExists(paneID)
	}

	res := j.reg.GC(j.idleLimit, paneExists)
	if res.Reaped > 0 {
		log.Printf("janitor: reaped %d stale session(s)", res.Reaped)
		// Publish a fresh snapshot so bound activities update to "unknown"
		// (they normally retain last-known state across disconnects; reaping
		// is the one path that explicitly wipes it).
		for _, s := range j.reg.List() {
			if s.State == wire.StateUnknown {
				j.bus.Publish(s.ID, wire.SnapshotMsg(s.ID, wire.StateUnknown))
			}
		}
	}
	return res.Reaped
}
