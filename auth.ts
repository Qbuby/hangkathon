import NextAuth from "next-auth";
import { headers } from "next/headers";
import WeChat from "next-auth/providers/wechat";

/**
 * OAuth credentials are supplied per environment, so a provider only joins the
 * config once its client id and secret are both present. The header entry reads
 * `oauthProviders` to decide whether to offer sign-in or explain that it is not
 * configured yet, instead of sending the visitor into a provider error page.
 */
/**
 * 可用的登录方式。**只保留微信**（2026-10-20 用户决定：GitHub / Google 直接废弃）。
 *
 * 为什么连 provider 注册一起删，而不是只把按钮藏起来：
 *   · 只要 provider 还注册着，`/api/auth/signin/github` 这类路由就仍然可达 ——
 *     一个"界面上看不见但直接访问能用"的登录入口，等于绕过产品决定。
 *   · 也少一处依赖第三方可达性的故障点：Google 的 OIDC discovery 在国内主机上
 *     根本连不通（实测 accounts.google.com 超时）。
 *
 * 代价必须说清楚：**微信 qrconnect 在手机普通浏览器里物理上无法完成** ——
 * 二维码就在用户自己那块屏幕上，同一台手机扫不了；微信还明确禁止长按/相册识别
 * （"该二维码仅支持在扫一扫时，通过摄像头来识别"）。
 * 所以手机端唯一可行的路径是**在微信内置浏览器里打开本站**：那里 qrconnect 会变成
 * "微信快捷登录"，轻触允许即可，不用扫码。界面按 UA 分流并给出引导，
 * 见 app/session-menu.tsx。
 */
export const oauthProviders = [
  {
    id: "wechat",
    name: "微信",
    configured: Boolean(process.env.AUTH_WECHAT_ID && process.env.AUTH_WECHAT_SECRET),
  },
];

/** 客户端登录按钮消费的列表。现在只剩微信，直接全量下发。 */
export const loginProviders = oauthProviders;

// 客户端视角的「能登录」：至少一家未隐藏且已配置的 provider。与 authConfigured（服务端
// 按全量列表判定，仅用于读取已有会话）分开：否则在 GitHub/Google 已配但被隐藏、微信又
// 未配凭据的部署上，登录框会只剩一个禁用按钮，而 configured=true 会吞掉缺配置的警告。
export const loginConfigured = loginProviders.some((provider) => provider.configured);

export const sessionSecretConfigured = Boolean(process.env.AUTH_SECRET);

export const authConfigured =
  sessionSecretConfigured && oauthProviders.some((provider) => provider.configured);

