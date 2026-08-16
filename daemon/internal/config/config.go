// Package config resolves filesystem locations for the Waiting Room daemon:
// the Unix Domain Socket, the daemon.info discovery file, and the lock file.
package config

import (
	"os"
	"path/filepath"
)

// Config holds the daemon's resolved paths.
type Config struct {
	// SocketPath is the Unix Domain Socket the daemon listens on.
	SocketPath string
	// InfoPath is the well-known daemon.info file (discovery + staleness).
	InfoPath string
	// LockPath is the flock target guarding against double-start.
	LockPath string
}

// Default resolves paths from the environment:
//
//	SocketPath: $WAITING_ROOM_SOCKET, else
//	            $XDG_RUNTIME_DIR/waiting-room/daemon.sock, else
//	            ~/.waiting-room/run/waiting-room/daemon.sock   (macOS lacks XDG_RUNTIME_DIR)
//	InfoPath:   ~/.waiting-room/daemon.info   (always fixed so clients can find it)
//	LockPath:   ~/.waiting-room/daemon.lock
func Default() (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, err
	}
	base := filepath.Join(home, ".waiting-room")

	socket := os.Getenv("WAITING_ROOM_SOCKET")
	if socket == "" {
		runtimeDir := os.Getenv("XDG_RUNTIME_DIR")
		if runtimeDir == "" {
			runtimeDir = filepath.Join(base, "run")
		}
		socket = filepath.Join(runtimeDir, "waiting-room", "daemon.sock")
	}

	return Config{
		SocketPath: socket,
		InfoPath:   filepath.Join(base, "daemon.info"),
		LockPath:   filepath.Join(base, "daemon.lock"),
	}, nil
}
