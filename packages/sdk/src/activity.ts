/**
 * The public activity API. Separation of concerns: the daemon owns
 * OS-level focus recovery; the activity owns pausing/resuming its own
 * loop via these callbacks.
 */
import { randomUUID } from 'node:crypto';
import { daemonAlive, ensureDaemon } from './ensure.js';
import { socketCandidates } from './discover.js';
import {
  PROTOCOL_VERSION,
  type AgentState,
  type BindMode,
  type StateChangeMessage,
  type SnapshotMessage,
} from './protocol.js';
import { type Transport } from './transport.js';
import { pickTransport } from './pick-transport.js';

export interface ActivityOptions {
  /**
   * Which Claude session this activity follows.
   * - `'auto'` (default): bind to the most recently active Claude session.
   * - `'any'`: fire on every session's state change.
   * - `{ session: '<id>' }`: bind to an explicit Claude session_id.
   * Falls back to $WAITING_ROOM_SESSION if unset.
   */
  readonly session?: BindMode;
  /** Human-readable label, surfaced in `waiting-room status`. */
  readonly title?: string;
  /**
   * Auto-spawn the daemon when unreachable (default true, or
   * $WAITING_ROOM_NO_SPAWN=1 to disable). When spawning fails or is
   * disabled, the activity runs in degraded mode: callbacks never fire,
   * nothing throws — the SDK must never crash an activity.
   */
  readonly spawnDaemon?: boolean;
}

export interface StateChangeInfo {
  readonly from: AgentState;
  readonly to: AgentState;
  readonly reason?: string;
}

/** A handle on a registered side activity. */
export interface Activity {
  /** Current bound session state. */
  readonly state: AgentState;
  /** Fired when state transitions to needs_attention (Claude halted / needs input). */
  onPause(cb: () => void): void;
  /** Fired when state transitions to working (Claude resumed). */
  onResume(cb: () => void): void;
  /** Fired on every state transition. */
  onStateChange(cb: (state: AgentState, info: StateChangeInfo) => void): void;
  /** Fired when the connection to the daemon drops (activity keeps running). */
  onDisconnect(cb: () => void): void;
  /**
   * Imperatively focus the user's terminal (sends focus_request).
   * Best-effort; resolves once the daemon has acked. Returns immediately
   * when running in degraded mode.
   */
  focusClaude(): Promise<void>;
  /** Unsubscribe and close the transport. Safe to call multiple times. */
  dispose(): Promise<void>;
}

/** Register a side activity with the Waiting Room daemon. */
export async function createActivity(options: ActivityOptions = {}): Promise<Activity> {
  const title = options.title ?? 'activity';
  const spawnEnabled =
    options.spawnDaemon ?? process.env['WAITING_ROOM_NO_SPAWN'] !== '1';

  // Probe candidates; a dead advertised socket is stale info — never spawn
  // onto it, fall back to the default path.
  const candidates = socketCandidates();
  let socketPath = candidates[candidates.length - 1]!;
  for (const candidate of candidates) {
    if (await daemonAlive(candidate, 300)) {
      socketPath = candidate;
      break;
    }
  }

  const alive = await ensureDaemon(socketPath, { spawnEnabled });
  if (!alive) return degradedActivity();

  return liveActivity(options, title);
}

function liveActivity(
  options: ActivityOptions,
  title: string,
): Activity {
  const activityId = `${slug(title)}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const bind = resolveBind(options);

  let state: AgentState = 'unknown';
  let disposed = false;
  const pauseCbs: Array<() => void> = [];
  const resumeCbs: Array<() => void> = [];
  const stateCbs: Array<(s: AgentState, info: StateChangeInfo) => void> = [];
  const disconnectCbs: Array<() => void> = [];

  let transport: Transport | undefined;
  void (async () => {
    transport = await pickTransport({
      onConnected: () => {
        // (Re)subscribe on every connection; the server answers with a
        // snapshot that re-syncs our state.
        transport?.send({
          v: PROTOCOL_VERSION,
          type: 'subscribe',
          mode: bind.mode,
          session_id: bind.sessionId,
          activity_id: activityId,
          title,
        });
      },
      onMessage: (msg) => {
        switch (msg.type) {
          case 'snapshot':
            applyState((msg as SnapshotMessage).state);
            break;
          case 'state_change': {
            const sc = msg as StateChangeMessage;
            applyState(sc.to, { from: sc.from, to: sc.to, reason: sc.reason });
            break;
          }
          default:
            break; // ack/pong/dropped/hello: not state-bearing
        }
      },
      onDisconnect: () => {
        for (const cb of disconnectCbs) cb();
      },
    });
    if (!disposed) transport.start();
  })();

  function applyState(next: AgentState, info?: StateChangeInfo): void {
    if (next === state) return;
    const from = state;
    state = next;
    const change = info ?? { from, to: next };
    for (const cb of stateCbs) cb(next, change);
    if (next === 'needs_attention') {
      for (const cb of pauseCbs) cb();
    } else if (next === 'working') {
      for (const cb of resumeCbs) cb();
    }
  }

  return {
    get state() {
      return state;
    },
    onPause(cb) {
      pauseCbs.push(cb);
    },
    onResume(cb) {
      resumeCbs.push(cb);
    },
    onStateChange(cb) {
      stateCbs.push(cb);
    },
    onDisconnect(cb) {
      disconnectCbs.push(cb);
    },
    focusClaude() {
      transport?.send({ v: PROTOCOL_VERSION, type: 'focus_request' });
      return Promise.resolve();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (transport) await transport.stop();
    },
  };
}

/** Inert activity used when the daemon can't be reached: never crashes,
 *  never fires callbacks — the user just plays without auto-pause. */
function degradedActivity(): Activity {
  return {
    state: 'unknown',
    onPause() {},
    onResume() {},
    onStateChange() {},
    onDisconnect() {},
    focusClaude() {
      return Promise.resolve();
    },
    dispose() {
      return Promise.resolve();
    },
  };
}

function resolveBind(options: ActivityOptions): { mode: 'auto' | 'any' | 'session'; sessionId?: string } {
  const bind: BindMode = options.session ?? parseEnvSession() ?? 'auto';
  if (bind === 'auto' || bind === 'any') return { mode: bind };
  return { mode: 'session', sessionId: bind.session };
}

function parseEnvSession(): BindMode | undefined {
  const v = process.env['WAITING_ROOM_SESSION'];
  if (!v) return undefined;
  if (v === 'auto' || v === 'any') return v;
  return { session: v };
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'activity';
}

// Re-exported for `daemonAlive` consumers doing their own health checks.
export { daemonAlive };

