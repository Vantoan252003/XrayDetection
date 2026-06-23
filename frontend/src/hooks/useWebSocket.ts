"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type WSMessage = {
  type: string;
  event_type?: string;
  scan_id?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  active_clients?: number;
};

type UseWebSocketReturn = {
  isConnected: boolean;
  lastMessage: WSMessage | null;
  activeClients: number;
  messages: WSMessage[];
};

export function useWebSocket(url?: string): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [activeClients, setActiveClients] = useState(0);
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const wsUrl =
    url ||
    (typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}:8000/ws/dashboard`
      : "ws://localhost:8000/ws/dashboard");

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
        // Send pings to keep alive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);

          if (msg.type === "heartbeat" || msg.type === "connected") {
            if (msg.active_clients !== undefined) {
              setActiveClients(msg.active_clients);
            }
            return;
          }

          if (msg.type === "pong") return;

          setLastMessage(msg);
          setMessages((prev) => [msg, ...prev].slice(0, 100)); // Keep last 100
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        // Auto-reconnect after 3s
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    }
  }, [wsUrl]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [connect]);

  return { isConnected, lastMessage, activeClients, messages };
}
