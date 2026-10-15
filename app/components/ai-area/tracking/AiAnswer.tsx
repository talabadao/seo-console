"use client";

import { Fragment, type ReactNode } from "react";
import { domainMatchesWebsite, googleVia, type Subject } from "@/lib/ai-area/tracking/analytics";
import { isGoogleHost } from "@/lib/ai-area/tracking/visibility";
import type { AiTextSnapshot, SourceRef } from "@/lib/ai-area/tracking/types";
import { Favicon } from "./Favicon";
import { GoogleViaBadge, TrackButton } from "./ui";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps every subject name/alias in the text with a tinted mark - your brand in the accent tint, competitors in neutral. */
export function highlightSubjects(text: string, subjects: Subject[], enabled = true): ReactNode {
  if (!enabled) return text;
  const terms = subjects.flatMap((s) =>
    [s.def.name, ...s.def.aliases].filter((t) => t.trim()).map((t) => ({ term: t.trim(), subject: s }))
  );
  if (terms.length === 0 || !text) return text;
  terms.sort((a, b) => b.term.length - a.term.length);
  const pattern = new RegExp(`\\b(${terms.map((t) => escapeRegExp(t.term)).join("|")})\\b`, "gi");
  return text.split(pattern).map((part, i) => {
    const match = terms.find((t) => t.term.toLowerCase() === part.toLowerCase());
    if (!match) return <Fragment key={i}>{part}</Fragment>;
    return (
      <mark
        key={i}
        className="rounded px-0.5 font-semibold"
        style={{
          background: match.subject.isYourBrand
            ? "color-mix(in srgb, var(--series-1) 20%, transparent)"
            : "color-mix(in srgb, var(--text-muted) 18%, transparent)",
          color: "var(--text-primary)",
        }}
      >
        {part}
      </mark>
    );
  });
}

export function AnswerText({ text, subjects, highlight = true }: { text: string; subjects: Subject[]; highlight?: boolean }) {
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
      {lines.map((line, i) =>
        line.startsWith("- ") ? (
          <p key={i} className="flex gap-2 pl-2">
            <span aria-hidden style={{ color: "var(--text-muted)" }}>
              •
            </span>
            <span>{highlightSubjects(line.slice(2), subjects, highlight)}</span>
          </p>
        ) : (
          <p key={i}>{highlightSubjects(line, subjects, highlight)}</p>
        )
      )}
    </div>
  );
}

export function SourceList({
  sources,
  subjects,
  onTrack,
}: {
  sources: SourceRef[];
  subjects: Subject[];
  onTrack?: (domain: string) => void;
}) {
  if (sources.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        No sources listed.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {sources.map((s, i) => {
        const onGoogle = isGoogleHost(s.domain);
        const owner = subjects.find(
          (sub) =>
            domainMatchesWebsite(s.domain, sub.website) ||
            (onGoogle && [sub.def.name, ...sub.def.aliases].some((n) => n.trim().length > 2 && s.title.toLowerCase().includes(n.trim().toLowerCase())))
        );
        const via = googleVia(s.link);
        return (
          <li
            key={`${s.link}-${i}`}
            className="flex items-start gap-2 rounded-lg border p-2.5"
            style={{
              borderColor: owner?.isYourBrand
                ? "color-mix(in srgb, var(--series-1) 45%, transparent)"
                : via
                  ? "color-mix(in srgb, var(--series-4) 45%, transparent)"
                  : "var(--border-hairline)",
              background: owner?.isYourBrand
                ? "color-mix(in srgb, var(--series-1) 7%, transparent)"
                : via
                  ? "color-mix(in srgb, var(--series-4) 7%, transparent)"
                  : "var(--surface-1)",
            }}
          >
            <a href={s.link} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 flex-col gap-0.5 hover:opacity-90">
              <span className="flex items-center gap-2">
                <Favicon domain={s.domain} />
                <span className="line-clamp-1 text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                  {s.title || s.domain}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 pl-6 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span className="truncate">
                  {s.source && !onGoogle && !/\.[a-z]{2,}$/i.test(s.source) ? `${s.source} · ` : ""}
                  {s.domain}
                  {owner ? ` · ${owner.isYourBrand ? "you" : owner.name}` : ""}
                </span>
                {via ? <GoogleViaBadge via={via} /> : null}
              </span>
            </a>
            {onTrack && !owner && s.domain && !onGoogle ? <TrackButton onClick={() => onTrack(s.domain)} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AiAnswerBlock({
  answer,
  subjects,
  emptyLabel,
  onTrack,
}: {
  answer: AiTextSnapshot;
  subjects: Subject[];
  emptyLabel: string;
  onTrack?: (domain: string) => void;
}) {
  if (!answer.present || !answer.text) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <AnswerText text={answer.text} subjects={subjects} />
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
          Sources ({answer.sources.length})
        </span>
        <SourceList sources={answer.sources} subjects={subjects} onTrack={onTrack} />
      </div>
    </div>
  );
}
