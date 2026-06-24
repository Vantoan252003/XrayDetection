"use client";

import { useEffect, useState } from "react";
import { Cpu, Loader2, Award, RefreshCw, ChevronDown, ChevronRight, Check } from "lucide-react";
import TrainingStatus from "@/components/TrainingStatus";
import { translateDisease } from "@/utils/disease";

type ModelVersion = {
  version: string;
  stage: string;
  created_at: string;
  run_id: string;
  source: string;
  metrics?: {
    avg_auc?: number;
    [key: string]: any;
  };
};

export default function ModelsPage() {
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Record<string, boolean>>({});
  const [confirmVersion, setConfirmVersion] = useState<ModelVersion | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchVersions = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/model-versions`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch (e) {
      console.error("Failed to fetch model versions:", e);
      setToast({ type: "error", message: "Không thể tải danh sách phiên bản model." });
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, []);

  const promoteModel = async (version: string) => {
    setActionLoading(version);
    setConfirmVersion(null);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/model-versions/${version}/promote`;
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        setToast({ type: "success", message: `Nâng cấp Phiên bản ${version} lên Production thành công!` });
        await fetchVersions(false);
      } else {
        const err = await res.json();
        setToast({ type: "error", message: err.error || "Thao tác nâng cấp model thất bại." });
      }
    } catch (e) {
      setToast({ type: "error", message: "Lỗi kết nối khi gửi yêu cầu nâng cấp." });
    } finally {
      setActionLoading(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const getStageLabel = (stage: string) => {
    switch (stage.toLowerCase()) {
      case "production":
        return "Đang dùng";
      case "staging":
        return "Chờ duyệt";
      case "archived":
        return "Đã lưu trữ";
      default:
        return stage;
    }
  };

  const getStageBadgeClass = (stage: string) => {
    switch (stage.toLowerCase()) {
      case "production":
        return "badge-emerald";
      case "staging":
        return "badge-indigo";
      case "archived":
        return "badge-slate";
      default:
        return "badge-slate";
    }
  };

  const toggleExpand = (version: string) => {
    setExpandedVersions((prev) => ({
      ...prev,
      [version]: !prev[version],
    }));
  };

  const cleanDiseaseName = (key: string) => {
    return key.startsWith("auc_") ? key.replace("auc_", "") : key;
  };

  // Find current production model for comparison
  const productionModel = versions.find((v) => v.stage.toLowerCase() === "production");

  // Helper to extract disease metrics
  const getDiseaseMetrics = (metrics?: Record<string, any>) => {
    if (!metrics) return [];
    return Object.entries(metrics)
      .filter(([k]) => k !== "avg_auc")
      .map(([k, v]) => ({
        key: k,
        name: translateDisease(cleanDiseaseName(k)),
        value: typeof v === "number" ? v : 0,
      }));
  };

  // Format AUC display
  const formatAuc = (val?: number) => {
    if (val === undefined || val === null) return "N/A";
    return `${(val * 100).toFixed(1)}%`;
  };

  if (loading && versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
        <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
          Đang tải danh sách model versions...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      {/* Toast Alert */}
      {toast && (
        <div 
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-xs font-bold transition-all border ${
            toast.type === "success" 
              ? "bg-emerald-50 text-emerald-800 border-emerald-200" 
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {toast.type === "success" ? "✓" : "⚠️"} {toast.message}
        </div>
      )}

      {/* Top bar */}
      <div className="topbar flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="page-title flex items-center gap-2 text-xl font-bold">
            <Cpu className="w-5 h-5 text-indigo-500" />
            Quản Lý Mô Hình
          </h1>
          <p className="page-subtitle text-xs text-slate-400 mt-1">
            Giám sát các phiên bản mô hình Deep Learning DenseNet121, so sánh AUC và cập nhật Production
          </p>
        </div>
        <button
          onClick={() => fetchVersions(true)}
          className="p-2 border rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5 font-semibold text-xs text-slate-600"
          title="Làm mới"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-500" : ""}`} />
          Làm mới
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Model Registry List */}
        <div className="lg:col-span-8 space-y-6">
          <div className="chart-card bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              📦 Sổ đăng ký mô hình (MLflow) - xray-model
            </h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border-medium)", color: "var(--text-muted)" }}>
                    <th className="pb-3 w-8"></th>
                    <th className="pb-3 font-semibold">Phiên bản</th>
                    <th className="pb-3 font-semibold">Trạng thái</th>
                    <th className="pb-3 font-semibold">Thời gian train</th>
                    <th className="pb-3 font-semibold text-center">AUC Trung Bình</th>
                    <th className="pb-3 font-semibold text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => {
                    const isProd = v.stage.toLowerCase() === "production";
                    const isStaging = v.stage.toLowerCase() === "staging";
                    const isExpanded = !!expandedVersions[v.version];
                    
                    return (
                      <>
                        <tr 
                          key={v.version} 
                          className="hover:bg-slate-50/40 transition-colors"
                          style={{ borderBottom: isExpanded ? "none" : "1px solid var(--border-light)" }}
                        >
                          <td className="py-4 pl-1">
                            <button 
                              onClick={() => toggleExpand(v.version)}
                              className="p-1 rounded hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </td>
                          <td className="py-4 font-bold" style={{ color: "var(--text-primary)" }}>
                            Version {v.version}
                          </td>
                          <td className="py-4">
                            <span className={`badge ${getStageBadgeClass(v.stage)} text-[10px]`}>
                              {getStageLabel(v.stage)}
                            </span>
                          </td>
                          <td className="py-4" style={{ color: "var(--text-muted)" }}>
                            {new Date(v.created_at).toLocaleString("vi-VN")}
                          </td>
                          <td className="py-4 text-center font-bold tabular-nums" style={{ color: "var(--text-secondary)" }}>
                            {formatAuc(v.metrics?.avg_auc)}
                          </td>
                          <td className="py-4 text-right">
                            {isStaging && (
                              <button
                                disabled={actionLoading === v.version}
                                onClick={() => setConfirmVersion(v)}
                                className="btn-primary text-[10px] hover:scale-105 active:scale-95 transition-all"
                                style={{ padding: "5px 10px" }}
                              >
                                Đưa vào Production
                              </button>
                            )}
                            {isProd && (
                              <span className="text-[10px] font-bold text-emerald-600 flex items-center justify-end gap-1">
                                <Check className="w-3.5 h-3.5" /> Đang hoạt động
                              </span>
                            )}
                            {!isProd && !isStaging && (
                              <span className="text-[10px] text-slate-400">Đã lưu trữ</span>
                            )}
                          </td>
                        </tr>

                        {/* Collapsible AUC details per disease */}
                        {isExpanded && (
                          <tr key={`${v.version}-details`} style={{ borderBottom: "1px solid var(--border-light)" }}>
                            <td colSpan={6} className="bg-slate-50/50 p-4">
                              <div className="space-y-3 animate-fadeIn">
                                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                  Chi tiết AUC theo từng bệnh lý:
                                </h4>
                                {getDiseaseMetrics(v.metrics).length > 0 ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                    {getDiseaseMetrics(v.metrics).map((m) => {
                                      const colorClass = m.value >= 0.8 
                                        ? "bg-emerald-500" 
                                        : m.value >= 0.6 
                                          ? "bg-indigo-500" 
                                          : "bg-rose-500";
                                      return (
                                        <div key={m.key} className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm space-y-1">
                                          <div className="flex justify-between font-semibold text-[11px]">
                                            <span className="text-slate-600 truncate mr-2">{m.name}</span>
                                            <span className="text-slate-800 font-bold tabular-nums">{(m.value * 100).toFixed(0)}%</span>
                                          </div>
                                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                            <div 
                                              className={`h-1.5 rounded-full ${colorClass}`}
                                              style={{ width: `${m.value * 100}%` }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-400 italic">Mô hình chưa cập nhật hoặc không có dữ liệu chi tiết AUC của từng bệnh.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {versions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center" style={{ color: "var(--text-muted)" }}>
                        Chưa đăng ký phiên bản nào trong MLflow Registry.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fine-tuning Status and trigger */}
          <TrainingStatus versions={versions} />
        </div>

        {/* Right column: Current Active Production Model details */}
        <div className="lg:col-span-4 space-y-6">
          <div 
            className="chart-card space-y-4 shadow-md rounded-2xl p-6" 
            style={{ background: "var(--grad-indigo)", border: "none" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Award className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Mô hình Hoạt động</h4>
                <p className="text-[11px] text-indigo-100">Đang trực tiếp xử lý các ca quét</p>
              </div>
            </div>

            {productionModel ? (
              <div className="space-y-3 text-white pt-2">
                <div className="flex justify-between items-end">
                  <span className="text-[11px] text-indigo-100">Phiên bản hiện tại:</span>
                  <span className="text-xl font-bold">Version {productionModel.version}</span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[11px] text-indigo-100">AUC Trung bình:</span>
                  <span className="text-xl font-bold tabular-nums">
                    {formatAuc(productionModel.metrics?.avg_auc)}
                  </span>
                </div>
                
                {getDiseaseMetrics(productionModel.metrics).length > 0 && (
                  <div className="space-y-2 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                    <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-wide">Chi tiết AUC theo bệnh lý:</p>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-indigo-50 font-medium">
                      {getDiseaseMetrics(productionModel.metrics).slice(0, 6).map((m) => (
                        <div key={m.key} className="flex justify-between">
                          <span className="opacity-80 truncate mr-2">{m.name}:</span>
                          <span className="font-bold tabular-nums">{(m.value * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-indigo-100 text-xs py-4">
                Chưa cấu hình model Production trên MLflow. Đang sử dụng mô hình TorchXRayVision DenseNet121 mặc định (weights: densenet121-res224-all).
              </div>
            )}
          </div>

          <div className="chart-card space-y-3 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h4 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-primary)" }}>
              💡 Vòng đời Model Fine-tuning
            </h4>
            <div className="space-y-3 text-xs" style={{ color: "var(--text-secondary)" }}>
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center flex-shrink-0">1</div>
                <p>Bác sĩ phê duyệt ảnh chẩn đoán tại trang <strong>Review</strong>. Ảnh được lưu vào bucket training.</p>
              </div>
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center flex-shrink-0">2</div>
                <p>Cuối tuần, Airflow tự động gom dữ liệu, upload lên Kaggle và trigger Job Fine-tune mô hình.</p>
              </div>
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center flex-shrink-0">3</div>
                <p>Mô hình mới được sinh ra, tự động log AUC vào <strong>MLflow</strong> và đăng ký ở trạng thái <strong>Chờ duyệt (Staging)</strong>.</p>
              </div>
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center flex-shrink-0">4</div>
                <p>Quản trị viên click <strong>Đưa vào Production</strong> để cập nhật nóng model chạy chính, phục vụ các ca quét tiếp theo.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl border border-slate-100 animate-scaleUp">
            {/* Header */}
            <div className="p-6 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white">
              <h3 className="text-base font-bold flex items-center gap-2">
                🚀 Xác nhận đưa mô hình lên Production
              </h3>
              <p className="text-[11px] text-indigo-100 mt-1">
                Bạn sắp cập nhật phiên bản hoạt động chính từ 
                <strong> Version {productionModel?.version || "Mặc định"}</strong> sang 
                <strong> Version {confirmVersion.version}</strong>.
              </p>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4 max-h-[350px] overflow-y-auto">
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  So sánh hiệu suất AUC:
                </h4>
                
                {/* Average AUC comparison */}
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-slate-600">AUC Trung Bình</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Chỉ số đánh giá chung</p>
                  </div>
                  <div className="flex items-center gap-3 font-bold">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-normal">Hiện tại</span>
                      <span className="text-xs text-slate-700">{formatAuc(productionModel?.metrics?.avg_auc)}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                    <div className="text-right">
                      <span className="text-[10px] text-indigo-500 block font-normal">Phiên bản mới</span>
                      <span className="text-sm text-indigo-600 font-extrabold">{formatAuc(confirmVersion.metrics?.avg_auc)}</span>
                    </div>
                  </div>
                </div>

                {/* Per-disease AUC comparison */}
                <div className="space-y-2.5 pt-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Hiệu suất chi tiết từng bệnh:
                  </p>
                  
                  {getDiseaseMetrics(confirmVersion.metrics).length > 0 ? (
                    <div className="space-y-2">
                      {getDiseaseMetrics(confirmVersion.metrics).map((newM) => {
                        const currentVal = productionModel?.metrics?.[newM.key] ?? 0.81; // 0.81 default if not present
                        const diff = newM.value - currentVal;
                        const diffText = diff >= 0 ? `+${(diff * 100).toFixed(0)}%` : `${(diff * 100).toFixed(0)}%`;
                        const diffColor = diff >= 0 ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50";

                        return (
                          <div 
                            key={newM.key} 
                            className="flex justify-between items-center text-[11px] py-1.5 border-b border-dashed border-slate-100 last:border-0"
                          >
                            <span className="text-slate-600 font-medium truncate max-w-[150px]">
                              {newM.name}
                            </span>
                            <div className="flex items-center gap-2.5">
                              <span className="text-slate-400 font-medium">{productionModel ? `(V${productionModel.version})` : ""} {(currentVal * 100).toFixed(0)}%</span>
                              <ChevronRight className="w-3 h-3 text-slate-300" />
                              <span className="font-bold text-slate-800">{(newM.value * 100).toFixed(0)}%</span>
                              {productionModel && (
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold tabular-nums ${diffColor}`}>
                                  {diffText}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Không có dữ liệu chi tiết của phiên bản này.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="bg-slate-50 px-6 py-4 flex items-center justify-end gap-3 border-t border-slate-100">
              <button
                onClick={() => setConfirmVersion(null)}
                className="py-2 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all"
              >
                Hủy
              </button>
              <button
                onClick={() => promoteModel(confirmVersion.version)}
                className="py-2 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all hover:scale-105 active:scale-95"
              >
                Xác nhận nâng cấp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

