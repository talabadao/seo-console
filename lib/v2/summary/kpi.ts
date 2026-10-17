// KPI target attainment, kept apart from project delivery status ("off track"
// belongs to Asana project status, not to a metric) and from change versus a
// comparison period.
//
// - Attainment compares the month-to-date actual with the FULL-MONTH target.
//   While the month is running, a KPI that hasn't reached its target yet is
//   "in progress", never "below target". After the month ends it is final.
// - Projection estimates the month end from the last 30 days' daily rate
//   (the Weekly Report's rule) and compares that with the target.
// Direction says whether a higher or lower value is desirable.

import type { KpiAttainment, KpiDirection, KpiItem, KpiProjection } from "./types";

export const ATTAINMENT_LABEL: Record<KpiAttainment, string> = {
  achieved: "Target achieved",
  above: "Above target",
  below: "Below target",
  "in-progress": "In progress",
  "no-target": "No target set",
  unavailable: "Data unavailable",
};

export const PROJECTION_LABEL: Record<KpiProjection, string> = {
  achieved: "Projected to achieve target",
  above: "Projected above target",
  below: "Projected below target",
};

/** Whether this attainment/projection is the desirable outcome, given the metric's direction. */
export function isGood(state: KpiAttainment | KpiProjection): boolean {
  return state === "achieved";
}

export function evaluateKpi(input: {
  id: string;
  label: string;
  direction?: KpiDirection;
  actual: number;
  /** null = no target (blank in KPI Planning); 0 is an explicit target of zero. */
  target: number | null;
  projected: number;
  monthComplete: boolean;
}): KpiItem {
  const direction = input.direction ?? "higher";
  const { actual, projected } = input;
  const target = input.target ?? 0;
  const hasTarget = input.target != null && input.target >= 0;
  const pct = (v: number) => (target > 0 ? (v / target) * 100 : 0);
  // For higher-is-better metrics, reaching the target is the goal; for lower-is-better ones (e.g. a cost or a
  // bounce rate), staying at or under it is, and going over is "above target".
  const compare = (v: number): KpiProjection =>
    direction === "higher" ? (v >= target ? "achieved" : "below") : v <= target ? "achieved" : "above";

  let attainment: KpiAttainment;
  if (!hasTarget) attainment = "no-target";
  else if (input.monthComplete) attainment = compare(actual);
  else if (direction === "higher") attainment = actual >= target ? "achieved" : "in-progress";
  // Lower-is-better: exceeding the full-month limit before the month ends is already final.
  else attainment = actual > target ? "above" : "in-progress";

  return {
    id: input.id,
    label: input.label,
    direction,
    actual,
    target,
    attainmentPct: pct(actual),
    attainment,
    projected,
    projectedPct: pct(projected),
    projection: hasTarget ? compare(projected) : "achieved",
  };
}
