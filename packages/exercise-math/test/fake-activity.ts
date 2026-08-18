import type { Activity, AgentState, StateChangeInfo } from '@waiting-room/sdk';

/** A controllable Activity fake for rendering tests. `_ready` flips true
 *  once the component has registered its callbacks (effects flushed) —
 *  always await it before firing `_pause`/`_resume`/`_disconnect`. */
export interface FakeActivity extends Activity {
  readonly _ready: boolean;
  _pause(): void;
  _resume(): void;
  _disconnect(): void;
}

export function fakeActivity(): FakeActivity {
  const pause: Array<() => void> = [];
  const resume: Array<() => void> = [];
  const disconnect: Array<() => void> = [];
  const stateChange: Array<(s: AgentState, info: StateChangeInfo) => void> = [];
  let state: AgentState = 'unknown';
  let ready = false;
  return {
    get state() {
      return state;
    },
    get _ready() {
      return ready;
    },
    onPause(cb) {
      ready = true;
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
    focusAgentTerminal() {
      return Promise.resolve();
    },
    dispose() {
      return Promise.resolve();
    },
    _pause() {
      state = 'needs_attention';
      for (const cb of pause) cb();
    },
    _resume() {
      state = 'working';
      for (const cb of resume) cb();
    },
    _disconnect() {
      for (const cb of disconnect) cb();
    },
  };
}
