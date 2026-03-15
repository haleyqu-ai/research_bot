/**
 * WebSocket manager for real-time communication with backend.
 */

export class WebSocketManager {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = {};
    this.reconnectAttempts = 0;
    this.maxReconnects = 5;
  }

  on(type, handler) {
    this.handlers[type] = handler;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        // Keepalive ping every 25s to prevent Railway proxy idle timeout
        this._pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ action: 'ping' }));
          }
        }, 25000);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const handler = this.handlers[data.type];
          if (handler) {
            handler(data);
          } else {
            console.log('Unhandled message type:', data.type, data);
          }
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket closed');
        if (this._pingInterval) {
          clearInterval(this._pingInterval);
          this._pingInterval = null;
        }
        this._tryReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        reject(err);
      };
    });
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not connected, message dropped:', data);
    }
  }

  _tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(() => {});
    }, delay);
  }

  close() {
    this.maxReconnects = 0; // Prevent reconnection
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}
