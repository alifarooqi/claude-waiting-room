package tmux

import "testing"

func TestParsePanes(t *testing.T) {
	out := "%0\t$1\tmain\t@1\t1\t1\n" +
		"%1\t$1\tmain\t@1\t0\t1\n" +
		"%2\t$2\tother\t@2\t1\t1\n"
	panes := ParsePanes(out)
	if len(panes) != 3 {
		t.Fatalf("got %d panes, want 3", len(panes))
	}
	p0 := panes[0]
	if p0.ID != "%0" || p0.SessionID != "$1" || p0.SessionName != "main" || p0.WindowID != "@1" ||
		!p0.ActiveInWindow || !p0.WindowActive {
		t.Fatalf("pane 0 mismatch: %+v", p0)
	}
	// %1 is not the active pane of its window, but its window IS the
	// session's active window — window_active is about the window, not
	// the pane.
	p1 := panes[1]
	if p1.ActiveInWindow || !p1.WindowActive {
		t.Fatalf("pane 1 activity flags mismatch: %+v", p1)
	}
}

func TestParsePanesSkipsMalformed(t *testing.T) {
	out := "garbage\n\n%9\t$9\tlate\t@9\t1\t0\n"
	panes := ParsePanes(out)
	if len(panes) != 1 || panes[0].ID != "%9" {
		t.Fatalf("want only the valid pane, got %+v", panes)
	}
}
