"use client";

type Props = {
  avgMs: number;
  maxMs?: number;
  p95Ms?: number;
  p99Ms?: number;
};

export default function ProcessingTimeGauge({
  avgMs,
  maxMs = 10000,
  p95Ms,
  p99Ms,
}: Props) {
  const size = 180;
  const cx = size / 2;
  const cy = size / 2 + 10;
  const radius = 72;
  const strokeWidth = 12;

  // Arc from -210° to 30° (240° total sweep)
  const startAngle = -210;
  const endAngle = 30;
  const totalSweep = endAngle - startAngle;

  // Clamp value
  const clampedAvg = Math.min(avgMs, maxMs);
  const progress = clampedAvg / maxMs;
  const currentAngle = startAngle + progress * totalSweep;

  // Convert angle to radians for SVG
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const arcPath = (startDeg: number, endDeg: number, r: number) => {
    const x1 = cx + r * Math.cos(toRad(startDeg));
    const y1 = cy + r * Math.sin(toRad(startDeg));
    const x2 = cx + r * Math.cos(toRad(endDeg));
    const y2 = cy + r * Math.sin(toRad(endDeg));
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Color based on performance
  const getColor = () => {
    if (avgMs < 2000) return "#34d399"; // green
    if (avgMs < 4000) return "#fbbf24"; // amber
    return "#fb7185"; // red
  };

  const color = getColor();

  // Needle position
  const needleAngle = toRad(currentAngle);
  const needleLen = radius - 20;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy + needleLen * Math.sin(needleAngle);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size - 10} viewBox={`0 0 ${size} ${size - 10}`}>
        {/* Background arc */}
        <path
          d={arcPath(startAngle, endAngle, radius)}
          fill="none"
          stroke="rgba(148,163,184,0.1)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Value arc */}
        <path
          d={arcPath(startAngle, currentAngle, radius)}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 8px ${color}40)`,
            transition: "all 1s ease-out",
          }}
        />

        {/* Tick marks */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const angle = toRad(startAngle + pct * totalSweep);
          const x1 = cx + (radius + 8) * Math.cos(angle);
          const y1 = cy + (radius + 8) * Math.sin(angle);
          const x2 = cx + (radius + 14) * Math.cos(angle);
          const y2 = cy + (radius + 14) * Math.sin(angle);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          );
        })}

        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ transition: "all 1s ease-out" }}
        />
        <circle cx={cx} cy={cy} r="5" fill={color} />
        <circle cx={cx} cy={cy} r="2.5" fill="var(--bg-card)" />

        {/* Center value */}
        <text
          x={cx}
          y={cy + 28}
          textAnchor="middle"
          fontSize="22"
          fontWeight="800"
          fill="white"
          fontFamily="Inter, sans-serif"
        >
          {avgMs < 1000 ? `${avgMs}ms` : `${(avgMs / 1000).toFixed(1)}s`}
        </text>
        <text
          x={cx}
          y={cy + 42}
          textAnchor="middle"
          fontSize="9"
          fill="#64748b"
          fontFamily="Inter, sans-serif"
        >
          AVG PROCESSING
        </text>

        {/* Min/Max labels */}
        <text
          x={cx - radius - 4}
          y={cy + 18}
          textAnchor="middle"
          fontSize="8"
          fill="#64748b"
          fontFamily="Inter, sans-serif"
        >
          0s
        </text>
        <text
          x={cx + radius + 4}
          y={cy + 18}
          textAnchor="middle"
          fontSize="8"
          fill="#64748b"
          fontFamily="Inter, sans-serif"
        >
          {maxMs / 1000}s
        </text>
      </svg>

      {/* P95/P99 stats */}
      {(p95Ms || p99Ms) && (
        <div className="flex gap-4 mt-1">
          {p95Ms !== undefined && (
            <div className="text-center">
              <p className="text-xs text-slate-500">P95</p>
              <p className="text-sm font-bold text-slate-300">
                {(p95Ms / 1000).toFixed(1)}s
              </p>
            </div>
          )}
          {p99Ms !== undefined && (
            <div className="text-center">
              <p className="text-xs text-slate-500">P99</p>
              <p className="text-sm font-bold text-slate-300">
                {(p99Ms / 1000).toFixed(1)}s
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
