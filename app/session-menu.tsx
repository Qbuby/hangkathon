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
  user: { name: string | null; email: string | null } | null;
};

const SIGNED_OUT: SessionState = { configured: false, secret: false, providers: [], user: null };

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
 *   · 微信内置浏览器：**同样是二维码**，扫不了自己（2026-10-20 实测纠正）。
 *     页面里确实有「微信快捷登录」这段文案，但它是 `display:none` 的备选分支，
 *     只有页面探测到本机 `localhost.weixin.qq.com:13013-14015` 有微信客户端时才显示 ——
 *     那是给**桌面微信客户端**用的，手机上没有这些端口在监听。
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

// lucide 不含品牌图标，微信标志内联（绿色气泡）。
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

/**
 * provider 图标。现在只剩微信 —— GitHub / Google 的登录方式已整体废弃（2026-10-20），
 * 对应的 SVG 组件与分支一并删掉；留着死分支会让人以为它们还"随时可以恢复"。
 */
function ProviderMark({ id }: { id: string }) {
  if (id === "wechat") return <WeChatMark />;
  return null;
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
  const [copied, setCopied] = useState(false);
  /**
   * UA 只在客户端读，且初始为 null —— 服务端渲染时拿不到真实 UA，
   * 直接读会在首屏与客户端不一致（hydration mismatch）。null 表示"还没判断出来"，
   * 此时按普通浏览器处理（桌面端占绝大多数，体验不变）。
   */
  const [ua, setUa] = useState<{ wechat: boolean; mobile: boolean } | null>(null);

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
  const user = session?.user ?? null;
  const providers = session?.providers ?? [];
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
                  <p className="wechat-mobile-guide-title">微信登录需要在电脑上扫码</p>
                  <p className="wechat-mobile-guide-body">
                    本站用的是微信「网站应用」登录：电脑上出二维码，用手机微信扫它。
                    手机上做不到 —— 二维码就在这块屏幕上，同一台手机扫不了自己；
                    微信也不允许长按或从相册识别登录码（截图同样不行）。
                  </p>
                  <p className="wechat-mobile-guide-body">
                    手机上可以正常浏览活动、看排行榜；需要发起活动、报名或提交作品时，
                    请在电脑上打开本站登录。
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
                      <span>{copied ? "已复制，去微信粘贴打开" : "复制本站网址"}</span>
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
                <p className="wechat-inapp-note">
                  当前在微信内置浏览器里：网站应用登录仍需扫码，而二维码就在这块屏幕上，无法自扫。
                  请改用电脑打开本站完成登录。
                </p>
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
