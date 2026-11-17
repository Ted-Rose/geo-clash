// Clock-skew helper. Client emits with its local send timestamp;
// server replies with both so the client can compute skew without
// a second round-trip.
import { guardSocketHandler } from '../sentry.js';

export function registerTimeSync(socket) {
  socket.on('time-sync', guardSocketHandler((clientSendMs, ack) => {
    const serverNowMs = Date.now();
    if (typeof ack === 'function') {
      ack({ clientSendMs, serverNowMs });
    } else {
      socket.emit('time-sync', { clientSendMs, serverNowMs });
    }
  }, { event: 'time-sync' }));
}
