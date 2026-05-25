CREATE TABLE scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- File locations trên MinIO
    image_key       TEXT NOT NULL,    -- originals/{id}.jpg
    heatmap_key     TEXT NOT NULL,    -- heatmaps/{id}.png

    -- Kết quả model
    top_disease     TEXT,
    scores          JSONB NOT NULL,   -- {"Pneumonia": 0.82, "Effusion": 0.45}
    is_normal       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Giải thích từ Gemma
    explanation     TEXT,

    -- Metadata tuỳ chọn
    patient_id      TEXT,
    notes           TEXT
);

-- Index để query nhanh theo thời gian và bệnh
CREATE INDEX idx_scans_created_at  ON scans (created_at DESC);
CREATE INDEX idx_scans_top_disease ON scans (top_disease);
CREATE INDEX idx_scans_scores      ON scans USING GIN (scores);
