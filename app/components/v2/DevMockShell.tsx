"use client";

// Local-development only (see lib/v2/devMock.ts): answers the shell's /api
// calls with fixtures so it can be worked on without a database or sign-in.
// The server page renders this component only when devMockEnabled() is true.

import { useState, type ComponentProps } from "react";
import { mockApi } from "@/lib/v2/devMock";
import { Shell } from "./Shell";

let installed = false;

function installMockFetch() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (!url.startsWith("/api/")) return real(input, init);
    const { status, body } = mockApi(url);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof window.fetch;
}

export function DevMockShell(props: ComponentProps<typeof Shell>) {
  // Installed during the first render, before any child effect fetches.
  useState(() => {
    installMockFetch();
    return true;
  });
  return (
    <>
      <div role="note" className="bg-position/20 px-4 py-1 text-center text-xs">
        Local mock mode (V2_MOCK=1): fixture data, no sign-in. Never available on a deployment.
      </div>
      <Shell {...props} />
    </>
  );
}
