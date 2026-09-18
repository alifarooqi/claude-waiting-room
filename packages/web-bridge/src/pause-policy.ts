/**
 * The shared pause policy for game pages: Claude needing attention pauses
 * the game, but resuming is always the player's call — the game never
 * resumes on its own. While paused, the banner tracks whether Claude is
 * still waiting or back at work, and "resume & remind" snoozes the pause:
 * keep playing now, get re-paused after N minutes if Claude still waits.
 *
 * Framework-agnostic on purpose (bundled into pages; no React here) —
 * games keep a tiny hook that mirrors snapshots into component state.
 */

/** What the pause banner should show. */
export type PauseBanner = 'none' | 'waiting' | 'working-again';

export interface PauseSnapshot {
  /** Lock the game loop and input. */
  readonly paused: boolean;
  /** Run attention effects (title flash, favicon, notification, beep). */
  readonly attention: boolean;
  /** Which banner to render. */
  readonly banner: PauseBanner;
  /** Epoch ms when the armed reminder fires, null when none. */
  readonly reminderAt: number | null;
}

export interface PausePolicy {
  /** Current state (frozen snapshot object; changes only via callbacks). */
  readonly snapshot: PauseSnapshot;
  /** Feed the live agent state (needs_attention / working / unknown). */
  onState(state: AgentStateLike): void;
  /** User chose "resume now" (idempotent). */
  onResume(): void;
  /** User chose "resume & remind": resume now, re-pause after `ms` if
   *  Claude still needs attention at that point (a working signal before
   *  then cancels the reminder silently). */
  onRemind(ms: number): void;
  /** Subscribe to snapshot changes; returns an unsubscribe function. */
  onChange(cb: (snapshot: PauseSnapshot) => void): () => void;
  /** Cancel any pending reminder and drop listeners. */
  dispose(): void;
}

export type AgentStateLike = 'working' | 'needs_attention' | 'unknown';

const NO_PAUSE: PauseSnapshot = {
  paused: false,
  attention: false,
  banner: 'none',
  reminderAt: null,
};

export function createPausePolicy(): PausePolicy {
  let agent: AgentStateLike = 'unknown';
  let snapshot = NO_PAUSE;
  let reminderTimer: ReturnType<typeof setTimeout> | undefined;
  let reminderAt: number | null = null;
  let dismissed = true; // no pause to acknowledge yet
  const listeners = new Set<(snapshot: PauseSnapshot) => void>();

  function publish(next: PauseSnapshot): void {
    if (
      next.paused === snapshot.paused &&
      next.attention === snapshot.attention &&
      next.banner === snapshot.banner &&
      next.reminderAt === snapshot.reminderAt
    ) {
      return; // identical — spare React the rerender
    }
    snapshot = next;
    for (const cb of listeners) cb(snapshot);
  }

  function current(partial: Partial<PauseSnapshot>): PauseSnapshot {
    const paused = partial.paused ?? snapshot.paused;
    const attention = partial.attention ?? snapshot.attention;
    return {
      paused,
      attention,
      banner: paused ? (attention ? 'waiting' : 'working-again') : 'none',
      reminderAt: partial.reminderAt !== undefined ? partial.reminderAt : snapshot.reminderAt,
    };
  }

  function cancelReminder(): void {
    if (reminderTimer !== undefined) {
      clearTimeout(reminderTimer);
      reminderTimer = undefined;
    }
    reminderAt = null;
  }

  function recompute(): void {
    // Paused state persists until the player resumes; only the banner and
    // the attention effects follow Claude's live state.
    if (!snapshot.paused) {
      publish(current({ reminderAt }));
      return;
    }
    if (dismissed) {
      publish(current({ reminderAt }));
      return;
    }
    publish(current({ attention: agent === 'needs_attention', reminderAt }));
  }

  const policy: PausePolicy = {
    get snapshot(): PauseSnapshot {
      return snapshot;
    },
    onState(state: AgentStateLike): void {
      if (state === 'unknown') {
        agent = 'unknown';
        return;
      }
      agent = state;
      if (state === 'needs_attention') {
        // Claude is waiting: pause (fresh banner + effects) and let any
        // pending reminder go — the real thing just happened.
        cancelReminder();
        dismissed = false;
        publish({ paused: true, attention: true, banner: 'waiting', reminderAt: null });
        return;
      }
      // working: a pending reminder is moot (Claude got unstuck on its
      // own — someone answered elsewhere); drop it silently.
      cancelReminder();
      recompute();
    },
    onResume(): void {
      if (!snapshot.paused) return;
      cancelReminder();
      dismissed = true;
      publish({ ...NO_PAUSE });
    },
    onRemind(ms: number): void {
      if (!snapshot.paused) return; // nothing to snooze
      cancelReminder();
      dismissed = true;
      reminderAt = Date.now() + ms;
      publish({ ...NO_PAUSE, reminderAt: reminderAt });
      reminderTimer = setTimeout(() => {
        reminderTimer = undefined;
        reminderAt = null;
        if (agent !== 'needs_attention') {
          publish(current({ reminderAt: null })); // Claude is fine — stay quiet
          return;
        }
        dismissed = false;
        publish({ paused: true, attention: true, banner: 'waiting', reminderAt: null });
      }, ms);
    },
    onChange(cb: (snapshot: PauseSnapshot) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose(): void {
      cancelReminder();
      listeners.clear();
    },
  };
  return policy;
}
