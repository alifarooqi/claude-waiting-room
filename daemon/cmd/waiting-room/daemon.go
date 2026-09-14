package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/config"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/focus"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/lifecycle"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/server"
	"github.com/alifarooqi/claude-waiting-room/daemon/internal/web"
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
	noWeb := false
	fs.BoolVar(&noWeb, "no-web", false, "disable the localhost HTTP+WS listener")
	webAddr := fs.String("web-listen", "127.0.0.1:0", "address for the HTTP+WS listener")
	gamesDir := fs.String("games-dir", defaultGamesDir(), "directory of installed game bundles (served at /games/<name>/)")
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

	core := server.NewCore(Version, logger, osascriptFocus(logger))
	srv := server.New(server.Options{
		SocketPath: cfg.SocketPath,
		InfoPath:   cfg.InfoPath,
		Version:    Version,
		Log:        logger,
	}, core)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Background GC sweeps: reap sessions that have been idle for > idleLimit.
	// Can be disabled with --no-janitor (useful for tests / one-off daemons).
	if !noJanitor {
		j := server.NewJanitor(core.Registry(), core.Bus())
		j.SetLogging(logger)
		go j.Run(ctx)
		logger.Printf("janitor: sweeping every 60s, idle limit 5m")
	}

	// Localhost HTTP+WS listener for browser-based side activities.
	// Disabled by --no-web (tests, single-transport debug sessions).
	var webLn *web.Listener
	if !noWeb {
		webLn = web.New(web.Options{
			ListenAddr: *webAddr,
			GamesDir:   *gamesDir,
			Log:        logger,
		}, core)
		go func() {
			if err := webLn.Start(ctx); err != nil {
				logger.Printf("web: %v", err)
			}
		}()
	}

	fmt.Printf("waiting-room daemon %s\n  socket: %s\n  info:   %s\n", Version, cfg.SocketPath, cfg.InfoPath)

	// Run the UDS server in a goroutine. It writes the baseline info
	// file. We wait for it to be ready, then (if web is enabled) wait
	// for the web listener too, then overwrite the info file with the
	// combined view (web URLs included).
	udsDone := make(chan error, 1)
	go func() { udsDone <- srv.Run(ctx) }()

	// Wait for UDS server to bind.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !lifecycle.DaemonAlive(cfg.SocketPath, 100*time.Millisecond) {
		time.Sleep(10 * time.Millisecond)
	}
	// Wait for web listener to bind (if enabled).
	if webLn != nil {
		deadline = time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) && webLn.Addr() == "" {
			time.Sleep(10 * time.Millisecond)
		}
		// Overwrite the info file with web URLs.
		info := lifecycle.Info{
			PID:         os.Getpid(),
			SocketPath:  cfg.SocketPath,
			WebURL:      webLn.BaseURL(),
			WSURL:       webLn.WSURL(),
			WebGamesDir: *gamesDir,
			Version:     Version,
			StartedAt:   time.Now().UTC(),
		}
		if err := lifecycle.WriteInfo(cfg.InfoPath, info); err != nil {
			logger.Printf("warning: failed to overwrite info with web urls: %v", err)
		}
		fmt.Printf("  web:    %s\n  ws:     %s\n  games:  %s\n",
			webLn.BaseURL(), webLn.WSURL(), *gamesDir)
	}

	// Block until the UDS server returns (signal / ctx cancel).
	if err := <-udsDone; err != nil {
		fmt.Fprintf(os.Stderr, "waiting-room: %v\n", err)
		return 1
	}
	return 0
}

// defaultGamesDir returns ~/.waiting-room/web (or WAITING_ROOM_HOME/web).
func defaultGamesDir() string {
	if base := os.Getenv("WAITING_ROOM_HOME"); base != "" {
		return filepath.Join(base, "web")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".waiting-room", "web")
}

// osascriptFocus returns the platform-appropriate focus controller.
// macOS gets the osascript controller (built only on darwin via the
// build tag on osascript.go). Other platforms get a no-op.
func osascriptFocus(l *log.Logger) focus.Controller {
	if runtime.GOOS == "darwin" {
		// Sanity check: skip if osascript is missing (e.g. minimal macOS).
		if _, err := exec.LookPath("osascript"); err == nil {
			return focus.NewOsascript(l)
		}
	}
	return focus.Noop{}
}
