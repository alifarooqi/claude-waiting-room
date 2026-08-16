package wire

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestEmitRoundTrip(t *testing.T) {
	msg := &EmitMessage{
		Envelope:  Env("emit"),
		Event:     EventAgentWorking,
		SessionID: "s1",
		Seq:       42,
		TS:        time.Now().UTC(),
		TmuxPane:  "%5",
		Meta:      map[string]any{"hook": "UserPromptSubmit"},
	}
	b, err := Encode(msg)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	if b[len(b)-1] != '\n' {
		t.Fatal("Encode must append a newline (JSON-lines framing)")
	}

	got, err := Decode(b)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	m, ok := got.(*EmitMessage)
	if !ok {
		t.Fatalf("wrong type %T", got)
	}
	if m.Event != EventAgentWorking || m.SessionID != "s1" || m.Seq != 42 || m.TmuxPane != "%5" {
		t.Fatalf("field mismatch: %+v", m)
	}
	if m.Meta["hook"] != "UserPromptSubmit" {
		t.Fatalf("meta mismatch: %+v", m.Meta)
	}
	if !m.TS.Equal(msg.TS) {
		t.Fatalf("timestamp mismatch: %v vs %v", m.TS, msg.TS)
	}
}

func TestDecodeStateChange(t *testing.T) {
	line := `{"v":1,"type":"state_change","session_id":"s1","from":"working","to":"needs_attention","reason":"Stop"}`
	got, err := Decode([]byte(line))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	sc, ok := got.(*StateChangeMessage)
	if !ok {
		t.Fatalf("wrong type %T", got)
	}
	if sc.Envelope.Type != "state_change" || sc.Envelope.V != Version {
		t.Fatalf("envelope mismatch: %+v", sc.Envelope)
	}
	if sc.From != StateWorking || sc.To != StateNeedsAttention || sc.Reason != "Stop" {
		t.Fatalf("field mismatch: %+v", sc)
	}
}

func TestDecodeUnknownType(t *testing.T) {
	_, err := Decode([]byte(`{"v":1,"type":"warp_drive"}`))
	if !errors.Is(err, ErrUnknownType) {
		t.Fatalf("want ErrUnknownType, got %v", err)
	}
}

func TestDecodeBadVersion(t *testing.T) {
	_, err := Decode([]byte(`{"v":99,"type":"ping"}`))
	if err == nil || !strings.Contains(err.Error(), "unsupported protocol version") {
		t.Fatalf("want version error, got %v", err)
	}
}

func TestDecodeBadJSON(t *testing.T) {
	if _, err := Decode([]byte(`definitely not json`)); err == nil {
		t.Fatal("want error for malformed json")
	}
}

func TestPingPongRoundTrip(t *testing.T) {
	for _, msg := range []any{PingMsg(), PongMsg()} {
		b, err := Encode(msg)
		if err != nil {
			t.Fatalf("Encode: %v", err)
		}
		if _, err := Decode(b); err != nil {
			t.Fatalf("Decode: %v", err)
		}
	}
}

func TestStateForEvent(t *testing.T) {
	cases := []struct {
		event string
		want  State
		ok    bool
	}{
		{EventAgentWorking, StateWorking, true},
		{EventAgentHeartbeat, StateWorking, true},
		{EventAgentNeedsAttention, StateNeedsAttention, true},
		{"agent_panicking", StateUnknown, false},
	}
	for _, c := range cases {
		got, ok := StateForEvent(c.event)
		if got != c.want || ok != c.ok {
			t.Fatalf("StateForEvent(%q) = (%v, %v), want (%v, %v)", c.event, got, ok, c.want, c.ok)
		}
	}
}
