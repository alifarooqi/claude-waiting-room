/**
 * Browser-side client for Waiting Room web activities. Zero Node APIs —
 * this module is bundled into the served page (via
 * `@waiting-room/web-bridge/browser` + esbuild).
 *
 * Two concerns:
 *  1. `createBrowserClient()` — live agent state over SSE + focus/quit
 *     POSTs back to the local bridge.
 *  2. `startAttention()`/`stopAttention()` — "Claude needs you" effects
 *     (title flash, favicon, notification, beep), each degrading
 *     independently; a browser page cannot steal OS focus, so these are
 *     the page's half of getting your attention.
 */
import type { AgentState } from '@waiting-room/sdk';

export interface BrowserClientEvents {
  /** Every agent-state observation (initial snapshot + pings resync). */
  onState?: (state: AgentState, daemonOnline: boolean) => void;
  /** Daemon connection lost — auto-pause unavailable until onOnline. */
  onOffline?: () => void;
  /** Daemon connection restored. */
  onOnline?: () => void;
  /** SSE stream to the bridge dropped (bridge exited or crashed). */
  onServerLost?: () => void;
}

export interface BrowserClient {
  /** Current agent state, or 'connecting' before the first snapshot. */
  readonly state: AgentState | 'connecting';
  /** Whether the bridge currently sees the daemon. */
  readonly daemonOnline: boolean;
  /** Ask the bridge to focus Claude's terminal, then leave. */
  quit(): Promise<void>;
  /** Ask the bridge to focus Claude's terminal (stay in the game). */
  focusClaude(): Promise<void>;
  /** Close the SSE stream (page teardown). */
  destroy(): void;
}

interface StatePayload {
  state: AgentState;
  daemon: boolean;
}

export function createBrowserClient(events: BrowserClientEvents = {}): BrowserClient {
  const base = document.baseURI;
  const eventsUrl = new URL('events', base).toString();
  const post = (path: string): Promise<void> =>
    fetch(new URL(path, base).toString(), { method: 'POST', keepalive: true })
      .then(() => undefined, () => undefined);

  let state: AgentState | 'connecting' = 'connecting';
  let daemonOnline = true;

  const setDaemon = (online: boolean): void => {
    const was = daemonOnline;
    daemonOnline = online;
    if (was && !online) events.onOffline?.();
    else if (!was && online) events.onOnline?.();
  };

  const source = new EventSource(eventsUrl);
  source.addEventListener('state', (ev) => {
    safe(() => {
      const data = JSON.parse((ev as MessageEvent<string>).data) as StatePayload;
      state = data.state;
      setDaemon(data.daemon);
      events.onState?.(state, daemonOnline);
    });
  });
  source.addEventListener('offline', () => safe(() => setDaemon(false)));
  source.addEventListener('online', () => safe(() => setDaemon(true)));
  source.onerror = () => events.onServerLost?.();

  return {
    get state() {
      return state;
    },
    get daemonOnline() {
      return daemonOnline;
    },
    quit: () => post('quit'),
    focusClaude: () => post('focus'),
    destroy() {
      safe(() => source.close());
    },
  };
}

/** Run fn, swallowing errors — attention effects must never break the game. */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // degrade silently
  }
}

// ---------------------------------------------------------------------------
// Attention effects
// ---------------------------------------------------------------------------

export interface AttentionOptions {
  /** Notification/title text (default "Claude needs you"). */
  readonly title?: string;
  /** Notification body (default explains what to do). */
  readonly message?: string;
  /** Play a short beep (default true; only audible after a user gesture). */
  readonly sound?: boolean;
}

const RED_DOT_FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>" +
  "<circle cx='8' cy='8' r='7' fill='%23e11d48'/></svg>";

let attentionActive = false;

/** Start all attention effects. Idempotent (restarts are no-ops). */
export function startAttention(opts: AttentionOptions = {}): void {
  if (attentionActive) return;
  attentionActive = true;

  const title = opts.title ?? 'Claude needs you';
  const message =
    opts.message ?? 'Claude stopped and is waiting for your input in its terminal.';

  startTitleFlash(title);
  swapFavicon(RED_DOT_FAVICON);
  fireNotification(title, message);
  if (opts.sound !== false) beep();
}

/** Stop all attention effects and restore title/favicon. */
export function stopAttention(): void {
  if (!attentionActive) return;
  attentionActive = false;
  stopTitleFlash();
  restoreFavicon();
}

// --- title flash ------------------------------------------------------------

let titleTimer: ReturnType<typeof setInterval> | undefined;
let originalTitle: string | undefined;

function startTitleFlash(alertTitle: string): void {
  safe(() => {
    originalTitle = document.title;
    let showAlert = false; // alert is showing now; first tick restores
    document.title = `⏸ ${alertTitle}`;
    titleTimer = setInterval(() => {
      safe(() => {
        document.title = showAlert ? `⏸ ${alertTitle}` : (originalTitle ?? '');
        showAlert = !showAlert;
      });
    }, 900);
  });
}

function stopTitleFlash(): void {
  safe(() => {
    if (titleTimer !== undefined) clearInterval(titleTimer);
    titleTimer = undefined;
    if (originalTitle !== undefined) document.title = originalTitle;
  });
}

// --- favicon ----------------------------------------------------------------

let faviconLink: HTMLLinkElement | null = null;
let faviconHref: string | null | undefined;
let faviconCreated = false;

function findFavicon(): HTMLLinkElement | null {
  for (const link of document.querySelectorAll('link[rel]')) {
    if ((link.getAttribute('rel') ?? '').split(/\s+/).includes('icon')) {
      return link as HTMLLinkElement;
    }
  }
  return null;
}

function swapFavicon(href: string): void {
  safe(() => {
    faviconLink = findFavicon();
    faviconCreated = !faviconLink;
    faviconHref = faviconLink ? faviconLink.getAttribute('href') : null;
    if (!faviconLink) {
      faviconLink = document.createElement('link');
      faviconLink.setAttribute('rel', 'icon');
      document.head.appendChild(faviconLink);
    }
    faviconLink.setAttribute('href', href);
  });
}

function restoreFavicon(): void {
  safe(() => {
    if (!faviconLink) return;
    if (faviconCreated) faviconLink.remove();
    else if (faviconHref !== undefined) faviconLink.setAttribute('href', faviconHref ?? '');
    faviconLink = null;
    faviconCreated = false;
  });
}

// --- notification -----------------------------------------------------------

let gestureSeen = false;
let audioCtx: AudioContext | undefined;

/**
 * Call once on the page's first user gesture (pointerdown/keydown) to
 * unlock the effects browsers gate behind interaction: notification
 * permission and audio playback. Safe to wire unconditionally —
 * repeated calls are no-ops.
 */
export function primeUserGesture(): void {
  if (gestureSeen) return;
  gestureSeen = true;
  safe(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  });
  safe(() => {
    const Ctor = window.AudioContext;
    if (Ctor) {
      audioCtx = new Ctor();
      void audioCtx.resume();
    }
  });
}

function fireNotification(title: string, body: string): void {
  safe(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, tag: 'waiting-room-attention' });
    n.onclick = () => {
      safe(() => {
        window.focus();
        n.close();
      });
    };
  });
}

// --- beep -------------------------------------------------------------------

function beep(): void {
  safe(() => {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime;
    for (const [delay, freq] of [
      [0, 880],
      [0.16, 660],
    ] as const) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + 0.16);
    }
  });
}
