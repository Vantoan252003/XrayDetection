"""
Kafka Consumer — Background consumer that processes scan events.
Updates analytics tables and broadcasts to WebSocket clients.
"""
import os
import json
import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_SCANS", "scan-events")
KAFKA_GROUP = "xray-analytics-consumer"

_consumer = None
_running = False


async def start_consumer(ws_manager, db_pool_getter):
    """
    Start background Kafka consumer.
    Processes scan events → updates DB analytics → broadcasts to WebSocket.
    """
    global _consumer, _running

    # Wait for Kafka to be ready
    await asyncio.sleep(5)

    try:
        from aiokafka import AIOKafkaConsumer
        _consumer = AIOKafkaConsumer(
            KAFKA_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP,
            group_id=KAFKA_GROUP,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
            auto_offset_reset="latest",
            enable_auto_commit=True,
        )
        await _consumer.start()
        _running = True
        logger.info("Kafka consumer started, listening for scan events...")

        async for msg in _consumer:
            if not _running:
                break
            try:
                event = msg.value
                event_type = event.get("event_type", "")
                scan_id = event.get("scan_id", "")
                event_data = event.get("data", {})
                timestamp = event.get("timestamp", datetime.now(timezone.utc).isoformat())

                logger.info(f"Consumed event: {event_type} for scan {scan_id}")

                # Save event to scan_events table
                try:
                    pool = await db_pool_getter()
                    await pool.execute(
                        """INSERT INTO scan_events (scan_id, event_type, event_data, created_at, kafka_offset, kafka_partition)
                           VALUES ($1, $2, $3, $4, $5, $6)""",
                        __import__("uuid").UUID(scan_id),
                        event_type,
                        json.dumps(event_data),
                        datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else timestamp,
                        msg.offset,
                        msg.partition,
                    )
                except Exception as db_err:
                    logger.error(f"Failed to save event to DB: {db_err}")

                # Update hourly analytics for completed scans
                if event_type == "scan.completed":
                    try:
                        pool = await db_pool_getter()
                        await pool.execute(
                            "SELECT upsert_hourly_analytics($1, $2, $3, $4, $5)",
                            datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else datetime.now(timezone.utc),
                            event_data.get("is_normal", False),
                            event_data.get("top_disease"),
                            event_data.get("processing_time_ms", 0),
                            event_data.get("source", "web"),
                        )
                        await pool.execute(
                            "SELECT upsert_daily_analytics($1, $2, $3, $4, $5)",
                            (datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else datetime.now(timezone.utc)).date(),
                            event_data.get("is_normal", False),
                            event_data.get("top_disease"),
                            event_data.get("processing_time_ms", 0),
                            event_data.get("source", "web"),
                        )
                    except Exception as analytics_err:
                        logger.error(f"Failed to update analytics: {analytics_err}")

                # Broadcast to WebSocket clients
                await ws_manager.broadcast({
                    "type": "scan_event",
                    "event_type": event_type,
                    "scan_id": scan_id,
                    "data": event_data,
                    "timestamp": timestamp,
                })

            except Exception as e:
                logger.error(f"Error processing Kafka message: {e}")

    except Exception as e:
        logger.warning(f"Kafka consumer error (will continue without Kafka): {e}")
    finally:
        if _consumer:
            await _consumer.stop()
            logger.info("Kafka consumer stopped")


async def stop_consumer():
    """Signal consumer to stop."""
    global _running
    _running = False
