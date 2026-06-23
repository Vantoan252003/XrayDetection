"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  BarChart3,
  FileText,
  Activity,
  Stethoscope,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload",    label: "Upload X-Ray",    icon: Upload },
  { href: "/analytics", label: "Phân tích",      icon: BarChart3 },
  { href: "/reports",   label: "Spark Reports",  icon: FileText },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="sidebar">
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--border-light)" }}>
        <Link href="/dashboard" className="flex items-center gap-3 no-underline">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0"
            style={{ background: "var(--grad-indigo)" }}
          >
            <Stethoscope className="w-[18px] h-[18px] text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight leading-tight" style={{ color: "var(--text-primary)" }}>
              XRay Platform
            </h1>
            <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--text-muted)" }}>
              Data Engineering v2
            </p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <div className="flex-1 py-4 space-y-0.5">
        <p className="px-5 text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
          Navigation
        </p>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`sidebar-link ${isActive ? "active" : ""}`}>
              <Icon className="w-[17px] h-[17px] flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: "1px solid var(--border-light)" }}>
        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: "var(--emerald-50)" }}
        >
          <div className="pulse-dot" />
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--emerald-600)" }}>System Online</p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>All services running</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
