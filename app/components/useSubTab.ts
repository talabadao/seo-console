"use client";

import { useEffect, useState } from "react";

/** "sourceMedium" → "source-medium", for use in the address bar. */
const kebab = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * A tab's inner section (sub-tab) that is mirrored in the page address.
 * `slug` is the address segment the Dashboard read (empty for the default);
 * `onSlug` reports the user's choice back so the address can follow it.
 */
export function useSubTab<T extends string>(
  ids: readonly T[],
  fallback: T,
  slug: string | undefined,
  onSlug: ((slug: string) => void) | undefined,
): [T, (id: T) => void] {
  const fromSlug = ids.find((id) => kebab(id) === slug) ?? fallback;
  const [sub, setSub] = useState<T>(fromSlug);

  // Back/forward or a pasted link changed the address: follow it.
  useEffect(() => {
    setSub(fromSlug);
  }, [fromSlug]);

  return [
    sub,
    (id: T) => {
      setSub(id);
      onSlug?.(kebab(id));
    },
  ];
}
