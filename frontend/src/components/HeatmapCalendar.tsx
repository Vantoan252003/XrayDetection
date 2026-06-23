"use client";

type DayData = {
  date: string;
  count: number;
};

type Props = {
  data: DayData[];
  weeks?: number;
};

export default function HeatmapCalendar({ data, weeks = 15 }: Props) {
  const cellSize = 14;
  const gap = 3;
  const labelW = 28;

  // Build date map
  const countMap = new Map<string, number>();
  data.forEach((d) => countMap.set(d.date, d.count));

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // Generate grid — last N weeks
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (weeks * 7 + dayOfWeek));

  const cells: Array<{
    date: string;
    count: number;
    x: number;
    y: number;
    weekIdx: number;
    dayIdx: number;
  }> = [];

  const current = new Date(startDate);
  while (current <= today) {
    const dateStr = current.toISOString().split("T")[0];
    const count = countMap.get(dateStr) || 0;
    const daysSinceStart = Math.floor(
      (current.getTime() - startDate.getTime()) / 86400000
    );
    const weekIdx = Math.floor(daysSinceStart / 7);
    const dayIdx = current.getDay();

    cells.push({
      date: dateStr,
      count,
      x: labelW + weekIdx * (cellSize + gap),
      y: dayIdx * (cellSize + gap),
      weekIdx,
      dayIdx,
    });

    current.setDate(current.getDate() + 1);
  }

  const svgW = labelW + (weeks + 1) * (cellSize + gap);
  const svgH = 7 * (cellSize + gap);

  const getColor = (count: number): string => {
    if (count === 0) return "rgba(148,163,184,0.06)";
    const intensity = count / maxCount;
    if (intensity < 0.25) return "rgba(99,102,241,0.2)";
    if (intensity < 0.50) return "rgba(99,102,241,0.4)";
    if (intensity < 0.75) return "rgba(99,102,241,0.65)";
    return "rgba(99,102,241,0.9)";
  };

  const dayLabels = ["", "T2", "", "T4", "", "T6", ""];

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH + 4} viewBox={`0 0 ${svgW} ${svgH + 4}`}>
        {/* Day labels */}
        {dayLabels.map(
          (label, i) =>
            label && (
              <text
                key={i}
                x={0}
                y={i * (cellSize + gap) + cellSize - 2}
                fontSize="9"
                fill="#64748b"
                fontFamily="Inter, sans-serif"
              >
                {label}
              </text>
            )
        )}

        {/* Cells */}
        {cells.map((cell, i) => (
          <rect
            key={i}
            x={cell.x}
            y={cell.y}
            width={cellSize}
            height={cellSize}
            rx="3"
            fill={getColor(cell.count)}
            className="transition-all duration-150 hover:stroke-indigo-400 hover:stroke-1"
          >
            <title>
              {cell.date}: {cell.count} scans
            </title>
          </rect>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-500">
        <span>Ít</span>
        {[0, 0.25, 0.5, 0.75, 1].map((intensity, i) => (
          <div
            key={i}
            className="w-3 h-3 rounded-sm"
            style={{
              background:
                intensity === 0
                  ? "rgba(148,163,184,0.06)"
                  : `rgba(99,102,241,${0.2 + intensity * 0.7})`,
            }}
          />
        ))}
        <span>Nhiều</span>
      </div>
    </div>
  );
}
