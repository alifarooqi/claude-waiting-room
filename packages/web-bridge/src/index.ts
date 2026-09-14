/** @waiting-room/web-bridge — serve a Waiting Room activity as a local
 *  web page. Server-side entry; browser-side code lives under
 *  `@waiting-room/web-bridge/browser`. */
export {
  startWebServer,
  startWebActivity,
  type WebServer,
  type WebServerOptions,
  type WebActivity,
  type WebActivityOptions,
  type WebExitReason,
} from './server.js';
export { openBrowser, activateApp } from './open.js';
