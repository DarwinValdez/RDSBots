"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, BarChart3, Bot, CircleDot, Gauge, History, Layers, Menu, Shield, Trophy, X,
} from "lucide-react";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; module?: string };

const MAIN: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/value-bets", label: "Value Bets", icon: Trophy, module: "value_bets" },
  { href: "/parlay", label: "Parlays", icon: Layers, module: "parlays" },
  { href: "/history", label: "Historial y rendimiento", icon: History, module: "history" },
  { href: "/chat", label: "Asistente IA", icon: Bot, module: "chat" },
];

const SPORTS: Item[] = [
  { href: "/sports/soccer", label: "Fútbol", icon: CircleDot },
  { href: "/sports/nba", label: "NBA", icon: CircleDot },
  { href: "/sports/mlb", label: "MLB", icon: CircleDot },
  { href: "/sports/nfl", label: "NFL", icon: CircleDot },
  { href: "/sports/nhl", label: "NHL", icon: CircleDot },
  { href: "/sports/tennis", label: "Tenis", icon: CircleDot },
];

export function Sidebar({ isAdmin, modules, enabledSports }: { isAdmin: boolean; modules: Record<string, boolean>; enabledSports: string[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const link = (i: Item) => {
    const active = path === i.href || path.startsWith(`${i.href}/`);
    const Icon = i.icon;
    return (
      <Link
        key={i.href}
        href={i.href}
        onClick={() => setOpen(false)}
        className={clsx(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          active ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        <Icon className={clsx("size-4", active ? "text-brand" : "text-muted")} />
        {i.label}
      </Link>
    );
  };

  const nav = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      <Link href="/dashboard" className="flex items-center gap-2 px-2">
        <Activity className="size-5 text-brand" aria-hidden />
        <span className="font-semibold">AI Betting Analyst</span>
      </Link>
      <div className="space-y-1">{MAIN.filter((i) => !i.module || modules[i.module] !== false).map(link)}</div>
      <div>
        <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted">Deportes</div>
        <div className="space-y-1">{SPORTS.filter((s) => enabledSports.includes(s.href.split("/")[2])).map(link)}</div>
      </div>
      {isAdmin && (
        <div>
          <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted">Administración</div>
          <div className="space-y-1">{[{ href: "/admin", label: "Panel admin", icon: Shield }, { href: "/admin/model", label: "Modelos", icon: BarChart3 }].map(link)}</div>
        </div>
      )}
      <p className="mt-auto border-t border-line px-3 pt-4 text-xs text-muted">+18 · Juego responsable</p>
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="flex items-center gap-2 font-semibold"><Activity className="size-5 text-brand" /> AI Betting Analyst</span>
        <button aria-label="Abrir menú" onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-surface-2"><Menu className="size-5" /></button>
      </div>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-line bg-surface lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface">
            <button aria-label="Cerrar menú" onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-md p-1.5 hover:bg-surface-2"><X className="size-5" /></button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
