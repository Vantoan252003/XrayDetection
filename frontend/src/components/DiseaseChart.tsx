"use client";

import { translateDisease } from "@/utils/disease";

type DiseaseData = {
  disease: string;
  count: number;
  percentage: number;
};

type Props = {
  data: DiseaseData[];
  size?: number;
};

const COLORS = [
  "#6366f1","#10b981","#f59e0b","#f43f5e","#0ea5e9",
  "#8b5cf6","#14b8a6","#ef4444","#ec4899","#84cc16",
  "#06b6d4","#f97316","#a855f7","#22c55e",
];

export default function DiseaseChart({ data, size = 200 }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48" style={{ color: "var(--text-muted)" }}>
        <p className="text-sm">Chưa có dữ liệu</p>
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.count, 0);
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 6, r = R * 0.6;

  let cumAngle = -90;
  const arcs = data.map((d, i) => {
    const angle = (d.count / total) * 360;
    const s = cumAngle, e = cumAngle + angle;
    cumAngle += angle;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const x1 = cx + R * Math.cos(toRad(s)), y1 = cy + R * Math.sin(toRad(s));
    const x2 = cx + R * Math.cos(toRad(e)), y2 = cy + R * Math.sin(toRad(e));
    const ix1 = cx + r * Math.cos(toRad(e)), iy1 = cy + r * Math.sin(toRad(e));
    const ix2 = cx + r * Math.cos(toRad(s)), iy2 = cy + r * Math.sin(toRad(s));
    const la = angle > 180 ? 1 : 0;
    const path = `M${x1},${y1} A${R},${R} 0 ${la} 1 ${x2},${y2} L${ix1},${iy1} A${r},${r} 0 ${la} 0 ${ix2},${iy2} Z`;
    return { ...d, path, color: COLORS[i % COLORS.length] };
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {arcs.map((arc, i) => (
            <path
              key={i}
              d={arc.path}
              fill={arc.color}
              stroke="white"
              strokeWidth="2.5"
              opacity="0.9"
              className="transition-opacity hover:opacity-100"
              style={{ cursor: "pointer" }}
            >
              <title>{translateDisease(arc.disease)}: {arc.count.toLocaleString()} ({arc.percentage}%)</title>
            </path>
          ))}
          {/* Center */}
          <circle cx={cx} cy={cy} r={r - 2} fill="white" />
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="800" fill="#0f172a" fontFamily="Inter,sans-serif">
            {total >= 1000 ? (total / 1000).toFixed(1) + "K" : total}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="Inter,sans-serif">
            total scans
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 w-full">
        {arcs.slice(0, 10).map((arc, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: arc.color }} />
            <span className="truncate flex-1" style={{ color: "var(--text-secondary)" }}>{translateDisease(arc.disease)}</span>
            <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{arc.percentage}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
