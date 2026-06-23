"""
Seed Data Generator — Generate realistic X-ray scan records for dashboard demo.

Generates 10,000+ scan records with:
- Realistic disease distributions based on medical statistics
- Timestamps spread over last 30 days
- Realistic processing times (500ms - 8000ms)
- Multiple source types (web, api, mobile, batch)

Usage: python scripts/seed_data.py
"""
import asyncio
import asyncpg
import json
import uuid
import random
import os
from datetime import datetime, timedelta, timezone

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://xray:secret@localhost:5432/xraydb")
NUM_RECORDS = 12000

# Disease distributions (roughly based on real medical statistics)
DISEASES = {
    "Atelectasis":        0.12,
    "Cardiomegaly":       0.08,
    "Consolidation":      0.05,
    "Edema":              0.06,
    "Effusion":           0.14,
    "Emphysema":          0.03,
    "Fibrosis":           0.04,
    "Hernia":             0.01,
    "Infiltration":       0.10,
    "Mass":               0.05,
    "Nodule":             0.06,
    "Pleural_Thickening": 0.04,
    "Pneumonia":          0.08,
    "Pneumothorax":       0.04,
}

# 10% of scans are normal
NORMAL_RATE = 0.10

SOURCES = ["web", "api", "mobile", "batch"]
SOURCE_WEIGHTS = [0.45, 0.30, 0.15, 0.10]

REGIONS = ["default", "hanoi", "hcmc", "danang", "haiphong"]
REGION_WEIGHTS = [0.30, 0.25, 0.20, 0.15, 0.10]

AI_MODELS = ["gemini", "llava"]
AI_MODEL_WEIGHTS = [0.80, 0.20]


def generate_scan_record(base_time: datetime):
    """Generate a single realistic scan record."""
    scan_id = uuid.uuid4()
    is_normal = random.random() < NORMAL_RATE

    if is_normal:
        top_disease = None
        scores = {}
    else:
        # Pick a primary disease based on distribution
        diseases = list(DISEASES.keys())
        weights = list(DISEASES.values())
        top_disease = random.choices(diseases, weights=weights, k=1)[0]

        # Generate scores — top disease gets high score, others get lower
        scores = {}
        top_score = random.uniform(0.45, 0.95)
        scores[top_disease] = round(top_score, 3)

        # Add 1-4 additional diseases with lower scores
        num_additional = random.randint(0, 3)
        additional = random.sample(
            [d for d in diseases if d != top_disease],
            min(num_additional, len(diseases) - 1)
        )
        for d in additional:
            score = random.uniform(0.15, top_score * 0.8)
            if score > 0.40:  # Only include if above threshold
                scores[d] = round(score, 3)

    # Random timestamp within the time range (with realistic daily patterns)
    hours_offset = random.uniform(0, 30 * 24)  # Up to 30 days ago
    # Make scans more likely during working hours (8-18)
    hour_of_day = random.gauss(13, 4)
    hour_of_day = max(0, min(23, int(hour_of_day)))
    scan_time = base_time - timedelta(hours=hours_offset)
    scan_time = scan_time.replace(hour=hour_of_day, minute=random.randint(0, 59),
                                   second=random.randint(0, 59))

    # Processing time — roughly 1-6 seconds, occasionally longer
    if random.random() < 0.05:
        processing_ms = random.randint(5000, 12000)  # slow outliers
    else:
        processing_ms = random.randint(800, 5000)

    source = random.choices(SOURCES, weights=SOURCE_WEIGHTS, k=1)[0]
    region = random.choices(REGIONS, weights=REGION_WEIGHTS, k=1)[0]
    ai_model = random.choices(AI_MODELS, weights=AI_MODEL_WEIGHTS, k=1)[0]

    # Some scans have patient IDs
    patient_id = f"P{random.randint(1000, 9999)}" if random.random() < 0.7 else None

    return {
        "id": scan_id,
        "created_at": scan_time,
        "image_key": f"originals/{scan_id}.jpg",
        "heatmap_key": f"heatmaps/{scan_id}.png",
        "top_disease": top_disease,
        "scores": json.dumps(scores),
        "is_normal": is_normal,
        "explanation": _generate_explanation(top_disease, scores, is_normal),
        "patient_id": patient_id,
        "processing_time_ms": processing_ms,
        "status": "completed",
        "source": source,
        "region": region,
        "ai_model_used": ai_model,
    }


