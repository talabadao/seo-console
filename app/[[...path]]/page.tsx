import { currentUser } from "@/lib/session";
import { Landing } from "@/app/components/Landing";
import { Dashboard } from "@/app/components/Dashboard";
import { Shell } from "@/app/components/v2/Shell";
import { isShellPath } from "@/lib/v2/nav";
import { v2ShellEnabled } from "@/lib/v2/flag";
import { MOCK_USER, devMockEnabled } from "@/lib/v2/devMock";
import { DevMockShell } from "@/app/components/v2/DevMockShell";

export const dynamic = "force-dynamic";

// One page serves every console address — /<project>/<tab>/<sub-tab> — so a
// view can be bookmarked or shared; the Dashboard reads the path and keeps it
// in step as you move around. With the V2_SHELL flag on, the new console's
// addresses (/portfolio, /p/<id>/…, /docs) are served by the v2 shell; every
// other address keeps the classic dashboard, unchanged.
export default async function Home({ params }: { params: Promise<{ path?: string[] }> }) {
  // Local development only, with V2_MOCK=1: the shell on fixture data, no
  // sign-in. devMockEnabled() is false on every Vercel deployment.
  if (devMockEnabled()) {
    const { path } = await params;
    return <DevMockShell user={MOCK_USER} bingConnected={false} initialPath={isShellPath(path ?? []) ? path! : ["portfolio"]} />;
  }

  const user = await currentUser();
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  if (!user) return <Landing configured={configured} />;

  const { path } = await params;
  const segments = path ?? [];
  const props = {
    user: { email: user.email, name: user.name, picture: user.picture },
    bingConnected: Boolean(user.bing_api_key),
    initialPath: segments,
  };
  const v2 = v2ShellEnabled();
  if (v2 && isShellPath(segments)) return <Shell {...props} />;
  return <Dashboard {...props} v2Available={v2} />;
}
