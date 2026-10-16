"use client";

// The signed-in account, bottom-left of the sidebar: avatar, name and email, opening a menu with the account
// settings pages and Sign out. Collapsed sidebar: the avatar alone opens the same menu; the mobile drawer shows
// the full row. Keyboard: Enter/Space opens, arrow keys move, Escape closes and returns focus.

import { useEffect, useRef, useState } from "react";
import type { ShellLocation } from "@/lib/v2/nav";
import { Icon } from "./icons";

export const ACCOUNT_SECTION_LABEL: Record<string, string> = {
  "": "API credentials",
  usage: "Usage & Costs",
  budgets: "Budgets & limits",
  sync: "Sync & cache",
};

const ITEMS: Array<{ section: string; label: string; icon: string }> = [
  { section: "", label: "Account settings · API credentials", icon: "key" },
  { section: "usage", label: "Usage & Costs", icon: "wallet" },
  { section: "budgets", label: "Budgets & limits", icon: "gauge" },
  { section: "sync", label: "Sync & cache", icon: "gear" },
];

function Avatar({ user, size = 28 }: { user: { email: string; name: string | null; picture: string | null }; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (user.picture && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.picture} alt="" width={size} height={size} className="shrink-0 rounded-full" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  const initial = (user.name?.trim()[0] ?? user.email[0] ?? "?").toUpperCase();
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {initial}
    </span>
  );
}

export function AccountMenu({
  user,
  collapsed,
  projectId,
  loc,
  onNavigate,
}: {
  user: { email: string; name: string | null; picture: string | null };
  collapsed: boolean;
  /** The project in context; account pages use it only as the default usage filter. */
  projectId: number | null;
  loc: ShellLocation;
  onNavigate: (l: ShellLocation) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  }

  const current = loc.kind === "account" ? loc.section : null;
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? `${user.name ?? user.email} — account menu` : undefined}
        className={`flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${collapsed ? "justify-center" : ""}`}
      >
        <Avatar user={user} />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name || user.email.split("@")[0]}</span>
            <span className="block truncate text-xs text-muted">{user.email}</span>
          </span>
        )}
        {!collapsed && <Icon name="chevronDown" className="h-4 w-4 shrink-0 rotate-180 text-muted" strokeWidth={2} />}
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          onKeyDown={onKeyDown}
          className={`absolute bottom-full z-50 mb-2 w-64 rounded-lg border bg-surface p-1 shadow-lg ${collapsed ? "left-0" : "left-0 right-0 w-auto"}`}
        >
          <div className="border-b px-2.5 py-2 text-xs text-muted">
            Signed in as <span className="block truncate font-medium text-foreground">{user.email}</span>
          </div>
          {ITEMS.map((it) => (
            <a
              key={it.section}
              role="menuitem"
              tabIndex={-1}
              href={`/account${it.section ? `/${it.section}` : ""}${projectId ? `?project=${projectId}` : ""}`}
              aria-current={current === it.section ? "page" : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                setOpen(false);
                onNavigate({ kind: "account", section: it.section, projectId });
              }}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent-soft focus:bg-accent-soft focus:outline-none ${current === it.section ? "font-semibold text-accent" : ""}`}
            >
              <Icon name={it.icon} className="h-4 w-4" />
              {it.label}
            </a>
          ))}
          <div className="my-1 border-t" />
          <button
            role="menuitem"
            tabIndex={-1}
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.reload();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent-soft focus:bg-accent-soft focus:outline-none"
          >
            <Icon name="logout" className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
