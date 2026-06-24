"use client";

import { useEffect, useState } from "react";
import { CheckSquare, Loader2, CheckCircle2, XCircle, ChevronLeft, ChevronRight, AlertCircle, Play } from "lucide-react";
import ImageSlider from "@/components/ImageSlider";
import DiseaseCheckbox from "@/components/DiseaseCheckbox";
import { translateDisease } from "@/utils/disease";

type Scan = {
  id: string;
  image_url: string;
  heatmap_url: string | null;
  top_disease: string | null;
  scores: Record<string, number>;
  review_deadline?: string;
  patient_id?: string;
};

export default function ReviewPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [verifiedLabels, setVerifiedLabels] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Thêm quản lý tab: "pending" (chưa xác nhận) và "reviewed" (đã xác nhận)
  const [activeTab, setActiveTab] = useState<"pending" | "reviewed">("pending");
  const [confirmAllLoading, setConfirmAllLoading] = useState(false);
  const [trainLoading, setTrainLoading] = useState(false);
  const [trainStatus, setTrainStatus] = useState<{
    status: string; mode: string; progress: number; error_message: string | null; last_run_time: string | null;
  } | null>(null);
  const [trainStatusMsg, setTrainStatusMsg] = useState<string | null>(null);

  const fetchScans = async (tab: "pending" | "reviewed") => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const url = `${baseUrl}/review/${tab}?limit=50`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setScans(data.scans || []);
        setTotal(data.total || 0);
        setActiveIndex(0);
      }
    } catch (e) {
      console.error(`Failed to fetch ${tab} reviews:`, e);
      setError(`Không thể tải danh sách ca quét ${tab === "pending" ? "chờ duyệt" : "đã duyệt"}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScans(activeTab);
  }, [activeTab]);

  // Khởi tạo verifiedLabels khi activeIndex hoặc activeTab thay đổi
  useEffect(() => {
    if (scans.length > 0 && scans[activeIndex]) {
      const scan = scans[activeIndex];
      const initialLabels: Record<string, boolean> = {};
      
      // Nếu là tab đã duyệt, lấy nhãn đã duyệt từ database (reviewed_labels)
      if (activeTab === "reviewed" && (scan as any).reviewed_labels) {
        Object.entries((scan as any).reviewed_labels).forEach(([disease, checked]) => {
          if (checked) initialLabels[disease] = true;
        });
      } else {
        // Nếu là tab chưa duyệt, tự động tích nếu xác suất AI > 60% (0.6)
        Object.entries(scan.scores).forEach(([disease, score]) => {
          if (score > 0.6) {
            initialLabels[disease] = true;
          }
        });
      }
      setVerifiedLabels(initialLabels);
      setError(null);
    } else {
      setVerifiedLabels({});
    }
  }, [scans, activeIndex, activeTab]);

  const activeScan = scans[activeIndex];

  const handleCheckboxChange = (disease: string, checked: boolean) => {
    setVerifiedLabels((prev) => ({
      ...prev,
      [disease]: checked,
    }));
  };

  const submitReview = async (action: "approve" | "reject") => {
    if (!activeScan) return;
    setActionLoading(true);
    setError(null);

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    let url = `${baseUrl}/review/${activeScan.id}/${action}`;
    const payload = action === "approve" ? { verified_labels: verifiedLabels } : { reason: "Bác sĩ loại bỏ" };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        if (activeTab === "pending" || action === "reject") {
          // Xóa khỏi danh sách nếu đang ở pending, HOẶC nếu ấn bác bỏ ở bất kỳ tab nào
          setScans((prev) => prev.filter((_, idx) => idx !== activeIndex));
          setTotal((prev) => prev - 1);
          setActiveIndex(0);
        } else {
          // Trong tab đã xác nhận, nếu ấn phê duyệt thì cập nhật dữ liệu cục bộ của item
          setScans((prev) =>
            prev.map((s, idx) => {
              if (idx === activeIndex) {
                return {
                  ...s,
                  reviewed_labels: verifiedLabels,
                  ls_review_status: "approved",
                };
              }
              return s;
            })
          );
          setError("✓ Đã cập nhật thành công kết quả.");
          setTimeout(() => setError(null), 3000);
        }
      } else {
        const err = await res.json();
        setError(err.detail || "Thao tác phê duyệt thất bại.");
      }
    } catch (e) {
      setError("Lỗi kết nối khi gửi kết quả phê duyệt.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmAll = async () => {
    if (scans.length === 0) return;
    if (!window.confirm("Bạn có chắc chắn muốn xác nhận toàn bộ các ca chờ duyệt bằng phán đoán ban đầu của AI và gửi đi huấn luyện không?")) {
      return;
    }
    setConfirmAllLoading(true);
    setError(null);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const url = `${baseUrl}/review/approve-all`;
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(`Đã phê duyệt hàng loạt thành công ${data.approved_count} ca quét! Đang bắt đầu huấn luyện mô hình...`);
        // Gửi toàn bộ để train mô hình
        await handleTriggerTrain();
        fetchScans(activeTab);
      } else {
        const err = await res.json();
        setError(err.detail || "Phê duyệt hàng loạt thất bại.");
      }
    } catch (e) {
      setError("Lỗi kết nối khi phê duyệt hàng loạt.");
    } finally {
      setConfirmAllLoading(false);
    }
  };

  const pollTrainingStatus = async () => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const poll = async () => {
      try {
        const r = await fetch(`${baseUrl}/training/status`);
        if (r.ok) {
          const s = await r.json();
          setTrainStatus(s);
          if (s.status === "running") {
            setTimeout(poll, 3000);
          } else {
            setTrainLoading(false);
          }
        }
      } catch { setTrainLoading(false); }
    };
    poll();
  };

  const handleTriggerTrain = async () => {
    setTrainLoading(true);
    setTrainStatusMsg(null);
    setError(null);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/training/trigger`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTrainStatusMsg(`🚀 Đã kích hoạt huấn luyện! ${data.ready_scans} ảnh sẵn sàng · Mode: ${data.mode || "local"}`);
        pollTrainingStatus();
      } else {
        setTrainStatusMsg(`⚠️ ${data.detail || "Không có dữ liệu mới để huấn luyện."}`);
        setTrainLoading(false);
      }
    } catch (e) {
      setError("Lỗi kết nối khi gửi yêu cầu huấn luyện.");
      setTrainLoading(false);
    }
  };

  if (loading && scans.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
        <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
          Đang tải dữ liệu...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar with Title */}
      <div className="topbar flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="page-title flex items-center gap-2 text-xl font-bold">
            <CheckSquare className="w-5 h-5 text-indigo-500" />
            Bác Sĩ Review
            {total > 0 && (
              <span className="badge badge-indigo text-xs ml-2 bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold">
                {total} ca {activeTab === "pending" ? "chờ duyệt" : "đã duyệt"}
              </span>
            )}
          </h1>
          <p className="page-subtitle text-xs text-slate-400 mt-1">Xem xét bản đồ nhiệt Grad-CAM, xác nhận hoặc sửa lại chẩn đoán của AI</p>
        </div>
      </div>

      {scans.length === 0 ? (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left panel tabs with empty state */}
          <div className="lg:col-span-4 w-full lg:w-1/3 chart-card p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex border-b border-slate-200 mb-4 pb-1">
              <button
                onClick={() => setActiveTab("pending")}
                className={`flex-1 pb-2 text-xs font-bold transition-all border-b-2 text-center ${
                  activeTab === "pending"
                    ? "border-indigo-500 text-indigo-600"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                Chưa xác nhận
              </button>
              <button
                onClick={() => setActiveTab("reviewed")}
                className={`flex-1 pb-2 text-xs font-bold transition-all border-b-2 text-center ${
                  activeTab === "reviewed"
                    ? "border-indigo-500 text-indigo-600"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                Đã xác nhận
              </button>
            </div>
            {/* Train button when empty but in reviewed tab */}
            {activeTab === "reviewed" && (
              <button
                disabled={trainLoading}
                onClick={handleTriggerTrain}
                className="w-full mb-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center gap-1.5 font-bold text-xs transition-all disabled:opacity-50 shadow-sm"
              >
                {trainLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Huấn luyện mô hình
              </button>
            )}
            <p className="text-xs text-center py-8 italic text-slate-400">Danh sách trống.</p>
          </div>

          <div className="lg:col-span-8 flex-1 chart-card text-center py-16 space-y-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            </div>
            <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              Hoàn tất công việc!
            </h3>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Không có ảnh X-quang nào đang chờ phê duyệt. Dữ liệu đã được đồng bộ sạch sẽ vào tập huấn luyện.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* List scans left-side panel */}
          <div className="lg:col-span-4 space-y-3 chart-card max-h-[700px] overflow-y-auto bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            {/* Tabs */}
            <div className="flex border-b border-slate-200 mb-3 pb-1">
              <button
                onClick={() => setActiveTab("pending")}
                className={`flex-1 pb-2 text-xs font-bold transition-all border-b-2 text-center ${
                  activeTab === "pending"
                    ? "border-indigo-500 text-indigo-600"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                Chưa xác nhận
              </button>
              <button
                onClick={() => setActiveTab("reviewed")}
                className={`flex-1 pb-2 text-xs font-bold transition-all border-b-2 text-center ${
                  activeTab === "reviewed"
                    ? "border-indigo-500 text-indigo-600"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                Đã xác nhận
              </button>
            </div>

            {/* Confirm All Button */}
            {activeTab === "pending" && scans.length > 0 && (
              <button
                disabled={confirmAllLoading || trainLoading}
                onClick={handleConfirmAll}
                className="w-full mb-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded-xl flex items-center justify-center gap-1.5 font-bold text-xs transition-all disabled:opacity-50"
              >
                {(confirmAllLoading || trainLoading) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckSquare className="w-3.5 h-3.5" />}
                Xác nhận toàn bộ & Huấn luyện ({scans.length} ca)
              </button>
            )}
            
            {/* Train Button in Reviewed tab */}
            {activeTab === "reviewed" && (
              <div className="mb-3 space-y-2">
                <button
                  disabled={trainLoading}
                  onClick={handleTriggerTrain}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center gap-1.5 font-bold text-xs transition-all disabled:opacity-60 shadow-sm"
                >
                  {trainLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {trainLoading ? `Đang huấn luyện... ${trainStatus?.progress ?? 0}%` : "Huấn luyện mô hình"}
                </button>
                {trainStatusMsg && (
                  <p className="text-[10px] text-center font-medium" style={{ color: trainStatusMsg.startsWith("⚠️") ? "var(--rose-500)" : "var(--emerald-600)" }}>
                    {trainStatusMsg}
                  </p>
                )}
                {trainLoading && trainStatus && (
                  <div className="space-y-1">
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${trainStatus.progress}%`, background: "var(--grad-indigo)" }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 text-center">
                      {trainStatus.mode === "local" ? "🖥️ Đang train local" : "☁️ Kaggle GPU"} · {trainStatus.progress}%
                    </p>
                  </div>
                )}
                {trainStatus?.status === "complete" && trainStatus.last_run_time && (
                  <p className="text-[10px] text-center text-emerald-600 font-medium">
                    ✅ Hoàn tất · {new Date(trainStatus.last_run_time).toLocaleString("vi-VN")}
                  </p>
                )}
                {trainStatus?.status === "error" && (
                  <p className="text-[10px] text-center text-rose-500">
                    ❌ {trainStatus.error_message || "Lỗi trong quá trình huấn luyện"}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              {scans.map((scan, idx) => (
                <button
                  key={scan.id}
                  onClick={() => setActiveIndex(idx)}
                  className="w-full text-left p-3 rounded-xl transition-all border flex items-center justify-between"
                  style={{
                    borderColor: idx === activeIndex ? "var(--indigo-500)" : "var(--border-light)",
                    background: idx === activeIndex ? "var(--indigo-50)" : "var(--bg-card)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>
                      Ca: {scan.id.substring(0, 8)}...
                    </p>
                    <p className="text-[11px] truncate mt-0.5" style={{ color: (scan as any).is_normal ? "var(--text-muted)" : "var(--rose-500)" }}>
                      {activeTab === "reviewed" ? "Đã chẩn đoán: " : "AI dự đoán: "}
                      {activeTab === "reviewed"
                        ? ((scan as any).reviewed_labels && Object.keys((scan as any).reviewed_labels || {}).length > 0 ? Object.keys((scan as any).reviewed_labels || {}).map(translateDisease).join(", ") : "Bình thường")
                        : (scan.top_disease ? translateDisease(scan.top_disease) : "Bình thường")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {activeTab === "reviewed" && (
                      <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${
                        (scan as any).ls_review_status === "rejected"
                          ? "bg-rose-50 text-rose-600 border border-rose-100"
                          : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      }`}>
                        {(scan as any).ls_review_status === "rejected" ? "Đã bỏ" : "Đã duyệt"}
                      </span>
                    )}
                    {scan.review_deadline && activeTab === "pending" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 font-semibold">
                        Hạn: {new Date(scan.review_deadline).toLocaleDateString("vi-VN")}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Active scan details */}
          <div className="lg:col-span-8 space-y-6">
            <div className="chart-card space-y-6 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              {/* Card Header with details & pagination */}
              <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Chi tiết ca quét: {activeScan.id}
                  </h3>
                  {activeScan.patient_id && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                      Mã bệnh nhân: <strong>{activeScan.patient_id}</strong>
                    </p>
                  )}
                </div>
                
                {/* Navigation arrows */}
                <div className="flex gap-2">
                  <button
                    disabled={activeIndex === 0}
                    onClick={() => setActiveIndex(prev => prev - 1)}
                    className="p-1.5 rounded-lg border hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled={activeIndex === scans.length - 1}
                    onClick={() => setActiveIndex(prev => prev + 1)}
                    className="p-1.5 rounded-lg border hover:bg-slate-50 transition-colors disabled:opacity-50"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Action Buttons (2 buttons at the top of detail area) */}
              <div className="flex flex-wrap items-center justify-end gap-3 pb-3 border-b border-slate-100">
                {error && (
                  <div className="flex items-center gap-1 text-xs text-rose-500 mr-auto font-medium">
                    <AlertCircle className="w-4 h-4" />
                    <span>{error}</span>
                  </div>
                )}
                
                <button
                  disabled={actionLoading}
                  onClick={() => submitReview("reject")}
                  className="py-1.5 px-3 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 flex items-center gap-1 text-xs font-bold transition-all disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Bác bỏ ảnh quét
                </button>
                <button
                  disabled={actionLoading}
                  onClick={() => submitReview("approve")}
                  className="py-1.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
                >
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Xác nhận kết quả
                </button>
              </div>

              {/* Slider & AI predictions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Trực quan giải thích (XAI)
                  </p>
                  <div className="p-2 border rounded-2xl bg-slate-900 aspect-square">
                    {activeScan.heatmap_url ? (
                      <ImageSlider originalUrl={activeScan.image_url} heatmapUrl={activeScan.heatmap_url} />
                    ) : (
                      <img src={activeScan.image_url} alt="Original Scan" className="w-full h-full object-contain rounded-xl" />
                    )}
                  </div>
                  <p className="text-center text-xs mt-2 text-slate-400">
                    {activeScan.heatmap_url ? "Kéo thanh trượt để so sánh ảnh gốc và heatmap" : "Ảnh gốc (Không có bản đồ nhiệt do AI ban đầu không phát hiện bệnh)"}
                  </p>
                </div>

                <div className="space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Phán đoán của AI
                  </p>
                  <div className="space-y-2">
                    {Object.entries(activeScan.scores)
                      .filter(([, score]) => score > 0.4)
                      .sort(([, a], [, b]) => b - a)
                      .map(([disease, score]) => {
                        // Bác sĩ đã bỏ tích hoặc không tích bệnh này
                        const doctorApproved = verifiedLabels[disease] === true;
                        // Áp dụng gạch ngang và giảm độ mờ khi bác sĩ không chọn bệnh lý này
                        const showStrike = !doctorApproved;
                        const isUnchecked = !doctorApproved;
                        return (
                          <div key={disease} className="text-xs animate-fadeIn">
                            <div className="flex justify-between font-semibold mb-0.5">
                              <span style={{
                                color: showStrike ? "var(--text-muted)" : doctorApproved && activeTab === "reviewed" ? "var(--emerald-600)" : "var(--text-secondary)",
                                textDecoration: showStrike ? "line-through" : "none",
                                opacity: isUnchecked ? 0.5 : 1,
                              }}>
                                {showStrike && "✗ "}{translateDisease(disease)}
                                {doctorApproved && activeTab === "reviewed" && " ✓"}
                              </span>
                              <span style={{
                                color: showStrike ? "var(--text-muted)" : "var(--indigo-600)",
                                opacity: isUnchecked ? 0.4 : 1,
                              }}>{(score * 100).toFixed(1)}%</span>
                            </div>
                            <div className="progress-bar">
                              <div className="progress-bar-fill" style={{
                                width: `${score * 100}%`,
                                background: showStrike ? "#cbd5e1" : doctorApproved && activeTab === "reviewed" ? "var(--emerald-500)" : score > 0.75 ? "var(--rose-500)" : "var(--indigo-500)",
                                opacity: isUnchecked ? 0.3 : 1,
                              }} />
                            </div>
                            {showStrike && (
                              <p className="text-[10px] text-slate-400 mt-0.5 italic">
                                {activeTab === "reviewed" ? "Bác sĩ xác nhận: Không phải bệnh này" : "Chưa xác nhận bệnh này"}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    {Object.values(activeScan.scores).every(score => score <= 0.4) && (
                      <p className="text-xs py-4 text-center italic" style={{ color: "var(--text-muted)" }}>
                        AI chẩn đoán phổi hoàn toàn bình thường (tất cả chỉ số &lt; 40%).
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Verified checkbox list */}
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Xác nhận nhãn chẩn đoán (Chọn các bệnh lý được bác sĩ phê duyệt)
                </p>
                <DiseaseCheckbox
                  scores={activeScan.scores}
                  verifiedLabels={verifiedLabels}
                  onChange={handleCheckboxChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
