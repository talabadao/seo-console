"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

interface SiteConfig {
  brandTerms: string[];
  longtailMinWords: number;
  aiPosOp: "=" | "<=" | ">=";
  aiPosValue: number;
  aiImprMax: number;
}

interface AutoIndexConfig {
  autoIndexEnabled: boolean;
  autoIndexCap: number;
}

function initialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    return (localStorage.getItem("seo-theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
  try {
    localStorage.setItem("seo-theme", t);
  } catch {}
}

export function SettingsPanel({
  property,
  bingConnected,
  onClose,
  onChanged,
}: {
  property: string;
  bingConnected: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [connected, setConnected] = useState(bingConnected);

  const [cfg, setCfg] = useState<SiteConfig | null>(null);
  const [brandText, setBrandText] = useState("");
  const [cfgMsg, setCfgMsg] = useState<string | null>(null);

  const [idxCfg, setIdxCfg] = useState<AutoIndexConfig | null>(null);
  const [idxMsg, setIdxMsg] = useState<string | null>(null);

  const [aiText, setAiText] = useState("");
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/settings/ga")
      .then((r) => r.json())
      .then((j: { aiDomains?: string[] }) => {
        if (!ignore && j.aiDomains) setAiText(j.aiDomains.join("\n"));
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function saveAi() {
    setAiMsg(null);
    const res = await fetch("/api/settings/ga", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aiDomains: aiText.split(/[\s,\n]+/).map((s) => s.trim()).filter(Boolean),
      }),
    });
    setAiMsg(res.ok ? "Saved. Reload the Analytics tab to apply." : "Save failed.");
  }

  useEffect(() => {
    if (!property) return;
    let ignore = false;
    fetch(`/api/settings/site?property=${encodeURIComponent(property)}`)
      .then((r) => r.json())
      .then((j: SiteConfig) => {
        if (ignore || !j || j.longtailMinWords == null) return;
        setCfg(j);
        setBrandText((j.brandTerms ?? []).join(", "));
      });
    return () => {
      ignore = true;
    };
  }, [property]);

  async function saveSiteCfg() {
    if (!cfg) return;
    setCfgMsg(null);
    const res = await fetch("/api/settings/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property,
        brandTerms: brandText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
        longtailMinWords: cfg.longtailMinWords,
        aiPosOp: cfg.aiPosOp,
        aiPosValue: cfg.aiPosValue,
        aiImprMax: cfg.aiImprMax,
      }),
    });
    if (res.ok) {
      setCfgMsg("Saved. Reload the dashboard filters to apply.");
      onChanged();
    } else setCfgMsg("Save failed.");
  }

  useEffect(() => {
    if (!property) return;
    let ignore = false;
    fetch(`/api/settings/indexing?property=${encodeURIComponent(property)}`)
      .then((r) => r.json())
      .then((j: AutoIndexConfig) => {
        if (ignore || !j || j.autoIndexCap == null) return;
        setIdxCfg(j);
      });
    return () => {
      ignore = true;
    };
  }, [property]);

  async function saveIdxCfg() {
    if (!idxCfg) return;
    setIdxMsg(null);
    const res = await fetch("/api/settings/indexing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property,
        autoIndexEnabled: idxCfg.autoIndexEnabled,
        autoIndexCap: idxCfg.autoIndexCap,
      }),
    });
    setIdxMsg(res.ok ? "Saved." : "Save failed.");
  }

  async function saveBing() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/bing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const json = await res.json();
      if (res.ok) {
        setConnected(json.connected);
        setMsg(
          json.connected
            ? `Connected. Found ${json.sites?.length ?? 0} Bing site(s).`
            : "Bing key cleared.",
        );
        setKey("");
        onChanged();
      } else {
        setMsg(json.error ?? "Failed to save key");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>

        <section className="mt-5">
          <h3 className="text-sm font-medium">Appearance</h3>
          <div className="mt-2 flex gap-2">
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t);
                  applyTheme(t);
                }}
                className={`rounded-md border px-3 py-1.5 text-sm capitalize ${
                  theme === t ? "border-accent bg-accent-soft text-accent" : ""
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-medium">
            Bing Webmaster Tools{" "}
            <span className={connected ? "text-good" : "text-muted"}>
              {connected ? "· connected" : "· not connected"}
            </span>
          </h3>
          <p className="mt-1 text-xs text-muted">
            Bing Webmaster Tools → Settings → API access → API Key. One key covers every
            verified Bing site.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={connected ? "Enter a new key to replace" : "Paste Bing API key"}
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <button
              onClick={saveBing}
              disabled={busy}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "…" : "Save"}
            </button>
          </div>
          {connected && (
            <button
              onClick={() => {
                setKey("");
                fetch("/api/settings/bing", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ apiKey: "" }),
                }).then(() => {
                  setConnected(false);
                  onChanged();
                });
              }}
              className="mt-2 text-xs text-bad"
            >
              Disconnect Bing
            </button>
          )}
        </section>

        {cfg && (
          <section className="mt-6">
            <h3 className="text-sm font-medium">Query filters — {property}</h3>
            <label className="mt-2 block text-xs text-muted">
              Branded terms (comma-separated; a query containing any counts as branded)
            </label>
            <textarea
              value={brandText}
              onChange={(e) => setBrandText(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
              <button
                onClick={saveSiteCfg}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white"
              >
                Save
              </button>
            </div>
            {cfgMsg && <p className="mt-2 text-xs text-muted">{cfgMsg}</p>}
          </section>
        )}

        {idxCfg && (
          <section className="mt-6">
            <h3 className="text-sm font-medium">Indexing automation — {property}</h3>
            <p className="mt-1 text-xs text-muted">
              Runs once a day: pulls the sitemap from Search Console, inspects any URL not
              checked in the last 3 days, and logs each URL&apos;s indexing status for the day.
              Not every site needs this — leave it off for low-priority properties to save
              your daily URL Inspection quota (2,000/day, shared across the whole property).
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={idxCfg.autoIndexEnabled}
                  onChange={(e) => setIdxCfg({ ...idxCfg, autoIndexEnabled: e.target.checked })}
                />
                Auto-inspect this site daily
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-muted">Max URLs per daily run</span>
                <input
                  type="number"
                  min={1}
                  value={idxCfg.autoIndexCap}
                  onChange={(e) =>
                    setIdxCfg({ ...idxCfg, autoIndexCap: Number(e.target.value) })
                  }
                  className="mt-1 w-24 rounded-md border bg-background px-2 py-1"
                />
              </label>
              <button
                onClick={saveIdxCfg}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white"
              >
                Save
              </button>
            </div>
            {idxMsg && <p className="mt-2 text-xs text-muted">{idxMsg}</p>}
          </section>
        )}

        <section className="mt-6">
          <h3 className="text-sm font-medium">Analytics — AI Search sources</h3>
          <p className="mt-1 text-xs text-muted">
            One domain per line. A GA4 session counts as “AI Search” when its source matches
            one of these; it&apos;s then removed from “Organic Search” so they don&apos;t
            double-count.
          </p>
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={5}
            className="mt-2 w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={saveAi}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              Save
            </button>
            {aiMsg && <span className="text-xs text-muted">{aiMsg}</span>}
          </div>
        </section>

        <section className="mt-6 rounded-lg border bg-background p-3 text-xs text-muted">
          <p className="font-medium text-foreground">Scheduled daily sync (Windows)</p>
          <p className="mt-1">
            Run <code>npm run sync</code> in the project folder — or schedule it via Task
            Scheduler (Program <code>node</code>, Arguments{" "}
            <code>node_modules/tsx/dist/cli.mjs scripts/sync.mts</code>, Start in the project
            folder). Runs the same pull as “Sync now” for every property.
          </p>
        </section>

        {msg && <p className="mt-4 text-sm">{msg}</p>}
      </div>
    </div>
  );
}
