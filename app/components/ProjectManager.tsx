"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@/lib/projects";
import { brandFromHost, faviconFor, hostOf, matchGa, matchGsc } from "@/lib/projectMatch";
import { SearchableSelect } from "./SearchableSelect";

export type { Project };

interface GaProperty {
  propertyId: string;
  displayName: string;
  accountName: string | null;
  connectionId?: number;
  connectionEmail?: string;
}

/** What the manager opens on: the project list, a blank form, or one project's form. */
export type ProjectView = "list" | "new" | number;

export function Favicon({ src, name, size = 20 }: { src: string; name: string; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded bg-accent-soft font-semibold text-accent"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
        {(name.trim()[0] ?? "?").toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded"
      onError={() => setFailedSrc(src)}
    />
  );
}

/** Header control: shows the current project and switches between projects. */
export function ProjectPicker({
  projects,
  value,
  onChange,
  onManage,
  onNew,
}: {
  projects: Project[];
  value: number | null;
  onChange: (id: number) => void;
  onManage: () => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = projects.find((p) => p.id === value);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? projects.filter(
        (p) => p.name.toLowerCase().includes(needle) || p.websiteUrl.toLowerCase().includes(needle),
      )
    : projects;

  return (
    <div className="relative w-64" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setQ("");
          setOpen((o) => !o);
        }}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm"
      >
        {current && <Favicon src={current.faviconUrl} name={current.name} size={18} />}
        <span className="flex-1 truncate font-medium">{current?.name ?? "No project"}</span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 rounded-lg border bg-surface shadow-xl">
          {projects.length > 6 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search projects…"
              className="w-full border-b bg-transparent px-3 py-2 text-sm outline-none"
            />
          )}
          <div className="max-h-72 overflow-auto py-1">
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent-soft ${
                  p.id === value ? "bg-accent-soft text-accent" : ""
                }`}
              >
                <Favicon src={p.faviconUrl} name={p.name} size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  {p.websiteUrl && (
                    <span className="block truncate text-xs text-muted">{hostOf(p.websiteUrl)}</span>
                  )}
                </span>
              </button>
            ))}
            {!shown.length && <p className="px-3 py-2 text-sm text-muted">No projects.</p>}
          </div>
          <div className="flex gap-2 border-t p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
              className="flex-1 rounded-md bg-accent px-2 py-1.5 text-sm font-medium text-white"
            >
              New project
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              className="flex-1 rounded-md border px-2 py-1.5 text-sm hover:bg-accent-soft"
            >
              Manage
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A Search Console site as a shared connection lists it (the same property may be listed by several connections). */
export interface MappableSite {
  property: string;
  connectionId?: number;
  connectionEmail?: string;
}

const optionKey = (connectionId: number | null | undefined, value: string) => (value ? `${connectionId ?? ""}|${value}` : "");
const fromKey = (key: string): { connectionId: number | null; value: string } => {
  const i = key.indexOf("|");
  if (i < 0) return { connectionId: null, value: key };
  const id = Number(key.slice(0, i));
  return { connectionId: Number.isSafeInteger(id) && id > 0 ? id : null, value: key.slice(i + 1) };
};

export function ProjectManager({
  projects,
  sites,
  initialView,
  onClose,
  onChanged,
}: {
  projects: Project[];
  sites: MappableSite[];
  initialView: ProjectView;
  onClose: () => void;
  /** Called after any create/update/delete; `selectId` is the project to switch to, if any. */
  onChanged: (selectId?: number) => Promise<void> | void;
}) {
  const [view, setView] = useState<ProjectView>(initialView);
  const [gaProps, setGaProps] = useState<GaProperty[]>([]);
  const [brands, setBrands] = useState<Array<{ id: number; name: string }>>([]);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch("/api/ga/properties")
      .then((r) => r.json())
      .then((j: { properties?: GaProperty[] }) => {
        if (!ignore) setGaProps(j.properties ?? []);
      })
      .catch(() => {});
    fetch("/api/team")
      .then((r) => r.json())
      .then((j: { brands?: Array<{ id: number; name: string }> }) => {
        if (!ignore) setBrands(j.brands ?? []);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  async function remove(id: number) {
    setErr(null);
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) setErr(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't delete the project.");
    setConfirmDelete(null);
    await onChanged();
  }

  const editing = typeof view === "number" ? projects.find((p) => p.id === view) : undefined;
  const gaName = (id: string | null) => gaProps.find((g) => g.propertyId === id)?.displayName ?? id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {view === "list" ? "Projects" : view === "new" ? "New project" : editing?.canManage === false ? "Project details" : "Edit project"}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>

        {view === "list" ? (
          <>
            <p className="mt-1 text-sm text-muted">
              Every project of the team. Everyone can view all of them; a project&apos;s managers edit, share and delete it. Creating a project makes
              you its first manager.
            </p>
            {err && <p className="mt-3 text-sm text-bad">{err}</p>}
            <div className="mt-4 divide-y rounded-xl border">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3">
                  <Favicon src={p.faviconUrl} name={p.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {p.name}
                      <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[11px] font-normal text-muted">{p.canManage ? "Manager" : "View only"}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {[
                        p.brandName ?? "No brand",
                        p.primaryManagerName ? `Primary manager: ${p.primaryManagerName}` : "No manager yet",
                        p.gscProperty ? `Search Console: ${p.gscProperty}` : "No Search Console",
                        p.gaPropertyId ? `GA4: ${gaName(p.gaPropertyId)}` : "No GA4",
                      ].join(" · ")}
                    </div>
                  </div>
                  {confirmDelete === p.id ? (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-muted">Delete for everyone?</span>
                      <button onClick={() => remove(p.id)} className="font-medium text-bad">
                        Yes
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="text-muted">
                        No
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => setView(p.id)}
                        className="rounded-md border px-2.5 py-1 text-sm hover:bg-accent-soft"
                      >
                        {p.canManage ? "Edit" : "View"}
                      </button>
                      {p.canManage && (
                        <button
                          onClick={() => setConfirmDelete(p.id)}
                          className="text-sm text-muted hover:text-bad"
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
              {!projects.length && (
                <p className="p-4 text-sm text-muted">No projects yet — create the first one.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">
              Deleting hides the project from the whole team and cancels its queued work; its history is kept and the operator can restore it.
              Search Console and GA4 data are never touched.
            </p>
            <button
              onClick={() => setView("new")}
              className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              New project
            </button>
          </>
        ) : (
          <ProjectForm
            key={String(view)}
            project={editing}
            sites={sites}
            gaProps={gaProps}
            brands={brands}
            onCancel={() => (projects.length ? setView("list") : onClose())}
            onSaved={async (id) => {
              await onChanged(id);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ProjectForm({
  project,
  sites,
  gaProps,
  brands,
  onCancel,
  onSaved,
}: {
  project?: Project;
  sites: MappableSite[];
  gaProps: GaProperty[];
  brands: Array<{ id: number; name: string }>;
  onCancel: () => void;
  onSaved: (id: number) => Promise<void> | void;
}) {
  const readOnly = project ? !project.canManage : false;
  const [websiteUrl, setWebsiteUrl] = useState(project?.websiteUrl ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [faviconUrl, setFaviconUrl] = useState(project?.faviconUrl ?? "");
  // Mappings are "<connection id>|<property>": the same property can be readable through several shared connections.
  const [gsc, setGsc] = useState(optionKey(project?.gscConnectionId, project?.gscProperty ?? ""));
  const [ga, setGa] = useState(optionKey(project?.gaConnectionId, project?.gaPropertyId ?? ""));
  const [brandId, setBrandId] = useState<string>(project?.brandId != null ? String(project.brandId) : "");
  const [mapsUrl, setMapsUrl] = useState(project?.mapsUrl ?? "");
  const [asanaProjectGid, setAsanaProjectGid] = useState(project?.asanaProjectGid ?? "");
  const [asanaProjectName, setAsanaProjectName] = useState(project?.asanaProjectName ?? "");
  const [asanaConnectionId, setAsanaConnectionId] = useState<string>(project?.asanaConnectionId != null ? String(project.asanaConnectionId) : "");
  const [asanaConnections, setAsanaConnections] = useState<Array<{ id: number; asanaUserName: string | null; hint: string | null; status: string }>>([]);
  // Fields the user has set by hand stop following the website URL.
  const [touched, setTouched] = useState({
    name: Boolean(project),
    favicon: Boolean(project),
    gsc: Boolean(project?.gscProperty),
    ga: Boolean(project?.gaPropertyId),
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const host = useMemo(() => hostOf(websiteUrl), [websiteUrl]);
  const gscOptions = useMemo(
    () => sites.map((s) => ({ value: optionKey(s.connectionId, s.property), label: s.property, sublabel: s.connectionEmail ? `via ${s.connectionEmail}` : undefined })),
    [sites],
  );
  const gaOptions = useMemo(
    () => gaProps.map((p) => ({ value: optionKey(p.connectionId, p.propertyId), label: p.displayName, sublabel: [p.accountName, p.connectionEmail ? `via ${p.connectionEmail}` : null].filter(Boolean).join(" · ") || undefined })),
    [gaProps],
  );

  useEffect(() => {
    let live = true;
    fetch("/api/account/connections")
      .then((r) => r.json())
      .then((j: { asana?: Array<{ id: number; asanaUserName: string | null; hint: string | null; status: string }> }) => live && setAsanaConnections(j.asana ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /** The option for a property found by matching the website: the first connection that lists it. */
  const gscKeyFor = (property: string | null) => (property ? (gscOptions.find((o) => fromKey(o.value).value === property)?.value ?? "") : "");
  const gaKeyFor = (propertyId: string | null) => (propertyId ? (gaOptions.find((o) => fromKey(o.value).value === propertyId)?.value ?? "") : "");

  /** Fill in everything that can be derived from the URL and hasn't been set by hand. */
  function applyUrl(value: string, gaList = gaProps) {
    const h = hostOf(value);
    if (!h) return;
    if (!touched.name) setName(brandFromHost(h));
    if (!touched.favicon) setFaviconUrl(faviconFor(h));
    if (!touched.gsc) setGsc(gscKeyFor(matchGsc(h, [...new Set(sites.map((s) => s.property))])));
    if (!touched.ga) setGa(gaKeyFor(matchGa(h, gaList)));
  }

  // GA4 properties load after the form opens; retry the GA match once they arrive, and resolve the saved mapping's
  // connection when the project predates connection ids.
  useEffect(() => {
    if (!touched.ga && !ga && host && gaProps.length) setGa(gaKeyFor(matchGa(host, gaProps)));
    if (ga && fromKey(ga).connectionId == null && gaProps.length) setGa(gaKeyFor(fromKey(ga).value) || ga);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaProps]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const g = fromKey(gsc);
      const a = fromKey(ga);
      const res = await fetch(project ? `/api/projects/${project.id}` : "/api/projects", {
        method: project ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          websiteUrl,
          faviconUrl,
          gscProperty: g.value || null,
          gscConnectionId: g.value ? g.connectionId : null,
          gaPropertyId: a.value || null,
          gaConnectionId: a.value ? a.connectionId : null,
          brandId: brandId ? Number(brandId) : null,
          mapsUrl,
          asanaProjectGid,
          asanaProjectName,
          asanaConnectionId: asanaConnectionId ? Number(asanaConnectionId) : null,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Couldn't save the project.");
        return;
      }
      await onSaved(j.project.id);
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-70";
  const label = "block text-xs font-medium text-muted";

  return (
    <div className="mt-4 space-y-5">
      {readOnly && (
        <p className="rounded-md border px-3 py-2 text-sm text-muted">
          You can view this project. Changing it needs management access — ask {project?.primaryManagerName ?? "one of its managers"} to share it with you.
        </p>
      )}
      <fieldset disabled={readOnly} className="space-y-5">
        <section className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Website URL</span>
            <input
              value={websiteUrl}
              onChange={(e) => {
                setWebsiteUrl(e.target.value);
                applyUrl(e.target.value);
              }}
              placeholder="https://example.com"
              className={field}
              autoFocus={!project}
            />
            <span className="mt-1 block text-xs text-muted">
              The brand name, favicon and matching properties below are filled in from this
              address — change any of them if the match is wrong.
            </span>
          </label>

          <label>
            <span className={label}>Brand name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setTouched((t) => ({ ...t, name: true }));
              }}
              placeholder="Brand name"
              className={field}
            />
          </label>

          <label>
            <span className={label}>Favicon</span>
            <span className="mt-1 flex items-center gap-2">
              <Favicon src={faviconUrl} name={name || host} size={28} />
              <input
                value={faviconUrl}
                onChange={(e) => {
                  setFaviconUrl(e.target.value);
                  setTouched((t) => ({ ...t, favicon: true }));
                }}
                placeholder="Fetched automatically"
                className="w-full min-w-0 rounded-md border bg-background px-3 py-1.5 text-sm"
              />
            </span>
          </label>

          <label>
            <span className={label}>Company</span>
            <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={field}>
              <option value="">{project ? "No brand" : "From your company login"}</option>
              {brands.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h3 className="text-sm font-medium">Linked Google assets</h3>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div>
              <span className={label}>Search Console property</span>
              <SearchableSelect
                className="mt-1"
                value={gsc}
                onChange={(v) => {
                  setGsc(v);
                  setTouched((t) => ({ ...t, gsc: true }));
                }}
                placeholder="None"
                options={[{ value: "", label: "None" }, ...gscOptions]}
              />
            </div>
            <div>
              <span className={label}>Google Analytics (GA4) property</span>
              <SearchableSelect
                className="mt-1"
                value={ga}
                onChange={(v) => {
                  setGa(v);
                  setTouched((t) => ({ ...t, ga: true }));
                }}
                placeholder="None"
                options={[{ value: "", label: "None" }, ...gaOptions]}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Properties come from the workspace&apos;s shared Google connections (Account → Data connections); &ldquo;via&rdquo; shows which one reads
            it. Performance, Opportunities and Indexing use the Search Console property; Analytics and the Weekly Report use GA4.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium">Google Maps reviews</h3>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <label>
              <span className={label}>Google Maps link of the business</span>
              <input
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
                placeholder="https://www.google.com/maps/place/…"
                className={field}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">
            The Reviews tab reads this business&apos;s Google Maps reviews through SerpApi, only when a manager presses fetch, billed to that
            manager&apos;s own SerpApi key.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-medium">Asana</h3>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <label>
              <span className={label}>Asana project ID</span>
              <input
                value={asanaProjectGid}
                onChange={(e) => setAsanaProjectGid(e.target.value)}
                placeholder="e.g. 1201234567890123"
                className={field}
              />
            </label>
            <label>
              <span className={label}>Asana project name</span>
              <input
                value={asanaProjectName}
                onChange={(e) => setAsanaProjectName(e.target.value)}
                placeholder="Used as the status update title"
                className={field}
              />
            </label>
            <label className="sm:col-span-2">
              <span className={label}>Asana connection that reads it</span>
              <select value={asanaConnectionId} onChange={(e) => setAsanaConnectionId(e.target.value)} className={field}>
                <option value="">Choose a connection…</option>
                {asanaConnections.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {(c.asanaUserName ?? "Asana token") + (c.hint ? ` ••••${c.hint}` : "") + (c.status === "ok" ? "" : ` (${c.status})`)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted">Add one under Account → Data connections. Task alerts still go to each task&apos;s assignee.</span>
            </label>
          </div>
        </section>
      </fieldset>

      {ga && !readOnly && (
        <p className="text-xs text-muted">
          Monthly KPI targets are planned for many months at once in Project settings → KPI planning.
        </p>
      )}

      {err && <p className="text-sm text-bad">{err}</p>}

      <div className="flex gap-2">
        {!readOnly && (
          <button
            onClick={save}
            disabled={busy || (!name.trim() && !host)}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : project ? "Save changes" : "Create project"}
          </button>
        )}
        <button onClick={onCancel} className="rounded-md border px-4 py-1.5 text-sm">
          {readOnly ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
