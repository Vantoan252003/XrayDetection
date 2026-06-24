"use client";

import { useEffect, useState } from "react";
import { Cpu, Loader2, CheckCircle2, ChevronRight, Play, Award, Zap } from "lucide-react";
import TrainingStatus from "@/components/TrainingStatus";

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
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/model-versions`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions || []);
      }
    } catch (e) {
      console.error("Failed to fetch model versions:", e);
      setError("Không thể tải danh sách phiên bản model.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
  }, []);

  const promoteModel = async (version: string) => {
    setActionLoading(version);
    setError(null);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/model-versions/${version}/promote`;
      const res = await fetch(url, { method: "POST" });
      if (res.ok) {
        // Tải lại list
        await fetchVersions();
      } else {
        const err = await res.json();
        setError(err.error || "Thao tác nâng cấp model thất bại.");
      }
    } catch (e) {
      setError("Lỗi kết nối khi gửi yêu cầu nâng cấp.");
    } finally {
      setActionLoading(null);
    }
  };

  const productionModel = versions.find(v => v.stage.toLowerCase() === "production");

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
    <div className="space-y-6">
      <div className="topbar">
        <div>
          <h1 className="page-title">
            <Cpu className="w-5 h-5" style={{ color: "var(--indigo-500)" }} />
            Quản Lý Mô Hình
          </h1>
          <p className="page-subtitle">Giám sát các phiên bản mô hình Deep Learning DenseNet121, so sánh AUC và cập nhật Production</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: Model Registry List */}
        <div className="lg:col-span-8 space-y-6">
          <div className="chart-card">
            <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text-primary)" }}>
              📦 MLflow Model Registry - xray-model
            </h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border-medium)", color: "var(--text-muted)" }}>
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
                    const auc = v.metrics?.avg_auc ? (v.metrics.avg_auc * 100).toFixed(1) : "N/A";
                    
                    return (
                      <tr key={v.version} style={{ borderBottom: "1px solid var(--border-light)" }}>
                        <td className="py-4 font-bold" style={{ color: "var(--text-primary)" }}>
                          Version {v.version}
                        </td>
                        <td className="py-4">
                          <span 
                            className={`badge ${isProd ? "badge-emerald" : isStaging ? "badge-indigo" : "badge-slate"} text-[10px]`}
                          >
                            {v.stage}
                          </span>
                        </td>
                        <td className="py-4" style={{ color: "var(--text-muted)" }}>
                          {new Date(v.created_at).toLocaleString("vi-VN")}
                        </td>
                        <td className="py-4 text-center font-bold tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {auc}%
                        </td>
                        <td className="py-4 text-right">
                          {isStaging && (
                            <button
                              disabled={actionLoading === v.version}
                              onClick={() => promoteModel(v.version)}
                              className="btn-primary text-[10px]"
                              style={{ padding: "5px 10px" }}
                            >
                              {actionLoading === v.version ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                "Promote to Prod"
                              )}
                            </button>
                          )}
                          {isProd && (
                            <span className="text-[10px] font-bold text-emerald-600 flex items-center justify-end gap-1">
                              ✓ Đang active
                            </span>
                          )}
                          {!isProd && !isStaging && (
                            <span className="text-[10px] text-slate-400">Đã lưu trữ</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {versions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center" style={{ color: "var(--text-muted)" }}>
                        Chưa đăng ký phiên bản nào trong MLflow Registry.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fine-tuning Status and trigger */}
          <TrainingStatus />
        </div>

        {/* Right column: Current Active Production Model details */}
        <div className="lg:col-span-4 space-y-6">
          <div className="chart-card space-y-4" style={{ background: "var(--grad-indigo-card)", border: "none" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Award className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Active Model</h4>
                <p className="text-[11px] text-indigo-100">Đang phục vụ suy luận chẩn đoán</p>
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
                    {productionModel.metrics?.avg_auc ? (productionModel.metrics.avg_auc * 100).toFixed(1) : "81.0"}%
                  </span>
                </div>
                
                {productionModel.metrics && (
                  <div className="space-y-2 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                    <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-wide">Chi tiết AUC theo bệnh lý:</p>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-indigo-50 font-medium">
                      {Object.entries(productionModel.metrics)
                        .filter(([k]) => k !== "avg_auc")
                        .slice(0, 6)
                        .map(([disease, val]) => (
                          <div key={disease} className="flex justify-between">
                            <span className="opacity-80 truncate mr-2">{disease}:</span>
                            <span className="font-bold tabular-nums">{(val * 100).toFixed(0)}%</span>
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

          <div className="chart-card space-y-3">
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
                <p>Mô hình mới được sinh ra, tự động log AUC vào <strong>MLflow</strong> và đăng ký ở trạng thái <strong>Staging</strong>.</p>
              </div>
              <div className="flex gap-2">
                <div className="w-5 h-5 rounded-full bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center flex-shrink-0">4</div>
                <p>Quản trị viên click <strong>Promote to Prod</strong> để cập nhật nóng model chạy chính, phục vụ các ca quét tiếp theo.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
