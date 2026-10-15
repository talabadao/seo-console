// Feature flag for the v2 console shell (Milestone 01b). Off unless the
// deployment sets V2_SHELL=1, so production keeps the classic dashboard until
// the owner turns it on. Read on the server only.
export function v2ShellEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.V2_SHELL === "1";
}
