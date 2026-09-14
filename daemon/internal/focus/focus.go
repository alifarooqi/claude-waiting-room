// Package focus implements OS-level focus recovery for the Waiting Room
// daemon: when Claude Code needs the user's attention, the daemon asks
// the focus controller to bring the user's terminal to the front.
//
// v2 dropped the tmux-specific focus controller (it relied on `tmux
// select-pane`). The new abstraction lets us swap in platform-specific
// implementations: macOS uses osascript (System Events), Linux uses
// xdg-open or wmctrl, Windows uses the platform's native APIs.
//
// All controllers must be fail-open: a focus failure must never error
// Claude — log and move on.
package focus

import "log"

// Controller brings the user's terminal to the front when Claude needs
// attention.
type Controller interface {
	// FocusClaude is called when state transitions to needs_attention.
	// Returns nil on success or when the controller is a no-op. Errors
	// are logged but never propagated to the user.
	FocusClaude() error
}

// Noop is a Controller that does nothing. Used as the default on
// platforms without an implementation (Linux, Windows in v2) and in
// tests.
type Noop struct{ Log *log.Logger }

// FocusClaude is a no-op.
func (Noop) FocusClaude() error { return nil }
