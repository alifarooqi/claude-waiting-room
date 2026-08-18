// Package tmux wraps tmux control: pane discovery and focus switching.
//
// Every tmux interaction in the daemon funnels through the Controller
// interface so unit tests can substitute a fake and integration tests can
// point at an isolated tmux server (`tmux -S <socket>`). Never call
// exec.Command("tmux", …) outside this package.
package tmux

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
)

// PaneInfo describes one tmux pane (from `list-panes -a`).
type PaneInfo struct {
	ID          string // %0
	SessionID   string // $0
	SessionName string
	WindowID    string // @0
	// ActiveInWindow: this pane is the active pane of its window.
	ActiveInWindow bool
	// WindowActive: this pane's window is the session's active window.
	WindowActive bool
}

// Controller is the daemon's entire tmux surface.
type Controller interface {
	// Available reports whether tmux can be used at all.
	Available() bool
	// ListPanes returns every pane on the tmux server.
	ListPanes() ([]PaneInfo, error)
	// FocusPane makes paneID the active pane (switching window first if
	// needed — select-pane alone only works within the current window).
	FocusPane(paneID string) error
}

// Shell is the production Controller: it shells out to tmux, scoped to an
// optional socket path (empty = default server).
type Shell struct {
	socket string
}

// NewShell returns a Controller bound to a tmux socket path ("" = default).
func NewShell(socketPath string) Controller { return &Shell{socket: socketPath} }

func (s *Shell) cmd(args ...string) (string, error) {
	full := args
	if s.socket != "" {
		full = append([]string{"-S", s.socket}, args...)
	}
	c := exec.Command("tmux", full...)
	var stdout, stderr bytes.Buffer
	c.Stdout = &stdout
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		return "", fmt.Errorf("tmux %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

// Available reports whether a tmux binary is on PATH.
func (s *Shell) Available() bool {
	_, err := exec.LookPath("tmux")
	return err == nil
}

const paneFmt = "#{pane_id}\t#{session_id}\t#{session_name}\t#{window_id}\t#{pane_active}\t#{window_active}"

// ListPanes returns all panes on the server (-a: across all sessions).
func (s *Shell) ListPanes() ([]PaneInfo, error) {
	out, err := s.cmd("list-panes", "-a", "-F", paneFmt)
	if err != nil {
		return nil, err
	}
	return ParsePanes(out), nil
}

// ParsePanes parses `list-panes -a -F` output (tab-separated fields).
func ParsePanes(out string) []PaneInfo {
	var panes []PaneInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) < 6 {
			continue
		}
		panes = append(panes, PaneInfo{
			ID:             f[0],
			SessionID:      f[1],
			SessionName:    f[2],
			WindowID:       f[3],
			ActiveInWindow: f[4] == "1",
			WindowActive:   f[5] == "1",
		})
	}
	return panes
}

// FocusPane switches to the pane's window, then selects the pane.
func (s *Shell) FocusPane(paneID string) error {
	panes, err := s.ListPanes()
	if err != nil {
		return err
	}
	for _, p := range panes {
		if p.ID != paneID {
			continue
		}
		if _, err := s.cmd("select-window", "-t", p.WindowID); err != nil {
			return err
		}
		_, err := s.cmd("select-pane", "-t", paneID)
		return err
	}
	return fmt.Errorf("tmux: pane %s not found", paneID)
}
