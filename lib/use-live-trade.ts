'use client';

import { useEffect, useRef } from 'react';

/**
 * Subscribe to a trade's live update stream (SSE). The stream carries only a
 * version marker; `onChange` fires when it moves and the caller refetches the
 * full detail through the normal authorized API. Also refreshes when the tab
 * returns to the foreground, which is how a payment screen picks up where it
 * left off after the user backgrounds Pi Browser mid flow.
 */
export function useLiveTrade(tradeId: string | null, onChange: () => void) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!tradeId) return;
    let es: EventSource | null = null;
    let lastMarker = '';
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/trades/${tradeId}/stream`);
      es.onmessage = (ev) => {
        if (ev.data === lastMarker) return;
        const isFirst = lastMarker === '';
        lastMarker = ev.data;
        if (!isFirst) onChangeRef.current(); // the first message is the state we already rendered
      };
      // EventSource reconnects on its own for network blips; a server-closed
      // stream (function time limit) surfaces as an error too. Refetch once on
      // each drop so anything that changed while disconnected is not missed.
      es.onerror = () => {
        lastMarker = '';
        onChangeRef.current();
      };
    };
    connect();

    const onVisible = () => {
      if (document.visibilityState === 'visible') onChangeRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      es?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tradeId]);
}
