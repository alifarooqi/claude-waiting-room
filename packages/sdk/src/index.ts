/**
 * @waiting-room/sdk — public surface for Waiting Room activity authors.
 *
 *   const wr = await createActivity({ session: 'auto', title: 'Snake' });
 *   wr.onPause(() => game.pause());   // Claude needs you
 *   wr.onResume(() => game.resume()); // Claude is working again
 */

export {
  PROTOCOL_VERSION,
} from './protocol.js';

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
  FocusRequestMessage,
  SessionStatus,
  StatusRequestMessage,
  StatusResponseMessage,
  ServerToClient,
  ClientToServer,
} from './protocol.js';

export { createActivity, daemonAlive } from './activity.js';
export type { Activity, ActivityOptions, StateChangeInfo } from './activity.js';

export { IpcClient } from './client.js';
export type { ConnectionStatus, IpcClientOptions } from './client.js';

export { resolveSocketPath } from './discover.js';