def _generate_explanation(top_disease, scores, is_normal):
    if is_normal:
        return "Không phát hiện dấu hiệu bất thường rõ ràng trên ảnh X-quang. Các cấu trúc phổi, tim, xương sườn trong giới hạn bình thường."

    explanations = {
        "Atelectasis": "Phát hiện dấu hiệu xẹp phổi (Atelectasis). Vùng mờ trên phim cho thấy khả năng xẹp một phần phổi.",
        "Cardiomegaly": "Tim phì đại (Cardiomegaly) — bóng tim trên phim lớn hơn bình thường, có thể liên quan đến suy tim.",
        "Consolidation": "Phát hiện đông đặc phổi (Consolidation), có thể do viêm phổi hoặc tổn thương phế nang.",
        "Edema": "Phù phổi (Pulmonary Edema) — dấu hiệu tích tụ dịch trong phổi, cần theo dõi sát.",
        "Effusion": "Tràn dịch màng phổi (Pleural Effusion) — dịch tích tụ trong khoang màng phổi.",
        "Emphysema": "Khí phế thũng (Emphysema) — phổi giãn nở quá mức, thường liên quan đến bệnh phổi tắc nghẽn mạn tính.",
        "Fibrosis": "Xơ hóa phổi (Fibrosis) — tổ chức xơ trong nhu mô phổi.",
        "Hernia": "Thoát vị hoành (Hernia) — phát hiện bất thường vùng cơ hoành.",
        "Infiltration": "Thâm nhiễm phổi (Infiltration) — vùng mờ lan tỏa trên phim, có thể do nhiễm trùng.",
        "Mass": "Phát hiện khối u/mass trong phổi — cần chẩn đoán sâu hơn.",
        "Nodule": "Nốt phổi (Nodule) — phát hiện nốt nhỏ trong nhu mô phổi.",
        "Pleural_Thickening": "Dày màng phổi (Pleural Thickening) — màng phổi dày hơn bình thường.",
        "Pneumonia": "Viêm phổi (Pneumonia) — vùng đông đặc và thâm nhiễm trong phổi.",
        "Pneumothorax": "Tràn khí màng phổi (Pneumothorax) — khí tích tụ trong khoang màng phổi.",
    }
    return explanations.get(top_disease, f"Phát hiện bất thường: {top_disease}. Khuyến nghị tham khảo ý kiến bác sĩ chuyên khoa.")


