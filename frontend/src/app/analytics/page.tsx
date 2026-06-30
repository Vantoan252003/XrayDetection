"use client";

import { translateDisease } from "@/utils/disease";
import { useState, useEffect, useCallback } from "react";
import DiseaseBarChart from "@/components/DiseaseBarChart";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import DiseaseChart from "@/components/DiseaseChart";
import {
  BarChart3, TrendingUp, Calendar, Filter,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type DailyRecord = {
  day_bucket: string;
  total_scans: number;
  normal_scans: number;
  abnormal_scans: number;
  avg_processing_ms: number;
  disease_counts: Record<string, number>;
  top_disease: string | null;
};

export default function AnalyticsPage() {
  const [period, setPeriod]           = useState<"7d" | "30d">("30d");
  const [granularity, setGranularity] = useState<"hour" | "day">("day");
  const [tab, setTab]                 = useState<"trend" | "disease" | "icd" | "daily">("trend");
  const [daily, setDaily]             = useState<DailyRecord[]>([]);
  const [timeline, setTimeline]       = useState<{ time: string; total: number; normal: number; abnormal: number }[]>([]);
  const [diseases, setDiseases]       = useState<{ disease: string; count: number; percentage: number }[]>([]);
  const [icdData, setIcdData]         = useState<{ icd_group: string; count: number; percentage: number }[]>([]);
  const [loading, setLoading]         = useState(true);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    const days = period === "7d" ? 7 : 30;
    try {
      const [dRes, tRes, disRes, icdRes] = await Promise.all([
        fetch(`${API}/analytics/daily?days=${days}`),
        fetch(`${API}/analytics/timeline?period=${period}&granularity=${granularity}`),
        fetch(`${API}/analytics/diseases`),
        fetch(`${API}/analytics/icd`),
      ]);
      if (dRes.ok)   { const d = await dRes.json();   setDaily(d.daily || []); }
      if (tRes.ok)   { const t = await tRes.json();   setTimeline(t.timeline || []); }
      if (disRes.ok) { const d = await disRes.json(); setDiseases(d.diseases || []); }
      if (icdRes.ok) { const d = await icdRes.json(); setIcdData(d.icd_distribution || []); }
    } catch {}
    setLoading(false);
  }, [period, granularity]);

  useEffect(() => { fetch_(); }, [fetch_]);

  // Summary stats
  const totalScans   = daily.reduce((s, d) => s + d.total_scans, 0);
  const totalAbnormal = daily.reduce((s, d) => s + d.abnormal_scans, 0);
  const avgPerDay    = daily.length > 0 ? Math.round(totalScans / daily.length) : 0;
  const avgProc      = daily.length > 0 ? Math.round(daily.reduce((s, d) => s + d.avg_processing_ms, 0) / daily.length) : 0;
  const topDisease   = translateDisease(diseases[0]?.disease) || "—";

  // Build heatmap calendar data
  const heatmapData: Record<string, number> = {};
  daily.forEach(d => { heatmapData[d.day_bucket] = d.total_scans; });
  const maxHeat = Math.max(...Object.values(heatmapData), 1);

  // Build 7 weeks
  const today = new Date();
  const calCells: { date: string; count: number }[] = [];
  for (let i = 6 * 7 - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = d.toISOString().split("T")[0];
    calCells.push({ date: ds, count: heatmapData[ds] || 0 });
  }

  const getHeatColor = (count: number) => {
    if (!count) return "#f1f5f9";
    const pct = count / maxHeat;
    if (pct < 0.25) return "#c7d2fe";
    if (pct < 0.5)  return "#a5b4fc";
    if (pct < 0.75) return "#818cf8";
    return "#4f46e5";
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="topbar">
        <div>
          <h1 className="page-title">
            <BarChart3 className="w-5 h-5" style={{ color: "var(--sky-500)" }} />
            Phân tích chuyên sâu
          </h1>
          <p className="page-subtitle">Xu hướng, thống kê bệnh lý và hiệu suất hệ thống</p>
        </div>
        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
          <div className="tab-pill">
            {(["7d", "30d"] as const).map(p => (
              <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
                {p === "7d" ? "7 ngày" : "30 ngày"}
              </button>
            ))}
          </div>
          <div className="tab-pill">
            {(["hour", "day"] as const).map(g => (
              <button key={g} className={granularity === g ? "active" : ""} onClick={() => setGranularity(g)}>
                {g === "hour" ? "Theo giờ" : "Theo ngày"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI summary */}
      <div className="dashboard-grid animate-fade-in-up">
        {[
          { label: "Tổng scans", val: totalScans.toLocaleString("vi-VN"), icon: "📊", sub: `${period === "7d" ? "7" : "30"} ngày` },
          { label: "Avg/ngày",   val: avgPerDay.toLocaleString("vi-VN"),  icon: "📅", sub: "Trung bình" },
          { label: "Bất thường", val: totalAbnormal.toLocaleString("vi-VN"), icon: "⚠️", sub: `${daily.length > 0 ? Math.round(totalAbnormal / totalScans * 100) : 0}% tổng` },
          { label: "Top bệnh",   val: topDisease, icon: "🏆", sub: `${diseases[0]?.percentage || 0}% tần suất` },
        ].map((s, i) => (
          <div key={i} className="chart-card animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>{s.label}</p>
                <p className="text-2xl font-extrabold tracking-tight truncate" style={{ color: "var(--text-primary)" }}>{s.val}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{s.sub}</p>
              </div>
              <span className="text-2xl">{s.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-64 w-full" />
          <div className="skeleton h-80 w-full" />
        </div>
      ) : (
        <>
          {/* Activity Heatmap */}
          <div className="chart-card animate-fade-in-up stagger-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  <Calendar className="inline w-4 h-4 mr-1.5" style={{ color: "var(--indigo-500)" }} />
                  Calendar heatmap — Lưu lượng scan
                </h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Màu đậm = nhiều scan hơn</p>
              </div>
              {/* Legend */}
              <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                <span>Ít</span>
                {["#f1f5f9","#c7d2fe","#a5b4fc","#818cf8","#4f46e5"].map((c, i) => (
                  <div key={i} className="w-3.5 h-3.5 rounded-sm" style={{ background: c, border: "1px solid #e2e8f0" }} />
                ))}
                <span>Nhiều</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-max">
                {/* Group by week */}
                {Array.from({ length: 6 }, (_, w) => (
                  <div key={w} className="flex flex-col gap-1">
                    {calCells.slice(w * 7, w * 7 + 7).map((cell, d) => (
                      <div
                        key={d}
                        title={`${cell.date}: ${cell.count} scans`}
                        className="w-4 h-4 rounded-sm cursor-pointer transition-transform hover:scale-125"
                        style={{
                          background: getHeatColor(cell.count),
                          border: "1px solid rgba(99,102,241,0.1)",
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1">
                {["T2","T3","T4","T5","T6","T7","CN"].map((d, i) => (
                  <div key={i} className="text-[9px] w-4 text-center" style={{ color: "var(--text-muted)" }}>{d}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Content tabs */}
          <div className="animate-fade-in-up stagger-3">
            {/* Tab Pills */}
            <div className="flex items-center gap-2 mb-4">
              <div className="tab-pill">
                {(["trend", "disease", "icd", "daily"] as const).map(t => (
                  <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                    {t === "trend" ? "📈 Xu hướng" : t === "disease" ? "🦠 Bệnh lý" : t === "icd" ? "📋 Nhóm ICD-10" : "📋 Nhật ký"}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            {tab === "trend" && (
              <div className="chart-card">
                <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                  Xu hướng scan — {period === "7d" ? "7 ngày" : "30 ngày"} ({granularity === "hour" ? "theo giờ" : "theo ngày"})
                </h3>
                <TimeSeriesChart data={timeline} height={280} />
              </div>
            )}

            {tab === "disease" && (
              <div className="dashboard-grid-2">
                <div className="chart-card">
                  <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                    🏆 Top bệnh lý phổ biến
                  </h3>
                  <DiseaseBarChart data={diseases} maxItems={12} />
                </div>
                <div className="chart-card">
                  <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                    Phân bố tỉ lệ
                  </h3>
                  <DiseaseChart data={diseases} size={200} />
                </div>
              </div>
            )}

            {tab === "icd" && (
              <div className="dashboard-grid-2 animate-fadeIn">
                <div className="chart-card">
                  <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                    📋 Phân bố theo Nhóm bệnh ICD-10
                  </h3>
                  
                  {!icdData.length ? (
                    <div className="flex items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
                      <p className="text-sm">Chưa có dữ liệu phân loại ICD-10</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {icdData.slice(0, 10).map((d, i) => {
                        const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#0ea5e9", "#8b5cf6", "#14b8a6", "#ef4444", "#ec4899", "#84cc16"];
                        const maxCount = Math.max(...icdData.map(item => item.count), 1);
                        return (
                          <div key={d.icd_group} className="group">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                                <span className="text-sm font-medium truncate max-w-[240px]" style={{ color: "var(--text-primary)" }} title={d.icd_group}>
                                  {d.icd_group}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                                  {d.count.toLocaleString("vi-VN")} ca
                                </span>
                                <span className="text-xs font-semibold w-12 text-right tabular-nums" style={{ color: COLORS[i % COLORS.length] }}>
                                  {d.percentage}%
                                </span>
                              </div>
                            </div>
                            <div className="progress-bar">
                              <div
                                className="progress-bar-fill"
                                style={{
                                  width: `${(d.count / maxCount) * 100}%`,
                                  background: COLORS[i % COLORS.length],
                                  opacity: 0.85,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="chart-card flex flex-col items-center justify-center">
                  <h3 className="text-sm font-bold mb-4 self-start" style={{ color: "var(--text-primary)" }}>
                    Tỷ lệ phần trăm nhóm bệnh
                  </h3>
                  {!icdData.length ? (
                    <div className="flex items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
                      <p className="text-sm">Chưa có dữ liệu</p>
                    </div>
                  ) : (
                    <DiseaseChart
                      data={icdData.map(d => ({
                        disease: d.icd_group,
                        count: d.count,
                        percentage: d.percentage
                      }))}
                      size={200}
                    />
                  )}
                </div>
              </div>
            )}

            {tab === "daily" && (
              <div className="chart-card">
                <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
                  Nhật ký hàng ngày
                </h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Tổng scans</th>
                      <th>Bình thường</th>
                      <th>Bất thường</th>
                      <th>Avg time</th>
                      <th>Bệnh phổ biến</th>
                      <th>Tỉ lệ bất thường</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...daily].reverse().slice(0, 30).map((d) => {
                      const abnPct = d.total_scans > 0 ? Math.round((d.abnormal_scans / d.total_scans) * 100) : 0;
                      const isHighAbn = abnPct > 30;
                      return (
                        <tr key={d.day_bucket}>
                          <td className="font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
                            {new Date(d.day_bucket).toLocaleDateString("vi-VN")}
                          </td>
                          <td className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                            {d.total_scans.toLocaleString("vi-VN")}
                          </td>
                          <td>
                            <span className="badge badge-success">{d.normal_scans.toLocaleString("vi-VN")}</span>
                          </td>
                          <td>
                            <span className="badge badge-danger">{d.abnormal_scans.toLocaleString("vi-VN")}</span>
                          </td>
                          <td className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                            {d.avg_processing_ms >= 1000
                              ? `${(d.avg_processing_ms / 1000).toFixed(1)}s`
                              : `${Math.round(d.avg_processing_ms)}ms`}
                          </td>
                          <td>
                            {d.top_disease
                              ? <span className="badge badge-indigo">{translateDisease(d.top_disease)}</span>
                              : <span style={{ color: "var(--text-muted)" }}>—</span>}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="progress-bar w-20">
                                <div
                                  className="progress-bar-fill"
                                  style={{
                                    width: `${abnPct}%`,
                                    background: isHighAbn ? "var(--grad-rose)" : "var(--grad-amber)",
                                  }}
                                />
                              </div>
                              <span className="text-xs font-semibold tabular-nums"
                                style={{ color: isHighAbn ? "var(--rose-500)" : "var(--amber-600)" }}>
                                {abnPct}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
