"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

type Props = {
  title: string;
  value: number;
  suffix?: string;
  prefix?: string;
  trend?: number;
  icon: React.ReactNode;
  color: "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet" | "teal";
  live?: boolean;
  formatNumber?: boolean;
  description?: string;
};

export default function LiveMetricCard({
  title, value, suffix = "", prefix = "",
  trend, icon, color, live = false,
  formatNumber = true, description,
}: Props) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 1000;
    const start = Date.now();
    const from = displayValue;
    const raf = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplayValue(Math.round(from + (value - from) * ease));
      if (t < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (n: number) => {
    if (!formatNumber) return n.toString();
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString("vi-VN");
  };

  return (
    <div className={`metric-card ${color}`}>
      {/* Icon */}
      <div className="flex items-start justify-between mb-3">
        <div className="icon-wrap">{icon}</div>
        {live && (
          <div className="flex items-center gap-1.5">
            <div className="pulse-dot" style={{ width: 7, height: 7 }} />
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--emerald-500)" }}>Live</span>
          </div>
        )}
      </div>

      {/* Value */}
      <div className="mb-1">
        <span className="text-3xl font-extrabold tracking-tight" style={{ color: "var(--text-primary)" }}>
          {prefix}{fmt(displayValue)}{suffix && <span className="text-lg font-medium ml-1" style={{ color: "var(--text-muted)" }}>{suffix}</span>}
        </span>
      </div>

      {/* Label + Trend */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>{title}</p>
        {trend !== undefined && (
          <span className={`flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full ${
            trend >= 0
              ? "text-emerald-600 bg-emerald-50"
              : "text-rose-500 bg-rose-50"
          }`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {description && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{description}</p>
      )}
    </div>
  );
}
