//go:build darwin

// macOS focus controller: bring the user's terminal application to the
// front via AppleScript / System Events.
//
// The command picks the first visible process whose name contains
// "Terminal" or "iTerm" — both Terminal.app and iTerm2 (whose process
// name is iTerm2) match. We don't try to find Claude Code's exact
// window because Claude Code runs in a TTY inside a terminal emulator
// (Terminal.app / iTerm2 / Ghostty / WezTerm). Bringing the terminal
// process to front is what the user expects when Claude is waiting.
//
// Failure mode (most common): the daemon hasn't been granted
// Accessibility permission. System Settings → Privacy & Security →
// Accessibility. We log a one-time hint on the first failure so the
// user can fix it.
package focus

import (
	"log"
	"os/exec"
	"sync/atomic"
)

// Osascript is the macOS focus controller.
type Osascript struct {
	Log        *log.Logger
	hintLogged atomic.Bool
}

// NewOsascript returns a macOS focus controller.
func NewOsascript(l *log.Logger) *Osascript {
	if l == nil {
		l = defaultLogger()
	}
	return &Osascript{Log: l}
}

const osascriptCmd = `tell application "System Events" to set frontmost of (first process whose visible is true and (name contains "Terminal" or name contains "iTerm")) to true`

// FocusClaude runs the osascript AppleScript. Errors are logged and
// swallowed — focus recovery is best-effort and must never block the
// daemon's main loop.
func (o *Osascript) FocusClaude() error {
	cmd := exec.Command("osascript", "-e", osascriptCmd)
	if err := cmd.Run(); err != nil {
		if o.hintLogged.CompareAndSwap(false, true) {
			o.Log.Printf("focus: osascript failed (need Accessibility permission? System Settings -> Privacy & Security -> Accessibility): %v", err)
		}
		return err
	}
	return nil
}

func defaultLogger() *log.Logger {
	return log.New(nil, "", 0)
}
