import asyncpg
import os, json, uuid

_pool = None

async def get_pool():
    global _pool
    if _pool is None:
        db_url = os.getenv("DATABASE_URL")
        if db_url and db_url.startswith("postgresql+asyncpg://"):
            db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        _pool = await asyncpg.create_pool(
            db_url,
            min_size=5,
            max_size=20,
            command_timeout=60,
        )
    return _pool

async def save_scan(scan_id, image_key, heatmap_key,
                    scores, top_disease, is_normal, explanation,
                    patient_id=None, processing_time_ms=0,
                    source="web", region="default", ai_model_used="gemini"):
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO scans
           (id, image_key, heatmap_key, scores, top_disease, is_normal, explanation,
            patient_id, processing_time_ms, source, region, ai_model_used, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)""",
        uuid.UUID(scan_id), image_key, heatmap_key,
        json.dumps(scores), top_disease, is_normal, explanation,
        patient_id, processing_time_ms, source, region, ai_model_used, "completed",
    )

async def get_scan(scan_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM scans WHERE id=$1", uuid.UUID(scan_id))
    return dict(row) if row else None

async def list_scans(limit=20, offset=0) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM scans ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit, offset,
    )
    return [dict(r) for r in rows]

async def get_total_scan_count() -> int:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT COUNT(*) as count FROM scans")
    return row["count"] if row else 0

async def save_scan_event(scan_id: str, event_type: str, event_data: dict = None):
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO scan_events (scan_id, event_type, event_data)
           VALUES ($1, $2, $3)""",
        uuid.UUID(scan_id), event_type, json.dumps(event_data or {}),
    )
