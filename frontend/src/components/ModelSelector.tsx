"use client";

import { useEffect, useState } from "react";
import { Cpu, HelpCircle } from "lucide-react";

type ModelVersion = {
  version: string;
  stage: string;
  created_at: string;
  metrics?: {
    avg_auc?: number;
    [key: string]: any;
  };
};

interface ModelSelectorProps {
  selectedVersion: string;
  onChange: (version: string) => void;
}

export default function ModelSelector({ selectedVersion, onChange }: ModelSelectorProps) {
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/model-versions`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.versions) {
            setVersions(data.versions);
            // Tự động chọn Production model nếu có
            const prod = data.versions.find((v: ModelVersion) => v.stage.toLowerCase() === "production");
            if (prod && !selectedVersion) {
              onChange(prod.version);
            } else if (data.versions.length > 0 && !selectedVersion) {
              onChange(data.versions[0].version);
            }
          }
        }
      } catch (e) {
        console.error("Failed to fetch model versions:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchVersions();
  }, [onChange, selectedVersion]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs py-2" style={{ color: "var(--text-muted)" }}>
        <span className="animate-spin text-indigo-500">⏳</span> Đang tải các phiên bản model...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
        <Cpu className="w-3.5 h-3.5" style={{ color: "var(--indigo-500)" }} />
        Phiên bản mô hình AI
      </label>
      <div className="relative">
        <select
          value={selectedVersion}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-xl appearance-none transition-all cursor-pointer"
          style={{
            border: "1px solid var(--border-medium)",
            background: "var(--bg-card)",
            color: "var(--text-primary)",
            paddingRight: "30px",
          }}
        >
          <option value="">Production Model (Mặc định)</option>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              Version {v.version} ({v.stage}) {v.metrics?.avg_auc ? `- AUC: ${(v.metrics.avg_auc * 100).toFixed(1)}%` : ""}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-xs" style={{ color: "var(--text-muted)" }}>
          ▼
        </div>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Chọn phiên bản cụ thể của mô hình Deep Learning được huấn luyện hoặc dùng bản mặc định chạy trên môi trường Production.
      </p>
    </div>
  );
}
