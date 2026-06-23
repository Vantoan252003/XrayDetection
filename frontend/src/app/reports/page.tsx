"use client";

import { useState, useEffect } from "react";
import { FileText, Download, Sparkles, Clock, Database } from "lucide-react";
import { translateDisease } from "@/utils/disease";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type SparkReport = {
  id: number;
  report_type: string;
  report_date: string;
  report_data: Record<string, unknown>;
  minio_path: string | null;
  created_at: string;
};

export default function ReportsPage() {
  const [reports, setReports] = useState<SparkReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<SparkReport | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const res = await fetch(`${API_URL}/analytics/spark-reports?limit=20`);
        if (res.ok) {
          const data = await res.json();
          setReports(data.reports || []);
          if (data.reports?.length > 0) {
            setSelectedReport(data.reports[0]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch reports:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchReports();
  }, []);

  const reportTypeLabels: Record<string, { label: string; icon: string }> = {
    weekly_summary: { label: "Báo cáo tuần", icon: "📊" },
    daily_summary: { label: "Báo cáo ngày", icon: "📈" },
    disease_correlation: { label: "Tương quan bệnh", icon: "🔬" },
    monthly_summary: { label: "Báo cáo tháng", icon: "📅" },
  };

  return (
    <div className="space-y-6">
      {/* ── Top Bar ── */}
      <div className="topbar">
        <div>
          <h1 className="page-title">
            <Sparkles className="w-5 h-5 animate-pulse" style={{ color: "var(--violet-500)" }} />
            Spark Reports
          </h1>
          <p className="page-subtitle">
            Kết quả phân tích dữ liệu lớn (Batch Analytics) từ Apache Spark
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-16 w-full" />
          <div className="skeleton h-96 w-full" />
        </div>
      ) : reports.length === 0 ? (
        <div className="chart-card flex flex-col items-center justify-center py-20">
          <Database className="w-12 h-12 text-slate-400 mb-4" />
          <h3 className="text-lg font-semibold text-slate-500">
            Chưa có báo cáo
          </h3>
          <p className="text-sm text-slate-600 mt-1 max-w-md text-center">
            Các báo cáo phân tích sẽ xuất hiện ở đây sau khi chạy Spark Batch Analytics Job:
          </p>
          <code className="mt-3 px-4 py-2 rounded-lg bg-slate-100 border border-slate-200 text-xs text-indigo-600 font-mono">
            docker compose exec spark-master spark-submit --conf spark.jars.ivy=/tmp/.ivy --packages org.postgresql:postgresql:42.7.1,org.apache.hadoop:hadoop-aws:3.3.4,com.amazonaws:aws-java-sdk-bundle:1.12.262 /opt/spark-apps/analytics_job.py
          </code>
        </div>
      ) : (
        <div className="dashboard-grid-3">
          {/* Report List */}
          <div className="chart-card">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <FileText className="w-4 h-4 text-violet-500" />
              Danh sách báo cáo
            </h3>
            <div className="space-y-2">
              {reports.map((report) => {
                const typeInfo = reportTypeLabels[report.report_type] || {
                  label: report.report_type,
                  icon: "📄",
                };
                const isSelected = selectedReport?.id === report.id;

                return (
                  <button
                    key={report.id}
                    onClick={() => setSelectedReport(report)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all border ${
                      isSelected
                        ? "bg-indigo-50 border-indigo-100 shadow-sm"
                        : "hover:bg-slate-50 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{typeInfo.icon}</span>
                      <span
                        className={`text-sm font-semibold ${
                          isSelected ? "text-indigo-600" : "text-slate-700"
                        }`}
                      >
                        {typeInfo.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{new Date(report.created_at).toLocaleDateString("vi-VN")}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Report Detail */}
          <div className="chart-card span-2">
            {selectedReport ? (
              <>
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-lg font-extrabold" style={{ color: "var(--text-primary)" }}>
                      {
                        (
                          reportTypeLabels[selectedReport.report_type] || {
                            label: selectedReport.report_type,
                          }
                        ).label
                      }
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Ngày dữ liệu:{" "}
                      {new Date(selectedReport.report_date).toLocaleDateString(
                        "vi-VN"
                      )}{" "}
                      · Tạo lúc:{" "}
                      {new Date(selectedReport.created_at).toLocaleString(
                        "vi-VN"
                      )}
                    </p>
                  </div>
                  {selectedReport.minio_path && (
                    <button className="btn-secondary text-xs flex items-center gap-2" style={{ padding: "7px 12px" }}>
                      <Download className="w-3.5 h-3.5" />
                      Export
                    </button>
                  )}
                </div>

                {/* Report Content */}
                <div className="space-y-6">
                  {/* Key Metrics */}
                  {selectedReport.report_data && (
                    <>
                      <div className="grid grid-cols-3 gap-4">
                        {!!selectedReport.report_data.total_scans_analyzed && (
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 shadow-xs">
                            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                              Tổng số ca scan
                            </p>
                            <p className="text-2xl font-extrabold mt-1.5" style={{ color: "var(--text-primary)" }}>
                              {(
                                selectedReport.report_data
                                  .total_scans_analyzed as number
                              ).toLocaleString("vi-VN")}
                            </p>
                          </div>
                        )}
                        {selectedReport.report_data.processing_time_p50 !== undefined && (
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 shadow-xs">
                            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                              Thời gian P50
                            </p>
                            <p className="text-2xl font-extrabold mt-1.5" style={{ color: "var(--text-primary)" }}>
                              {(
                                (selectedReport.report_data
                                  .processing_time_p50 as number) / 1000
                              ).toFixed(1)}
                              s
                            </p>
                          </div>
                        )}
                        {selectedReport.report_data.processing_time_p95 !== undefined && (
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 shadow-xs">
                            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                              Thời gian P95
                            </p>
                            <p className="text-2xl font-extrabold mt-1.5" style={{ color: "var(--amber-600)" }}>
                              {(
                                (selectedReport.report_data
                                  .processing_time_p95 as number) / 1000
                              ).toFixed(1)}
                              s
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Top Diseases from Spark */}
                      {Array.isArray(
                        selectedReport.report_data.top_diseases
                      ) && (
                        <div>
                          <h4 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>
                            Phát hiện bệnh lý hàng đầu (Phân tích Spark)
                          </h4>
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Bệnh lý</th>
                                <th>Số ca</th>
                                <th>Tỉ lệ</th>
                                <th>Tần suất</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(
                                selectedReport.report_data.top_diseases as Array<{
                                  disease: string;
                                  count: number;
                                  percentage: number;
                                }>
                              ).map((d) => (
                                <tr key={d.disease}>
                                  <td className="font-semibold" style={{ color: "var(--text-primary)" }}>
                                    {translateDisease(d.disease)}
                                  </td>
                                  <td className="font-bold font-mono" style={{ color: "var(--text-secondary)" }}>
                                    {d.count.toLocaleString("vi-VN")}
                                  </td>
                                  <td>
                                    <span className="badge badge-indigo">
                                      {d.percentage}%
                                    </span>
                                  </td>
                                  <td className="w-32">
                                    <div className="progress-bar">
                                      <div
                                        className="progress-bar-fill"
                                        style={{
                                          width: `${Math.min(
                                            d.percentage * 3.5,
                                            100
                                          )}%`,
                                          background:
                                            "var(--grad-indigo)",
                                        }}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Peak Hours */}
                      {Array.isArray(
                        selectedReport.report_data.peak_hours
                      ) && (
                        <div>
                          <h4 className="text-sm font-bold mb-2.5" style={{ color: "var(--text-primary)" }}>
                            Khung giờ cao điểm
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {(
                              selectedReport.report_data.peak_hours as number[]
                            ).map((h) => (
                              <span
                                key={h}
                                className="px-3.5 py-1.5 rounded-lg bg-amber-50 text-amber-600 text-sm font-bold border border-amber-100 shadow-xs"
                              >
                                {h}:00
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Raw JSON */}
                      <div className="pt-4 border-t border-slate-100">
                        <details className="group">
                          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-800 transition-colors font-semibold">
                            Xem dữ liệu JSON gốc
                          </summary>
                          <pre className="mt-2.5 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 overflow-auto max-h-60 font-mono leading-relaxed shadow-inner">
                            {JSON.stringify(
                              selectedReport.report_data,
                              null,
                              2
                            )}
                          </pre>
                        </details>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-96 text-slate-400">
                Chọn một báo cáo để xem chi tiết
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
