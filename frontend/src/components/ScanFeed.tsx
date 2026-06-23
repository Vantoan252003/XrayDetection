"use client";

import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";

type ScanEvent = {
  scan_id: string;
  created_at: string;
  top_disease: string | null;
  is_normal: boolean;
  processing_time_ms: number;
  source: string;
  patient_id: string | null;
  status: string;
};

const srcLabel: Record<string, string> = { web: "Web", api: "API", mobile: "Mobile", batch: "Batch" };
const srcColor: Record<string, string> = {
  web:    "background:var(--indigo-100);color:var(--indigo-600)",
  api:    "background:var(--sky-100);color:var(--sky-500)",
  mobile: "background:var(--violet-50);color:#7c3aed",
  batch:  "background:var(--amber-100);color:var(--amber-600)",
};

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

import { translateDisease } from "@/utils/disease";

export default function ScanFeed({ events, maxItems = 12 }: { events: ScanEvent[]; maxItems?: number }) {
  const list = events.slice(0, maxItems);

  if (!list.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
        <Clock className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-sm">Chưa có scan nào</p>
      </div>
    );
  }

  return (
    <div>
      {list.map((ev, i) => (
        <div
          key={ev.scan_id}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl animate-fade-in"
          style={{
            animationDelay: `${i * 40}ms`,
            transition: "background 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-subtle)")}
          onMouseLeave={e => (e.currentTarget.style.background = "")}
        >
          {/* Icon */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: ev.is_normal ? "var(--emerald-50)" : "var(--amber-50)",
            }}
          >
            {ev.is_normal
              ? <CheckCircle2 className="w-4 h-4" style={{ color: "var(--emerald-500)" }} />
              : <AlertTriangle className="w-4 h-4" style={{ color: "var(--amber-500)" }} />}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {ev.is_normal ? "Bình thường" : translateDisease(ev.top_disease)}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
              #{ev.scan_id.slice(0, 8)}
              {ev.patient_id && <> · {ev.patient_id}</>}
            </p>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="badge text-[10px]"
              style={{ ...(Object.fromEntries((srcColor[ev.source] || "").split(";").map(s => { const [k,v] = s.split(":"); return [k?.trim(), v?.trim()]; }).filter(([k]) => k))) }}
            >
              {srcLabel[ev.source] || ev.source}
            </span>
            <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
              {timeAgo(ev.created_at)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
