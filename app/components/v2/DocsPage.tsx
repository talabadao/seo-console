"use client";

// Docs: articles and news. Everyone signed in reads published ones; Docs admins (DOCS_ADMIN_EMAILS) also see
// drafts and can write, publish and unpublish. Examples marked Demo exist on Preview only and never notify.
// Bodies are plain text with a few conventions (## heading, - list item, blank line = new paragraph), rendered
// as text — no HTML from the database is ever injected.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DocArticle } from "@/lib/docs/store";
import { Card, EmptyState, ErrorState, LoadingState, buttonClass, primaryButtonClass } from "./ui";

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

function Body({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        if (lines.length === 1 && lines[0].startsWith("## ")) {
          return (
            <h2 key={i} className="pt-2 text-base font-semibold">
              {lines[0].slice(3)}
            </h2>
          );
        }
        const out: ReactNode[] = [];
        let list: string[] = [];
        const flush = () => {
          if (list.length) out.push(<ul key={`l${out.length}`} className="list-disc space-y-1 pl-5">{list.map((li, j) => <li key={j}>{li}</li>)}</ul>);
          list = [];
        };
        for (const l of lines) {
          if (l.startsWith("- ")) list.push(l.slice(2));
          else if (l.startsWith("## ")) {
            flush();
            out.push(<h2 key={`h${out.length}`} className="pt-2 text-base font-semibold">{l.slice(3)}</h2>);
          } else {
            flush();
            out.push(<p key={`p${out.length}`}>{l}</p>);
          }
        }
        flush();
        return <div key={i} className="space-y-2">{out}</div>;
      })}
    </div>
  );
}

function Badges({ a }: { a: DocArticle }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <span className="rounded-full border px-1.5 text-[11px] text-muted">{a.kind === "news" ? "News" : "Article"}</span>
      {a.demo && (
        <span className="rounded-full border px-1.5 text-[11px]" style={{ borderColor: "var(--position)" }} title="Example for Preview; not real documentation">
          Demo
        </span>
      )}
      {a.status === "draft" && <span className="rounded-full border px-1.5 text-[11px]" style={{ borderColor: "var(--bad)" }}>Draft</span>}
    </span>
  );
}

