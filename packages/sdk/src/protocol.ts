/**
 * Waiting Room wire protocol — TypeScript mirror of the Go `internal/wire` package.
 *
 * Transport-agnostic: over a Unix Domain Socket these are newline-delimited JSON
 * objects (JSON-lines); a future WebSocket gateway would carry each object as one
 * text frame with no body changes.
 */

/** Protocol schema version carried in every envelope (`v`). */
export const PROTOCOL_VERSION = 1 as const;

/** Per-session Claude Code agent state. */
export type AgentState = 'unknown' | 'working' | 'needs_attention';

/** How an activity binds to a Claude session. */
export type BindMode = 'auto' | 'any' | { session: string };

/** Base envelope. Every frame is a JSON object with at least `v` and `type`. */
export interface Envelope {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: string;
}

// ---------------------------------------------------------------------------
// Hook -> daemon (sent by the one-shot `waiting-room emit` client)
// ---------------------------------------------------------------------------

export type EmitEvent =
  | 'agent_working'
  | 'agent_needs_attention'
  | 'agent_heartbeat';

export interface EmitMessage extends Envelope {
  readonly type: 'emit';
  readonly event: EmitEvent;
  readonly session_id: string;
  readonly seq: number;
  readonly ts: string;
  readonly tmux_pane?: string;
  readonly tmux_session?: string;
  readonly meta?: {
    readonly hook?: string;
    readonly cwd?: string;
    readonly reason?: string;
    readonly [k: string]: unknown;
  };
}

export interface AckMessage extends Envelope {
  readonly type: 'ack';
  readonly ok: boolean;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Activity -> daemon
// ---------------------------------------------------------------------------

export interface SubscribeMessage extends Envelope {
  readonly type: 'subscribe';
  readonly mode: 'auto' | 'any' | 'session';
  /** Present when `mode === 'session'`. */
  readonly session_id?: string;
  readonly activity_id: string;
  readonly activity_pane?: string;
  readonly title?: string;
}

export interface UnsubscribeMessage extends Envelope {
  readonly type: 'unsubscribe';
  readonly activity_id: string;
}

// ---------------------------------------------------------------------------
// Daemon -> activity
// ---------------------------------------------------------------------------

export interface SnapshotMessage extends Envelope {
  readonly type: 'snapshot';
  /** Absent when the activity is subscribed unbound (`mode: 'any'`) and no session is active. */
  readonly session_id?: string;
  readonly state: AgentState;
  readonly ts: string;
}

export interface StateChangeMessage extends Envelope {
  readonly type: 'state_change';
  readonly session_id: string;
  readonly from: AgentState;
  readonly to: AgentState;
  readonly reason?: string;
  readonly ts: string;
}

export interface DroppedMessage extends Envelope {
  readonly type: 'dropped';
  readonly session_id?: string;
  readonly hint?: string;
}

export interface HelloMessage extends Envelope {
  readonly type: 'hello';
  readonly server_version?: string;
}

export interface ByeMessage extends Envelope {
  readonly type: 'bye';
  readonly reason?: string;
}

export interface ErrorMessage extends Envelope {
  readonly type: 'error';
  readonly message: string;
}

export interface PingMessage extends Envelope {
  readonly type: 'ping';
}

export interface PongMessage extends Envelope {
  readonly type: 'pong';
}

/** All messages a client (SDK) can receive from the daemon. */
export type ServerToClient =
  | SnapshotMessage
  | StateChangeMessage
  | DroppedMessage
  | AckMessage
  | HelloMessage
  | ByeMessage
  | ErrorMessage
  | PongMessage;

/** All messages a client (SDK) can send to the daemon. */
export type ClientToServer =
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage;
