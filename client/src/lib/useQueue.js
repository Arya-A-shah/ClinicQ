import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api.js';

// One shared socket for the whole app.
let socket;
function getSocket() {
  if (!socket) socket = io({ transports: ['websocket', 'polling'] });
  return socket;
}

// Live public queue state. Calls onChange after every update so pages can refetch
// their private data (my tokens / staff list).
export function useQueue(onChange) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    const onUpdate = (data) => {
      setState(data);
      onChange?.(data);
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('queue:update', onUpdate);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    setConnected(s.connected);
    // Also fetch once over HTTP, in case the socket is slow to connect.
    api('/queue').then(onUpdate).catch(() => {});
    return () => {
      s.off('queue:update', onUpdate);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, connected };
}
