package main

import (
	"bufio"
	"flag"
	"fmt"
	"net"
	"os"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// runWatch implements `waiting-room watch` — a debug subscriber that prints
// snapshots and state changes live. This is the human window into the daemon
// (and the reference consumer the SDK will replace).
func runWatch(args []string) int {
	fs := flag.NewFlagSet("watch", flag.ContinueOnError)
	sessionFlag := fs.String("session", "", "bind to a specific session id (default: auto)")
	anyFlag := fs.Bool("any", false, "watch every session")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	path := discoverSocket()
	conn, err := net.DialTimeout("unix", path, 2*time.Second)
	if err != nil {
		fmt.Fprintf(os.Stderr, "waiting-room: cannot reach daemon at %s (is it running?)\n", path)
		return 1
	}
	defer conn.Close()

	mode, sid := "auto", ""
	switch {
	case *anyFlag:
		mode = "any"
	case *sessionFlag != "":
		mode, sid = "session", *sessionFlag
	}

	sub := wire.SubscribeMessage{
		Envelope:   wire.Env("subscribe"),
		Mode:       mode,
		SessionID:  sid,
		ActivityID: fmt.Sprintf("watch-%d", os.Getpid()),
		Title:      "watch",
	}
	line, err := wire.Encode(sub)
	if err != nil {
		return 1
	}
	if _, err := conn.Write(line); err != nil {
		fmt.Fprintln(os.Stderr, "waiting-room: connection closed")
		return 1
	}

	fmt.Printf("watching %s (mode=%s)\n", path, mode)
	r := bufio.NewReader(conn)
	for {
		raw, err := r.ReadBytes('\n')
		if err != nil {
			fmt.Println("-- connection closed --")
			return 0
		}
		m, err := wire.Decode(raw)
		if err != nil {
			continue
		}
		stamp := time.Now().Format("15:04:05")
		switch t := m.(type) {
		case *wire.HelloMessage:
			fmt.Printf("[%s] connected (server %s)\n", stamp, t.ServerVersion)
		case *wire.SnapshotMessage:
			fmt.Printf("[%s] snapshot  session=%s state=%s\n", stamp, orDash(t.SessionID), t.State)
		case *wire.StateChangeMessage:
			fmt.Printf("[%s] session=%s %s -> %s (%s)\n", stamp, t.SessionID, t.From, t.To, orDash(t.Reason))
		case *wire.DroppedMessage:
			fmt.Printf("[%s] events dropped, resyncing\n", stamp)
		case *wire.ErrorMessage:
			fmt.Printf("[%s] error: %s\n", stamp, t.Message)
		}
	}
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
