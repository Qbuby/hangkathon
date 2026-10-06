import { auth, authConfigured, loginConfigured, loginProviders, sessionSecretConfigured } from "@/auth";
import { hasDatabase } from "@/db";

export const dynamic = "force-dynamic";

/**
 * One round trip tells the header entry everything it needs: whether OAuth is
 * configured at all, which providers are usable, and who is signed in. The
 * `secret` flag is reported separately so the dialog can name the missing piece
 * instead of failing later inside the OAuth route.
 *
 * `database` tells the client which storage mode it is in: true 走服务端 API，
 * false 回落到 localStorage（Vercel 那份没有 DATABASE_URL，行为与改动前一致）。
 */
export async function GET() {
  const session = authConfigured ? await auth() : null;

  return Response.json({
    // 客户端视角的「可登录」：存在未隐藏且已配置的 provider（见 auth.ts loginConfigured）。
    // 上面的 auth() 仍按 authConfigured（全量列表）读取已有会话，两者语义不同。
    configured: loginConfigured,
    secret: sessionSecretConfigured,
    database: hasDatabase(),
    // 登录按钮列表：auth.ts 里已过滤掉暂时隐去的 provider（HIDDEN_LOGIN_PROVIDERS）。
    providers: loginProviders,
    user: session?.user
      ? {
          name: session.user.name ?? null,
          email: session.user.email ?? null,
        }
      : null,
  });
}
