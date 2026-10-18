import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

// Broadcasts carry no member data. They only tell the authenticated admin UI
// to reload its private RPC; the administrator code never enters this channel.
export function subscribeLocationChanges(onChange) {
  const topic = 'realtime:admin-location-updates';
  const url = new URL('/realtime/v1/websocket', SUPABASE_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('apikey', SUPABASE_KEY);
  url.searchParams.set('vsn', '1.0.0');
  let socket;
  let stopped = false;
  let reconnectTimer;
  let heartbeatTimer;
  let reference = 0;
  let retries = 0;

  function connect() {
    if (stopped) return;
    try {
      socket = new WebSocket(url);
    } catch {
      reconnect();
      return;
    }
    const connection = socket;
    let joinReference;
    const send = (event, payload, channel = topic) => {
      const ref = String(++reference);
      connection.send(JSON.stringify({ topic: channel, event, payload, ref }));
      return ref;
    };
    connection.addEventListener('open', () => {
      if (stopped || connection !== socket) return connection.close();
      joinReference = send('phx_join', {
        config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, postgres_changes: [], private: false }
      });
      heartbeatTimer = setInterval(() => {
        if (connection.readyState === WebSocket.OPEN) send('heartbeat', {}, 'phoenix');
      }, 25000);
    });
    connection.addEventListener('message', message => {
      if (stopped || connection !== socket) return;
      let frame;
      try { frame = JSON.parse(message.data); } catch { return; }
      if (frame.event === 'phx_reply' && frame.ref === joinReference) {
        if (frame.payload?.status !== 'ok') return connection.close();
        retries = 0;
        // Catch up with events missed while opening or reconnecting the socket.
        onChange();
      } else if (frame.topic === topic && frame.event === 'broadcast' && frame.payload?.event === 'location_changed') {
        onChange();
      } else if (frame.topic === topic && ['phx_error', 'phx_close'].includes(frame.event)) {
        connection.close();
      }
    });
    connection.addEventListener('error', () => connection.close());
    connection.addEventListener('close', () => {
      if (connection !== socket) return;
      clearInterval(heartbeatTimer);
      reconnect();
    });
  }

  function reconnect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 30000));
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    clearInterval(heartbeatTimer);
    socket?.close();
  };
}
