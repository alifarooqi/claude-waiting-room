package main

import (
	"bufio"
	"flag"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/alifarooqi/claude-waiting-room/daemon/internal/wire"
)

// runStatus implements `waiting-room status`: ask the daemon for its
// session registry and print it as a table.
func runStatus(args []string) int {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
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

	line, err := wire.Encode(wire.StatusRequest())
	if err != nil {
		fmt.Fprintln(os.Stderr, "waiting-room: failed to encode status request")
		return 1
	}
	if _, err := conn.Write(line); err != nil {
		fmt.Fprintln(os.Stderr, "waiting-room: failed to send status request")
		return 1
	}

	r := bufio.NewReader(conn)
	deadline := time.Now().Add(2 * time.Second)
	for {
		_ = conn.SetReadDeadline(deadline)
		raw, err := r.ReadBytes('\n')
		if err != nil {
			fmt.Fprintln(os.Stderr, "waiting-room: no status response")
			return 1
		}
		m, err := wire.Decode(raw)
		if err != nil {
			continue
		}
		st, ok := m.(*wire.StatusResponseMessage)
		if !ok {
			continue // skip hello etc.
		}
		printStatus(st)
		return 0
	}
}

func printStatus(st *wire.StatusResponseMessage) {
	if st.ServerVersion != "" {
		fmt.Printf("waiting-room daemon %s\n", st.ServerVersion)
	}
	if len(st.Sessions) == 0 {
		fmt.Println("no sessions registered")
		return
	}
	fmt.Printf("%-24s %-16s %-8s %s\n", "SESSION", "STATE", "PANE", "ACTIVITIES")
	for _, s := range st.Sessions {
		acts := strings.Join(s.BoundActivities, ", ")
		fmt.Printf("%-24s %-16s %-8s %s\n",
			s.SessionID, s.State, orDash(s.TmuxPane), orDash(acts))
	}
}
