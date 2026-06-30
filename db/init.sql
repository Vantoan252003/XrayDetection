-- ╔══════════════════════════════════════════════════════════════╗
-- ║  XRay Data Engineering Platform — Database Schema           ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── Core: Scan Records ─────────────────────────────────────────
CREATE TABLE scans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- File locations trên MinIO
    image_key         TEXT NOT NULL,
    heatmap_key       TEXT NOT NULL,

    -- Kết quả model
    top_disease       TEXT,
    scores            JSONB NOT NULL,
    is_normal         BOOLEAN NOT NULL DEFAULT FALSE,

    -- Giải thích từ AI
    explanation       TEXT,

    -- ICD-10 Classification
    icd_code          TEXT,
    icd_group         TEXT,

    -- Metadata
    patient_id        TEXT,
    notes             TEXT,

    -- Data Engineering fields
    processing_time_ms  INTEGER DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'completed',  -- submitted, processing, completed, failed
    source              TEXT DEFAULT 'web',                 -- web, api, mobile, batch
    region              TEXT DEFAULT 'default',             -- geographic region
    ai_model_used       TEXT DEFAULT 'gemini'               -- gemini, llava, ollama
);

-- Indexes cho query nhanh
CREATE INDEX idx_scans_created_at   ON scans (created_at DESC);
CREATE INDEX idx_scans_top_disease  ON scans (top_disease);
CREATE INDEX idx_scans_scores       ON scans USING GIN (scores);
CREATE INDEX idx_scans_status       ON scans (status);
CREATE INDEX idx_scans_source       ON scans (source);
CREATE INDEX idx_scans_region       ON scans (region);

-- ── Event Log: Kafka Consumer writes here ──────────────────────
CREATE TABLE scan_events (
    id              BIGSERIAL PRIMARY KEY,
    scan_id         UUID NOT NULL,
    event_type      TEXT NOT NULL,           -- scan.submitted, scan.processing, scan.completed, scan.failed
    event_data      JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kafka_offset    BIGINT,
    kafka_partition INTEGER
);

CREATE INDEX idx_scan_events_scan_id    ON scan_events (scan_id);
CREATE INDEX idx_scan_events_type       ON scan_events (event_type);
CREATE INDEX idx_scan_events_created_at ON scan_events (created_at DESC);

-- ── Analytics: Hourly Aggregation ──────────────────────────────
CREATE TABLE analytics_hourly (
    id              BIGSERIAL PRIMARY KEY,
    hour_bucket     TIMESTAMPTZ NOT NULL,    -- truncated to hour
    total_scans     INTEGER NOT NULL DEFAULT 0,
    normal_scans    INTEGER NOT NULL DEFAULT 0,
    abnormal_scans  INTEGER NOT NULL DEFAULT 0,
    avg_processing_ms FLOAT DEFAULT 0,
    disease_counts  JSONB DEFAULT '{}',      -- {"Pneumonia": 15, "Effusion": 8, ...}
    source_counts   JSONB DEFAULT '{}',      -- {"web": 10, "api": 5, ...}
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(hour_bucket)
);

CREATE INDEX idx_analytics_hourly_bucket ON analytics_hourly (hour_bucket DESC);

-- ── Analytics: Daily Aggregation ───────────────────────────────
CREATE TABLE analytics_daily (
    id              BIGSERIAL PRIMARY KEY,
    day_bucket      DATE NOT NULL,
    total_scans     INTEGER NOT NULL DEFAULT 0,
    normal_scans    INTEGER NOT NULL DEFAULT 0,
    abnormal_scans  INTEGER NOT NULL DEFAULT 0,
    avg_processing_ms FLOAT DEFAULT 0,
    disease_counts  JSONB DEFAULT '{}',
    source_counts   JSONB DEFAULT '{}',
    top_disease     TEXT,
    peak_hour       INTEGER,                 -- 0-23
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(day_bucket)
);

CREATE INDEX idx_analytics_daily_bucket ON analytics_daily (day_bucket DESC);

