import NextAuth from "next-auth";
import { headers } from "next/headers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import WeChat from "next-auth/providers/wechat";

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
  {
    id: "wechat",
    name: "微信",
    configured: Boolean(process.env.AUTH_WECHAT_ID && process.env.AUTH_WECHAT_SECRET),
  },
];

// 暂时隐去 GitHub / Google 的登录入口：只从返回给客户端（登录按钮）的列表里过滤掉，
// provider 本体仍注册（已有会话与 signIn 回调路由不受影响）。恢复时删除该常量即可。
const HIDDEN_LOGIN_PROVIDERS = ["github", "google"];

// 只在微信已配好凭据的部署上隐去它们——那种部署上微信就是唯一对外的入口。没配微信的
// 部署（Vercel 那份 hangkathon.net）必须留着 GitHub / Google：否则登录框里只剩一个
// 点不动的微信按钮，直接变成谁也登不进来的死局。
const wechatConfigured = oauthProviders.some(
  (provider) => provider.id === "wechat" && provider.configured,
);

/** 客户端登录按钮消费的列表（/api/session 返回这份，已应用 HIDDEN_LOGIN_PROVIDERS）。 */
export const loginProviders = oauthProviders.filter(
  (provider) => !wechatConfigured || !HIDDEN_LOGIN_PROVIDERS.includes(provider.id),
);

/**
 * 「备用登录方式」：被隐去但**确实已配置**的 provider。
 *
 * 为什么需要它（2026-10-19 用户反馈「手机上登陆不了」）：
 *   微信走的是 WebsiteApp 扫码（qrconnect），**在手机上物理上无法完成** ——
 *   二维码就显示在用户自己那块屏幕上，没法用同一台手机去扫；微信还明确禁止
 *   长按/相册识别（"该二维码仅支持在扫一扫时通过摄像头识别"）。
 *   于是手机端一个可点的入口都没有，直接死路。
 *
 * 处理方式：微信仍是主入口（桌面端体验不变），下面折一行「其他登录方式」，
 * 只在**存在可用的备用 provider** 时出现。不并进主列表是为了守住
 * 「微信为主」的产品决定；但也不该让手机用户无路可走。
 *
 * ── 为什么还要一层「实际可用」的白名单 ──────────────────────────────────
 * "已配置凭据" ≠ "能用"。2026-10-19 实测：自托管在国内，容器里
 * `wget https://accounts.google.com/.well-known/openid-configuration` **超时**
 * （GitHub 正常）。Auth.js 的 Google provider 走 OIDC discovery，拉不到配置就
 * 直接 `error=Configuration` —— 把 Google 放进备用入口，等于给用户一个
 * **点了就报错的死按钮**，比不放更糟。
 *
 * 所以由部署方用环境变量声明这台机器上真能连通的 provider：
 *   LOGIN_FALLBACK_PROVIDERS=github        （默认，国内主机）
 *   LOGIN_FALLBACK_PROVIDERS=github,google （境外主机 / 能连通 Google 的部署）
 *
 * 默认只放 github：宁可少一个入口，也不要多一个报错的入口。
 */
const FALLBACK_ALLOWLIST = (process.env.LOGIN_FALLBACK_PROVIDERS ?? "github")
  .split(",")
  .map((id) => id.trim().toLowerCase())
  .filter(Boolean);

export const fallbackLoginProviders = oauthProviders.filter(
  (provider) =>
    wechatConfigured &&
    HIDDEN_LOGIN_PROVIDERS.includes(provider.id) &&
    provider.configured &&
    FALLBACK_ALLOWLIST.includes(provider.id),
);

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
    ...(providerConfigured("github") ? [GitHub] : []),
    ...(providerConfigured("google") ? [Google] : []),
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
            profile(profile) {
              const p = profile as { unionid?: string; openid?: string; nickname?: string; headimgurl?: string };
              const wechatId = p.openid ?? p.unionid ?? "";
              return {
                id: wechatId,
                name: p.nickname,
                email: wechatId ? `${wechatId}@wechat.user` : null,
                image: p.headimgurl,
              };
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
