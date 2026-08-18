package config

import (
	"path/filepath"
	"testing"
)

func TestSocketEnvOverrideWins(t *testing.T) {
	t.Setenv("WAITING_ROOM_SOCKET", "/tmp/custom.sock")
	t.Setenv("HOME", "/tmp/fakehome")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SocketPath != "/tmp/custom.sock" {
		t.Fatalf("SocketPath = %q", cfg.SocketPath)
	}
}

func TestXDGRuntimeDirUsed(t *testing.T) {
	t.Setenv("WAITING_ROOM_SOCKET", "")
	t.Setenv("XDG_RUNTIME_DIR", "/run/user/1000")
	t.Setenv("WAITING_ROOM_HOME", "")
	t.Setenv("HOME", "/tmp/fakehome")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("/run/user/1000", "waiting-room", "daemon.sock")
	if cfg.SocketPath != want {
		t.Fatalf("SocketPath = %q, want %q", cfg.SocketPath, want)
	}
}

func TestFallsBackToHomeRunDir(t *testing.T) {
	t.Setenv("WAITING_ROOM_SOCKET", "")
	t.Setenv("XDG_RUNTIME_DIR", "")
	t.Setenv("WAITING_ROOM_HOME", "")
	t.Setenv("HOME", "/tmp/fakehome")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join("/tmp/fakehome", ".waiting-room", "run", "waiting-room", "daemon.sock")
	if cfg.SocketPath != want {
		t.Fatalf("SocketPath = %q, want %q", cfg.SocketPath, want)
	}
	if cfg.InfoPath != filepath.Join("/tmp/fakehome", ".waiting-room", "daemon.info") {
		t.Fatalf("InfoPath = %q", cfg.InfoPath)
	}
}

func TestWaitingRoomHomeIsolatesEverything(t *testing.T) {
	t.Setenv("WAITING_ROOM_SOCKET", "")
	t.Setenv("XDG_RUNTIME_DIR", "/run/user/1000") // must be ignored under WAITING_ROOM_HOME
	t.Setenv("WAITING_ROOM_HOME", "/tmp/wrhome")
	t.Setenv("HOME", "/tmp/fakehome")
	cfg, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SocketPath != filepath.Join("/tmp/wrhome", "run", "waiting-room", "daemon.sock") {
		t.Fatalf("SocketPath = %q", cfg.SocketPath)
	}
	if cfg.InfoPath != filepath.Join("/tmp/wrhome", "daemon.info") {
		t.Fatalf("InfoPath = %q", cfg.InfoPath)
	}
	if cfg.LockPath != filepath.Join("/tmp/wrhome", "daemon.lock") {
		t.Fatalf("LockPath = %q", cfg.LockPath)
	}
}
