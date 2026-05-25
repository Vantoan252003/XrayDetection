"""
WebSocket Manager — Manages WebSocket connections for real-time dashboard.
Handles connect/disconnect, broadcast, and heartbeat.
"""
import json
import asyncio
import logging
from datetime import datetime, timezone
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages active WebSocket connections and broadcasts events."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._heartbeat_task: asyncio.Task | None = None

    async def connect(self, websocket: WebSocket):
        """Accept and register a new WebSocket connection."""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total: {len(self.active_connections)}")

        # Send initial state
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to XRay Dashboard",
            "active_clients": len(self.active_connections),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    def disconnect(self, websocket: WebSocket):
        """Remove a disconnected WebSocket."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Send message to all connected clients."""
        if not self.active_connections:
            return

        dead_connections = []
        encoded = json.dumps(message, default=str)

        for connection in self.active_connections:
            try:
                await connection.send_text(encoded)
            except Exception:
                dead_connections.append(connection)

        # Clean up dead connections
        for conn in dead_connections:
            self.disconnect(conn)

    async def start_heartbeat(self, interval: int = 30):
        """Send periodic heartbeat to keep connections alive."""
        async def _heartbeat():
            while True:
                await asyncio.sleep(interval)
                await self.broadcast({
                    "type": "heartbeat",
                    "active_clients": len(self.active_connections),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

        self._heartbeat_task = asyncio.create_task(_heartbeat())

    async def stop_heartbeat(self):
        """Stop heartbeat task."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass


# Singleton instance
ws_manager = WebSocketManager()
