//go:build darwin

package focus

import (
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestOsascriptRunsScript verifies the AppleScript source string we hand
// to osascript targets the right processes and uses the right event
// syntax. We can't actually run osascript in CI (no display server,
// no Accessibility perms), so we just verify the executable was found
// and would be invoked with the expected script.
func TestOsascriptRunsScript(t *testing.T) {
	if _, err := exec.LookPath("osascript"); err != nil {
		t.Skip("osascript not on PATH (non-macOS test env)")
	}

	// Stub osascript with a shell script that records its arguments.
	dir := t.TempDir()
	stub := filepath.Join(dir, "osascript")
	script := `#!/bin/sh
echo "$@" > "$STUB_OUT"
exit 0
`
	if err := os.WriteFile(stub, []byte(script), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	out := filepath.Join(dir, "stub.out")
	t.Setenv("STUB_OUT", out)

	origPath := os.Getenv("PATH")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+origPath)

	c := NewOsascript(log.New(io.Discard, "", 0))
	if err := c.FocusClaude(); err != nil {
		t.Fatalf("FocusClaude: %v", err)
	}

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read stub out: %v", err)
	}
	if !strings.Contains(string(got), "first process whose visible is true") {
		t.Fatalf("osascript was invoked with unexpected args: %s", got)
	}
	if !strings.Contains(string(got), "Terminal") || !strings.Contains(string(got), "iTerm") {
		t.Fatalf("osascript script must target Terminal and iTerm: %s", got)
	}
}

// TestFocusFailureSwallowed verifies that an osascript failure (e.g.
// accessibility permission denied) is logged but never returned to the
// caller.
func TestFocusFailureSwallowed(t *testing.T) {
	dir := t.TempDir()
	stub := filepath.Join(dir, "osascript")
	script := `#!/bin/sh
exit 1
`
	if err := os.WriteFile(stub, []byte(script), 0o755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	var buf strings.Builder
	c := NewOsascript(log.New(&buf, "", 0))
	if err := c.FocusClaude(); err == nil {
		t.Fatal("expected error from failing osascript")
	}
	if !strings.Contains(buf.String(), "Accessibility") {
		t.Fatalf("expected accessibility hint in log on first failure; got %q", buf.String())
	}
}
