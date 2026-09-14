/**
 * @waiting-room/sdk — public surface for Waiting Room activity authors.
 *
 *   const wr = await createActivity({ session: 'auto', title: 'Snake' });
 *   wr.onPause(() => game.pause());   // Claude needs you
 *   wr.onResume(() => game.resume()); // Claude is working again
 *
 * The SDK auto-picks a transport: UDS when running in Node, WebSocket
 * when running in a browser. The same envelope is used for both.
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

export type { Transport, TransportOptions, ConnectionStatus } from './transport.js';

export { socketCandidates, defaultSocketPath, infoFilePath, wsUrlFromInfo } from './discover.js';
