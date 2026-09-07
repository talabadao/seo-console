import { currentUser } from "@/lib/session";
import { Landing } from "@/app/components/Landing";
import { Dashboard } from "@/app/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  if (!user) return <Landing configured={configured} />;

  return (
    <Dashboard
      user={{ email: user.email, name: user.name, picture: user.picture }}
      bingConnected={Boolean(user.bing_api_key)}
    />
  );
}
