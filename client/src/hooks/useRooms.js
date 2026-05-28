import { useCallback, useEffect, useState } from 'react';
import { socket } from '../socket.js';

// Subscribes to `rooms-updated` broadcasts and exposes a refresh() that
// asks the server for the current room list. Returns a stable shape
// regardless of socket state so the lobby can render an empty list during
// reconnects without flashing errors.
export function useRooms() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    socket.emit('rooms-list', (resp) => {
      if (resp && Array.isArray(resp.rooms)) setRooms(resp.rooms);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    function onUpdate({ rooms: next }) {
      if (Array.isArray(next)) setRooms(next);
    }
    socket.on('rooms-updated', onUpdate);
    if (socket.connected) refresh();
    socket.on('connect', refresh);
    return () => {
      socket.off('rooms-updated', onUpdate);
      socket.off('connect', refresh);
    };
  }, [refresh]);

  return { rooms, loading, refresh };
}
