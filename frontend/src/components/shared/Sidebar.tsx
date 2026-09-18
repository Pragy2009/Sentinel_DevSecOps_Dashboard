"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, LayoutDashboard, GitBranch, Search, FileCode, Settings, LogOut, ChevronRight, FileBarChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import Image from "next/image";

const NAV = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "Repositories", icon: GitBranch, href: "/repositories" },
  { label: "Scans", icon: Search, href: "/scans" },
  { label: "Code Explorer", icon: FileCode, href: "/explorer" },
  { label: "Reports", icon: FileBarChart, href: "/reports" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-56 min-w-56 bg-sn-surface border-r border-sn-border flex flex-col h-screen">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-sn-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-900 flex items-center justify-center">
          <Shield size={16} className="text-white" />
        </div>
        <div>
          <div className="text-[13px] font-bold text-sn-text tracking-wide">Sentinel</div>
          <div className="text-[9px] text-sn-dim tracking-widest uppercase">DevSecOps</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV.map(({ label, icon: Icon, href }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href}
              className={cn("flex items-center gap-3 px-3 py-2.5 rounded-lg text-[12px] font-medium transition-all duration-150 group",
                active ? "bg-violet-950/60 text-violet-300 border border-violet-800/40" : "text-sn-dim hover:text-sn-text hover:bg-sn-muted/30")}>
              <Icon size={15} className={active ? "text-violet-400" : "text-sn-dim group-hover:text-sn-text"} />
              {label}
              {active && <ChevronRight size={12} className="ml-auto text-violet-500" />}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      {user && (
        <div className="p-3 border-t border-sn-border">
          <div className="flex items-center gap-2.5 px-2 py-2">
            {user.avatar_url ? (
              <Image src={user.avatar_url} alt="avatar" width={28} height={28} className="rounded-full border border-sn-border" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-violet-900 flex items-center justify-center text-xs text-violet-300 font-bold">
                {(user.full_name || user.email)[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-sn-text font-medium truncate">{user.full_name || user.email}</div>
              {user.github_username && <div className="text-[9px] text-sn-dim">@{user.github_username}</div>}
            </div>
            <button onClick={logout} className="text-sn-dim hover:text-red-400 transition-colors" title="Logout">
              <LogOut size={13} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
