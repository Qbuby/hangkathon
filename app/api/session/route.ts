import { auth, authConfigured, oauthProviders } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * One round trip tells the header entry everything it needs: whether OAuth is
 * configured at all, which providers are usable, and who is signed in.
 */
export async function GET() {
  const session = authConfigured ? await auth() : null;

  return Response.json({
    configured: authConfigured,
    providers: oauthProviders,
    user: session?.user
      ? {
          name: session.user.name ?? null,
          email: session.user.email ?? null,
        }
      : null,
  });
}
