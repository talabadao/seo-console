"use client";

// A single stored API credential: shows whether it's saved (masked identifier + when it was last saved),
// separately from whether it has been verified, and offers Add / Replace / Remove / Check. The raw secret is
// only ever sent to the server — it is never read back, so the input starts empty and an empty unchanged input
// means "keep the saved credential". Removal is an explicit action. Reused for project- and account-level keys.

import { useState } from "react";
import { buttonClass, primaryButtonClass } from "./ui";

export interface CredentialStatus {
  /** A saved credential's masked identifier, e.g. the last 4 characters; null when nothing is saved. */
  last4: string | null;
  /** When it was last saved (epoch ms); null when nothing is saved. */
  updatedAt: number | null;
}

export type CheckResult = { ok: boolean; message: string } | null;

export function CredentialField({
  label,
  hint,
  docsHref,
  status,
  onSave,
  onRemove,
  onCheck,
  inputType = "password",
  placeholder = "Paste the key",
}: {
  label: string;
  hint?: string;
  docsHref?: string;
  status: CredentialStatus;
  /** Saves (or replaces) the credential; resolves to an error message, or null on success. */
  onSave: (value: string) => Promise<string | null>;
  /** Removes the saved credential; resolves to an error message, or null on success. */
  onRemove: () => Promise<string | null>;
  /** Optional non-billable verification; resolves to a result to show, or null if unsupported. */
  onCheck?: () => Promise<CheckResult>;
  inputType?: "password" | "text";
  placeholder?: string;
}) {
  const saved = status.updatedAt != null || status.last4 != null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<null | "save" | "remove" | "check">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [check, setCheck] = useState<CheckResult>(null);

  async function save() {
    if (!value.trim()) {
      setError("Enter a key to save, or press Cancel to keep the saved one.");
      return;
    }
    setBusy("save");
    setError(null);
    const err = await onSave(value.trim());
    setBusy(null);
    if (err) {
      setError(err);
      return;
    }
    setValue("");
    setEditing(false);
    setCheck(null);
  }

  async function remove() {
    setBusy("remove");
    setError(null);
    const err = await onRemove();
    setBusy(null);
    setConfirmRemove(false);
    if (err) setError(err);
    else setCheck(null);
  }

  async function runCheck() {
    if (!onCheck) return;
    setBusy("check");
    setError(null);
    setCheck(await onCheck());
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-40 shrink-0 text-sm font-medium">{label}</span>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
          title={saved ? "A credential is stored on the server" : "No credential stored"}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: saved ? "var(--good)" : "var(--bad)" }} aria-hidden="true" />
          {saved ? "Saved" : "Not configured"}
        </span>
        {saved && (
          <span className="text-xs text-muted">
            {status.last4 ? <>••••{status.last4}</> : "stored"}
            {status.updatedAt ? ` · updated ${new Date(status.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!editing && (
            <button type="button" className={buttonClass} onClick={() => { setEditing(true); setError(null); setCheck(null); }}>
              {saved ? "Replace" : "Add"}
            </button>
          )}
          {saved && onCheck && !editing && (
            <button type="button" className={buttonClass} onClick={runCheck} disabled={busy === "check"}>
              {busy === "check" ? "Checking…" : "Check"}
            </button>
          )}
          {saved && !editing && !confirmRemove && (
            <button type="button" className="text-sm text-muted hover:text-bad" onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
          {confirmRemove && (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-muted">Remove the saved key?</span>
              <button type="button" className="font-medium text-bad" onClick={remove} disabled={busy === "remove"}>
                {busy === "remove" ? "Removing…" : "Yes"}
              </button>
              <button type="button" className="text-muted" onClick={() => setConfirmRemove(false)}>
                No
              </button>
            </span>
          )}
        </span>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type={inputType}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            aria-label={`${label} — new value`}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
          />
          <button type="button" className={primaryButtonClass} onClick={save} disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button type="button" className={buttonClass} onClick={() => { setEditing(false); setValue(""); setError(null); }}>
            Cancel
          </button>
        </div>
      )}

      {hint && !editing && <p className="text-xs text-muted">{hint}{docsHref ? <> · <a href={docsHref} target="_blank" rel="noreferrer" className="text-accent hover:underline">docs</a></> : null}</p>}
      {error && <p role="alert" className="text-xs" style={{ color: "var(--bad)" }}>{error}</p>}
      {check && (
        <p className="text-xs" style={{ color: check.ok ? "var(--good)" : "var(--bad)" }}>
          {check.ok ? "Verified: " : "Check failed: "}
          {check.message}
        </p>
      )}
    </div>
  );
}
