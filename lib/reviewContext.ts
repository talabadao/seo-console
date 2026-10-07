import { getProject, serpKeyFor, type Project } from "@/lib/projects";
import type { ReviewProject } from "@/lib/reviews";

/** The project in the shape the reviews code uses, with its SerpApi key — or why it can't be used. */
export async function reviewContext(userId: number, projectId: number) {
  const project = await getProject(userId, projectId);
  if (!project) return { error: "unknown project", status: 404 } as const;
  const key = await serpKeyFor(project.id);
  if (!project.mapsUrl || !key) {
    return { error: "Add a Google Maps link and a SerpApi key in the project settings.", status: 400 } as const;
  }
  return { project: toReviewProject(project), key } as const;
}

function toReviewProject(p: Project): ReviewProject {
  return { id: p.id, name: p.name, mapsUrl: p.mapsUrl, placeRef: p.gbpLocation, placeTitle: p.gbpLocationTitle };
}
