"use client";

import { useEffect, useState } from "react";
import { Play, Loader2, CheckCircle, AlertCircle, RefreshCw, Cpu, Cloud } from "lucide-react";

type TrainStatusResponse = {
  status: string;
  mode: string;
  progress: number;
  error_message?: string | null;
  notebook_ref?: string;
  is_running?: boolean;
  message?: string;
};

export default function TrainingStatus() {
  const [status, setStatus] = useState<TrainStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/training/status`;
      const res = await fetch(url);
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch training status:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Tự động reload status mỗi 10 giây nếu đang chạy
    const interval = setInterval(() => {
      if (status?.is_running) {
        fetchStatus();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [status?.is_running]);

  const triggerTraining = async () => {
    setTriggerLoading(true);
    setMsg(null);
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/training/trigger`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMsg(`Đã gửi yêu cầu chạy fine-tuning (${status?.mode === 'local' ? 'Local' : 'Kaggle'}). Sẵn sàng: ${data.ready_scans} ảnh.`);
        fetchStatus();
      } else {
        setMsg(`Lỗi: ${data.detail || data.message || "Không thể trigger training."}`);
      }
    } catch (e) {
      setMsg("Lỗi kết nối khi gửi yêu cầu.");
    } finally {
      setTriggerLoading(false);
    }
  };

  return (
    <div className="chart-card space-y-4">
      <div className="flex justify-between items-center pb-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
        <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          ⚙️ Trạng thái huấn luyện (Fine-tuning)
        </h3>
        <button onClick={fetchStatus} disabled={loading} className="p-1 rounded-md hover:bg-slate-100 transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-500" : ""}`} />
        </button>
      </div>

      {status && (
        <div className="flex flex-col gap-3">
          {/* Training Mode & Status Badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              {status.mode === "local" ? (
                <>
                  <Cpu className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Chế độ: <strong className="text-emerald-600">LOCAL (Bảo mật)</strong></span>
                </>
              ) : (
                <>
                  <Cloud className="w-3.5 h-3.5 text-blue-500" />
                  <span>Chế độ: <strong className="text-blue-600">KAGGLE (Cloud)</strong></span>
                </>
              )}
            </div>
            
            <span 
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full`}
              style={{
                background: status.is_running ? "var(--rose-50)" : status.status === "complete" ? "var(--emerald-50)" : status.status === "error" ? "var(--rose-50)" : "var(--bg-subtle)",
                color: status.is_running ? "var(--rose-600)" : status.status === "complete" ? "var(--emerald-600)" : status.status === "error" ? "var(--rose-600)" : "var(--text-secondary)",
              }}
            >
              {status.status.toUpperCase()}
            </span>
          </div>

          {status.notebook_ref && status.mode === "kaggle" && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Kaggle Notebook Slug: <strong>{status.notebook_ref}</strong>
            </p>
          )}

          {status.is_running && (
            <div className="flex flex-col gap-2 py-2 px-3 bg-rose-50/30 rounded-xl border border-rose-100/50">
              <div className="flex items-center gap-2 text-xs">
                <Loader2 className="w-4 h-4 animate-spin text-rose-500 flex-shrink-0" />
                <p className="text-rose-600 font-medium">
                  {status.mode === "local" 
                    ? "Đang huấn luyện cục bộ bằng PyTorch (Classifier-only)..." 
                    : "Đang huấn luyện trên GPU của Kaggle (Quá trình có thể tốn 10 - 20 phút)..."
                  }
                </p>
              </div>
              
              {/* Progress Bar for Local Mode */}
              <div className="w-full bg-slate-100 rounded-full h-2 mt-1 overflow-hidden">
                <div 
                  className="bg-rose-500 h-2 transition-all duration-500"
                  style={{ width: `${status.progress || 0}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-[10px] text-rose-500 font-bold">
                <span>Tiến trình</span>
                <span>{status.progress || 0}%</span>
              </div>
            </div>
          )}

          {status.error_message && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-xl border border-rose-100 text-[11px] text-rose-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Lỗi huấn luyện:</strong>
                <p className="break-all">{status.error_message}</p>
              </div>
            </div>
          )}

          {!status.is_running && (
            <div className="flex justify-between items-center pt-2">
              <p className="text-[11px]" style={{ color: "var(--text-muted)", maxWidth: "70%" }}>
                {status.mode === "local" 
                  ? "Dữ liệu được huấn luyện an toàn, không rời khỏi hệ thống mạng nội bộ."
                  : "Dữ liệu sẽ được đẩy lên Kaggle thông qua Dataset API bảo mật."
                }
              </p>
              <button 
                onClick={triggerTraining} 
                disabled={triggerLoading} 
                className="btn-primary flex items-center gap-1 text-xs" 
                style={{ padding: "6px 12px" }}
              >
                {triggerLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Trigger Train Job
              </button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div 
          className="flex items-center gap-2 p-3 rounded-xl text-xs"
          style={{
            background: msg.startsWith("Lỗi") ? "var(--rose-50)" : "var(--emerald-50)",
            border: `1px solid ${msg.startsWith("Lỗi") ? "var(--rose-100)" : "var(--emerald-100)"}`,
            color: msg.startsWith("Lỗi") ? "var(--rose-600)" : "var(--emerald-600)",
          }}
        >
          {msg.startsWith("Lỗi") ? <AlertCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle className="w-4 h-4 flex-shrink-0" />}
          <p>{msg}</p>
        </div>
      )}
    </div>
  );
}
