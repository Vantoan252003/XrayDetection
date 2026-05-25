"""
Analytics — Query functions for dashboard and analytics endpoints.
Reads from PostgreSQL analytics tables and Spark output.
"""
import json
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


async def get_overview(pool) -> dict:
    """Get overall analytics overview."""
    row = await pool.fetchrow("""
        SELECT
            COUNT(*) as total_scans,
            COUNT(*) FILTER (WHERE is_normal = true) as normal_scans,
            COUNT(*) FILTER (WHERE is_normal = false) as abnormal_scans,
            COALESCE(AVG(processing_time_ms), 0) as avg_processing_ms,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as scans_24h,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as scans_1h,
            COUNT(DISTINCT patient_id) as unique_patients
        FROM scans
    """)
    return dict(row) if row else {}


async def get_disease_distribution(pool) -> list[dict]:
    """Get disease frequency distribution."""
    rows = await pool.fetch("""
        SELECT
            top_disease as disease,
            COUNT(*) as count,
            ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0), 1) as percentage
        FROM scans
        WHERE top_disease IS NOT NULL
        GROUP BY top_disease
        ORDER BY count DESC
        LIMIT 20
    """)
    return [dict(r) for r in rows]


async def get_timeline(pool, period: str = "24h", granularity: str = "hour") -> list[dict]:
    """
    Get scan volume over time.
    period: 24h, 7d, 30d
    granularity: hour, day
    """
    interval_map = {"24h": "24 hours", "7d": "7 days", "30d": "30 days"}
    interval = interval_map.get(period, "24 hours")

    if granularity == "day":
        rows = await pool.fetch(f"""
            SELECT
                date_trunc('day', created_at) as time_bucket,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_normal = true) as normal,
                COUNT(*) FILTER (WHERE is_normal = false) as abnormal
            FROM scans
            WHERE created_at > NOW() - INTERVAL '{interval}'
            GROUP BY time_bucket
            ORDER BY time_bucket ASC
        """)
    else:
        rows = await pool.fetch(f"""
            SELECT
                date_trunc('hour', created_at) as time_bucket,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_normal = true) as normal,
                COUNT(*) FILTER (WHERE is_normal = false) as abnormal
            FROM scans
            WHERE created_at > NOW() - INTERVAL '{interval}'
            GROUP BY time_bucket
            ORDER BY time_bucket ASC
        """)

    return [
        {
            "time": r["time_bucket"].isoformat() if r["time_bucket"] else None,
            "total": r["total"],
            "normal": r["normal"],
            "abnormal": r["abnormal"],
        }
        for r in rows
    ]


async def get_processing_time_stats(pool) -> dict:
    """Get processing time statistics."""
    row = await pool.fetchrow("""
        SELECT
            COALESCE(AVG(processing_time_ms), 0) as avg_ms,
            COALESCE(MIN(processing_time_ms), 0) as min_ms,
            COALESCE(MAX(processing_time_ms), 0) as max_ms,
            COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY processing_time_ms), 0) as p50_ms,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time_ms), 0) as p95_ms,
            COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY processing_time_ms), 0) as p99_ms
        FROM scans
        WHERE processing_time_ms > 0
    """)
    return dict(row) if row else {}


async def get_hourly_analytics(pool, hours: int = 24) -> list[dict]:
    """Get pre-aggregated hourly analytics."""
    rows = await pool.fetch("""
        SELECT *
        FROM analytics_hourly
        WHERE hour_bucket > NOW() - make_interval(hours => $1)
        ORDER BY hour_bucket ASC
    """, hours)
    result = []
    for r in rows:
        d = dict(r)
        d["hour_bucket"] = d["hour_bucket"].isoformat()
        d["updated_at"] = d["updated_at"].isoformat()
        # Parse JSONB fields
        if isinstance(d.get("disease_counts"), str):
            d["disease_counts"] = json.loads(d["disease_counts"])
        if isinstance(d.get("source_counts"), str):
            d["source_counts"] = json.loads(d["source_counts"])
        result.append(d)
    return result


async def get_daily_analytics(pool, days: int = 30) -> list[dict]:
    """Get pre-aggregated daily analytics."""
    rows = await pool.fetch("""
        SELECT *
        FROM analytics_daily
        WHERE day_bucket > CURRENT_DATE - $1
        ORDER BY day_bucket ASC
    """, days)
    result = []
    for r in rows:
        d = dict(r)
        d["day_bucket"] = d["day_bucket"].isoformat()
        d["updated_at"] = d["updated_at"].isoformat()
        if isinstance(d.get("disease_counts"), str):
            d["disease_counts"] = json.loads(d["disease_counts"])
        if isinstance(d.get("source_counts"), str):
            d["source_counts"] = json.loads(d["source_counts"])
        result.append(d)
    return result


async def get_recent_events(pool, limit: int = 20) -> list[dict]:
    """Get recent scan events for the live feed."""
    rows = await pool.fetch("""
        SELECT
            s.id as scan_id,
            s.created_at,
            s.top_disease,
            s.is_normal,
            s.processing_time_ms,
            s.source,
            s.patient_id,
            s.status
        FROM scans s
        ORDER BY s.created_at DESC
        LIMIT $1
    """, limit)
    return [
        {
            "scan_id": str(r["scan_id"]),
            "created_at": r["created_at"].isoformat(),
            "top_disease": r["top_disease"],
            "is_normal": r["is_normal"],
            "processing_time_ms": r["processing_time_ms"],
            "source": r["source"],
            "patient_id": r["patient_id"],
            "status": r["status"],
        }
        for r in rows
    ]


async def get_source_distribution(pool) -> list[dict]:
    """Get scan source distribution."""
    rows = await pool.fetch("""
        SELECT
            COALESCE(source, 'web') as source,
            COUNT(*) as count
        FROM scans
        GROUP BY source
        ORDER BY count DESC
    """)
    return [dict(r) for r in rows]


async def get_spark_reports(pool, report_type: str = None, limit: int = 10) -> list[dict]:
    """Get stored Spark report results."""
    if report_type:
        rows = await pool.fetch("""
            SELECT * FROM spark_reports
            WHERE report_type = $1
            ORDER BY report_date DESC
            LIMIT $2
        """, report_type, limit)
    else:
        rows = await pool.fetch("""
            SELECT * FROM spark_reports
            ORDER BY created_at DESC
            LIMIT $1
        """, limit)

    result = []
    for r in rows:
        d = dict(r)
        d["report_date"] = d["report_date"].isoformat()
        d["created_at"] = d["created_at"].isoformat()
        if isinstance(d.get("report_data"), str):
            d["report_data"] = json.loads(d["report_data"])
        result.append(d)
    return result
