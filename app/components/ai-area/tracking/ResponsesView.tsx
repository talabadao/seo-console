"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SURFACE_LABEL,
  collectAiResponses,
  type AiResponseItem,
  type AiSurface,
  type HitLookup,
  type MentionStatus,
  type Subject,
} from "@/lib/ai-area/tracking/analytics";
import { formatShortDate } from "@/lib/ai-area/tracking/format";
import type { KeywordHistory } from "@/lib/ai-area/tracking/types";
import { AnswerText, SourceList } from "./AiAnswer";
import { Favicon } from "./Favicon";
import { Chip, EmptyState, IconCalendar, IconCheck, IconMessage, Panel, Segmented, SelectControl, Switch } from "./ui";

interface ResponsesViewProps {
  histories: KeywordHistory[];
  dates: string[];
  subjects: Subject[];
  hits: HitLookup;
  surfaces: AiSurface[];
  localeLabel: string;
  onTrack: (domain: string) => void;
}

type StatusFilter = "all" | "mentioned" | "missing";

const STATUS_LABEL: Record<MentionStatus, string> = {
  cited: "Mentioned & cited",
  mentioned: "Mentioned",
  none: "Not mentioned",
  notShown: "No AI answer shown",
};

function StatusChip({ status }: { status: MentionStatus }) {
  if (status === "cited" || status === "mentioned") {
    return (
      <Chip tone="good">
        <span style={{ color: "var(--success-text)" }}>
          <IconCheck />
        </span>
        {STATUS_LABEL[status]}
      </Chip>
    );
  }
  return <Chip tone="muted">{STATUS_LABEL[status]}</Chip>;
}

export function ResponsesView({ histories, dates, subjects, hits, surfaces, localeLabel, onTrack }: ResponsesViewProps) {
  const latestDate = dates[dates.length - 1] ?? null;
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const date = pickedDate && dates.includes(pickedDate) ? pickedDate : latestDate;
  const items = useMemo(
    () => (date ? collectAiResponses(histories, subjects, hits, surfaces, date) : []),
    [histories, subjects, hits, surfaces, date]
  );

  const shownItems = items.filter((i) => i.yours !== "notShown");
  const mentionedCount = shownItems.filter((i) => i.yours === "cited" || i.yours === "mentioned").length;
  const filtered = items.filter((i) => {
    if (status === "mentioned") return i.yours === "cited" || i.yours === "mentioned";
    if (status === "missing") return i.yours === "none";
    return true;
  });
  const openItem = items.find((i) => i.key === openKey) ?? null;

  if (surfaces.length === 0) {
    return (
      <EmptyState
        title="Organic results don't have AI answers"
        body="Switch the surface filter to All surfaces, AI Overview or AI Mode to browse what Google's AI said."
      />
    );
  }
  if (!date) {
    return <EmptyState title="No AI answers yet" body="Run tracking to capture AI Overview and AI Mode answers for your keywords." />;
  }

  return (
    <>
      <Panel
        icon={<IconMessage />}
        title="AI responses"
        subtitle="What Google's AI answered for each tracked keyword"
        actions={
          <>
            <SelectControl
              ariaLabel="Date"
              icon={<IconCalendar />}
              value={date}
              onChange={setPickedDate}
              options={[...dates].reverse().map((d) => ({ value: d, label: formatShortDate(d) }))}
            />
            <Segmented
              ariaLabel="Mention status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All" },
                { value: "mentioned", label: "Mentioned" },
                { value: "missing", label: "Not mentioned" },
              ]}
            />
          </>
        }
        bodyClassName="flex flex-col"
        footer={
          <span>
            Your brand appears in {mentionedCount} of {shownItems.length} AI answers on {formatShortDate(date)} ·{" "}
            {items.length - shownItems.length} searches showed no AI answer
          </span>
        }
      >
        {filtered.length === 0 ? (
          <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing matches this filter.
          </p>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((item) => (
              <ResponseRow key={item.key} item={item} onOpen={() => setOpenKey(item.key)} />
            ))}
          </ul>
        )}
      </Panel>

      {openItem ? (
        <ResponseDetail item={openItem} subjects={subjects} localeLabel={localeLabel} onTrack={onTrack} onClose={() => setOpenKey(null)} />
      ) : null}
    </>
  );
}

