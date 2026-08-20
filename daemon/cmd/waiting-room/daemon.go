package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/config"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/lifecycle"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/server"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/tmux"
)

// runDaemon implements `waiting-room daemon`: the long-lived IPC server.
//
// Double-start guard: probe the socket for a live daemon first (friendly
// message, exit 0), then take the flock for race safety.
func runDaemon(args []string) int {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	socket := fs.String("socket", "", "socket path override")
	noJanitor := false
	fs.BoolVar(&noJanitor, "no-janitor", false, "disable the background GC sweep")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	cfg, err := config.Default()
	if err != nil {
		fmt.Fprintf(os.Stderr, "waiting-room: %v\n", err)
		return 1
	}
	if *socket != "" {
		cfg.SocketPath = *socket
	}

	logger := log.New(os.Stderr, "waiting-room ", log.LstdFlags)

	if lifecycle.DaemonAlive(cfg.SocketPath, 500*time.Millisecond) {
		fmt.Printf("waiting-room: daemon already running at %s\n", cfg.SocketPath)
		return 0
	}
	lock, err := lifecycle.AcquireLock(cfg.LockPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "waiting-room: %v\n", err)
		return 1
	}
	defer lock.Close() // releases the flock

	core := server.NewCore(Version, logger, tmux.NewShell)
	srv := server.New(server.Options{
		SocketPath: cfg.SocketPath,
		InfoPath:   cfg.InfoPath,
		Version:    Version,
		Log:        logger,
	}, core)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Background GC sweeps: reap sessions whose Claude pane is gone and
	// whose activity has been idle for > idleLimit. Can be disabled with
	// --no-janitor (useful for tests / one-off daemons).
	if !noJanitor {
		j := server.NewJanitor(core.Registry(), core.Bus(), core.Factory())
		j.SetLogging(logger)
		go j.Run(ctx)
		logger.Printf("janitor: sweeping every 60s, idle limit 5m")
	}

	fmt.Printf("waiting-room daemon %s\n  socket: %s\n  info:   %s\n", Version, cfg.SocketPath, cfg.InfoPath)
	if err := srv.Run(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "waiting-room: %v\n", err)
		return 1
	}
	return 0
}
