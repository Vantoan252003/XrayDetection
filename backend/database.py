import asyncpg
import os, json, uuid
from datetime import datetime

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
                    source="web", region="default", ai_model_used="gemini",
                    review_status="none", review_deadline=None, ai_model_version="densenet121-res224-all",
                    status="completed", icd_code=None, icd_group=None):
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO scans
           (id, image_key, heatmap_key, scores, top_disease, is_normal, explanation,
            patient_id, processing_time_ms, source, region, ai_model_used, status,
            review_status, review_deadline, ai_model_version, icd_code, icd_group)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)""",
        uuid.UUID(scan_id), image_key, heatmap_key,
        json.dumps(scores), top_disease, is_normal, explanation,
        patient_id, processing_time_ms, source, region, ai_model_used, status,
        review_status, review_deadline, ai_model_version, icd_code, icd_group
    )

def _parse_row_scores(row) -> dict | None:
    if not row:
        return None
    d = dict(row)
    if "scores" in d and isinstance(d["scores"], str):
        try:
            d["scores"] = json.loads(d["scores"])
        except Exception:
            pass
    if "reviewed_labels" in d and isinstance(d["reviewed_labels"], str):
        try:
            d["reviewed_labels"] = json.loads(d["reviewed_labels"])
        except Exception:
            pass
    return d

async def get_scan(scan_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM scans WHERE id=$1", uuid.UUID(scan_id))
    return _parse_row_scores(row)

async def list_scans(limit=20, offset=0) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM scans ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit, offset,
    )
    return [_parse_row_scores(r) for r in rows]

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

# ── New review and labeling operations ────────────────────────

async def list_pending_scans(limit=20, offset=0) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM scans WHERE review_status = 'pending' ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        limit, offset,
    )
    return [_parse_row_scores(r) for r in rows]

async def get_total_pending_scan_count() -> int:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT COUNT(*) as count FROM scans WHERE review_status = 'pending'")
    return row["count"] if row else 0

async def list_reviewed_scans(limit=20, offset=0) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT s.*, ls.verified_labels as reviewed_labels, ls.review_status as ls_review_status
           FROM scans s
           JOIN labeled_scans ls ON s.id = ls.scan_id
           WHERE s.review_status = 'done' AND ls.review_status = 'approved'
           ORDER BY ls.reviewed_at DESC LIMIT $1 OFFSET $2""",
        limit, offset,
    )
    return [_parse_row_scores(r) for r in rows]

async def get_total_reviewed_scan_count() -> int:
    pool = await get_pool()
    row = await pool.fetchrow("""SELECT COUNT(*) as count 
                                 FROM scans s 
                                 JOIN labeled_scans ls ON s.id = ls.scan_id 
                                 WHERE s.review_status = 'done' AND ls.review_status = 'approved'""")
    return row["count"] if row else 0

async def save_labeled_scan(scan_id: str, image_key: str, verified_labels: dict, 
                            review_status: str, reviewed_by: str, 
                            reviewed_at: datetime = None, added_to_training: bool = False):
    pool = await get_pool()
    if reviewed_at is None:
        reviewed_at = datetime.utcnow()
    
    labeled_scan_id = str(uuid.uuid4())
    await pool.execute(
        """INSERT INTO labeled_scans
           (id, scan_id, image_key, verified_labels, review_status, reviewed_by, reviewed_at, added_to_training)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
        uuid.UUID(labeled_scan_id), uuid.UUID(scan_id), image_key, json.dumps(verified_labels),
        review_status, reviewed_by, reviewed_at, added_to_training,
    )
    return labeled_scan_id

async def update_scan_review_status(scan_id: str, review_status: str):
    pool = await get_pool()
    await pool.execute(
        "UPDATE scans SET review_status = $1 WHERE id = $2",
        review_status, uuid.UUID(scan_id),
    )

