package web

import (
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/bus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// nopHandler is a Handler that just discards everything. Used in tests
// that only exercise the HTTP layer.
type nopHandler struct{}

func (nopHandler) Handle(bus.Sink, wire.Message) {}
func (nopHandler) Closed(bus.Sink)               {}

func TestHealthzReturnsOK(t *testing.T) {
	ln := New(Options{Log: log.New(io.Discard, "", 0)}, nopHandler{})
	runListenerAsync(t, ln)

	resp, err := http.Get("http://" + ln.Addr() + "/healthz")
	if err != nil {
		t.Fatalf("get healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestServesGameFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>{{WS_URL}}</html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	ln := New(Options{Log: log.New(io.Discard, "", 0), GamesDir: dir}, nopHandler{})
	runListenerAsync(t, ln)

	resp, err := http.Get("http://" + ln.Addr() + "/games/index.html")
	if err != nil {
		t.Fatalf("get game: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "{{WS_URL}}") {
		t.Fatalf("body missing placeholder: %s", body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("content-type = %q, want html", ct)
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	ln := New(Options{Log: log.New(io.Discard, "", 0), GamesDir: dir}, nopHandler{})
	runListenerAsync(t, ln)

	resp, err := http.Get("http://" + ln.Addr() + "/games/../secret.txt")
	if err != nil {
		t.Fatalf("get traversal: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("status = %d, want 404 (path traversal blocked)", resp.StatusCode)
	}
}

// runListenerAsync starts ln in a goroutine and registers cleanup to
// cancel it after the test. Returns once ln.Addr() is populated.
func runListenerAsync(t *testing.T, ln *Listener) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	done := make(chan error, 1)
	go func() { done <- ln.Start(ctx) }()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && ln.Addr() == "" {
		time.Sleep(5 * time.Millisecond)
	}
	if ln.Addr() == "" {
		t.Fatal("listener did not bind within 2s")
	}
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Log("listener did not shut down within 2s")
		}
	})
}

// injectListener stubs in a bound net.Listener so allowOrigin has an
// Addr to compare against. We don't call Start, so the http.Server is
// nil but Addr() returns the manually-bound address.
func injectListener(t *testing.T) *Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	// Close immediately; we only need the address string.
	addr := ln.Addr().String()
	_ = ln.Close()
	l := New(Options{Log: log.New(io.Discard, "", 0)}, nopHandler{})
	// Reach into the unexported field via a tiny test-only setter.
	listenerForTest = l
	// We can't easily set l.listener without exposing it, so use the
	// Start path: bind a real listener by setting the addr.
	_ = addr
	return l
}

// listenerForTest is set by injectListener for tests that need to
// exercise allowOrigin.
var listenerForTest *Listener

func TestOriginRejectsForeignHost(t *testing.T) {
	ln := New(Options{Log: log.New(io.Discard, "", 0)}, nopHandler{})
	ln.listener = listenOrFatal(t)

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Origin", "http://evil.example.com:1234")
	if ln.allowOrigin(req) {
		t.Fatal("allowOrigin accepted foreign origin")
	}
}

func TestOriginAllowsLocalhost(t *testing.T) {
	ln := New(Options{Log: log.New(io.Discard, "", 0)}, nopHandler{})
	ln.listener = listenOrFatal(t)
	port := portOf(ln.Addr())

	for _, host := range []string{"http://127.0.0.1:" + port, "http://localhost:" + port} {
		req := httptest.NewRequest(http.MethodGet, "/ws", nil)
		req.Header.Set("Origin", host)
		if !ln.allowOrigin(req) {
			t.Errorf("allowOrigin rejected %s", host)
		}
	}
}

func TestOriginAllowsNoOrigin(t *testing.T) {
	ln := New(Options{Log: log.New(io.Discard, "", 0)}, nopHandler{})
	ln.listener = listenOrFatal(t)

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	if !ln.allowOrigin(req) {
		t.Fatal("non-browser client without Origin should be allowed")
	}
}

func listenOrFatal(t *testing.T) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	return ln
}

func portOf(addr string) string {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	return port
}

func TestIsLocalHost(t *testing.T) {
	for _, h := range []string{"127.0.0.1", "127.0.0.1:1234", "localhost", "[::1]", "::1"} {
		if !isLocalHost(h) {
			t.Errorf("isLocalHost(%q) = false, want true", h)
		}
	}
	for _, h := range []string{"example.com", "10.0.0.1", "192.168.1.1"} {
		if isLocalHost(h) {
			t.Errorf("isLocalHost(%q) = true, want false", h)
		}
	}
}

func mustTCPAddr(s string) *net.TCPAddr {
	a, err := net.ResolveTCPAddr("tcp", s)
	if err != nil {
		panic(err)
	}
	return a
}