function ResponseRow({ item, onOpen }: { item: AiResponseItem; onOpen: () => void }) {
  const shown = item.yours !== "notShown";
  const mentionedSubjects = item.subjectHits.filter((h) => h.mentioned || h.cited);
  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--gridline)" }}>
      <button
        type="button"
        onClick={onOpen}
        disabled={!shown}
        className="flex w-full items-start gap-3 px-4 py-3 text-left enabled:hover:bg-[color-mix(in_srgb,var(--series-1)_5%,transparent)] disabled:cursor-default"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: "var(--border-hairline)" }}>
          <Favicon domain="google.com" size={14} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {item.keyword}
            </span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
              {SURFACE_LABEL[item.surface]}
            </span>
          </span>
          <span className="line-clamp-2 text-xs" style={{ color: shown ? "var(--text-secondary)" : "var(--text-muted)" }}>
            {shown ? item.answer.text : `Google showed no ${SURFACE_LABEL[item.surface]} for this search.`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusChip status={item.yours} />
          {mentionedSubjects.length > 0 ? (
            <span className="flex -space-x-1">
              {mentionedSubjects.slice(0, 5).map((h) => (
                <span
                  key={h.subject.id}
                  className="flex h-5 w-5 items-center justify-center rounded-full border"
                  style={{ background: "var(--surface-1)", borderColor: "var(--border-hairline)" }}
                  title={h.subject.name}
                >
                  <Favicon domain={h.subject.website} label={h.subject.name} size={12} />
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function ResponseDetail({
  item,
  subjects,
  localeLabel,
  onTrack,
  onClose,
}: {
  item: AiResponseItem;
  subjects: Subject[];
  localeLabel: string;
  onTrack: (domain: string) => void;
  onClose: () => void;
}) {
  const [highlight, setHighlight] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mentioned = item.subjectHits.filter((h) => h.mentioned || h.cited);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6"
      style={{ background: "rgba(11, 11, 11, 0.45)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.keyword}
        onClick={(e) => e.stopPropagation()}
        className="grid h-full max-h-[92vh] w-full max-w-6xl grid-cols-1 overflow-hidden rounded-xl border shadow-2xl lg:grid-cols-[minmax(0,1fr)_320px]"
        style={{ background: "var(--surface-1)", borderColor: "var(--border-hairline)" }}
      >
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b px-5 py-3 text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)" }}>
            <button type="button" onClick={onClose} className="flex items-center gap-1 font-medium" style={{ color: "var(--text-primary)" }}>
              ← Back
            </button>
            <span aria-hidden style={{ color: "var(--gridline)" }}>
              |
            </span>
            <span className="flex items-center gap-1.5">
              <Favicon domain="google.com" size={14} />
              {SURFACE_LABEL[item.surface]}
            </span>
            <span className="uppercase">{localeLabel}</span>
          </div>

          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-5 sm:px-8">
            <h2 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {item.keyword}
            </h2>

            <dl className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-sm">
              <dt style={{ color: "var(--text-secondary)" }}>Date</dt>
              <dd>
                <Chip>
                  <IconCalendar />
                  {formatShortDate(item.date)}
                </Chip>
              </dd>
              <dt style={{ color: "var(--text-secondary)" }}>Visibility</dt>
              <dd>
                <StatusChip status={item.yours} />
              </dd>
              <dt style={{ color: "var(--text-secondary)" }}>Mentions</dt>
              <dd className="flex flex-wrap gap-2">
                {mentioned.length === 0 ? (
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    No tracked brand mentioned
                  </span>
                ) : (
                  mentioned.map((h) => (
                    <Chip key={h.subject.id} tone={h.subject.isYourBrand ? "good" : "neutral"}>
                      <Favicon domain={h.subject.website} label={h.subject.name} size={14} />
                      {h.subject.name}
                      {h.subject.isYourBrand ? (
                        <span style={{ color: "var(--success-text)" }}>
                          <IconCheck />
                        </span>
                      ) : null}
                    </Chip>
                  ))
                )}
              </dd>
            </dl>

            <div className="flex gap-3 border-t pt-5" style={{ borderColor: "var(--border-hairline)" }}>
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: "var(--border-hairline)" }}>
                <Favicon domain="google.com" size={14} />
              </span>
              <AnswerText text={item.answer.text ?? ""} subjects={subjects} highlight={highlight} />
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col overflow-y-auto border-t lg:border-l lg:border-t-0" style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)" }}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-hairline)" }}>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Details
            </span>
            <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none" style={{ color: "var(--text-secondary)" }}>
              ×
            </button>
          </div>

          <section className="flex flex-col gap-2 border-b px-4 py-4" style={{ borderColor: "var(--border-hairline)" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                Brands
              </span>
              <Switch checked={highlight} onChange={setHighlight} label="Highlight" />
            </div>
            <ul className="flex flex-col gap-1.5">
              {item.subjectHits.map((h) => {
                const found = h.mentioned || h.cited;
                return (
                  <li
                    key={h.subject.id}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm"
                    style={{
                      background: found
                        ? h.subject.isYourBrand
                          ? "color-mix(in srgb, var(--series-1) 14%, transparent)"
                          : "var(--surface-1)"
                        : "transparent",
                      color: found ? "var(--text-primary)" : "var(--text-muted)",
                    }}
                  >
                    <Favicon domain={h.subject.website} label={h.subject.name} size={16} />
                    <span className="truncate">{h.subject.name}</span>
                    <span className="ml-auto text-xs font-medium" style={{ color: found ? "var(--success-text)" : "var(--text-muted)" }}>
                      {h.cited && h.mentioned ? "Yes · cited" : h.cited ? "Cited" : h.mentioned ? "Yes" : "No"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex flex-col gap-2 px-4 py-4">
            <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              Sources ({item.answer.sources.length})
            </span>
            <SourceList sources={item.answer.sources} subjects={subjects} onTrack={onTrack} />
          </section>
        </aside>
      </div>
    </div>
  );
}
