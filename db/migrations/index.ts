import type { Migration } from "../../lib/migrations";
import { migration as baseline } from "./0001_baseline";
import { migration as projectSettings } from "./0002_project_settings";
import { migration as aiArea } from "./0003_ai_area";
import { migration as projectSerpapiMeta } from "./0004_project_serpapi_meta";
import { migration as accountCredentials } from "./0005_account_credentials";
import { migration as budgetLimits } from "./0006_budget_limits";
import { migration as kpiTargets } from "./0007_kpi_targets";
import { migration as syncCache } from "./0008_sync_cache";
import { migration as organicSerp } from "./0009_organic_serp";

/** Every migration, in id order. Append new ones; never edit or reorder applied ones. */
export const MIGRATIONS: readonly Migration[] = [baseline, projectSettings, aiArea, projectSerpapiMeta, accountCredentials, budgetLimits, kpiTargets, syncCache, organicSerp];
