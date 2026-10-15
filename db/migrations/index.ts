import type { Migration } from "../../lib/migrations";
import { migration as baseline } from "./0001_baseline";

/** Every migration, in id order. Append new ones; never edit or reorder applied ones. */
export const MIGRATIONS: readonly Migration[] = [baseline];
