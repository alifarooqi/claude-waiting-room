// Package lifecycle handles daemon process concerns: the daemon.info
// discovery file, the double-start flock guard, socket liveness probing,
// and graceful shutdown coordination.
package lifecycle

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"syscall"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// ErrAlreadyRunning is returned when another live daemon holds the lock.
var ErrAlreadyRunning = errors.New("waiting-room: another daemon is already running")

// Info describes a running daemon. Written to a well-known path (mode 0600)
// so clients (`emit`, SDK) can discover the socket and detect staleness.
type Info struct {
	PID        int       `json:"pid"`
	SocketPath string    `json:"socket_path"`
	Version    string    `json:"version"`
	StartedAt  time.Time `json:"started_at"`
}

// ReadInfo loads a daemon.info file. A missing file is an error.
func ReadInfo(path string) (*Info, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var in Info
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fmt.Errorf("lifecycle: corrupt info file %s: %w", path, err)
	}
	return &in, nil
}

// WriteInfo atomically writes the info file with mode 0600.
func WriteInfo(path string, in Info) error {
	raw, err := json.MarshalIndent(in, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dirOf(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// RemoveInfo deletes the info file (best effort, on shutdown).
func RemoveInfo(path string) { _ = os.Remove(path) }

// AcquireLock takes an exclusive non-blocking flock on the lock file for the
// daemon's lifetime. The returned file must stay open; closing it releases
// the lock. Returns ErrAlreadyRunning if another daemon holds it.
func AcquireLock(path string) (*os.File, error) {
	if err := os.MkdirAll(dirOf(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, ErrAlreadyRunning
		}
		return nil, err
	}
	return f, nil
}

// DaemonAlive reports whether a live daemon is answering on socketPath. It
// dials, sends a ping, and waits for any response line. A socket file left
// behind by a crashed daemon fails the dial and reports false.
func DaemonAlive(socketPath string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("unix", socketPath, timeout)
	if err != nil {
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))

	line, err := wire.Encode(wire.PingMsg())
	if err != nil {
		return false
	}
	if _, err := conn.Write(line); err != nil {
		return false
	}
	// Any response line (hello or pong) means a live daemon.
	_, err = bufio.NewReader(conn).ReadString('\n')
	return err == nil
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return "."
}
