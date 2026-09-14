// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createBrowserClient,
  primeUserGesture,
  startAttention,
  stopAttention,
} from '../src/browser.js';

/** Minimal EventSource stub — jsdom doesn't implement SSE. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners = new Map<string, Array<(ev: { data?: string }) => void>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: { data?: string }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  emit(type: string, data?: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) {
      cb({ data: data === undefined ? undefined : JSON.stringify(data) });
    }
  }

  close(): void {
    this.closed = true;
  }
}

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/t/test-token/');
  document.title = 'Snake';
});

afterEach(() => {
  stopAttention(); // never let a failed assert leak attention state
  document.querySelectorAll('link[rel]').forEach((l) => l.remove());
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe('createBrowserClient', () => {
  it('connects to the events endpoint relative to the page URL', () => {
    createBrowserClient({});
    const es = FakeEventSource.instances.at(-1)!;
    expect(es.url).toBe('http://localhost:3000/t/test-token/events');
  });

  it('applies state snapshots and reports daemon transitions', () => {
    const onState = vi.fn();
    const onOffline = vi.fn();
    const onOnline = vi.fn();
    const client = createBrowserClient({ onState, onOffline, onOnline });
    const es = FakeEventSource.instances.at(-1)!;

    expect(client.state).toBe('connecting');
    es.emit('state', { state: 'working', daemon: true });
    expect(client.state).toBe('working');
    expect(client.daemonOnline).toBe(true);
    expect(onState).toHaveBeenCalledWith('working', true);

    es.emit('offline');
    expect(client.daemonOnline).toBe(false);
    expect(onOffline).toHaveBeenCalledTimes(1);

    // The periodic state ping carries the daemon flag too — recovery via
    // either channel fires onOnline exactly once (transitions dedupe).
    es.emit('state', { state: 'working', daemon: true });
    expect(onOnline).toHaveBeenCalledTimes(1);

    es.emit('online');
    es.emit('online');
    expect(onOnline).toHaveBeenCalledTimes(1);
  });

  it('posts quit and focus to the bridge endpoints', async () => {
    const client = createBrowserClient({});
    await client.quit();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/t/test-token/quit',
      expect.objectContaining({ method: 'POST' }),
    );
    await client.focusClaude();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/t/test-token/focus',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces SSE errors as onServerLost and closes cleanly', () => {
    const onServerLost = vi.fn();
    const client = createBrowserClient({ onServerLost });
    const es = FakeEventSource.instances.at(-1)!;
    es.onerror?.(new Error('boom'));
    expect(onServerLost).toHaveBeenCalledTimes(1);
    client.destroy();
    expect(es.closed).toBe(true);
  });

  it('tolerates malformed state frames', () => {
    const client = createBrowserClient({});
    const es = FakeEventSource.instances.at(-1)!;
    es.emit('state'); // no data
    expect(client.state).toBe('connecting');
  });
});

describe('attention effects', () => {
  it('flashes the title and restores it on stop', () => {
    vi.useFakeTimers();
    try {
      startAttention({ title: 'Claude needs you' });
      expect(document.title).toBe('⏸ Claude needs you');
      vi.advanceTimersByTime(900);
      expect(document.title).toBe('Snake');
      vi.advanceTimersByTime(900);
      expect(document.title).toBe('⏸ Claude needs you');
      stopAttention();
      expect(document.title).toBe('Snake');
    } finally {
      vi.useRealTimers();
    }
  });

  it('swaps the favicon to a red dot and restores it', () => {
    const link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('href', '/original.png');
    document.head.appendChild(link);

    startAttention({});
    expect(link.getAttribute('href')).toMatch(/^data:image\/svg\+xml/);
    stopAttention();
    expect(link.getAttribute('href')).toBe('/original.png');
  });

  it('degrades without throwing when Notification is absent', () => {
    // jsdom has no Notification — startAttention must not throw.
    expect(() => {
      startAttention({ sound: true });
      stopAttention();
    }).not.toThrow();
  });

  it('primeUserGesture requests notification permission once', () => {
    let requested = 0;
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: () => {
        requested += 1;
        return Promise.resolve('denied');
      },
    });
    primeUserGesture();
    primeUserGesture();
    expect(requested).toBe(1);
  });
});