async def seed():
    db_url = DATABASE_URL
    if db_url.startswith("postgresql+asyncpg://"):
        db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    print(f"Connecting to database: {db_url}")
    pool = await asyncpg.create_pool(db_url, min_size=5, max_size=20)

    base_time = datetime.now(timezone.utc)

    print(f"Generating {NUM_RECORDS} scan records...")

    # Generate records
    records = [generate_scan_record(base_time) for _ in range(NUM_RECORDS)]

    # Batch insert
    batch_size = 500
    inserted = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        async with pool.acquire() as conn:
            await conn.executemany(
                """INSERT INTO scans
                   (id, created_at, image_key, heatmap_key, top_disease, scores, is_normal,
                    explanation, patient_id, processing_time_ms, status, source, region, ai_model_used)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                   ON CONFLICT (id) DO NOTHING""",
                [
                    (
                        r["id"], r["created_at"], r["image_key"], r["heatmap_key"],
                        r["top_disease"], r["scores"], r["is_normal"], r["explanation"],
                        r["patient_id"], r["processing_time_ms"], r["status"],
                        r["source"], r["region"], r["ai_model_used"],
                    )
                    for r in batch
                ],
            )
        inserted += len(batch)
        print(f"  Inserted {inserted}/{NUM_RECORDS} records...")

    # Also populate analytics tables
    print("\nPopulating hourly analytics...")
    await pool.execute("""
        INSERT INTO analytics_hourly (hour_bucket, total_scans, normal_scans, abnormal_scans, avg_processing_ms, disease_counts, source_counts)
        SELECT
            date_trunc('hour', created_at) as hour_bucket,
            COUNT(*) as total_scans,
            COUNT(*) FILTER (WHERE is_normal = true) as normal_scans,
            COUNT(*) FILTER (WHERE is_normal = false) as abnormal_scans,
            AVG(processing_time_ms) as avg_processing_ms,
            jsonb_object_agg(COALESCE(top_disease, 'Normal'), disease_count) as disease_counts,
            jsonb_object_agg(COALESCE(source, 'web'), source_count) as source_counts
        FROM (
            SELECT created_at, is_normal, top_disease, processing_time_ms, source,
                   COUNT(*) OVER (PARTITION BY date_trunc('hour', created_at), top_disease) as disease_count,
                   COUNT(*) OVER (PARTITION BY date_trunc('hour', created_at), source) as source_count
            FROM scans
        ) sub
        GROUP BY date_trunc('hour', created_at)
        ON CONFLICT (hour_bucket) DO UPDATE SET
            total_scans = EXCLUDED.total_scans,
            normal_scans = EXCLUDED.normal_scans,
            abnormal_scans = EXCLUDED.abnormal_scans,
            avg_processing_ms = EXCLUDED.avg_processing_ms,
            disease_counts = EXCLUDED.disease_counts,
            source_counts = EXCLUDED.source_counts,
            updated_at = NOW()
    """)

    print("Populating daily analytics...")
    await pool.execute("""
        INSERT INTO analytics_daily (day_bucket, total_scans, normal_scans, abnormal_scans, avg_processing_ms, disease_counts, source_counts, top_disease)
        SELECT
            day_bucket,
            COUNT(*) as total_scans,
            COUNT(*) FILTER (WHERE is_normal = true) as normal_scans,
            COUNT(*) FILTER (WHERE is_normal = false) as abnormal_scans,
            AVG(processing_time_ms) as avg_processing_ms,
            jsonb_object_agg(COALESCE(top_disease, 'Normal'), disease_count) as disease_counts,
            jsonb_object_agg(COALESCE(source, 'web'), source_count) as source_counts,
            (SELECT top_disease FROM scans s2 WHERE s2.created_at::date = day_bucket AND top_disease IS NOT NULL GROUP BY top_disease ORDER BY COUNT(*) DESC LIMIT 1) as top_disease
        FROM (
            SELECT created_at::date as day_bucket, is_normal, top_disease, processing_time_ms, source,
                   COUNT(*) OVER (PARTITION BY created_at::date, top_disease) as disease_count,
                   COUNT(*) OVER (PARTITION BY created_at::date, source) as source_count
            FROM scans
        ) sub
        GROUP BY day_bucket
        ON CONFLICT (day_bucket) DO UPDATE SET
            total_scans = EXCLUDED.total_scans,
            normal_scans = EXCLUDED.normal_scans,
            abnormal_scans = EXCLUDED.abnormal_scans,
            avg_processing_ms = EXCLUDED.avg_processing_ms,
            disease_counts = EXCLUDED.disease_counts,
            source_counts = EXCLUDED.source_counts,
            top_disease = EXCLUDED.top_disease,
            updated_at = NOW()
    """)

    # Add some Spark-like reports
    print("Generating sample Spark reports...")
    report_data = {
        "total_scans_analyzed": NUM_RECORDS,
        "top_diseases": [
            {"disease": "Effusion", "count": int(NUM_RECORDS * 0.14), "percentage": 14.0},
            {"disease": "Atelectasis", "count": int(NUM_RECORDS * 0.12), "percentage": 12.0},
            {"disease": "Infiltration", "count": int(NUM_RECORDS * 0.10), "percentage": 10.0},
            {"disease": "Cardiomegaly", "count": int(NUM_RECORDS * 0.08), "percentage": 8.0},
            {"disease": "Pneumonia", "count": int(NUM_RECORDS * 0.08), "percentage": 8.0},
        ],
        "processing_time_p50": 2100,
        "processing_time_p95": 4800,
        "processing_time_p99": 7500,
        "peak_hours": [10, 11, 14, 15],
        "busiest_day": "Monday",
    }

    await pool.execute(
        """INSERT INTO spark_reports (report_type, report_date, report_data, minio_path)
           VALUES ($1, $2, $3, $4)""",
        "weekly_summary",
        datetime.now(timezone.utc).date(),
        json.dumps(report_data),
        "spark-output/weekly_summary/latest",
    )

    await pool.close()
    print(f"\n✅ Seeded {NUM_RECORDS} scan records successfully!")
    print("   - Hourly analytics populated")
    print("   - Daily analytics populated")
    print("   - Sample Spark report created")


if __name__ == "__main__":
    asyncio.run(seed())
