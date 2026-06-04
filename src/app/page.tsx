import { AuthGateway } from "@/components/auth-gateway";
import { resolveServerIdentity } from "@/lib/auth/server-identity";

// Identity is derived from request cookies, so this route cannot be statically
// rendered. force-dynamic ensures the server resolves identity per request.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialIdentity = await resolveServerIdentity();
  return <AuthGateway initialIdentity={initialIdentity} />;
}
