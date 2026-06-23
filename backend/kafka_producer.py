"""
Kafka Producer — Publish scan events to Kafka topics.
Events: scan.submitted, scan.processing, scan.completed, scan.failed
"""
import os
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:29092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_SCANS", "scan-events")

_producer = None


async def get_producer():
    """Lazy-init Kafka producer."""
    global _producer
    if _producer is None:
        try:
            from aiokafka import AIOKafkaProducer
            _producer = AIOKafkaProducer(
                bootstrap_servers=KAFKA_BOOTSTRAP,
                value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
                key_serializer=lambda k: k.encode("utf-8") if k else None,
                acks="all",
                retry_backoff_ms=500,
            )
            await _producer.start()
            logger.info("Kafka producer started successfully")
        except Exception as e:
            logger.warning(f"Kafka producer init failed (will retry): {e}")
            _producer = None
    return _producer


async def stop_producer():
    """Graceful shutdown."""
    global _producer
    if _producer:
        await _producer.stop()
        _producer = None
        logger.info("Kafka producer stopped")


async def publish_scan_event(
    event_type: str,
    scan_id: str,
    data: dict | None = None,
):
    """
    Publish a scan event to Kafka.

    event_type: scan.submitted | scan.processing | scan.completed | scan.failed
    scan_id: UUID of the scan
    data: additional event payload
    """
    producer = await get_producer()
    if producer is None:
        logger.warning(f"Kafka unavailable, skipping event: {event_type} for {scan_id}")
        return

    event = {
        "event_type": event_type,
        "scan_id": scan_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data or {},
    }

    try:
        await producer.send_and_wait(
            topic=KAFKA_TOPIC,
            key=scan_id,
            value=event,
        )
        logger.info(f"Published {event_type} for scan {scan_id}")
    except Exception as e:
        logger.error(f"Failed to publish event {event_type}: {e}")