/** 按 id 查配置状态：注册条件不依赖数组下标，往 oauthProviders 中间插入新项不会错位。 */
const providerConfigured = (id: string) =>
  oauthProviders.find((provider) => provider.id === id)?.configured ?? false;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // 微信开放平台「网站应用」扫码登录：必须用 WebsiteApp 形态（PC 扫码走
    // open.weixin.qq.com/connect/qrconnect、scope=snsapi_login），默认的
    // OfficialAccount 是公众号网页授权，只在微信内置浏览器里有效。
    // 内置实现已处理好其余协议细节（@auth/core/providers/wechat.js）：token 接口
    // 响应带 openid 且 conform 补 token_type；userinfo 请求自动带上 access_token +
    // openid + lang；内置 profile 映射 unionid/nickname/headimgurl。
    ...(providerConfigured("wechat")
      ? [
          WeChat({
            clientId: process.env.AUTH_WECHAT_ID,
            clientSecret: process.env.AUTH_WECHAT_SECRET,
            platformType: "WebsiteApp",
            // 微信不返回邮箱，而本站的用户表按 email upsert、会话解析也以 email 为身份：
            // 合成一个稳定的占位邮箱，保证微信用户能建号登录。openid 恒定随每次响应返回，
            // 且跨「绑定开放平台」前后不变；unionid 只在绑定后才出现——若优先 unionid，
            // 绑定状态变化会把同一用户裂成两个账号，故 openid 优先（unionid 仅兜底；
            // 单应用部署下不同用户的 openid 必不相同，无需跨应用去重）。
            //
            // 2026-10-21：这里改成 async，先按 unionid 认人再返回身份。
            // 原因：手机端走公众号验证码登录，拿到的是**公众号**的 openid；如果一个人
            // 先在手机登录、后回电脑扫码，两边的占位邮箱不同，Auth.js 会照 email 再建一行，
            // 同一个人裂成两个号。先查一次 users.union_id 就能落到同一行。
            async profile(profile) {
              const p = profile as { unionid?: string; openid?: string; nickname?: string; headimgurl?: string };
              const wechatId = p.openid ?? p.unionid ?? "";
              /** 未配数据库的部署（Vercel 那份）保持原来的纯 JWT 行为。 */
              const base = {
                id: wechatId,
                name: p.nickname ?? null,
                // 与 lib/server/wechat-identity 的 wechatEmail 保持一致：**必须小写**。
                // 站内身份按 email 精确匹配，openid 里的大写会让同一个人裂成两行。
                email: wechatId ? `${wechatId}@wechat.user`.toLowerCase() : null,
                image: p.headimgurl ?? null,
              };
              if (!process.env.DATABASE_URL || !wechatId) return base;

              try {
                const { resolveWechatUser } = await import("@/lib/server/wechat-identity");
                const resolved = await resolveWechatUser({
                  openId: wechatId,
                  unionId: p.unionid ?? null,
                  nickname: p.nickname ?? null,
                  image: p.headimgurl ?? null,
                });
                return {
                  // id 仍是本应用的 openid：它只用于 Auth.js 内部的账户标识，
                  // 站内身份一律以 email 为准（recordAuthEvent 按 email upsert）。
                  id: wechatId,
                  // 库里已有的昵称优先：用户可能在手机端设置过，别被本次返回值覆盖。
                  name: resolved.name ?? p.nickname ?? null,
                  // 关键：用命中那一行的 email，Auth.js 才不会另建一行
                  email: resolved.email,
                  image: resolved.image ?? p.headimgurl ?? null,
                };
              } catch (error) {
                // 合并失败不能让登录挂掉：退回按 openid 建号的旧行为
                console.error("[auth] 微信 unionid 合并失败，回退到按 openid 建号", error);
                return base;
              }
            },
          }),
        ]
      : []),
  ],
  // Vercel terminates TLS in front of the app, and the Cloudflare target serves
  // through its own proxy; both need the forwarded host to be honoured.
  trustHost: true,
  // No database is provisioned, so the session lives in a signed cookie.
  // maxAge 7 天：JWT 无服务端吊销，令牌泄露后的暴露窗口 = 剩余有效期，
  // 30 天默认值太长（安全评估 P2#4）；高危操作的 step-up 认证是后续项。
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { error: "/auth-error" },
  // 登录/登出留痕（检查表 8.4.2c：登录时间、退出时间、IP 地址及端口）。
  // Auth.js 的事件里拿不到原始 Request，所以这里自己从 headers 重建来源地址。
  events: {
    async signIn({ user, account }) {
      const email = user.email ?? null;
      await recordAuthEvent("login", email, user.name ?? null, account?.provider ?? null);
    },
    async signOut(message) {
      // Auth.js 的 signOut 消息是 { token } | { session } 两种形状，这里只取 token 上的邮箱。
      const token = "token" in message ? message.token : null;
      await recordAuthEvent("logout", typeof token?.email === "string" ? token.email : null);
    },
  },
});

/**
 * 把登录相关事件写进审计日志，并更新 users 表上的最近登录痕迹。
 * 没有数据库的部署（Vercel 那份）整套函数静默跳过 —— 不影响登录本身。
 */
async function recordAuthEvent(
  kind: "login" | "logout",
  email: string | null,
  name?: string | null,
  provider?: string | null,
) {
  if (!process.env.DATABASE_URL) return;
  try {
    const requestHeaders = await headers();
    const forwarded = requestHeaders.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0]?.trim() || requestHeaders.get("x-real-ip") || null;
    const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
    const port = requestHeaders.get("x-forwarded-port") ?? (protocol === "https" ? "443" : "80");
    const userAgent = requestHeaders.get("user-agent");

    const { getDb, schema } = await import("@/db");
    const { writeAudit } = await import("@/lib/server/audit");
    const db = getDb();

    let userId: string | null = null;
    if (email) {
      // 首次登录即注册：upsert 出用户行，同时把注册这件事本身记进 register 类别。
      const [row] = await db
        .insert(schema.users)
        .values({ email, name: name ?? null, lastLoginAt: new Date(), lastLoginIp: ip })
        .onConflictDoUpdate({
          target: schema.users.email,
          set: {
            name: name ?? undefined,
            lastLoginAt: new Date(),
            lastLoginIp: ip,
          },
        })
        .returning({ id: schema.users.id, createdAt: schema.users.createdAt });
      userId = row?.id ?? null;
      if (row && Date.now() - row.createdAt.getTime() < 60_000) {
        await writeAudit({
          category: "register",
          action: "user.register",
          user: { id: row.id, email },
          ip,
          port,
          protocol,
          userAgent,
          method: "POST",
          path: "/api/auth/callback",
          targetType: "user",
          targetId: row.id,
          detail: { provider, name: name ?? null, channel: provider === "wechat" ? "微信扫码" : "OAuth" },
        });
      }
    }

    await writeAudit({
      category: "auth",
      action: `auth.${kind}`,
      user: userId && email ? { id: userId, email } : null,
      ip,
      port,
      protocol,
      userAgent,
      method: kind === "logout" ? "POST" : "GET",
      path: kind === "logout" ? "/api/auth/signout" : "/api/auth/callback",
      result: "success",
      detail: provider ? { provider } : {},
    });
  } catch (error) {
    console.error("[auth] 审计写入失败", error);
  }
}
