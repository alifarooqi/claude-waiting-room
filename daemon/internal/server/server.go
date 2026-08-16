// Package server implements the daemon's Unix Domain Socket server: it
// listens, authenticates connections by peer credentials (same-uid only),
// frames JSON-lines, and dispatches decoded messages to a Handler.
package server

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/bus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/lifecycle"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// Handler processes decoded client messages for the lifetime of a connection.
// Implemented by Core.
type Handler interface {
	Handle(sink bus.Sink, msg wire.Message)
	// Closed is invoked when a client connection goes away, so
	// subscriptions writing to it can be dropped.
	Closed(sink bus.Sink)
}

// Options configures a Server.
type Options struct {
	SocketPath string
	// InfoPath is the daemon.info discovery file; empty skips writing it.
	InfoPath string
	Version  string
	Log      *log.Logger
}

// Server is the UDS server. Use New, then Run.
type Server struct {
	opts     Options
	handler  Handler
	log      *log.Logger
	listener *net.UnixListener

	mu    sync.Mutex
	conns map[*conn]struct{}
}

// New creates a server for the given options and handler.
func New(opts Options, h Handler) *Server {
	if opts.Log == nil {
		opts.Log = log.New(os.Stderr, "", log.LstdFlags)
	}
	return &Server{opts: opts, handler: h, log: opts.Log, conns: make(map[*conn]struct{})}
}

// Run listens on the configured socket and serves connections until ctx is
// canceled (SIGINT/SIGTERM at the call site), then shuts down gracefully:
// stop accepting, close all connections, unlink the socket, remove the
// info file.
func (s *Server) Run(ctx context.Context) error {
	if err := s.listen(); err != nil {
		return err
	}
	defer s.teardown()

	if s.opts.InfoPath != "" {
		if err := lifecycle.WriteInfo(s.opts.InfoPath, lifecycle.Info{
			PID:        os.Getpid(),
			SocketPath: s.opts.SocketPath,
			Version:    s.opts.Version,
			StartedAt:  time.Now().UTC(),
		}); err != nil {
			return fmt.Errorf("write info file: %w", err)
		}
	}
	s.log.Printf("listening on %s", s.opts.SocketPath)

	acceptErr := make(chan error, 1)
	go func() {
		for {
			uc, err := s.listener.AcceptUnix()
			if err != nil {
				select {
				case <-ctx.Done():
					acceptErr <- nil
				default:
					acceptErr <- err
				}
				return
			}
			go s.serve(uc)
		}
	}()

	select {
	case <-ctx.Done():
		_ = s.listener.Close()
		return nil
	case err := <-acceptErr:
		return err
	}
}

// listen prepares the socket: 0700 directory, stale-socket cleanup behind a
// liveness probe, listen, 0600 socket permissions (explicit, umask-independent).
func (s *Server) listen() error {
	dir := filepath.Dir(s.opts.SocketPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create socket dir: %w", err)
	}
	_ = os.Chmod(dir, 0o700)

	if lifecycle.DaemonAlive(s.opts.SocketPath, 500*time.Millisecond) {
		return fmt.Errorf("a daemon is already listening at %s", s.opts.SocketPath)
	}
	if err := os.Remove(s.opts.SocketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove stale socket: %w", err)
	}

	l, err := net.Listen("unix", s.opts.SocketPath)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	ul := l.(*net.UnixListener)
	ul.SetUnlinkOnClose(false) // teardown removes it explicitly
	if err := os.Chmod(s.opts.SocketPath, 0o600); err != nil {
		ul.Close()
		return fmt.Errorf("chmod socket: %w", err)
	}
	s.listener = ul
	return nil
}

func (s *Server) teardown() {
	if s.listener != nil {
		_ = s.listener.Close()
	}
	s.mu.Lock()
	conns := make([]*conn, 0, len(s.conns))
	for c := range s.conns {
		conns = append(conns, c)
	}
	s.mu.Unlock()
	for _, c := range conns {
		c.close()
	}
	_ = os.Remove(s.opts.SocketPath)
	if s.opts.InfoPath != "" {
		lifecycle.RemoveInfo(s.opts.InfoPath)
	}
	s.log.Printf("shut down")
}

func (s *Server) track(c *conn, on bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if on {
		s.conns[c] = struct{}{}
	} else {
		delete(s.conns, c)
	}
}

// serve handles one connection: peer-cred auth, greeting, then the
// JSON-lines read loop until the client disconnects or the server closes.
func (s *Server) serve(uc *net.UnixConn) {
	c := newConn(uc)
	s.track(c, true)
	defer func() {
		c.close()
		s.track(c, false)
		s.handler.Closed(c)
	}()

	// Peer-credential auth: reject any connection not owned by our uid.
	// (Filesystem perms 0700/0600 are the first line of defense; this is
	// defense in depth.)
	if uid, ok := c.peerUID(); !ok || uid != uint32(os.Getuid()) {
		s.log.Printf("rejected connection: peer credential check failed (uid=%d ok=%v)", uid, ok)
		return
	}

	_ = c.Send(wire.Hello(s.opts.Version))

	r := bufio.NewReader(uc)
	for {
		line, err := r.ReadBytes('\n')
		if err != nil {
			return // EOF or closed
		}
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		msg, derr := wire.Decode(line)
		if derr != nil {
			if errors.Is(derr, wire.ErrUnknownType) {
				// Forward compatibility: ignore unknown types.
				s.log.Printf("ignored: %v", derr)
				continue
			}
			_ = c.Send(wire.ErrorMsg(derr.Error()))
			continue
		}
		s.handler.Handle(c, msg)
	}
}

// conn wraps a Unix connection with mutex-guarded writes (the bus may write
// from its pump goroutine while the read loop writes acks).
type conn struct {
	uc   *net.UnixConn
	wmu  sync.Mutex
	dead bool
}

func newConn(uc *net.UnixConn) *conn { return &conn{uc: uc} }

// Send writes one JSON-lines frame. Implements bus.Sink.
func (c *conn) Send(msg any) error {
	b, err := wire.Encode(msg)
	if err != nil {
		return err
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.dead {
		return io.ErrClosedPipe
	}
	_ = c.uc.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := c.uc.Write(b); err != nil {
		c.dead = true
		return err
	}
	return nil
}

func (c *conn) close() {
	c.wmu.Lock()
	if !c.dead {
		c.dead = true
		_ = c.uc.Close()
	}
	c.wmu.Unlock()
}

// peerUID returns the uid of the connecting process via SO_PEERCRED (Linux)
// or LOCAL_PEERCRED (macOS).
func (c *conn) peerUID() (uint32, bool) {
	rc, err := c.uc.SyscallConn()
	if err != nil {
		return 0, false
	}
	var (
		uid uint32
		ok  bool
	)
	rc.Control(func(fd uintptr) {
		uid, ok = peerUID(fd)
	})
	return uid, ok
}
