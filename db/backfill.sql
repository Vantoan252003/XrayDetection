DO $$
DECLARE
    r RECORD;
BEGIN
    -- Clear existing analytics (since we'll re-run everything)
    TRUNCATE analytics_hourly;
    TRUNCATE analytics_daily;

    FOR r IN SELECT * FROM scans LOOP
        PERFORM upsert_hourly_analytics(r.created_at, r.is_normal, r.top_disease, r.processing_time_ms, r.source);
        PERFORM upsert_daily_analytics(r.created_at::DATE, r.is_normal, r.top_disease, r.processing_time_ms, r.source);
    END LOOP;
END;
$$;
