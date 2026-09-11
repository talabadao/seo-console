import { NextRequest, NextResponse } from "next/server";
import { subMonths, subYears, format, parseISO } from "date-fns";
import { currentUser } from "@/lib/session";
import { accessTokenFor } from "@/lib/google/oauth";
import { siteConfigFor } from "@/lib/siteConfig";
import { resolveRange, type PresetId, type Range } from "@/lib/dateRanges";
import {
  cannibalization,
  lowHangingFruit,
  underperformingPages,
} from "@/lib/opportunities";
import type { SearchType } from "@/lib/google/searchconsole";

export const maxDuration = 300;

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const property = p.get("property");
  if (!property) return NextResponse.json({ error: "property required" }, { status: 400 });
  const sc = await siteConfigFor(user.id, property);
  if (!sc) return NextResponse.json({ error: "unknown property" }, { status: 404 });

  const searchType = (p.get("searchType") || "web") as SearchType;
  const preset = (p.get("preset") || "3m") as PresetId;
  const range: Range = resolveRange(preset, {
    customStart: p.get("start") || undefined,
    customEnd: p.get("end") || undefined,
  });

  let token: string;
  try {
    token = await accessTokenFor(user);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "auth" }, { status: 502 });
  }

  try {
    if (kind === "cannibalization") {
      return NextResponse.json({
        range,
        rows: await cannibalization(token, property, range, searchType, {
          minPages: Math.max(2, Number(p.get("minPages") || 2)),
          brandTerms: sc.config.brandTerms,
        }),
      });
    }

    if (kind === "low-hanging") {
      return NextResponse.json({
        range,
        rows: await lowHangingFruit(token, property, range, searchType, {
          posFrom: Number(p.get("posFrom") || 4),
          posTo: Number(p.get("posTo") || 10),
          minImpr: Number(p.get("minImpr") || 100),
        }),
      });
    }

    if (kind === "underperforming") {
      const months = Math.max(1, Number(p.get("months") || 2));
      const end = parseISO(range.end);
      const current: Range = { start: ymd(subMonths(end, months)), end: range.end };
      const previous: Range = {
        start: ymd(subMonths(end, months * 2)),
        end: ymd(subMonths(end, months)),
      };
      const yoy: Range = {
        start: ymd(subYears(parseISO(current.start), 1)),
        end: ymd(subYears(end, 1)),
      };
      return NextResponse.json({
        windows: { current, previous, yoy },
        rows: await underperformingPages(
          token,
          property,
          { current, previous, yoy },
          searchType,
          {
            months,
            minBaseline: Number(p.get("minBaseline") || 20),
            sharePct: Number(p.get("sharePct") || 0.5),
            perMonth: Number(p.get("perMonth") || 100),
          },
        ),
      });
    }

    return NextResponse.json({ error: "unknown report" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
