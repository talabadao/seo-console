export function Landing({ configured }: { configured: boolean }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <div className="rounded-2xl border bg-surface p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">SEO Console</h1>
        <p className="mt-2 text-muted">
          A cleaner, more customizable view of Google Search Console (and Bing) performance,
          plus index &amp; crawl signals for technical SEO.
        </p>

        {configured ? (
          <a
            href="/api/auth/google"
            className="mt-6 inline-flex items-center gap-3 rounded-lg border bg-background px-5 py-3 font-medium transition hover:bg-accent-soft"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.85 14.1a6.6 6.6 0 0 1 0-4.2V7.05H2.18a11 11 0 0 0 0 9.9l3.67-2.85Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05L5.85 9.9C6.71 7.3 9.14 5.38 12 5.38Z"
              />
            </svg>
            Continue with Google
          </a>
        ) : (
          <div className="mt-6 rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm">
            <p className="font-medium text-bad">Google OAuth not configured</p>
            <p className="mt-1 text-muted">
              Copy <code>.env.local.example</code> to <code>.env.local</code>, fill in your
              Google client ID/secret, then restart the dev server.
            </p>
          </div>
        )}

        <p className="mt-6 text-xs text-muted">
          Read-only access. We request the Search Console scope only.
        </p>
      </div>
    </main>
  );
}
