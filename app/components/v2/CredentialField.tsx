"use client";

// One stored API credential. Two separate states, never merged:
// - Storage: Saved (masked identifier, last updated) or Not configured.
// - Connection: Verified / Check failed (with when and why) or Untested — from a non-billable check.
// The secret is only ever sent to the server; it is never read back, so the inputs start empty and leaving
// them untouched keeps the saved credential. Replace and Remove are explicit actions; success is shown only
// after the server confirms the write.

import { useState } from "react";
import type { CredentialFieldSpec, CredentialStatus } from "@/lib/credentials/providers";
import { buttonClass, primaryButtonClass } from "./ui";

const fmt = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Dot({ color }: { color: string }) {
  return <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />;
}

export function CredentialField({
  label,
  usedFor,
  fields,
  docsHref,
  checkNote,
  status,
  onSave,
  onRemove,
  onCheck,
}: {
  label: string;
  usedFor: string;
  fields: CredentialFieldSpec[];
  docsHref: string;
  checkNote: string;
  status: CredentialStatus;
  /** Resolves to an error message, or null when the server confirmed the save. */
  onSave: (values: Record<string, string>) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
  onCheck: () => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | "save" | "remove" | "check">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const saved = status.saved;
  const server = !saved && status.source === "server-legacy";

  async function run(kind: "save" | "remove" | "check", fn: () => Promise<string | null>, done: string) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    const err = await fn();
    setBusy(null);
    if (err) setError(err);
    else setNotice(done);
    return !err;
  }

  async function save() {
    const missing = fields.find((f) => !(values[f.name] ?? "").trim());
    if (missing) {
      setError(`Enter the ${missing.label.toLowerCase()}, or press Cancel to keep ${saved ? "the saved credential" : "it unset"}.`);
      return;
    }
    const ok = await run("save", () => onSave(Object.fromEntries(fields.map((f) => [f.name, values[f.name].trim()]))), saved ? "Replaced. The new credential is saved and untested." : "Saved. Untested until you run Check.");
    if (ok) {
      setValues({});
      setEditing(false);
    }
  }

  return (
    <section className="border-b border-border/60 py-4 last:border-0" aria-label={label}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{label}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {usedFor}{" "}
            <a href={docsHref} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Where to find it
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!editing && (
            <button type="button" className={buttonClass} onClick={() => { setEditing(true); setError(null); setNotice(null); }}>
              {saved ? "Replace" : "Add"}
            </button>
          )}
          {saved && !editing && (
            <button type="button" className={buttonClass} onClick={() => run("check", onCheck, "Check finished.")} disabled={busy === "check"} title={checkNote}>
              {busy === "check" ? "Checking…" : "Check connection"}
            </button>
          )}
          {saved && !editing && !confirmRemove && (
            <button type="button" className="text-sm text-muted hover:text-bad" onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
          {confirmRemove && (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-muted">Remove the saved {label} credential?</span>
              <button
                type="button"
                className="font-medium text-bad"
                disabled={busy === "remove"}
                onClick={async () => {
                  await run("remove", onRemove, "Removed.");
                  setConfirmRemove(false);
                }}
              >
                {busy === "remove" ? "Removing…" : "Remove"}
              </button>
              <button type="button" className="text-muted" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </span>
          )}
        </div>
      </div>

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <dt className="text-muted">Storage</dt>
          <dd className="flex items-center gap-1.5 font-medium">
            <Dot color={saved ? "var(--good)" : server ? "var(--warning, #b7791f)" : "var(--bad)"} />
            {saved ? (
              <>
                Saved <span className="font-normal text-muted">· {fields.length > 1 ? status.hint : `••••${status.hint ?? ""}`}{status.updatedAt ? ` · updated ${fmt(status.updatedAt)}` : ""}</span>
              </>
            ) : server ? (
              <>Using the server key (legacy, allowed for this account)</>
            ) : (
              "Not configured"
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted">Connection</dt>
          <dd className="flex items-center gap-1.5 font-medium">
            {!saved ? (
              <span className="font-normal text-muted">—</span>
            ) : status.verifyStatus === "ok" ? (
              <>
                <Dot color="var(--good)" /> Verified <span className="font-normal text-muted">{status.verifiedAt ? `· ${fmt(status.verifiedAt)}` : ""}</span>
              </>
            ) : status.verifyStatus === "failed" ? (
              <>
                <Dot color="var(--bad)" /> Check failed <span className="font-normal text-muted">{status.verifiedAt ? `· ${fmt(status.verifiedAt)}` : ""}</span>
              </>
            ) : (
              <>
                <Dot color="var(--muted, #888)" /> Untested
              </>
            )}
          </dd>
        </div>
      </dl>
      {saved && status.verifyMessage && <p className="mt-1 text-xs text-muted">{status.verifyMessage}</p>}

      {editing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {fields.map((f) => (
            <label key={f.name} className="min-w-[14rem] flex-1 text-xs">
              <span className="font-medium">{f.label}</span>
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
              />
            </label>
          ))}
          <button type="submit" className={primaryButtonClass} disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : saved ? "Save replacement" : "Save"}
          </button>
          <button type="button" className={buttonClass} onClick={() => { setEditing(false); setValues({}); setError(null); }}>
            Cancel
          </button>
          <p className="w-full text-xs text-muted">Saving stores the credential encrypted; it doesn&apos;t call {label} or run anything billable.</p>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="mt-2 text-xs text-muted">
          {notice}
        </p>
      )}
    </section>
  );
}
