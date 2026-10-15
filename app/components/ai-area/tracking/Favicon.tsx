"use client";

import { useState } from "react";

/** Google's public favicon service - no API key, works for any domain. Falls back to a lettered avatar. */
export function Favicon({ domain, label, size = 16 }: { domain: string; label?: string; size?: number }) {
  const [failedDomain, setFailedDomain] = useState<string | null>(null);
  const clean = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  if (!clean || failedDomain === clean) {
    const letter = (label || clean || "?").trim().charAt(0).toUpperCase() || "?";
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
        style={{
          width: size,
          height: size,
          fontSize: Math.max(8, Math.round(size * 0.55)),
          background: "var(--gridline)",
          color: "var(--text-secondary)",
        }}
      >
        {letter}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny external favicon, not worth next/image's remote-domain allowlisting
    <img
      src={`https://www.google.com/s2/favicons?sz=${size * 2}&domain=${encodeURIComponent(clean)}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-sm"
      onError={() => setFailedDomain(clean)}
    />
  );
}
