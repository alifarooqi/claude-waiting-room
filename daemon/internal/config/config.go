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
//	Base dir:   $WAITING_ROOM_HOME, else ~/.waiting-room
//	SocketPath: $WAITING_ROOM_SOCKET, else
//	            $XDG_RUNTIME_DIR/waiting-room/daemon.sock, else
//	            <base>/run/waiting-room/daemon.sock   (macOS lacks XDG_RUNTIME_DIR)
//	InfoPath:   <base>/daemon.info   (fixed so clients can find it)
//	LockPath:   <base>/daemon.lock
//
// WAITING_ROOM_HOME lets tests and multi-instance setups fully isolate
// socket, info, and lock state.
func Default() (Config, error) {
	base := os.Getenv("WAITING_ROOM_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return Config{}, err
		}
		base = filepath.Join(home, ".waiting-room")
	}

	socket := os.Getenv("WAITING_ROOM_SOCKET")
	if socket == "" {
		runtimeDir := os.Getenv("XDG_RUNTIME_DIR")
		if runtimeDir == "" || os.Getenv("WAITING_ROOM_HOME") != "" {
			// No XDG dir (macOS), or full isolation requested: keep the
			// socket under the base dir.
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
