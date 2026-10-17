import { getProject, type Project } from "@/lib/projects";
import type { ReviewProject } from "@/lib/reviews";
import { resolveCredential } from "@/lib/credentials/resolve";

/**
 * The project in the shape the reviews code uses, with the acting team member's own SerpApi key and (optional)
 * OpenAI key — or why reviews can't be used. Reading saved reviews only needs to see the project (the key is then
 * optional: it only adds the person's own SerpApi balance); fetching or classifying needs management access and
 * the person's own keys (never another User's or a shared one).
 */
export async function reviewContext(userId: number, projectId: number, opts: { manage?: boolean } = {}) {
  const project = await getProject(userId, projectId);
  if (!project) return { error: "unknown project", status: 404 } as const;
  if (opts.manage && !project.canManage) {
    return { error: `Viewing is open to the whole team; fetching or analysing reviews for ${project.name} needs management access.`, status: 403 } as const;
  }
  const serp = await resolveCredential(userId, "serpapi", project.id);
  if (!opts.manage) {
    if (!project.mapsUrl) return { error: "Add the business's Google Maps link in Project settings.", status: 400 } as const;
    const openai = await resolveCredential(userId, "openai");
    return { project: toReviewProject(project), key: serp?.values.apiKey ?? null, openaiKey: openai?.values.apiKey ?? null } as const;
  }
  if (!project.mapsUrl || !serp) {
    return {
      error: !project.mapsUrl
        ? "Add the business's Google Maps link in Project settings."
        : "Add your own SerpApi key in Account → API credentials. Paid runs use the key of the person who starts them.",
      status: 400,
    } as const;
  }
  const openai = await resolveCredential(userId, "openai");
  return { project: toReviewProject(project), key: serp.values.apiKey, openaiKey: openai?.values.apiKey ?? null } as const;
}

function toReviewProject(p: Project): ReviewProject {
  return { id: p.id, name: p.name, mapsUrl: p.mapsUrl, placeRef: p.gbpLocation, placeTitle: p.gbpLocationTitle };
}
