import type { Migration } from "../../lib/migrations";
import { migration as baseline } from "./0001_baseline";
import { migration as projectSettings } from "./0002_project_settings";
import { migration as aiArea } from "./0003_ai_area";
import { migration as projectSerpapiMeta } from "./0004_project_serpapi_meta";

/** Every migration, in id order. Append new ones; never edit or reorder applied ones. */
export const MIGRATIONS: readonly Migration[] = [baseline, projectSettings, aiArea, projectSerpapiMeta];
