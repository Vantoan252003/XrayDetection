"use client";

import { useState, useEffect, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type OverviewData = {
  overview: {
    total_scans: number;
    normal_scans: number;
    abnormal_scans: number;
    avg_processing_ms: number;
    scans_24h: number;
    scans_1h: number;
    unique_patients: number;
  };
  diseases: Array<{ disease: string; count: number; percentage: number }>;
  processing_stats: {
    avg_ms: number;
    min_ms: number;
    max_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
  sources: Array<{ source: string; count: number }>;
};

type TimelineData = {
  timeline: Array<{
    time: string;
    total: number;
    normal: number;
    abnormal: number;
  }>;
  period: string;
  granularity: string;
};

type RecentEvent = {
  scan_id: string;
  created_at: string;
  top_disease: string | null;
  is_normal: boolean;
  processing_time_ms: number;
  source: string;
  patient_id: string | null;
  status: string;
};

type DailyData = {
  daily: Array<{
    id: number;
    day_bucket: string;
    total_scans: number;
    normal_scans: number;
    abnormal_scans: number;
    avg_processing_ms: number;
    disease_counts: Record<string, number>;
    source_counts: Record<string, number>;
    top_disease: string | null;
  }>;
};

type HealthData = {
  status: string;
  services: Record<string, { status: string; error?: string }>;
  websocket_clients: number;
};

export function useAnalytics() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [dailyData, setDailyData] = useState<DailyData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/analytics/overview`);
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error("Failed to fetch overview:", err);
    }
  }, []);

  const fetchTimeline = useCallback(async (period = "24h", granularity = "hour") => {
    try {
      const res = await fetch(`${API_URL}/analytics/timeline?period=${period}&granularity=${granularity}`);
      if (res.ok) {
        const data = await res.json();
        setTimeline(data);
      }
    } catch (err) {
      console.error("Failed to fetch timeline:", err);
    }
  }, []);

  const fetchRecentEvents = useCallback(async (limit = 20) => {
    try {
      const res = await fetch(`${API_URL}/analytics/recent?limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        setRecentEvents(data.events);
      }
    } catch (err) {
      console.error("Failed to fetch recent events:", err);
    }
  }, []);

  const fetchDaily = useCallback(async (days = 30) => {
    try {
      const res = await fetch(`${API_URL}/analytics/daily?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setDailyData(data);
      }
    } catch (err) {
      console.error("Failed to fetch daily data:", err);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (err) {
      console.error("Failed to fetch health:", err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        fetchOverview(),
        fetchTimeline("24h", "hour"),
        fetchRecentEvents(),
        fetchDaily(),
        fetchHealth(),
      ]);
    } catch {
      setError("Không thể kết nối đến server");
    } finally {
      setLoading(false);
    }
  }, [fetchOverview, fetchTimeline, fetchRecentEvents, fetchDaily, fetchHealth]);

  // Initial fetch
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refreshAll, 30000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  return {
    overview,
    timeline,
    recentEvents,
    dailyData,
    health,
    loading,
    error,
    refreshAll,
    fetchTimeline,
    fetchDaily,
  };
}
