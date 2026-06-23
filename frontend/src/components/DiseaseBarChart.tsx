"use client";

import { translateDisease } from "@/utils/disease";

const COLORS = [
  "#6366f1","#10b981","#f59e0b","#f43f5e","#0ea5e9",
  "#8b5cf6","#14b8a6","#ef4444","#ec4899","#84cc16",
];

type DiseaseData = {
  disease: string;
  count: number;
  percentage: number;
};

type Props = {
  data: DiseaseData[];
  maxItems?: number;
};

export default function DiseaseBarChart({ data, maxItems = 10 }: Props) {
  const items = data.slice(0, maxItems);
  const maxCount = Math.max(...items.map(d => d.count), 1);

  if (!items.length) {
    return (
      <div className="flex items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
        <p className="text-sm">Chưa có dữ liệu</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((d, i) => (
        <div key={d.disease} className="group">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="text-sm font-medium truncate max-w-[140px]" style={{ color: "var(--text-primary)" }}>
                {translateDisease(d.disease)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {d.count.toLocaleString("vi-VN")}
              </span>
              <span
                className="text-xs font-semibold w-10 text-right tabular-nums"
                style={{ color: COLORS[i % COLORS.length] }}
              >
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
      ))}
    </div>
  );
}
