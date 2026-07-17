import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies } from "next/headers";
import { AdminConsole } from "@/components/admin-console";
import { ADMIN_COOKIE_NAME, verifyAdminSession } from "@/lib/admin-auth";
import { listAdminPlaces } from "@/lib/place-repository";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [{ env }, cookieStore] = await Promise.all([
    getCloudflareContext({ async: true }),
    cookies(),
  ]);
  const authenticated = await verifyAdminSession(
    cookieStore.get(ADMIN_COOKIE_NAME)?.value,
    env.ADMIN_SESSION_SECRET,
  );
  const initialPlaces = authenticated ? await listAdminPlaces(env.DB) : [];

  return <AdminConsole initialAuthenticated={authenticated} initialPlaces={initialPlaces} />;
}
