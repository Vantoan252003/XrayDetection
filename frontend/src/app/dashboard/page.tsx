"use client";

import { translateDisease } from "@/utils/disease";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAnalytics } from "@/hooks/useAnalytics";
import LiveMetricCard from "@/components/LiveMetricCard";
import DiseaseChart from "@/components/DiseaseChart";
import DiseaseBarChart from "@/components/DiseaseBarChart";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import ScanFeed from "@/components/ScanFeed";
import SystemHealth from "@/components/SystemHealth";
import {
  Scan, Activity, HeartPulse, Users, RefreshCw,
  TrendingUp, AlertCircle, CheckCircle, Clock,
} from "lucide-react";

export default function DashboardPage() {
  const { isConnected, activeClients } = useWebSocket();
  const { overview, timeline, recentEvents, health, loading, refreshAll } = useAnalytics();

  const ov = overview?.overview;
  const diseases = overview?.diseases || [];
  const proc = overview?.processing_stats;

  const normalRate = ov && ov.total_scans > 0
    ? Math.round((ov.normal_scans / ov.total_scans) * 100)
    : 0;
  const abnormalRate = 100 - normalRate;

  return (
    <div className="space-y-6">

      {/* ── Top Bar ── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">
            <Activity className="w-5 h-5" style={{ color: "var(--indigo-500)" }} />
            Dashboard
          </h1>
          <p className="page-subtitle">Giám sát X-quang thời gian thực</p>
        </div>
        <div className="flex items-center gap-3">
          {/* WS status */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: isConnected ? "var(--emerald-50)" : "var(--rose-50)",
              color: isConnected ? "var(--emerald-600)" : "var(--rose-500)",
              border: `1px solid ${isConnected ? "var(--emerald-100)" : "var(--rose-100)"}`,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: isConnected ? "var(--emerald-500)" : "var(--rose-500)" }} />
            {isConnected ? `Live · ${activeClients} clients` : "Disconnected"}
          </div>

          <button
            onClick={refreshAll}
            className="btn-secondary text-sm"
            style={{ padding: "7px 14px" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="dashboard-grid animate-fade-in-up">
        <LiveMetricCard
          title="Tổng X-quang"
          value={ov?.total_scans || 0}
          icon={<Scan className="w-5 h-5" />}
          color="indigo" live
          description="Tất cả thời gian"
        />
        <LiveMetricCard
          title="Trong 24h"
          value={ov?.scans_24h || 0}
          icon={<Activity className="w-5 h-5" />}
          color="sky" live
          description="So với hôm qua"
        />
        <LiveMetricCard
          title="Ca bất thường"
          value={ov?.abnormal_scans || 0}
          icon={<HeartPulse className="w-5 h-5" />}
          color="rose"
          description={`Tỉ lệ: ${abnormalRate}%`}
        />
        <LiveMetricCard
          title="Bệnh nhân"
          value={ov?.unique_patients || 0}
          icon={<Users className="w-5 h-5" />}
          color="emerald"
          description="Unique patients"
        />
      </div>

      {/* ── Quick Stats Row ── */}
      <div className="dashboard-grid-3 animate-fade-in-up stagger-1">
        {/* Normal vs Abnormal Split */}
        <div className="chart-card">
          <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            Tỉ lệ kết quả
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1.5 font-medium" style={{ color: "var(--text-secondary)" }}>
                  <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--emerald-500)" }} />
                  Bình thường
                </span>
                <span className="font-bold" style={{ color: "var(--emerald-600)" }}>{normalRate}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${normalRate}%`, background: "var(--grad-emerald)" }} />
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{(ov?.normal_scans || 0).toLocaleString("vi-VN")} ca</p>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1.5 font-medium" style={{ color: "var(--text-secondary)" }}>
                  <AlertCircle className="w-3.5 h-3.5" style={{ color: "var(--rose-500)" }} />
                  Bất thường
                </span>
                <span className="font-bold" style={{ color: "var(--rose-500)" }}>{abnormalRate}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${abnormalRate}%`, background: "var(--grad-rose)" }} />
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{(ov?.abnormal_scans || 0).toLocaleString("vi-VN")} ca</p>
            </div>
          </div>

          {/* Source breakdown */}
          {overview?.sources && overview.sources.length > 0 && (
            <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--border-light)" }}>
              <p className="text-xs font-bold mb-2.5" style={{ color: "var(--text-muted)" }}>NGUỒN SCAN</p>
              <div className="space-y-2">
                {overview.sources.map((src) => {
                  const total = overview.sources.reduce((s, x) => s + x.count, 0);
                  const pct = total > 0 ? Math.round((src.count / total) * 100) : 0;
                  const colorMap: Record<string, string> = { web: "#6366f1", api: "#0ea5e9", mobile: "#8b5cf6", batch: "#f59e0b" };
                  return (
                    <div key={src.source} className="flex items-center gap-2 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorMap[src.source] || "#94a3b8" }} />
                      <span className="flex-1 capitalize font-medium" style={{ color: "var(--text-secondary)" }}>{src.source}</span>
                      <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Processing Time Stats */}
        <div className="chart-card">
          <h3 className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Clock className="w-4 h-4" style={{ color: "var(--amber-500)" }} />
            Thời gian xử lý
          </h3>
          <div className="space-y-3">
            {[
              { label: "Trung bình",   val: proc?.avg_ms || 0, color: "#6366f1" },
              { label: "Median (P50)", val: proc?.p50_ms || 0, color: "#10b981" },
              { label: "P95",          val: proc?.p95_ms || 0, color: "#f59e0b" },
              { label: "P99",          val: proc?.p99_ms || 0, color: "#f43f5e" },
              { label: "Nhanh nhất",  val: proc?.min_ms || 0, color: "#0ea5e9" },
              { label: "Chậm nhất",  val: proc?.max_ms || 0, color: "#ef4444" },
            ].map(({ label, val, color }) => (
              <div key={label} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--border-light)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{label}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>
                  {val >= 1000 ? `${(val / 1000).toFixed(1)}s` : `${Math.round(val)}ms`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* System Health */}
        <div className="chart-card">
          <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
            System Health
          </h3>
          <SystemHealth
            services={health?.services || {}}
            websocketClients={health?.websocket_clients || activeClients}
          />
        </div>
      </div>

      {/* ── Timeline Chart ── */}
      <div className="chart-card animate-fade-in-up stagger-2">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Lưu lượng scan theo thời gian</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>24 giờ gần nhất</p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="pulse-dot" />
            <span className="text-xs font-semibold" style={{ color: "var(--emerald-600)" }}>Realtime</span>
          </div>
        </div>
        <TimeSeriesChart data={timeline?.timeline || []} height={240} />
      </div>

      {/* ── Disease Analysis + Feed ── */}
      <div className="dashboard-grid-3 animate-fade-in-up stagger-3">
        {/* Disease Donut */}
        <div className="chart-card">
          <h3 className="text-sm font-bold mb-1" style={{ color: "var(--text-primary)" }}>
            Phân bố bệnh lý
          </h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>Tất cả thời gian</p>
          <DiseaseChart data={diseases} size={190} />
        </div>

        {/* Disease Bar Ranking */}
        <div className="chart-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                🏆 Top bệnh lý phổ biến
              </h3>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Xếp hạng theo số ca</p>
            </div>
          </div>
          <DiseaseBarChart data={diseases} maxItems={8} />
        </div>

        {/* Live Feed */}
        <div className="chart-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <div className="pulse-dot" />
              Scan gần đây
            </h3>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {recentEvents.length} kết quả
            </span>
          </div>
          <div className="max-h-[380px] overflow-y-auto -mx-1">
            <ScanFeed events={recentEvents} maxItems={12} />
          </div>
        </div>
      </div>

      {/* ── Disease Detail Table ── */}
      <div className="chart-card animate-fade-in-up stagger-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Chi tiết bệnh lý
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              Thống kê đầy đủ theo từng loại bệnh
            </p>
          </div>
          {diseases[0] && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
              style={{ background: "var(--amber-50)", color: "var(--amber-600)" }}>
              🥇 {translateDisease(diseases[0].disease)} phổ biến nhất ({diseases[0].percentage}%)
            </div>
          )}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Hạng</th>
              <th>Bệnh lý</th>
              <th>Số ca</th>
              <th>Tỉ lệ</th>
              <th style={{ width: "200px" }}>Tần suất</th>
            </tr>
          </thead>
          <tbody>
            {diseases.slice(0, 12).map((d, i) => {
              const colors = ["#6366f1","#10b981","#f59e0b","#f43f5e","#0ea5e9","#8b5cf6","#14b8a6","#ef4444","#ec4899","#84cc16","#06b6d4","#f97316"];
              const c = colors[i % colors.length];
              const rank = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
              return (
                <tr key={d.disease}>
                  <td>
                    <span className="text-base">{rank}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{translateDisease(d.disease)}</span>
                    </div>
                  </td>
                  <td>
                    <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {d.count.toLocaleString("vi-VN")}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-indigo">{d.percentage}%</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="progress-bar flex-1">
                        <div className="progress-bar-fill" style={{ width: `${d.percentage * 4}%`, background: c }} />
                      </div>
                      <span className="text-xs tabular-nums w-8 text-right" style={{ color: "var(--text-muted)" }}>
                        {d.percentage}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
