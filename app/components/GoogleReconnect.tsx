export function GoogleReconnectBanner({ detail }: { detail?: string }) {
  return (
    <div className="rounded-xl border border-bad/40 bg-bad/10 p-6 text-sm">
      <p className="font-medium text-bad">Your Google sign-in has expired.</p>
      <p className="mt-1 text-muted">
        {detail ?? "Google stopped accepting this app's access — sign in again to reconnect."}
      </p>
      <a
        href="/api/auth/google"
        className="mt-3 inline-block rounded-md bg-accent px-4 py-2 font-medium text-white"
      >
        Reconnect Google
      </a>
    </div>
  );
}