export function DocsPage({ slug, onNavigate }: { slug?: string; onNavigate: (href: string) => void }) {
  const [list, setList] = useState<{ admin: boolean; articles: DocArticle[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "article" | "news">("all");
  const [editing, setEditing] = useState<Partial<DocArticle> | null>(null);

  const reload = useCallback(
    () =>
      fetch("/api/docs", { cache: "no-store" })
        .then(async (r) => {
          const b = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(b.error ?? `Request failed (${r.status})`);
          setList(b);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <ErrorState title="Couldn't load Docs." body={error} />;
  if (!list) return <LoadingState label="Loading Docs…" />;

  const article = slug ? list.articles.find((a) => a.slug === slug) : undefined;

  if (editing) {
    return (
      <Editor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={async (a) => {
          setEditing(null);
          await reload();
          onNavigate(`/docs/${a.slug}`);
        }}
      />
    );
  }

  if (slug) {
    if (!article) return <EmptyState title="This article isn't available." body="It may be unpublished or the address may be wrong." action={<button className={buttonClass} onClick={() => onNavigate("/docs")}>All Docs</button>} />;
    return (
      <Card>
        <button className="mb-3 text-xs text-accent hover:underline" onClick={() => onNavigate("/docs")}>
          ← All Docs
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{article.title}</h1>
          <Badges a={article} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {article.status === "published" ? `Published ${when(article.publishedAt)}` : "Not published"} · updated {when(article.updatedAt)}
        </p>
        {article.summary && <p className="mt-3 text-sm text-muted">{article.summary}</p>}
        <div className="mt-4">
          <Body text={article.body} />
        </div>
        {list.admin && !article.demo && (
          <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
            <button className={buttonClass} onClick={() => setEditing(article)}>
              Edit
            </button>
            <PublishButton article={article} onDone={reload} />
          </div>
        )}
      </Card>
    );
  }

  const shown = list.articles.filter((a) => kind === "all" || a.kind === kind);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Type" className="inline-flex rounded-md border p-0.5 text-sm">
          {(
            [
              ["all", "All"],
              ["article", "Articles"],
              ["news", "News"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={kind === id} onClick={() => setKind(id)} className={`rounded px-2.5 py-1 ${kind === id ? "bg-accent-soft font-medium text-accent" : "text-muted"}`}>
              {label}
            </button>
          ))}
        </div>
        {list.admin && (
          <button className={`${primaryButtonClass} ml-auto`} onClick={() => setEditing({ kind: "article", title: "", summary: "", body: "" })}>
            New article
          </button>
        )}
      </div>
      {shown.length ? (
        <ul className="space-y-3">
          {shown.map((a) => (
            <li key={a.id} className="rounded-xl border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/docs/${a.slug}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate(`/docs/${a.slug}`);
                  }}
                  className="font-medium hover:underline"
                >
                  {a.title}
                </a>
                <Badges a={a} />
              </div>
              {a.summary && <p className="mt-1 text-sm text-muted">{a.summary}</p>}
              <p className="mt-1 text-xs text-muted">{a.status === "published" ? `Published ${when(a.publishedAt)}` : `Draft, updated ${when(a.updatedAt)}`}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing published yet." body={list.admin ? "Write an article and publish it when it's ready." : "Docs admins publish articles and news here."} />
      )}
      {!list.admin && <p className="text-xs text-muted">Only Docs admins can write and publish.</p>}
    </div>
  );
}

function PublishButton({ article, onDone }: { article: DocArticle; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = article.status !== "published";
  return (
    <>
      <button
        className={publish ? primaryButtonClass : buttonClass}
        disabled={busy}
        onClick={async () => {
          if (publish && !window.confirm("Publish this article? Every account gets an in-app notification.")) return;
          setBusy(true);
          const r = await fetch(`/api/docs/${article.slug}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publish }) });
          const b = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok) return setError(b.error ?? "Couldn't change it.");
          await onDone();
        }}
      >
        {publish ? "Publish" : "Unpublish"}
      </button>
      {error && <span role="alert" className="text-sm" style={{ color: "var(--bad)" }}>{error}</span>}
    </>
  );
}

function Editor({ initial, onCancel, onSaved }: { initial: Partial<DocArticle>; onCancel: () => void; onSaved: (a: DocArticle) => void }) {
  const [a, setA] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card title={initial.id ? "Edit article" : "New article"}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await fetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
          const b = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok) return setError(b.error ?? "Couldn't save.");
          onSaved(b.article);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-xs text-muted">Title</span>
            <input className="rounded-md border bg-surface px-2 py-1.5" value={a.title ?? ""} onChange={(e) => setA({ ...a, title: e.target.value })} required maxLength={200} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted">Type</span>
            <select className="rounded-md border bg-surface px-2 py-1.5" value={a.kind ?? "article"} onChange={(e) => setA({ ...a, kind: e.target.value as DocArticle["kind"] })}>
              <option value="article">Article</option>
              <option value="news">News</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">Address (optional; letters, digits and dashes)</span>
          <input className="rounded-md border bg-surface px-2 py-1.5" value={a.slug ?? ""} onChange={(e) => setA({ ...a, slug: e.target.value })} maxLength={100} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">Summary</span>
          <input className="rounded-md border bg-surface px-2 py-1.5" value={a.summary ?? ""} onChange={(e) => setA({ ...a, summary: e.target.value })} maxLength={500} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted">Body (## heading, - list item, blank line between paragraphs)</span>
          <textarea className="min-h-[16rem] rounded-md border bg-surface px-2 py-1.5 font-mono text-sm" value={a.body ?? ""} onChange={(e) => setA({ ...a, body: e.target.value })} />
        </label>
        {error && <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>{error}</p>}
        <div className="flex gap-2">
          <button className={primaryButtonClass} disabled={busy}>
            Save draft
          </button>
          <button type="button" className={buttonClass} onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p className="text-xs text-muted">Saving never publishes; publishing is a separate step on the article.</p>
      </form>
    </Card>
  );
}
