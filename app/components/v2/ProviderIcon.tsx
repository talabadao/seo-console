"use client";

// A provider's icon at a fixed size, aspect ratio kept, original colors, on a neutral light badge so dark marks stay
// visible on dark surfaces. Decorative by default (alt=""): it sits next to the provider's visible name, which screen
// readers already announce. Pass `label` only when no name is shown next to it. Not a connection-status indicator.

import { useState } from "react";
import { PROVIDER_ICONS, type ProviderIconId } from "@/lib/providerIcons";

export function ProviderIcon({ id, size = 20, label }: { id: ProviderIconId; size?: number; label?: string }) {
  const [failed, setFailed] = useState(false);
  const icon = PROVIDER_ICONS[id];
  const inner = Math.round(size * 0.8);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-black/10 bg-white align-middle"
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label ?? icon.label}
    >
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon.src} alt="" width={inner} height={inner} style={{ width: inner, height: inner, objectFit: "contain" }} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
    </span>
  );
}
