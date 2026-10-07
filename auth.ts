import NextAuth from "next-auth";
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
  session: { strategy: "jwt" },
  pages: { error: "/auth-error" },
});
