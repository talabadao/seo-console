// Shown on a Preview deployment that is still missing settings, instead of a
// bare server error. Lists setting names only, never values.
export function PreviewNotConfigured({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <div className="rounded-2xl border bg-surface p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">SEO Console Preview</h1>
        <p className="mt-2 text-muted">
          This Preview is built, but it isn&apos;t configured yet, so sign-in is turned off. It never falls back to
          production&apos;s database or keys.
        </p>
        <div className="mt-6 rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm">
          <p className="font-medium text-bad">Missing Preview settings</p>
          <ul className="mt-2 list-disc pl-5 text-muted">
            {missing.map((key) => (
              <li key={key}>
                <code>{key}</code>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-muted">
            Steps: <code>docs/seo-console-v2/PREVIEW-SETUP.md</code>. Status: <code>/api/preview-status</code>.
          </p>
        </div>
      </div>
    </main>
  );
}
