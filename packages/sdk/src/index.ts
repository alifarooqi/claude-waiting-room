/**
 * @waiting-room/sdk — public surface for Waiting Room activity authors.
 *
 * The transport client, reconnection, degraded mode, and `ensureDaemon()` are
 * implemented in milestone M4. Until then `createActivity()` throws so the
 * contract is visible but unusable.
 */

export type {
  AgentState,
  BindMode,
  Envelope,
  EmitEvent,
  EmitMessage,
  AckMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  SnapshotMessage,
  StateChangeMessage,
  DroppedMessage,
  HelloMessage,
  ByeMessage,
  ErrorMessage,
  PingMessage,
  PongMessage,
  ServerToClient,
  ClientToServer,
} from './protocol.js';

export { PROTOCOL_VERSION } from './protocol.js';

import type { AgentState, BindMode } from './protocol.js';

export interface ActivityOptions {
  /**
   * Which Claude session this activity follows.
   * - `'auto'` (default): bind by tmux window topology — the session whose Claude
   *   pane shares this activity's window.
   * - `'any'`: fire on every session's state change.
   * - `{ session: '<id>' }`: bind to an explicit Claude `session_id`.
   * Falls back to `process.env.WAITING_ROOM_SESSION` if unset.
   */
  readonly session?: BindMode;
  /** Human-readable label, surfaced in `waiting-room status`. */
  readonly title?: string;
}

export interface StateChangeInfo {
  readonly from: AgentState;
  readonly to: AgentState;
  readonly reason?: string;
}

/**
 * A handle on a registered side activity.
 *
 * Separation of concerns: the daemon owns focus-switching (via tmux); the
 * activity owns pausing/resuming its own loop via these callbacks.
 */
export interface Activity {
  /** Current bound session state. */
  readonly state: AgentState;
  /** Fired when state transitions to `needs_attention` (Claude halted / needs input). */
  onPause(cb: () => void): void;
  /** Fired when state transitions to `working` (Claude resumed). */
  onResume(cb: () => void): void;
  /** Fired on every state transition. */
  onStateChange(cb: (state: AgentState, info: StateChangeInfo) => void): void;
  /** Fired when the connection to the daemon drops (activity keeps running). */
  onDisconnect(cb: () => void): void;
  /** Imperatively focus the Claude pane (e.g. on quit). */
  focusAgentTerminal(): Promise<void>;
  /** Unsubscribe and close the socket. Safe to call multiple times. */
  dispose(): Promise<void>;
}

/**
 * Register a side activity with the Waiting Room daemon.
 *
 * @throws in degraded mode only if `requireDaemon` is set; otherwise degrades
 *   silently (callbacks never fire, the activity runs normally).
 */
export async function createActivity(_options?: ActivityOptions): Promise<Activity> {
  throw new Error(
    '@waiting-room/sdk: createActivity() is not implemented yet (milestone M4).',
  );
}
