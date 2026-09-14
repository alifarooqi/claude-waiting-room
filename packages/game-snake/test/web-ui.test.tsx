// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/web/App.web.js';
import type { BrowserClient } from '@waiting-room/web-bridge/browser';
import type { GameState } from '../src/game.js';

/** Fake bridge client — records actions, controllable state. */
function fakeClient(): BrowserClient & { _quitCalls: number; _focusCalls: number } {
  return {
    state: 'working',
    daemonOnline: true,
    quit() {
      this._quitCalls += 1;
    },
    focusClaude() {
      this._focusCalls += 1;
      return Promise.resolve();
    },
    destroy() {},
    _quitCalls: 0,
    _focusCalls: 0,
  };
}

/** Food directly ahead of the head: eating (and thus the score) is
 *  deterministic on the first tick. */
function hungryGame(): GameState {
  return {
    snake: [
      { x: 8, y: 6 },
      { x: 7, y: 6 },
      { x: 6, y: 6 },
    ],
    dir: { x: 1, y: 0 },
    food: { x: 9, y: 6 },
    score: 0,
    gameOver: false,
  };
}

interface Props {
  client?: BrowserClient & { _quitCalls: number; _focusCalls: number };
  agentState?: 'working' | 'needs_attention' | 'connecting' | 'unknown';
  daemonOnline?: boolean;
  serverLost?: boolean;
  initialGame?: GameState;
}

let root: Root | undefined;
let container: HTMLElement | undefined;

function renderui(props: Props = {}): void {
  const { client = fakeClient(), ...rest } = props;
  rerender(client, { agentState: 'working', daemonOnline: true, serverLost: false, ...rest });
}

function rerender(
  client: BrowserClient,
  props: Required<Omit<Props, 'client'>> | Omit<Props, 'client'>,
): void {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(
      <App
        client={client}
        agentState={props.agentState ?? 'working'}
        daemonOnline={props.daemonOnline ?? true}
        serverLost={props.serverLost ?? false}
        initialGame={props.initialGame}
      />,
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

function scoreText(): string {
  return document.querySelector('.score strong')?.textContent ?? '';
}

describe('snake web UI', () => {
  it('renders the hud, board canvas and controls', () => {
    renderui({});
    expect(document.querySelector('.title')?.textContent).toContain('snake');
    expect(document.querySelector('canvas.board')).not.toBeNull();
    expect(document.querySelector('.dpad')).not.toBeNull();
    expect(document.querySelector('.hint')?.textContent).toContain('WASD');
  });

  it('shows the pause banner when Claude needs attention, clears on resume', () => {
    const client = fakeClient();
    renderui({ client });
    expect(document.querySelector('.paused-banner')).toBeNull();

    rerender(client, { agentState: 'needs_attention' });
    const banner = document.querySelector('.paused-banner');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('Claude needs you');

    // "back to Claude" button focuses the terminal via the client.
    const btn = banner?.querySelector('button');
    act(() => {
      (btn as HTMLButtonElement).click();
    });
    expect(client._focusCalls).toBe(1);

    rerender(client, { agentState: 'working' });
    expect(document.querySelector('.paused-banner')).toBeNull();
  });

  it('runs the game loop (eats, scores) and freezes while auto-paused', async () => {
    const client = fakeClient();
    renderui({ client, initialGame: hungryGame() });
    expect(scoreText()).toBe('0');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    expect(scoreText()).toBe('1'); // food was one cell ahead — deterministic

    rerender(client, { agentState: 'needs_attention' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(scoreText()).toBe('1'); // loop frozen while paused
  });

  it('shows the offline note when the daemon is unreachable', () => {
    renderui({ daemonOnline: false });
    expect(document.querySelector('.offline-note')?.textContent).toContain('daemon offline');
  });

  it('shows the farewell when the bridge is gone', () => {
    renderui({ serverLost: true });
    expect(document.querySelector('.lost-banner')?.textContent).toContain('bridge closed');
  });

  it('quit button and Q key ask the bridge to quit', () => {
    const client = fakeClient();
    renderui({ client });

    const quitBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('quit'),
    )!;
    act(() => {
      quitBtn.click();
    });
    expect(client._quitCalls).toBe(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    });
    expect(client._quitCalls).toBe(2);
  });

  it('arrow keys steer (preventDefault so the page never scrolls)', () => {
    renderui({});
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
    act(() => {
      window.dispatchEvent(up);
    });
    expect(up.defaultPrevented).toBe(true);
  });
});
