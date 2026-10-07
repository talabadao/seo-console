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
}

interface GbpLocation {
  name: string;
  title: string;
  address: string;
  websiteUri: string;
}

/** Business Profile locations for the form, plus why the list may be empty. */
interface GbpList {
  locations: GbpLocation[];
  needsReconnect?: boolean;
  error?: string;
}

interface KpiConfig {
  yearMonth: string;
  trafficOrganicTarget: number;
  trafficAiTarget: number;
  leadOrganicTarget: number;
  leadAiTarget: number;
  leadEvents: string[];
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

export function ProjectManager({
  projects,
  gscProperties,
  initialView,
  onClose,
  onChanged,
}: {
  projects: Project[];
  gscProperties: string[];
  initialView: ProjectView;
  onClose: () => void;
  /** Called after any create/update/delete; `selectId` is the project to switch to, if any. */
  onChanged: (selectId?: number) => Promise<void> | void;
}) {
  const [view, setView] = useState<ProjectView>(initialView);
  const [gaProps, setGaProps] = useState<GaProperty[]>([]);
  const [gbp, setGbp] = useState<GbpList>({ locations: [] });
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
    fetch("/api/reviews/locations")
      .then((r) => r.json())
      .then((j: GbpList) => {
        if (!ignore) setGbp({ ...j, locations: j.locations ?? [] });
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  async function remove(id: number) {
    setErr(null);
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) setErr("Couldn't delete the project.");
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
            {view === "list" ? "Projects" : view === "new" ? "New project" : "Edit project"}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>

        {view === "list" ? (
          <>
            <p className="mt-1 text-sm text-muted">
              A project ties one brand&apos;s website to its Search Console and Analytics
              properties. Everything in the console is shown for the selected project.
            </p>
            {err && <p className="mt-3 text-sm text-bad">{err}</p>}
            <div className="mt-4 divide-y rounded-xl border">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-3">
                  <Favicon src={p.faviconUrl} name={p.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted">
                      {[
                        p.gscProperty ? `Search Console: ${p.gscProperty}` : "No Search Console",
                        p.gaPropertyId ? `GA4: ${gaName(p.gaPropertyId)}` : "No GA4",
                        p.gbpLocation
                          ? `Business Profile: ${p.gbpLocationTitle ?? "linked"}`
                          : "No Business Profile",
                      ].join(" · ")}
                    </div>
                  </div>
                  {confirmDelete === p.id ? (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-muted">Delete?</span>
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
                        Edit
                      </button>
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="text-sm text-muted hover:text-bad"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!projects.length && (
                <p className="p-4 text-sm text-muted">No projects yet — create your first one.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">
              Deleting a project only removes the grouping. Synced Search Console history,
              inspections and KPI targets are kept.
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
            gscProperties={gscProperties}
            gaProps={gaProps}
            gbp={gbp}
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

const numStr = (n: number) => (n ? String(n) : "");

function ProjectForm({
  project,
  gscProperties,
  gaProps,
  gbp,
  onCancel,
  onSaved,
}: {
  project?: Project;
  gscProperties: string[];
  gaProps: GaProperty[];
  gbp: GbpList;
  onCancel: () => void;
  onSaved: (id: number) => Promise<void> | void;
}) {
  const [websiteUrl, setWebsiteUrl] = useState(project?.websiteUrl ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [faviconUrl, setFaviconUrl] = useState(project?.faviconUrl ?? "");
  const [gscProperty, setGscProperty] = useState(project?.gscProperty ?? "");
  const [gaPropertyId, setGaPropertyId] = useState(project?.gaPropertyId ?? "");
  const [gbpLocation, setGbpLocation] = useState(project?.gbpLocation ?? "");
  const [asanaProjectGid, setAsanaProjectGid] = useState(project?.asanaProjectGid ?? "");
  const [asanaProjectName, setAsanaProjectName] = useState(project?.asanaProjectName ?? "");
  // Fields the user has set by hand stop following the website URL.
  const [touched, setTouched] = useState({
    name: Boolean(project),
    favicon: Boolean(project),
    gsc: Boolean(project?.gscProperty),
    ga: Boolean(project?.gaPropertyId),
    gbp: Boolean(project?.gbpLocation),
  });

  const [kpi, setKpi] = useState<KpiConfig | null>(null);
  const [targets, setTargets] = useState({ to: "", ta: "", lo: "", la: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const host = useMemo(() => hostOf(websiteUrl), [websiteUrl]);

  /** Fill in everything that can be derived from the URL and hasn't been set by hand. */
  function applyUrl(value: string, ga = gaProps) {
    const h = hostOf(value);
    if (!h) return;
    if (!touched.name) setName(brandFromHost(h));
    if (!touched.favicon) setFaviconUrl(faviconFor(h));
    if (!touched.gsc) setGscProperty(matchGsc(h, gscProperties) ?? "");
    if (!touched.ga) setGaPropertyId(matchGa(h, ga) ?? "");
    if (!touched.gbp) setGbpLocation(matchGbp(h));
  }

  /** The Business Profile whose listed website is on this host. */
  function matchGbp(h: string): string {
    const bare = (x: string) => x.replace(/^www\./, "");
    return gbp.locations.find((l) => l.websiteUri && bare(hostOf(l.websiteUri)) === bare(h))?.name ?? "";
  }

  // The linked location stays selectable even when the list couldn't be loaded.
  const gbpOptions = [
    { value: "", label: "None" },
    ...gbp.locations.map((l) => ({ value: l.name, label: l.title, sublabel: l.address || undefined })),
    ...(project?.gbpLocation && !gbp.locations.some((l) => l.name === project.gbpLocation)
      ? [{ value: project.gbpLocation, label: project.gbpLocationTitle ?? "Linked location" }]
      : []),
  ];

  // GA4 properties load after the form opens; retry the GA match once they arrive.
  useEffect(() => {
    if (!touched.ga && !gaPropertyId && host && gaProps.length) {
      setGaPropertyId(matchGa(host, gaProps) ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaProps]);

  // Same for Business Profile locations.
  useEffect(() => {
    if (!touched.gbp && !gbpLocation && host && gbp.locations.length) setGbpLocation(matchGbp(host));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gbp.locations]);

  // This month's KPI targets for the linked GA4 property.
  useEffect(() => {
    setKpi(null);
    if (!gaPropertyId) return;
    let ignore = false;
    fetch(`/api/weekly-report/config?propertyId=${encodeURIComponent(gaPropertyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: KpiConfig | null) => {
        if (ignore || !c) return;
        setKpi(c);
        setTargets({
          to: numStr(c.trafficOrganicTarget),
          ta: numStr(c.trafficAiTarget),
          lo: numStr(c.leadOrganicTarget),
          la: numStr(c.leadAiTarget),
        });
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [gaPropertyId]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(project ? `/api/projects/${project.id}` : "/api/projects", {
        method: project ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          websiteUrl,
          faviconUrl,
          gscProperty: gscProperty || null,
          gaPropertyId: gaPropertyId || null,
          gbpLocation: gbpLocation || null,
          gbpLocationTitle:
            gbp.locations.find((l) => l.name === gbpLocation)?.title ??
            (gbpLocation === project?.gbpLocation ? project?.gbpLocationTitle : null) ??
            null,
          asanaProjectGid,
          asanaProjectName,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Couldn't save the project.");
        return;
      }
      if (gaPropertyId && kpi) {
        const kres = await fetch("/api/weekly-report/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            propertyId: gaPropertyId,
            yearMonth: kpi.yearMonth,
            trafficOrganicTarget: Number(targets.to) || 0,
            trafficAiTarget: Number(targets.ta) || 0,
            leadOrganicTarget: Number(targets.lo) || 0,
            leadAiTarget: Number(targets.la) || 0,
            leadEvents: kpi.leadEvents,
            asanaProjectGid,
            asanaStatusTitle: asanaProjectName,
          }),
        });
        if (!kres.ok) {
          setErr("Project saved, but the KPI targets couldn't be saved.");
          return;
        }
      }
      await onSaved(j.project.id);
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm";
  const label = "block text-xs font-medium text-muted";

  return (
    <div className="mt-4 space-y-5">
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
      </section>

      <section>
        <h3 className="text-sm font-medium">Linked Google assets</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <span className={label}>Search Console property</span>
            <SearchableSelect
              className="mt-1"
              value={gscProperty}
              onChange={(v) => {
                setGscProperty(v);
                setTouched((t) => ({ ...t, gsc: true }));
              }}
              placeholder="None"
              options={[
                { value: "", label: "None" },
                ...gscProperties.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>
          <div>
            <span className={label}>Google Analytics (GA4) property</span>
            <SearchableSelect
              className="mt-1"
              value={gaPropertyId}
              onChange={(v) => {
                setGaPropertyId(v);
                setTouched((t) => ({ ...t, ga: true }));
              }}
              placeholder="None"
              options={[
                { value: "", label: "None" },
                ...gaProps.map((p) => ({
                  value: p.propertyId,
                  label: p.displayName,
                  sublabel: p.accountName || undefined,
                })),
              ]}
            />
          </div>
        </div>
        <div className="mt-4">
          <span className={label}>Google Business Profile location</span>
          <SearchableSelect
            className="mt-1"
            value={gbpLocation}
            onChange={(v) => {
              setGbpLocation(v);
              setTouched((t) => ({ ...t, gbp: true }));
            }}
            placeholder="None"
            options={gbpOptions}
          />
          {gbp.needsReconnect ? (
            <p className="mt-1 text-xs text-muted">
              To list your Business Profiles,{" "}
              <a href="/api/auth/google" className="text-accent underline">
                reconnect Google
              </a>{" "}
              and approve the Business Profile permission.
            </p>
          ) : gbp.error ? (
            <p className="mt-1 text-xs text-bad">{gbp.error}</p>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted">
          Performance, Opportunities and Indexing use the Search Console property; Analytics and
          the Weekly Report use the GA4 property; Reviews uses the Business Profile location.
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
        </div>
      </section>

      {gaPropertyId && kpi && (
        <section>
          <h3 className="text-sm font-medium">KPI targets · {kpi.yearMonth}</h3>
          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ["to", "Organic traffic"],
                ["ta", "AI traffic"],
                ["lo", "Organic leads"],
                ["la", "AI leads"],
              ] as const
            ).map(([k, text]) => (
              <label key={k}>
                <span className={label}>{text}</span>
                <input
                  type="number"
                  min={0}
                  value={targets[k]}
                  onChange={(e) => setTargets((t) => ({ ...t, [k]: e.target.value }))}
                  placeholder="0"
                  className={field}
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Other months and the events that count as leads are set in Weekly Report → Configure
            KPIs.
          </p>
        </section>
      )}

      {err && <p className="text-sm text-bad">{err}</p>}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy || (!name.trim() && !host)}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : project ? "Save changes" : "Create project"}
        </button>
        <button onClick={onCancel} className="rounded-md border px-4 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