-- ── Spark Reports: Stored Results ──────────────────────────────
CREATE TABLE spark_reports (
    id              BIGSERIAL PRIMARY KEY,
    report_type     TEXT NOT NULL,            -- daily_summary, weekly_trend, disease_correlation, etc.
    report_date     DATE NOT NULL,
    report_data     JSONB NOT NULL,
    minio_path      TEXT,                     -- path to Parquet file on MinIO
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spark_reports_type ON spark_reports (report_type, report_date DESC);

-- ── Helper function: Upsert hourly analytics ───────────────────
CREATE OR REPLACE FUNCTION upsert_hourly_analytics(
    p_hour TIMESTAMPTZ,
    p_is_normal BOOLEAN,
    p_disease TEXT,
    p_processing_ms INTEGER,
    p_source TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO analytics_hourly (hour_bucket, total_scans, normal_scans, abnormal_scans, avg_processing_ms, disease_counts, source_counts)
    VALUES (
        date_trunc('hour', p_hour),
        1,
        CASE WHEN p_is_normal THEN 1 ELSE 0 END,
        CASE WHEN p_is_normal THEN 0 ELSE 1 END,
        p_processing_ms,
        CASE WHEN p_disease IS NOT NULL THEN jsonb_build_object(p_disease, 1) ELSE '{}'::jsonb END,
        jsonb_build_object(COALESCE(p_source, 'web'), 1)
    )
    ON CONFLICT (hour_bucket) DO UPDATE SET
        total_scans = analytics_hourly.total_scans + 1,
        normal_scans = analytics_hourly.normal_scans + CASE WHEN p_is_normal THEN 1 ELSE 0 END,
        abnormal_scans = analytics_hourly.abnormal_scans + CASE WHEN p_is_normal THEN 0 ELSE 1 END,
        avg_processing_ms = (analytics_hourly.avg_processing_ms * analytics_hourly.total_scans + p_processing_ms) / (analytics_hourly.total_scans + 1),
        disease_counts = CASE
            WHEN p_disease IS NOT NULL THEN
                analytics_hourly.disease_counts || jsonb_build_object(
                    p_disease,
                    COALESCE((analytics_hourly.disease_counts->>p_disease)::int, 0) + 1
                )
            ELSE analytics_hourly.disease_counts
        END,
        source_counts = analytics_hourly.source_counts || jsonb_build_object(
            COALESCE(p_source, 'web'),
            COALESCE((analytics_hourly.source_counts->>COALESCE(p_source, 'web'))::int, 0) + 1
        ),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ── Helper function: Upsert daily analytics ────────────────────
CREATE OR REPLACE FUNCTION upsert_daily_analytics(
    p_day DATE,
    p_is_normal BOOLEAN,
    p_disease TEXT,
    p_processing_ms INTEGER,
    p_source TEXT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO analytics_daily (day_bucket, total_scans, normal_scans, abnormal_scans, avg_processing_ms, disease_counts, source_counts, top_disease)
    VALUES (
        p_day,
        1,
        CASE WHEN p_is_normal THEN 1 ELSE 0 END,
        CASE WHEN p_is_normal THEN 0 ELSE 1 END,
        p_processing_ms,
        CASE WHEN p_disease IS NOT NULL THEN jsonb_build_object(p_disease, 1) ELSE '{}'::jsonb END,
        jsonb_build_object(COALESCE(p_source, 'web'), 1),
        p_disease
    )
    ON CONFLICT (day_bucket) DO UPDATE SET
        total_scans = analytics_daily.total_scans + 1,
        normal_scans = analytics_daily.normal_scans + CASE WHEN p_is_normal THEN 1 ELSE 0 END,
        abnormal_scans = analytics_daily.abnormal_scans + CASE WHEN p_is_normal THEN 0 ELSE 1 END,
        avg_processing_ms = (analytics_daily.avg_processing_ms * analytics_daily.total_scans + p_processing_ms) / (analytics_daily.total_scans + 1),
        disease_counts = CASE
            WHEN p_disease IS NOT NULL THEN
                analytics_daily.disease_counts || jsonb_build_object(
                    p_disease,
                    COALESCE((analytics_daily.disease_counts->>p_disease)::int, 0) + 1
                )
            ELSE analytics_daily.disease_counts
        END,
        source_counts = analytics_daily.source_counts || jsonb_build_object(
            COALESCE(p_source, 'web'),
            COALESCE((analytics_daily.source_counts->>COALESCE(p_source, 'web'))::int, 0) + 1
        ),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
