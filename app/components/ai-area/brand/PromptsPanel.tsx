"use client";

import { useMemo, useState } from "react";
import type { BrandPrompt } from "@/lib/ai-area/brand/types";
import { Panel, Segmented } from "../tracking/ui";

const field: React.CSSProperties = { borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" };
const primary = "rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50";

type AddMode = "type" | "upload" | "suggest";

/** CSV/TSV/TXT -> prompts. A header row with "prompt"/"query"/"question" and "topic" columns is recognised; otherwise one prompt per line. */
function parseUpload(text: string): Array<{ text: string; topic: string }> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;
  const split = (line: string): string[] => {
    if (!sep) return [line];
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) {
        out.push(cell);
        cell = "";
      } else cell += ch;
    }
    out.push(cell);
    return out.map((c) => c.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const promptCol = header.findIndex((h) => /prompt|query|question|keyword|search/.test(h));
  const topicCol = header.findIndex((h) => /topic|category|group|theme/.test(h));
  const hasHeader = promptCol >= 0;
  return lines
    .slice(hasHeader ? 1 : 0)
    .map((line) => {
      const cells = split(line);
      return { text: (cells[hasHeader ? promptCol : 0] ?? "").trim(), topic: (topicCol >= 0 ? cells[topicCol] : "")?.trim() || "" };
    })
    .filter((p) => p.text.length > 2);
}

