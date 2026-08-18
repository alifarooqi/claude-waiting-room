// Package main is the entrypoint for the waiting-room CLI.
//
// waiting-room is a multi-modal binary:
//
//	waiting-room daemon   run the background IPC daemon (M1)
//	waiting-room emit     one-shot client used by Claude Code hooks (M2)
//	waiting-room status   print daemon + session registry status (M3)
//	waiting-room version  print version
//
// Milestone M0 ships only the dispatcher + `version`; subcommands land in later
// milestones and report "not implemented" until then.
package main

import (
	"fmt"
	"os"
)

// Version is overridden at build time via -ldflags "-X main.Version=…".
var Version = "dev"

func main() {
	if len(os.Args) < 2 {
		usage(os.Stderr)
		os.Exit(2)
	}

	switch os.Args[1] {
	case "version", "-v", "--version":
		fmt.Printf("waiting-room %s\n", Version)
	case "help", "-h", "--help":
		usage(os.Stdout)
	case "daemon":
		os.Exit(runDaemon(os.Args[2:]))
	case "emit":
		os.Exit(runEmit(os.Args[2:]))
	case "watch":
		os.Exit(runWatch(os.Args[2:]))
	case "status":
		os.Exit(runStatus(os.Args[2:]))
	default:
		fmt.Fprintf(os.Stderr, "waiting-room: unknown command %q\n", os.Args[1])
		usage(os.Stderr)
		os.Exit(2)
	}
}

func usage(w *os.File) {
	fmt.Fprintln(w, `waiting-room — pause activities & refocus when Claude Code needs you.

Usage:
  waiting-room <command> [args]

Commands:
  daemon    Run the background IPC daemon
  emit      Emit a lifecycle event (used by Claude Code hooks)
  watch     Debug subscriber: print session state changes live
  status    Show daemon + session registry status
  version   Print version
  help      Show this help`)
}
