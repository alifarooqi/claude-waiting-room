import type { Activity, AgentState, StateChangeInfo } from '@waiting-room/sdk';

/** A controllable Activity fake for server tests — same pattern as the
 *  games' test helper, plus an initial state and call recording. */
export interface FakeActivity extends Activity {
  _pause(): void;
  _resume(): void;
  _disconnect(): void;
  _reconnect(): void;
  _setState(state: AgentState): void;
  readonly _focusCalls: number;
  readonly _disposed: boolean;
}

export function fakeActivity(initial: AgentState = 'unknown'): FakeActivity {
  const pause: Array<() => void> = [];
  const resume: Array<() => void> = [];
  const disconnect: Array<() => void> = [];
  const reconnect: Array<() => void> = [];
  const stateChange: Array<(s: AgentState, info: StateChangeInfo) => void> = [];
  let state: AgentState = initial;
  let focusCalls = 0;
  let disposed = false;

  const apply = (next: AgentState): void => {
    const from = state;
    state = next;
    const info = { from, to: next };
    for (const cb of stateChange) cb(next, info);
    if (next === 'needs_attention') for (const cb of pause) cb();
    else if (next === 'working') for (const cb of resume) cb();
  };

  return {
    get state() {
      return state;
    },
    onPause(cb) {
      pause.push(cb);
    },
    onResume(cb) {
      resume.push(cb);
    },
    onStateChange(cb) {
      stateChange.push(cb);
    },
    onDisconnect(cb) {
      disconnect.push(cb);
    },
    onReconnect(cb) {
      reconnect.push(cb);
    },
    focusAgentTerminal() {
      focusCalls += 1;
      return Promise.resolve();
    },
    dispose() {
      disposed = true;
      return Promise.resolve();
    },
    _pause() {
      apply('needs_attention');
    },
    _resume() {
      apply('working');
    },
    _disconnect() {
      for (const cb of disconnect) cb();
    },
    _reconnect() {
      for (const cb of reconnect) cb();
    },
    _setState(next: AgentState) {
      apply(next);
    },
    get _focusCalls() {
      return focusCalls;
    },
    get _disposed() {
      return disposed;
    },
  };
}
