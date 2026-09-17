import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/**
 * OAuth credentials are supplied per environment, so a provider only joins the
 * config once its client id and secret are both present. The header entry reads
 * `oauthProviders` to decide whether to offer sign-in or explain that it is not
 * configured yet, instead of sending the visitor into a provider error page.
 */
export const oauthProviders = [
  {
    id: "github",
    name: "GitHub",
    configured: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  },
  {
    id: "google",
    name: "Google",
    configured: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  },
];

export const authConfigured =
  Boolean(process.env.AUTH_SECRET) && oauthProviders.some((provider) => provider.configured);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...(oauthProviders[0].configured ? [GitHub] : []),
    ...(oauthProviders[1].configured ? [Google] : []),
  ],
  // Vercel terminates TLS in front of the app, and the Cloudflare target serves
  // through its own proxy; both need the forwarded host to be honoured.
  trustHost: true,
  // No database is provisioned, so the session lives in a signed cookie.
  session: { strategy: "jwt" },
});
