import { getProject, type Project } from "@/lib/projects";
import type { ReviewProject } from "@/lib/reviews";
import { resolveCredential } from "@/lib/credentials/resolve";

/**
 * The project in the shape the reviews code uses, with the SerpApi key and (optional) OpenAI key the shared
 * credential resolver picks for this account and project — or why reviews can't be used.
 */
export async function reviewContext(userId: number, projectId: number) {
  const project = await getProject(userId, projectId);
  if (!project) return { error: "unknown project", status: 404 } as const;
  const serp = await resolveCredential(userId, "serpapi", project.id);
  if (!project.mapsUrl || !serp) {
    return {
      error: !project.mapsUrl
        ? "Add the business's Google Maps link in Project settings."
        : "Add a SerpApi key in Settings → Account → API credentials.",
      status: 400,
    } as const;
  }
  const openai = await resolveCredential(userId, "openai");
  return { project: toReviewProject(project), key: serp.values.apiKey, openaiKey: openai?.values.apiKey ?? null } as const;
}

function toReviewProject(p: Project): ReviewProject {
  return { id: p.id, name: p.name, mapsUrl: p.mapsUrl, placeRef: p.gbpLocation, placeTitle: p.gbpLocationTitle };
}
