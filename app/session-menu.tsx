"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { ArrowRight, LogOut, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";

type SessionState = {
  configured: boolean;
  secret: boolean;
  providers: { id: string; name: string; configured: boolean }[];
  /** 被隐去但已配置的 provider（GitHub / Google）——微信扫码在手机上走不通时用。 */
  fallbackProviders?: { id: string; name: string; configured: boolean }[];
  user: { name: string | null; email: string | null } | null;
};

const SIGNED_OUT: SessionState = { configured: false, secret: false, providers: [], fallbackProviders: [], user: null };

/** Names the pieces a deployment is still missing, so the dialog can be specific. */
function missingConfig(state: SessionState) {
  const missing: string[] = [];
  if (!state.secret) missing.push("AUTH_SECRET（会话签名密钥）");
  if (!state.providers.some((provider) => provider.configured)) {
    missing.push("任一第三方登录的 OAuth 凭据");
  }
  return missing;
}

/**
 * 判断当前是不是**微信内置浏览器**。
 *
 * 为什么这条决定登录成败（2026-10-19）：微信「网站应用」的 qrconnect 有两种形态 ——
 *   · 普通浏览器：显示二维码，要用**另一台设备**的微信扫。手机上没有第二块屏幕，死路。
 *   · 微信内置浏览器：自动变成「微信快捷登录」，轻触允许即可，**根本不用扫码**
 *     （实测页面文案："使用微信快捷登录" / "在微信中轻触允许即可登录"）。
 *
 * 而微信明确禁止对登录二维码做长按/相册识别（用户截图里那句"该二维码仅支持在扫一扫时，
 * 通过摄像头来识别"），所以"截图存到相册再扫"这条路也被堵死了。
 *
 * 结论：手机端唯一可行的路径是**把页面放到微信里打开**。所以这里要能分辨，
 * 才能给出对的引导，而不是让用户对着一个永远扫不掉的二维码发呆。
 */
export function isWeChatBrowser(userAgent: string): boolean {
  return /MicroMessenger/i.test(userAgent);
}

/** 是否移动端（含平板）。只用于决定文案与引导，不用于功能开关。 */
export function isMobileBrowser(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(userAgent);
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

// lucide dropped its brand icons, so the GitHub mark is inlined.
function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

// 微信标志（绿色气泡）：lucide 无品牌图标，同 GitHubMark 一样内联。
function WeChatMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="10" r="8.5" fill="#07C160" />
      <path d="M7 17.4 5.5 21.3 11 18.1Z" fill="#07C160" />
      <circle cx="9" cy="8.5" r="1.2" fill="#fff" />
      <circle cx="15" cy="8.5" r="1.2" fill="#fff" />
    </svg>
  );
}

/** 按列表里的 provider id 选图标；未知 id 回落到 Google 标（与既有兜底一致）。 */
function ProviderMark({ id }: { id: string }) {
  if (id === "github") return <GitHubMark />;
  if (id === "wechat") return <WeChatMark />;
  return <GoogleMark />;
}

function initial(user: { name: string | null; email: string | null }) {
  const source = user.name?.trim() || user.email?.trim() || "";
  return source.slice(0, 1).toUpperCase() || "·";
}

// 微信账号的 email 是 auth.ts 用 openid 合成的占位地址（<openid>@wechat.user），
// 界面上不原样展示（数据库/管理端仍用它做身份键）。
function displayEmail(email: string | null) {
  return email?.endsWith("@wechat.user") ? "微信账号" : email;
}

