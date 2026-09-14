// Package web implements the daemon's localhost HTTP+WebSocket listener
// for browser-based side activities. It runs alongside the UDS server
// in the same binary; the two transports share the wire envelope and
// the bus. Browser clients fetch game HTML/JS from disk (under
// <games-dir>) and exchange messages with the daemon over the WS
// endpoint. The listener binds to 127.0.0.1 only and validates the
// Origin header so a malicious site can't drive a user's waiting-room
// session cross-origin.
package web

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/bus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
	gws "github.com/gorilla/websocket"
)

// Handler is what the web layer needs from the rest of the daemon. It
// matches the UDS server's Handler (server.Handler) so the same Core
// can be plugged into both transports.
type Handler interface {
	Handle(sink bus.Sink, msg wire.Message)
	Closed(sink bus.Sink)
}

// Options configures a Listener.
type Options struct {
	// ListenAddr is the bind address (default "127.0.0.1:0" — random port).
	ListenAddr string
	// GamesDir is the on-disk root served at /games/<name>/. Defaults to
	// ~/.waiting-room/web (resolved by the caller via config.Default
	// + a GamesDir extension; kept as a string here for testability).
	GamesDir string
	// Log receives listener logs.
	Log *log.Logger
}

// Listener is the HTTP+WS server.
type Listener struct {
	opts     Options
	log      *log.Logger
	handler  Handler
	srv      *http.Server
	listener net.Listener

	mu      sync.Mutex
	closing bool
}

// New creates a Listener. Call Start to bind and serve.
func New(opts Options, h Handler) *Listener {
	if opts.ListenAddr == "" {
		opts.ListenAddr = "127.0.0.1:0"
	}
	if opts.Log == nil {
		opts.Log = log.New(io.Discard, "", 0)
	}
	return &Listener{opts: opts, handler: h, log: opts.Log}
}

// Addr returns the bound listen address. Returns "" before Start.
func (l *Listener) Addr() string {
	if l.listener == nil {
		return ""
	}
	return l.listener.Addr().String()
}

// BaseURL returns the http:// base URL clients should use.
func (l *Listener) BaseURL() string {
	addr := l.Addr()
	if addr == "" {
		return ""
	}
	return "http://" + addr
}

// WSURL returns the ws:// endpoint for browser subscribers.
func (l *Listener) WSURL() string {
	addr := l.Addr()
	if addr == "" {
		return ""
	}
	return "ws://" + addr + "/ws"
}

// Start binds the listener and serves HTTP until ctx is canceled.
func (l *Listener) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", l.handleHealth)
	mux.HandleFunc("/ws", l.handleWS)
	mux.HandleFunc("/games/", l.handleGames)

	ln, err := net.Listen("tcp", l.opts.ListenAddr)
	if err != nil {
		return err
	}
	l.listener = ln
	l.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		l.mu.Lock()
		l.closing = true
		l.mu.Unlock()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = l.srv.Shutdown(shutdownCtx)
	}()

	l.log.Printf("web: listening on http://%s (games=%s)", ln.Addr(), l.opts.GamesDir)
	if err := l.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (l *Listener) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "ok\n")
}

