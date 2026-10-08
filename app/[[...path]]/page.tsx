import { currentUser } from "@/lib/session";
import { Landing } from "@/app/components/Landing";
import { Dashboard } from "@/app/components/Dashboard";

export const dynamic = "force-dynamic";

// One page serves every console address — /<project>/<tab>/<sub-tab> — so a
// view can be bookmarked or shared; the Dashboard reads the path and keeps it
// in step as you move around.
export default async function Home({ params }: { params: Promise<{ path?: string[] }> }) {
  const user = await currentUser();
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  if (!user) return <Landing configured={configured} />;

  const { path } = await params;
  return (
    <Dashboard
      user={{ email: user.email, name: user.name, picture: user.picture }}
      bingConnected={Boolean(user.bing_api_key)}
      initialPath={path ?? []}
    />
  );
}
