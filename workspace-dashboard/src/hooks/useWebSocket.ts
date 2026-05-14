import { useEffect, useRef, useCallback } from 'react';

export type WsMessageHandler = (message: any) => void;

export interface UseWebSocketReturn {
  send: (msg: object) => void;
  isConnected: boolean;
}

interface UseWebSocketOptions {
  onMessage: WsMessageHandler;
  onConnectionChange: (connected: boolean) => void;
}

export function useWebSocket({ onMessage, onConnectionChange }: UseWebSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1000);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(`ws://${window.location.host}`);

      ws.onopen = () => {
        onConnectionChange(true);
        reconnectDelay.current = 1000;
      };

      ws.onmessage = (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch {
          // malformed message — ignore
        }
      };

      ws.onclose = () => {
        onConnectionChange(false);
        socketRef.current = null;
        if (!cancelled) {
          const delay = reconnectDelay.current;
          reconnectDelay.current = Math.min(delay * 2, 30000);
          reconnectTimer = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => ws.close();
      socketRef.current = ws;
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [onMessage, onConnectionChange]);

  const send = useCallback((msg: object) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  return { send };
}
