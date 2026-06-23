"use client";

import { CheckCircle2, XCircle, Wifi } from "lucide-react";

type ServiceStatus = { status: string; error?: string };

const SVC_META: Record<string, { label: string; emoji: string }> = {
  postgres: { label: "PostgreSQL",     emoji: "🐘" },
  minio:    { label: "MinIO (S3)",      emoji: "💾" },
  kafka:    { label: "Apache Kafka",    emoji: "⚡" },
  redis:    { label: "Redis Cache",     emoji: "🔴" },
};

export default function SystemHealth({
  services,
  websocketClients = 0,
}: {
  services: Record<string, ServiceStatus>;
  websocketClients?: number;
}) {
  const upCount = Object.values(services).filter(s => s.status === "up").length;
  const total   = Object.keys(services).length;

  return (
    <div>
      {/* Summary */}
      <div
        className="flex items-center justify-between mb-3 px-3 py-2.5 rounded-xl"
        style={{ background: upCount === total ? "var(--emerald-50)" : "var(--amber-50)" }}
      >
        <div className="flex items-center gap-2">
          <div className="pulse-dot" style={{ background: upCount === total ? "var(--emerald-500)" : "var(--amber-500)" }} />
          <span className="text-sm font-semibold" style={{ color: upCount === total ? "var(--emerald-600)" : "var(--amber-600)" }}>
            {upCount}/{total} dịch vụ hoạt động
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          <Wifi className="w-3.5 h-3.5" />
          <span>{websocketClients} clients</span>
        </div>
      </div>

      {/* Service list */}
      <div className="space-y-1">
        {Object.entries(services).map(([key, svc]) => {
          const meta = SVC_META[key] || { label: key, emoji: "🔧" };
          const isUp = svc.status === "up";
          return (
            <div
              key={key}
              className="flex items-center justify-between px-3 py-2.5 rounded-xl"
              style={{ transition: "background 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-subtle)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">{meta.emoji}</span>
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {meta.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {isUp
                  ? <CheckCircle2 className="w-3.5 h-3.5 status-up" />
                  : <XCircle     className="w-3.5 h-3.5 status-down" />}
                <span
                  className="text-xs font-semibold"
                  style={{ color: isUp ? "var(--emerald-500)" : "var(--rose-500)" }}
                >
                  {isUp ? "Online" : "Offline"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
