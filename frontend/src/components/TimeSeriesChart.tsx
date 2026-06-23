"use client";

type TimePoint = {
  time: string;
  total: number;
  normal: number;
  abnormal: number;
};

type Props = {
  data: TimePoint[];
  height?: number;
};

export default function TimeSeriesChart({ data, height = 240 }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height, color: "var(--text-muted)" }}>
        <p className="text-sm">Chưa có dữ liệu</p>
      </div>
    );
  }

  const pad = { top: 16, right: 16, bottom: 40, left: 48 };
  const W = 680, H = height;
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  const maxV = Math.max(...data.map(d => d.total), 1);
  const roundMax = Math.ceil(maxV / 5) * 5 || 5;

  const xS = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * cW;
  const yS = (v: number) => pad.top + cH - (v / roundMax) * cH;

  const linePath = (key: "total" | "abnormal") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${xS(i)},${yS(d[key])}`).join(" ");

  const areaPath = (key: "total" | "abnormal") => {
    const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${xS(i)},${yS(d[key])}`).join(" ");
    return `${line} L${xS(data.length - 1)},${yS(0)} L${xS(0)},${yS(0)} Z`;
  };

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    v: Math.round(roundMax * pct),
    y: yS(Math.round(roundMax * pct)),
  }));

  const step = Math.max(1, Math.floor(data.length / 7));
  const labels = data
    .map((d, i) => ({ i, d }))
    .filter(({ i }) => i % step === 0 || i === data.length - 1)
    .map(({ i, d }) => {
      const dt = new Date(d.time);
      return { x: xS(i), label: `${dt.getHours().toString().padStart(2,"0")}:${dt.getMinutes().toString().padStart(2,"0")}` };
    });

  return (
    <div>
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 rounded" style={{ background: "#6366f1" }} />
          <span>Tổng</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 rounded" style={{ background: "#f43f5e", borderTop: "2px dashed #f43f5e" }} />
          <span>Bất thường</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
        <defs>
          <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#6366f1" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
          </linearGradient>
          <linearGradient id="gradAbnormal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f43f5e" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={pad.left} y1={g.y} x2={W - pad.right} y2={g.y}
              stroke="#e2e8f0" strokeWidth="1" strokeDasharray={i === 0 ? "0" : "4 4"} />
            <text x={pad.left - 8} y={g.y + 4} textAnchor="end" fontSize="10"
              fill="#94a3b8" fontFamily="Inter,sans-serif">{g.v}</text>
          </g>
        ))}

        {/* Areas */}
        <path d={areaPath("total")}    fill="url(#gradTotal)"    />
        <path d={areaPath("abnormal")} fill="url(#gradAbnormal)" />

        {/* Lines */}
        <path d={linePath("total")}    fill="none" stroke="#6366f1" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />
        <path d={linePath("abnormal")} fill="none" stroke="#f43f5e" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6 3" />

        {/* Dots for total (if not too many) */}
        {data.length <= 50 && data.map((d, i) => (
          <circle key={i} cx={xS(i)} cy={yS(d.total)} r="3"
            fill="white" stroke="#6366f1" strokeWidth="2"
            style={{ opacity: 0 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0")}
          >
            <title>{new Date(d.time).toLocaleString("vi-VN")}: {d.total} scans</title>
          </circle>
        ))}

        {/* X labels */}
        {labels.map((l, i) => (
          <text key={i} x={l.x} y={H - 8} textAnchor="middle" fontSize="10"
            fill="#94a3b8" fontFamily="Inter,sans-serif">{l.label}</text>
        ))}
      </svg>
    </div>
  );
}