export function PromptsPanel({
  projectId,
  prompts,
  max,
  brandName,
  onChange,
  mentionRate,
}: {
  projectId: number;
  prompts: BrandPrompt[];
  max: number;
  brandName: string;
  onChange: (prompts: BrandPrompt[]) => void;
  /** promptId -> share of platforms whose latest answer mentioned the brand. */
  mentionRate: Record<string, { mentioned: number; answered: number }>;
}) {
  const [mode, setMode] = useState<AddMode>("type");
  const [typed, setTyped] = useState("");
  const [topic, setTopic] = useState("");
  const [upload, setUpload] = useState<Array<{ text: string; topic: string }>>([]);
  const [suggestions, setSuggestions] = useState<Array<{ text: string; topic: string; picked: boolean }>>([]);
  const [brandMode, setBrandMode] = useState<"mix" | "branded" | "unbranded">("mix");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function add(items: Array<{ text: string; topic: string }>, source: "manual" | "upload" | "suggested") {
    if (!items.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/ai-area/${projectId}/brand/prompts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompts: items, source }) });
      const data = (await res.json()) as { prompts?: BrandPrompt[]; added?: number; skipped?: number; error?: string };
      if (!res.ok || !data.prompts) throw new Error(data.error ?? "Couldn't add prompts");
      onChange(data.prompts);
      setMessage(`Added ${data.added} prompt${data.added === 1 ? "" : "s"}${data.skipped ? ` (${data.skipped} over the ${max} limit)` : ""}. Duplicates are skipped.`);
      if (source === "manual") setTyped("");
      if (source === "upload") setUpload([]);
      if (source === "suggested") setSuggestions((s) => s.filter((x) => !x.picked));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't add prompts");
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/ai-area/${projectId}/brand/suggest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: 20, brandMode }) });
      const data = (await res.json()) as { prompts?: Array<{ text: string; topic: string }>; error?: string };
      if (!res.ok || !data.prompts) throw new Error(data.error ?? "Suggestions failed");
      setSuggestions(data.prompts.map((p) => ({ ...p, picked: true })));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suggestions failed");
    } finally {
      setBusy(false);
    }
  }

  async function patch(ids: string[], body: Record<string, unknown>) {
    const res = await fetch(`/api/ai-area/${projectId}/brand/prompts`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, ...body }) });
    const data = (await res.json()) as { prompts?: BrandPrompt[] };
    if (data.prompts) onChange(data.prompts);
  }

  async function remove(ids: string[]) {
    if (!ids.length || !window.confirm(`Delete ${ids.length} prompt${ids.length === 1 ? "" : "s"}? Past answers stay in earlier runs.`)) return;
    const res = await fetch(`/api/ai-area/${projectId}/brand/prompts`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const data = (await res.json()) as { prompts?: BrandPrompt[] };
    if (data.prompts) onChange(data.prompts);
    setSelected(new Set());
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return prompts.filter((p) => !q || p.text.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q));
  }, [prompts, filter]);
  const active = prompts.filter((p) => p.active).length;
  const topics = [...new Set(prompts.map((p) => p.topic))].sort();

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Panel
        title="Tracked prompts"
        subtitle={`${active} active of ${prompts.length} · max ${max}`}
        bodyClassName="flex flex-col"
        actions={
          selected.size ? (
            <span className="flex items-center gap-2 text-xs">
              <button type="button" onClick={() => void patch([...selected], { active: true })} className="underline" style={{ color: "var(--text-secondary)" }}>
                Activate
              </button>
              <button type="button" onClick={() => void patch([...selected], { active: false })} className="underline" style={{ color: "var(--text-secondary)" }}>
                Pause
              </button>
              <button type="button" onClick={() => void remove([...selected])} className="underline" style={{ color: "var(--status-critical)" }}>
                Delete {selected.size}
              </button>
            </span>
          ) : (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter prompts" className="w-44 rounded-md border px-2 py-1 text-xs outline-none" style={field} aria-label="Filter prompts" />
          )
        }
      >
        {prompts.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No prompts yet. Add the questions people ask AI about {brandName || "your brand"}, its products and its category, or let ChatGPT suggest some.
          </p>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="sticky top-0" style={{ background: "var(--surface-1)" }}>
                <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={visible.length > 0 && visible.every((p) => selected.has(p.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((p) => p.id)) : new Set())}
                    />
                  </th>
                  <th className="px-2 py-2 font-medium">Prompt</th>
                  <th className="px-2 py-2 font-medium">Topic</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 text-right font-medium" title="Latest run: answers that mentioned your brand / answers given">
                    Mentioned
                  </th>
                  <th className="px-2 py-2 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const rate = mentionRate[p.id];
                  return (
                    <tr key={p.id} className="border-t" style={{ borderColor: "var(--border-hairline)", opacity: p.active ? 1 : 0.55 }}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.text}`}
                          checked={selected.has(p.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(p.id);
                            else next.delete(p.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="px-2 py-2" style={{ color: "var(--text-primary)" }}>
                        {p.text}
                        <span className="ml-2 text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
                          {p.source}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <input
                          defaultValue={p.topic}
                          list="brand-topics"
                          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.topic && void patch([p.id], { topic: e.target.value })}
                          className="w-28 rounded border px-1.5 py-0.5 text-xs outline-none"
                          style={field}
                          aria-label={`Topic for ${p.text}`}
                        />
                      </td>
                      <td className="px-2 py-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {p.branded ? "Branded" : "Unbranded"}
                      </td>
                      <td className="tabular px-2 py-2 text-right text-xs" style={{ color: "var(--text-secondary)" }}>
                        {rate ? `${rate.mentioned}/${rate.answered}` : "-"}
                      </td>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={p.active} onChange={(e) => void patch([p.id], { active: e.target.checked })} aria-label={`Track ${p.text}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="brand-topics">
              {topics.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        )}
      </Panel>

      <Panel title="Add prompts" subtitle="type, upload or get suggestions">
        <Segmented
          value={mode}
          options={[
            { value: "type", label: "Type" },
            { value: "upload", label: "Upload CSV" },
            { value: "suggest", label: "Suggest" },
          ]}
          onChange={(m) => {
            setMode(m);
            setMessage(null);
          }}
          ariaLabel="How to add prompts"
        />
        {mode === "type" ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              rows={7}
              placeholder={`One question per line, e.g.\nbest luxury Halong Bay cruise for couples\nis ${brandName || "Brand"} worth the price?`}
              className="rounded-lg border px-3 py-2 text-sm outline-none"
              style={field}
              aria-label="Prompts, one per line"
            />
            <input value={topic} onChange={(e) => setTopic(e.target.value)} list="brand-topics" placeholder="Topic (optional), e.g. Pricing" className="rounded-lg border px-3 py-1.5 text-sm outline-none" style={field} aria-label="Topic" />
            <button
              type="button"
              disabled={busy || !typed.trim()}
              onClick={() => void add(typed.split("\n").map((t) => ({ text: t, topic })), "manual")}
              className={primary}
              style={{ background: "var(--series-1)" }}
            >
              Add {typed.split("\n").filter((t) => t.trim()).length || ""} prompts
            </button>
          </div>
        ) : mode === "upload" ? (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center" style={{ borderColor: "var(--border-hairline)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Choose a CSV, TSV or TXT file
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Columns named prompt / query / question and topic are recognised (e.g. a Search Console export); otherwise one prompt per line.
              </span>
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const rows = parseUpload(await file.text());
                  setUpload(rows.slice(0, max));
                  setMessage(rows.length ? `${rows.length} prompts found in ${file.name}.` : "No prompts found in that file.");
                }}
              />
            </label>
            {upload.length ? (
              <>
                <ul className="max-h-48 overflow-auto rounded-lg border text-xs" style={{ borderColor: "var(--border-hairline)" }}>
                  {upload.slice(0, 50).map((u, i) => (
                    <li key={i} className="border-b px-2 py-1 last:border-b-0" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
                      {u.text}
                      {u.topic ? <span style={{ color: "var(--text-muted)" }}> · {u.topic}</span> : null}
                    </li>
                  ))}
                </ul>
                <button type="button" disabled={busy} onClick={() => void add(upload, "upload")} className={primary} style={{ background: "var(--series-1)" }}>
                  Add {upload.length} prompts
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              ChatGPT proposes the questions people ask while choosing: comparisons with competitors, &ldquo;is it worth it?&rdquo;, reviews, best
              options for a purpose and place, and who it suits - built from your brand, competitors, keywords and what customers say in reviews
              (about $0.001). Price-range and things-to-do questions are left out.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Brand name in the prompts
              </span>
              <Segmented
                value={brandMode}
                onChange={setBrandMode}
                ariaLabel="Brand name in the prompts"
                options={[
                  { value: "mix", label: "Both", title: "About half name the brand, half are category questions" },
                  { value: "branded", label: "Include brand", title: "Every prompt names the brand" },
                  { value: "unbranded", label: "Exclude brand", title: "No prompt names the brand - shows whether AI recommends it unprompted" },
                ]}
              />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {brandMode === "branded"
                  ? `Every prompt names ${brandName || "the brand"}: what AI says when people ask about it directly.`
                  : brandMode === "unbranded"
                    ? `No prompt names ${brandName || "the brand"}: shows whether AI recommends it without being asked.`
                    : "About half name the brand, half are category questions."}
              </span>
            </div>
            <button type="button" disabled={busy} onClick={() => void suggest()} className={primary} style={{ background: "var(--series-1)" }}>
              {busy ? "Thinking..." : suggestions.length ? "Suggest more" : "Suggest 20 prompts"}
            </button>
            {suggestions.length ? (
              <>
                <ul className="flex max-h-72 flex-col gap-1 overflow-auto">
                  {suggestions.map((s, i) => (
                    <li key={s.text}>
                      <label className="flex items-start gap-2 rounded-md px-1.5 py-1 text-xs" style={{ background: "var(--page-plane)", color: "var(--text-primary)" }}>
                        <input type="checkbox" checked={s.picked} onChange={(e) => setSuggestions((all) => all.map((x, j) => (j === i ? { ...x, picked: e.target.checked } : x)))} />
                        <span>
                          {s.text}
                          <span style={{ color: "var(--text-muted)" }}> · {s.topic}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy || !suggestions.some((s) => s.picked)}
                  onClick={() => void add(suggestions.filter((s) => s.picked), "suggested")}
                  className={primary}
                  style={{ background: "var(--series-1)" }}
                >
                  Add {suggestions.filter((s) => s.picked).length} selected
                </button>
              </>
            ) : null}
          </div>
        )}
        {message ? (
          <p className="text-xs" role="status" style={{ color: "var(--text-secondary)" }}>
            {message}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
