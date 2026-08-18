// Package wire defines the Waiting Room wire protocol: versioned JSON
// envelopes exchanged as JSON-lines over a Unix Domain Socket (and, in the
// future, as text frames over a WebSocket gateway with no body changes).
//
// This file is the Go mirror of packages/sdk/src/protocol.ts — keep the two
// in sync. Field names are snake_case to match the TypeScript definitions.
package wire

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Version is the protocol schema version carried in every envelope.
const Version = 1

// State is a per-session Claude Code agent state.
type State string

const (
	StateUnknown        State = "unknown"
	StateWorking        State = "working"
	StateNeedsAttention State = "needs_attention"
)

// Event names emitted by the one-shot `emit` client (driven by Claude Code hooks).
const (
	EventAgentWorking        = "agent_working"
	EventAgentNeedsAttention = "agent_needs_attention"
	EventAgentHeartbeat      = "agent_heartbeat"
)

// StateForEvent maps an emit event to the session state it declares.
//
// Events are absolute state declarations, not deltas: Stop fully defines
// needs_attention, UserPromptSubmit fully defines working. A missed event is
// therefore self-healing — the next event restores correct state.
func StateForEvent(event string) (State, bool) {
	switch event {
	case EventAgentWorking, EventAgentHeartbeat:
		return StateWorking, true
	case EventAgentNeedsAttention:
		return StateNeedsAttention, true
	default:
		return StateUnknown, false
	}
}

// Envelope is embedded in every message.
type Envelope struct {
	V    int    `json:"v"`
	Type string `json:"type"`
}

// Env returns an envelope for the given message type.
func Env(typ string) Envelope { return Envelope{V: Version, Type: typ} }

// ---------------------------------------------------------------------------
// Hook -> daemon (sent by the one-shot `waiting-room emit` client)
// ---------------------------------------------------------------------------

// EmitMessage is a lifecycle declaration from a Claude Code hook.
type EmitMessage struct {
	Envelope
	Event       string         `json:"event"`
	SessionID   string         `json:"session_id"`
	Seq         int64          `json:"seq"`
	TS          time.Time      `json:"ts"`
	TmuxPane    string         `json:"tmux_pane,omitempty"`
	TmuxSession string         `json:"tmux_session,omitempty"`
	TmuxSocket  string         `json:"tmux_socket,omitempty"`
	Meta        map[string]any `json:"meta,omitempty"`
}

