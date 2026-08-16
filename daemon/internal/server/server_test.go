package server

import (
	"bufio"
	"context"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/lifecycle"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// startTestServer boots a real daemon on a temp-dir socket and blocks until
// it answers pings. Returns the socket path and info file path.
func startTestServer(t *testing.T) (socketPath, infoPath string) {
	t.Helper()
	dir := t.TempDir()
	sock := filepath.Join(dir, "d.sock")
	info := filepath.Join(dir, "daemon.info")
	logger := log.New(io.Discard, "", 0)

	core := NewCore(logger)
	srv := New(Options{SocketPath: sock, InfoPath: info, Version: "test", Log: logger}, core)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Logf("server Run returned error during shutdown: %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Log("server did not shut down within 2s")
		}
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if lifecycle.DaemonAlive(sock, 100*time.Millisecond) {
			return sock, info
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Surface why: either Run errored early, or it's alive-but-not-answering.
	select {
	case err := <-done:
		t.Fatalf("server did not come up: Run failed: %v", err)
	default:
		t.Fatal("server did not come up: not answering pings")
	}
	return "", ""
}

// client is a test protocol client.
type client struct {
	t    *testing.T
	conn net.Conn
	r    *bufio.Reader
}

func dialClient(t *testing.T, sock string) *client {
	t.Helper()
	conn, err := net.DialTimeout("unix", sock, time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	c := &client{t: t, conn: conn, r: bufio.NewReader(conn)}
	t.Cleanup(func() { conn.Close() })
	// The server greets every connection; consume it.
	c.drainUntil(2*time.Second, func(m wire.Message) bool {
		_, ok := m.(*wire.HelloMessage)
		return ok
	})
	return c
}

func (c *client) send(msg any) {
	c.t.Helper()
	line, err := wire.Encode(msg)
	if err != nil {
		c.t.Fatalf("encode: %v", err)
	}
	if _, err := c.conn.Write(line); err != nil {
		c.t.Fatalf("write: %v", err)
	}
}

func (c *client) sendRaw(line string) {
	c.t.Helper()
	if _, err := c.conn.Write([]byte(line + "\n")); err != nil {
		c.t.Fatalf("write raw: %v", err)
	}
}

// drainUntil reads messages until pred matches, failing on timeout.
func (c *client) drainUntil(d time.Duration, pred func(wire.Message) bool) wire.Message {
	c.t.Helper()
	deadline := time.Now().Add(d)
	for {
		_ = c.conn.SetReadDeadline(deadline)
		raw, err := c.r.ReadBytes('\n')
		if err != nil {
			c.t.Fatalf("timed out waiting for message: %v", err)
		}
		m, err := wire.Decode(raw)
		if err != nil {
			continue
		}
		if pred(m) {
			return m
		}
	}
}

// expectSilence asserts no message arrives within d.
func (c *client) expectSilence(d time.Duration) {
	c.t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(d))
	if _, err := c.r.ReadBytes('\n'); err == nil {
		c.t.Fatal("expected silence, but a message arrived")
	}
	_ = c.conn.SetReadDeadline(time.Time{})
}

func mkEmit(session, event string, seq int64) *wire.EmitMessage {
	return &wire.EmitMessage{
		Envelope:  wire.Env("emit"),
		Event:     event,
		SessionID: session,
		Seq:       seq,
		TS:        time.Now().UTC(),
	}
}

// TestEmitDrivesSubscriber is the M2 definition-of-done: an emit on one
// connection drives a snapshot + state-change stream on a subscriber.
func TestEmitDrivesSubscriber(t *testing.T) {
	sock, _ := startTestServer(t)

	sub := dialClient(t, sock)
	sub.send(&wire.SubscribeMessage{Envelope: wire.Env("subscribe"), Mode: "any", ActivityID: "watch-1"})
	if ack, ok := sub.drainUntil(2*time.Second, func(m wire.Message) bool {
		a, ok := m.(*wire.AckMessage)
		return ok && a.Ok
	}).(*wire.AckMessage); !ok {
		t.Fatalf("subscribe not acked: %+v", ack)
	}
	snap, ok := sub.drainUntil(2*time.Second, func(m wire.Message) bool {
		_, ok := m.(*wire.SnapshotMessage)
		return ok
	}).(*wire.SnapshotMessage)
	if !ok || snap.State != wire.StateUnknown {
		t.Fatalf("initial snapshot should be unknown: %+v", snap)
	}

	em := dialClient(t, sock)
	em.send(mkEmit("s1", wire.EventAgentWorking, time.Now().UnixNano()))
	em.drainUntil(2*time.Second, func(m wire.Message) bool {
		a, ok := m.(*wire.AckMessage)
		return ok && a.Ok
	})

	sc, ok := sub.drainUntil(2*time.Second, func(m wire.Message) bool {
		_, ok := m.(*wire.StateChangeMessage)
		return ok
	}).(*wire.StateChangeMessage)
	if !ok || sc.From != wire.StateUnknown || sc.To != wire.StateWorking || sc.SessionID != "s1" {
		t.Fatalf("unexpected state change: %+v", sc)
	}

	em.send(mkEmit("s1", wire.EventAgentNeedsAttention, time.Now().UnixNano()))
	sc, ok = sub.drainUntil(2*time.Second, func(m wire.Message) bool {
		c, ok := m.(*wire.StateChangeMessage)
		return ok && c.To == wire.StateNeedsAttention
	}).(*wire.StateChangeMessage)
	if !ok || sc.From != wire.StateWorking {
		t.Fatalf("unexpected state change: %+v", sc)
	}
}

// TestMultiSessionIndependence: a subscriber bound to s1 hears nothing when
// a different session changes state.
func TestMultiSessionIndependence(t *testing.T) {
	sock, _ := startTestServer(t)

	sub := dialClient(t, sock)
	sub.send(&wire.SubscribeMessage{Envelope: wire.Env("subscribe"), Mode: "session", SessionID: "s1", ActivityID: "a1"})
	sub.drainUntil(2*time.Second, func(m wire.Message) bool {
		_, ok := m.(*wire.SnapshotMessage)
		return ok
	})

	em := dialClient(t, sock)
	em.send(mkEmit("s2", wire.EventAgentNeedsAttention, time.Now().UnixNano()))
	em.drainUntil(2*time.Second, func(m wire.Message) bool {
		a, ok := m.(*wire.AckMessage)
		return ok && a.Ok
	})

	sub.expectSilence(150 * time.Millisecond)
}

func TestPingPong(t *testing.T) {
	sock, _ := startTestServer(t)
	c := dialClient(t, sock)
	c.send(wire.PingMsg())
	c.drainUntil(2*time.Second, func(m wire.Message) bool {
		_, ok := m.(*wire.PongMessage)
		return ok
	})
}

func TestUnknownTypeIgnoredNotFatal(t *testing.T) {
	sock, _ := startTestServer(t)
	c := dialClient(t, sock)
	c.sendRaw(`{"v":1,"type":"telepathy"}`)
	// The connection must stay alive and keep processing.
	c.send(wire.PingMsg())
	c.drainUntil(2*time.Second, func(m wire.Message) bool {
		_, ok := m.(*wire.PongMessage)
		return ok
	})
}

func TestInvalidModeNacked(t *testing.T) {
	sock, _ := startTestServer(t)
	c := dialClient(t, sock)
	c.send(&wire.SubscribeMessage{Envelope: wire.Env("subscribe"), Mode: "teleport", ActivityID: "a1"})
	nack, ok := c.drainUntil(2*time.Second, func(m wire.Message) bool {
		a, ok := m.(*wire.AckMessage)
		return ok && !a.Ok
	}).(*wire.AckMessage)
	if !ok || nack.Error == "" {
		t.Fatalf("expected nack with error, got %+v", nack)
	}
}

func TestInfoFileLifecycle(t *testing.T) {
	sock, info := startTestServer(t)

	if _, err := lifecycle.ReadInfo(info); err != nil {
		t.Fatalf("info file should exist while running: %v", err)
	}
	if _, err := os.Stat(sock); err != nil {
		t.Fatalf("socket should exist while running: %v", err)
	}

	// Verify graceful teardown on a second server instance we control
	// (the first is cleaned up by t.Cleanup after the test ends).
	dir := t.TempDir()
	sock2 := filepath.Join(dir, "d2.sock")
	info2 := filepath.Join(dir, "daemon2.info")
	logger := log.New(io.Discard, "", 0)
	srv := New(Options{SocketPath: sock2, InfoPath: info2, Version: "test", Log: logger}, NewCore(logger))
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = srv.Run(ctx) }()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && !lifecycle.DaemonAlive(sock2, 100*time.Millisecond) {
		time.Sleep(10 * time.Millisecond)
	}

	cancel()
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		_, sockErr := os.Stat(sock2)
		_, infoErr := os.Stat(info2)
		if os.IsNotExist(sockErr) && os.IsNotExist(infoErr) {
			return // both gone: graceful teardown worked
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("socket or info file not removed on shutdown")
}