export default function SessionMenu() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  /**
   * UA 只在客户端读，且初始为 null —— 服务端渲染时拿不到真实 UA，
   * 直接读会在首屏与客户端不一致（hydration mismatch）。null 表示"还没判断出来"，
   * 此时按普通浏览器处理（桌面端占绝大多数，体验不变）。
   */
  const [ua, setUa] = useState<{ wechat: boolean; mobile: boolean } | null>(null);
  useEffect(() => {
    // 项目惯例：effect 里不直接 setState（react-hooks/set-state-in-effect）；
    // 用 setTimeout(…, 0) 挪出本次渲染周期。
    const timer = window.setTimeout(() => {
      const agent = navigator.userAgent;
      setUa({ wechat: isWeChatBrowser(agent), mobile: isMobileBrowser(agent) });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const inWeChat = ua?.wechat ?? false;
  const onMobile = ua?.mobile ?? false;
  /** 手机上的普通浏览器：微信扫码在这里物理上做不到，必须引导去微信打开。 */
  const mobileOutsideWeChat = onMobile && !inWeChat;
  /**
   * 备用登录方式是否展开。**手机普通浏览器上默认展开** —— 那里微信走不通，
   * 不展开的话用户看到的就是一条引导 + 一个折叠着、看不见的出入口。
   * 用派生值而不是 setState：不需要同步两份状态，也就不会出现"展开状态与实际不符"。
   */
  const fallbackOpen = showFallback || mobileOutsideWeChat;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/session");
        const data = (await response.json()) as SessionState;
        if (!cancelled) setSession(data);
      } catch {
        if (!cancelled) setSession(SIGNED_OUT);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const user = session?.user ?? null;
  const providers = session?.providers ?? [];
  const fallbacks = session?.fallbackProviders ?? [];
  const wechatProvider = providers.find((provider) => provider.id === "wechat") ?? null;
  const ready = Boolean(session?.configured);
  const missing = session ? missingConfig(session) : [];

  return (
    <>
      {session === null ? (
        <span className="session-placeholder" aria-hidden="true" />
      ) : (
        <button
          className="session-button"
          onClick={() => setOpen(true)}
          aria-label={user ? `账号：${user.name ?? displayEmail(user.email) ?? "已登录"}` : "登录"}
        >
          {user ? (
            <span className="session-avatar" aria-hidden="true">{initial(user)}</span>
          ) : (
            <UserRound size={19} />
          )}
          <span className="session-label">{user ? user.name ?? displayEmail(user.email) ?? "已登录" : "登录"}</span>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="detail-dialog session-dialog" showCloseButton={false}>
          <DialogClose asChild>
            <Button variant="ghost" className="dialog-close" aria-label="关闭登录"><X size={20} /></Button>
          </DialogClose>

          {user ? (
            <>
              <p className="eyebrow">SIGNED IN</p>
              <DialogTitle className="dialog-title">{user.name ?? displayEmail(user.email) ?? "已登录"}</DialogTitle>
              <DialogDescription className="dialog-description">{displayEmail(user.email)}</DialogDescription>
              <div className="dialog-note">
                <span>当前状态</span>
                <p>已通过第三方账号登录。账号信息仅用于显示登录状态，不会写入数据库或用于其他用途。</p>
              </div>
              <Button asChild variant="ghost" className="session-profile">
                <Link href="/profile">查看个人主页 <ArrowRight size={16} /></Link>
              </Button>
              <Button className="dialog-done" onClick={() => signOut({ callbackUrl: "/" })}>
                退出登录 <LogOut size={16} />
              </Button>
            </>
          ) : (
            <>
              <p className="eyebrow">SIGN IN</p>
              <DialogTitle className="dialog-title">登录杭客松</DialogTitle>
              <DialogDescription className="dialog-description">
                使用第三方账号登录，之后可以用同一个身份发起活动、发布作品。
              </DialogDescription>
              {/*
                手机普通浏览器里的微信登录：二维码就在用户自己这块屏幕上，
                没法用同一台手机扫；微信又禁止长按/相册识别（实测报"该二维码仅支持
                在扫一扫时，通过摄像头来识别"）。所以这里**不渲染登录按钮**，
                直接给出唯一可行的路径：去微信里打开。
              */}
              {mobileOutsideWeChat && wechatProvider ? (
                <div className="wechat-mobile-guide">
                  <p className="wechat-mobile-guide-title">手机上的微信登录需要在微信里打开</p>
                  <p className="wechat-mobile-guide-body">
                    微信扫码要「另一台设备」才能完成 —— 二维码就在这块屏幕上，同一台手机扫不了它，
                    微信也不允许长按或从相册识别登录码。
                  </p>
                  <p className="wechat-mobile-guide-body">
                    在微信里打开本站，会变成**一键快捷登录**，不需要扫码：点右上角「···」→
                    「发送给朋友」发给自己，或复制下面的地址粘到微信里。
                  </p>
                  <div className="wechat-mobile-guide-actions">
                    <button
                      type="button"
                      className="provider-button wechat-mobile-copy"
                      onClick={() => {
                        const url = window.location.origin;
                        void navigator.clipboard?.writeText(url).then(
                          () => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 2500);
                          },
                          () => setCopied(false),
                        );
                      }}
                    >
                      <span>{copied ? "已复制，去微信粘贴打开" : `复制网址 ${typeof window === "undefined" ? "" : window.location.host}`}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="provider-list">
                  {providers.map((provider) => (
                    <button
                      key={provider.id}
                      className="provider-button"
                      disabled={!ready || !provider.configured || pending !== null}
                      onClick={() => {
                        setPending(provider.id);
                        void signIn(provider.id, { callbackUrl: "/" });
                      }}
                    >
                      <ProviderMark id={provider.id} />
                      <span>使用 {provider.name} 登录</span>
                      {!provider.configured && <span className="provider-state">未配置</span>}
                    </button>
                  ))}
                </div>
              )}
              {inWeChat && wechatProvider && (
                <p className="wechat-inapp-note">已检测到微信环境：点上方「使用微信登录」会直接弹出授权，无需扫码。</p>
              )}
              {fallbacks.length > 0 && (
                <div className="provider-fallback">
                  {/*
                    微信扫码要"另一台设备"才能完成：手机上二维码就在自己屏幕里，
                    没法用同一台手机扫（微信也禁止长按/相册识别）。
                    所以这里给一条出路，而不是让手机用户对着二维码干瞪眼。
                  */}
                  <button
                    type="button"
                    className="provider-fallback-toggle"
                    onClick={() => setShowFallback((value) => !value)}
                    aria-expanded={fallbackOpen}
                  >
                    {fallbackOpen ? "收起其他登录方式" : "手机扫码不便？用其他方式登录"}
                  </button>
                  {fallbackOpen && (
                    <div className="provider-list provider-list-fallback">
                      {fallbacks.map((provider) => (
                        <button
                          key={provider.id}
                          className="provider-button"
                          disabled={!ready || !provider.configured || pending !== null}
                          onClick={() => {
                            setPending(provider.id);
                            void signIn(provider.id, { callbackUrl: "/" });
                          }}
                        >
                          <ProviderMark id={provider.id} />
                          <span>使用 {provider.name} 登录</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="dialog-note">
                <span>{ready ? "说明" : "当前状态"}</span>
                <p>
                  {ready
                    ? "登录仅用于识别身份，本站不会读取你的仓库、邮件或其他账号数据。"
                    : `登录尚未启用：部署环境还缺少 ${missing.join(" 和 ")}。`}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