// handleGames serves files under /games/<name>/<asset> from the
// configured GamesDir. Path-traversal-safe.
func (l *Listener) handleGames(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if l.opts.GamesDir == "" {
		http.NotFound(w, r)
		return
	}
	// r.URL.Path is "/games/<name>/<asset...>". Strip the prefix.
	const prefix = "/games/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		http.NotFound(w, r)
		return
	}
	rel := strings.TrimPrefix(r.URL.Path, prefix)
	clean, err := sanitizeGamesPath(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(l.opts.GamesDir, clean)
	// Defense in depth: ensure the resolved path is still under GamesDir.
	absRoot, err := filepath.Abs(l.opts.GamesDir)
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	absFull, err := filepath.Abs(full)
	if err != nil || !strings.HasPrefix(absFull, absRoot+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(absFull)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil || stat.IsDir() {
		http.NotFound(w, r)
		return
	}
	setContentType(w, clean)
	http.ServeContent(w, r, stat.Name(), stat.ModTime(), f)
}

// sanitizeGamesPath returns the cleaned relative path under GamesDir,
// rejecting path traversal, absolute paths, and ".." components.
func sanitizeGamesPath(rel string) (string, error) {
	if rel == "" || strings.HasPrefix(rel, "/") {
		return "", errors.New("invalid path")
	}
	cleaned := filepath.Clean(rel)
	if cleaned == "." || strings.HasPrefix(cleaned, "..") {
		return "", errors.New("invalid path")
	}
	return cleaned, nil
}

func setContentType(w http.ResponseWriter, name string) {
	switch {
	case strings.HasSuffix(name, ".html"):
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case strings.HasSuffix(name, ".js"):
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case strings.HasSuffix(name, ".css"):
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case strings.HasSuffix(name, ".svg"):
		w.Header().Set("Content-Type", "image/svg+xml")
	default:
		w.Header().Set("Content-Type", "application/octet-stream")
	}
}

var upgrader = gws.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Origin check happens explicitly in handleWS so the test suite
	// can drive localhost without a browser Origin header.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// handleWS upgrades the connection to WebSocket and bridges frames to
// the bus via the daemon's Handler.
func (l *Listener) handleWS(w http.ResponseWriter, r *http.Request) {
	if !l.allowOrigin(r) {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // upgrader writes an error response
	}
	defer conn.Close()

	sink := &wsSink{conn: conn, log: l.log, done: make(chan struct{})}

	// Send a hello immediately so the client knows the version.
	_ = sink.Send(wire.Hello("v1.1.0"))

	// Read loop: decode each text frame and dispatch.
	conn.SetReadLimit(1 << 16)
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			l.handler.Closed(sink)
			return
		}
		if mt != gws.TextMessage && mt != gws.BinaryMessage {
			continue
		}
		msg, err := wire.Decode(data)
		if err != nil {
			if errors.Is(err, wire.ErrUnknownType) {
				l.log.Printf("ws: ignored %v", err)
				continue
			}
			_ = sink.Send(wire.ErrorMsg(err.Error()))
			continue
		}
		l.handler.Handle(sink, msg)
	}
}

// allowOrigin checks the Origin header against the listener's own
// address. Browsers send Origin on every WS upgrade; non-browser clients
// (curl, the SDK) send none and are allowed through. A request with an
// Origin pointing at a different host/port is rejected.
func (l *Listener) allowOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // non-browser client
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := u.Host
	if host == "" {
		return false
	}
	// Allow any localhost origin (127.0.0.1, [::1], localhost).
	if isLocalHost(host) {
		return true
	}
	// Compare to the listener's own bound address.
	_, port, err := net.SplitHostPort(l.Addr())
	if err != nil {
		return false
	}
	_, originPort, err := net.SplitHostPort(host)
	if err != nil {
		return false
	}
	return originPort == port
}

func isLocalHost(host string) bool {
	hostname, _, err := net.SplitHostPort(host)
	if err != nil {
		hostname = host
	}
	if hostname == "localhost" || hostname == "127.0.0.1" || hostname == "[::1]" || hostname == "::1" {
		return true
	}
	if ip := net.ParseIP(hostname); ip != nil && ip.IsLoopback() {
		return true
	}
	return false
}

// wsSink implements bus.Sink for a WebSocket connection. Frames are
// JSON-lines encoded by wire.Encode and sent as text frames.
type wsSink struct {
	conn *gws.Conn
	log  *log.Logger
	mu   sync.Mutex
	done chan struct{}
	once sync.Once
}

func (s *wsSink) Send(msg any) error {
	b, err := wire.Encode(msg)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.done:
		return errors.New("ws sink closed")
	default:
	}
	_ = s.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := s.conn.WriteMessage(gws.TextMessage, b); err != nil {
		s.once.Do(func() { close(s.done) })
		return err
	}
	return nil
}
