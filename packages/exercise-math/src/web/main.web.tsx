/** Browser entry — owns the bridge client, renders the App. */
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserClient, type BrowserClient } from '@waiting-room/web-bridge/browser';
import type { AgentState } from '@waiting-room/sdk';
import { App } from './App.web.js';

interface Conn {
  state: AgentState | 'connecting';
  daemonOnline: boolean;
  serverLost: boolean;
}

function Root(): JSX.Element {
  const [conn, setConn] = useState<Conn>({
    state: 'connecting',
    daemonOnline: true,
    serverLost: false,
  });

  // The client takes its events at construction — build it exactly once.
  const clientRef = useRef<BrowserClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = createBrowserClient({
      onState: (state, daemonOnline) =>
        setConn((c) => ({ ...c, state, daemonOnline, serverLost: false })),
      onOffline: () => setConn((c) => ({ ...c, daemonOnline: false })),
      onOnline: () => setConn((c) => ({ ...c, daemonOnline: true })),
      onServerLost: () => setConn((c) => ({ ...c, serverLost: true })),
    });
  }

  return (
    <App
      client={clientRef.current}
      agentState={conn.state}
      daemonOnline={conn.daemonOnline}
      serverLost={conn.serverLost}
    />
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<Root />);
}
