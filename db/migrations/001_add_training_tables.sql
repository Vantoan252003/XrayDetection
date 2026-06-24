-- Migration 001: Add Training and Review Tables

-- Thêm các cột mới vào bảng scans
ALTER TABLE scans ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'none';
ALTER TABLE scans ADD COLUMN IF NOT EXISTS review_deadline TIMESTAMPTZ;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_model_version TEXT DEFAULT 'densenet121-res224-all';

-- Tạo bảng labeled_scans để lưu trữ các bản ghi sau khi bác sĩ review
CREATE TABLE IF NOT EXISTS labeled_scans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id           UUID REFERENCES scans(id) ON DELETE SET NULL,
    image_key         TEXT NOT NULL,
    verified_labels   JSONB NOT NULL,
    review_status     TEXT NOT NULL, -- 'approved' | 'rejected' | 'auto_approved'
    reviewed_by       TEXT NOT NULL, -- 'doctor' | 'system_timeout'
    reviewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_to_training BOOLEAN NOT NULL DEFAULT FALSE
);

-- Tạo các index phục vụ tìm kiếm nhanh
CREATE INDEX IF NOT EXISTS idx_labeled_scans_status ON labeled_scans (review_status);
CREATE INDEX IF NOT EXISTS idx_scans_review_deadline ON scans (review_deadline) WHERE review_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_labeled_scans_added_to_training ON labeled_scans (added_to_training) WHERE review_status IN ('approved', 'auto_approved');