// AckMessage acknowledges an emit (or subscribe) request.
type AckMessage struct {
	Envelope
	Ok    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// Activity -> daemon
// ---------------------------------------------------------------------------

// SubscribeMessage registers an activity's interest in session state.
type SubscribeMessage struct {
	Envelope
	Mode         string `json:"mode"` // "auto" | "any" | "session"
	SessionID    string `json:"session_id,omitempty"`
	ActivityID   string `json:"activity_id"`
	ActivityPane string `json:"activity_pane,omitempty"`
	TmuxSocket   string `json:"tmux_socket,omitempty"`
	Title        string `json:"title,omitempty"`
}

// UnsubscribeMessage removes a subscription.
type UnsubscribeMessage struct {
	Envelope
	ActivityID string `json:"activity_id"`
}

// ---------------------------------------------------------------------------
// Daemon -> activity
// ---------------------------------------------------------------------------

// SnapshotMessage reports the current state of the bound session. It is sent
// immediately on subscribe and after any dropped-event resync.
type SnapshotMessage struct {
	Envelope
	SessionID string    `json:"session_id,omitempty"`
	State     State     `json:"state"`
	TS        time.Time `json:"ts"`
}

// StateChangeMessage streams a state transition. The SDK treats
// to == needs_attention as pause and to == working as resume.
type StateChangeMessage struct {
	Envelope
	SessionID string    `json:"session_id"`
	From      State     `json:"from"`
	To        State     `json:"to"`
	Reason    string    `json:"reason,omitempty"`
	TS        time.Time `json:"ts"`
}

// DroppedMessage warns a subscriber that events were dropped due to a slow
// consumer; a resync Snapshot follows.
type DroppedMessage struct {
	Envelope
	SessionID string `json:"session_id,omitempty"`
	Hint      string `json:"hint,omitempty"`
}

// HelloMessage greets a newly connected client.
type HelloMessage struct {
	Envelope
	ServerVersion string `json:"server_version,omitempty"`
}

// ByeMessage is sent before the daemon closes a connection.
type ByeMessage struct {
	Envelope
	Reason string `json:"reason,omitempty"`
}

// ErrorMessage reports a protocol-level error on a request.
type ErrorMessage struct {
	Envelope
	Message string `json:"message"`
}

// PingMessage / PongMessage keep connections live and probe liveness.
type PingMessage struct{ Envelope }
type PongMessage struct{ Envelope }

// FocusRequestMessage asks the daemon to imperatively focus the bound
// session's Claude pane (used by an activity quitting, or the SDK's
// focusAgentTerminal()).
type FocusRequestMessage struct{ Envelope }

// SessionStatus is one entry in a StatusResponseMessage.
type SessionStatus struct {
	SessionID       string    `json:"session_id"`
	State           State     `json:"state"`
	TmuxPane        string    `json:"tmux_pane,omitempty"`
	TmuxSession     string    `json:"tmux_session,omitempty"`
	BoundActivities []string  `json:"bound_activities,omitempty"`
	LastEventAt     time.Time `json:"last_event_at"`
}

// StatusRequestMessage asks the daemon for its registry (used by
// `waiting-room status`).
type StatusRequestMessage struct{ Envelope }

// StatusResponseMessage reports the daemon's session registry.
type StatusResponseMessage struct {
	Envelope
	ServerVersion string          `json:"server_version,omitempty"`
	Sessions      []SessionStatus `json:"sessions"`
}

// ---------------------------------------------------------------------------
// Constructors for server messages
// ---------------------------------------------------------------------------

// Ack builds an ack message.
func Ack(ok bool, errMsg string) AckMessage {
	return AckMessage{Envelope: Env("ack"), Ok: ok, Error: errMsg}
}

// Hello builds a greeting message.
func Hello(serverVersion string) HelloMessage {
	return HelloMessage{Envelope: Env("hello"), ServerVersion: serverVersion}
}

// ErrorMsg builds an error message.
func ErrorMsg(message string) ErrorMessage {
	return ErrorMessage{Envelope: Env("error"), Message: message}
}

// SnapshotMsg builds a snapshot message.
func SnapshotMsg(sessionID string, state State) SnapshotMessage {
	return SnapshotMessage{Envelope: Env("snapshot"), SessionID: sessionID, State: state, TS: time.Now().UTC()}
}

// StateChangeMsg builds a state-change message.
func StateChangeMsg(sessionID string, from, to State, reason string) StateChangeMessage {
	return StateChangeMessage{Envelope: Env("state_change"), SessionID: sessionID, From: from, To: to, Reason: reason, TS: time.Now().UTC()}
}

// DroppedMsg builds a dropped-events warning.
func DroppedMsg(sessionID string) DroppedMessage {
	return DroppedMessage{Envelope: Env("dropped"), SessionID: sessionID, Hint: "resync"}
}

// PingMsg builds a liveness probe.
func PingMsg() PingMessage { return PingMessage{Envelope: Env("ping")} }

// PongMsg builds a liveness reply.
func PongMsg() PongMessage { return PongMessage{Envelope: Env("pong")} }

// FocusRequest builds an imperative focus request.
func FocusRequest() FocusRequestMessage { return FocusRequestMessage{Envelope: Env("focus_request")} }

// ByeMsg builds a goodbye message.
func ByeMsg(reason string) ByeMessage { return ByeMessage{Envelope: Env("bye"), Reason: reason} }

// StatusRequest builds a status request.
func StatusRequest() StatusRequestMessage {
	return StatusRequestMessage{Envelope: Env("status_request")}
}

// ---------------------------------------------------------------------------
// Codec: JSON-lines framing
// ---------------------------------------------------------------------------

// ErrUnknownType is returned for well-formed envelopes with an unrecognized
// `type`. The daemon ignores these (forward compatibility) but logs them.
var ErrUnknownType = errors.New("wire: unknown message type")

// Message is any decoded protocol message.
type Message any

// Decode parses one JSON-lines frame into the concrete message type
// indicated by its envelope `type` field.
func Decode(line []byte) (Message, error) {
	var env Envelope
	if err := json.Unmarshal(line, &env); err != nil {
		return nil, fmt.Errorf("wire: bad json: %w", err)
	}
	if env.V != Version {
		return nil, fmt.Errorf("wire: unsupported protocol version %d (want %d)", env.V, Version)
	}

	var msg Message
	switch env.Type {
	case "emit":
		msg = &EmitMessage{}
	case "ack":
		msg = &AckMessage{}
	case "subscribe":
		msg = &SubscribeMessage{}
	case "unsubscribe":
		msg = &UnsubscribeMessage{}
	case "snapshot":
		msg = &SnapshotMessage{}
	case "state_change":
		msg = &StateChangeMessage{}
	case "dropped":
		msg = &DroppedMessage{}
	case "hello":
		msg = &HelloMessage{}
	case "bye":
		msg = &ByeMessage{}
	case "error":
		msg = &ErrorMessage{}
	case "ping":
		msg = &PingMessage{}
	case "pong":
		msg = &PongMessage{}
	case "focus_request":
		msg = &FocusRequestMessage{}
	case "status_request":
		msg = &StatusRequestMessage{}
	case "status":
		msg = &StatusResponseMessage{}
	default:
		return nil, fmt.Errorf("%w: %q", ErrUnknownType, env.Type)
	}
	if err := json.Unmarshal(line, msg); err != nil {
		return nil, fmt.Errorf("wire: bad %s message: %w", env.Type, err)
	}
	return msg, nil
}

// Encode marshals a message as one JSON-lines frame (trailing newline included).
func Encode(msg any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	if err := enc.Encode(msg); err != nil { // Encoder appends '\n'
		return nil, err
	}
	return buf.Bytes(), nil
}
