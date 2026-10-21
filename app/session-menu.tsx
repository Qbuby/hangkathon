"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * 手机端的公众号验证码登录。
 *
 * ── 为什么是这个形态 ──────────────────────────────────────────────────
 * 微信「网站应用」的 qrconnect 只能出二维码，而手机上二维码就在用户自己屏幕上，
 * 无法自扫；微信也禁止长按/相册识别登录码。公众号（订阅号）又不支持带参二维码
 * 与网页授权。**但订阅号能收消息** —— 所以把方向反过来：
 *
 *   网页生成 6 位码 → 用户复制发给公众号 → 后端收到 openid → 前端轮询到就把
 *   会话 cookie 换回来。
 *
 * ── 用户体验上的三个细节 ──────────────────────────────────────────────
 *   1. 码一生成就**自动复制到剪贴板**，用户切到微信直接粘贴，不用手抄。
 *   2. 轮询每 3 秒一次、最长 10 分钟（与后端 TTL 一致），一旦 ready 立刻换票跳转。
 *   3. 换票失败（比如码被别人用掉）会给出明确文案并允许重新获取，
 *      而不是卡在"登录中"转圈。
 */
/**
 * 公众号二维码图片路径。
 *
 * 放在 public/assets 下，构建时原样拷贝。**图片缺失不能挡住登录** ——
 * 验证码那条路不依赖它，所以渲染时用 onError 兜底隐藏。
 */
const MP_QR_SRC = "/assets/wechat-mp-qrcode.png";

function MobileCodeLogin() {
  type Phase = "idle" | "issuing" | "waiting" | "exchanging" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [copied, setCopied] = useState(false);
  /** 二维码图加载失败时隐藏整块（图没放进来时不影响验证码这条路）。 */
  const [qrVisible, setQrVisible] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  /**
   * 已成功换到会话、正在跳转。**用 ref 而不是 phase** ——
   * 见下面 effect 里那段：phase 变化会触发 effect 清理，把 canceled 置 true，
   * 从而挡掉紧随其后的 reload()。这是我第一版卡在"正在完成登录"的真因。
   */
  const jumpingRef = useRef(false);

  const exchange = useCallback(async (target: string) => {
    setPhase("exchanging");
    try {
      const res = await fetch(`/api/auth/wechat-code/poll?code=${target}`, { method: "POST" });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        setPhase("error");
        setMessage(detail?.error ?? "换取登录状态失败，请重新获取验证码");
        return;
      }
      jumpingRef.current = true;
      setPhase("done");
      /**
       * 整页跳转而不是 router.refresh()：会话 cookie 刚由这个响应写入，
       * 只有重新发起文档请求，服务端组件才会带着新 cookie 渲染。
       *
       * 用 `location.replace` 而不是 `reload`：replace 不会在历史里留下
       * 一个"已经消费掉的验证码页"，用户点后退不会回到卡住的中间态。
       * 目标带 `?logged_in=1` 只是为了让地址栏变化、确保是新的文档请求。
       */
      window.location.replace(`${window.location.pathname}?logged_in=1`);
    } catch {
      setPhase("error");
      setMessage("网络异常，请重试");
    }
  }, []);

  // 轮询：只在 waiting 阶段跑
  useEffect(() => {
    if (phase !== "waiting" || !code || jumpingRef.current) return;
    let stopped = false;
    let timer: number | undefined;

    const tick = async () => {
      if (stopped || jumpingRef.current) return;
      try {
        const res = await fetch(`/api/auth/wechat-code/poll?code=${code}`, { cache: "no-store" });
        if (stopped || jumpingRef.current) return;
        if (!res.ok) {
          setPhase("error");
          setMessage("查询登录状态失败，请重试");
          return;
        }
        const data = (await res.json()) as { status: string };
        if (data.status === "ready") {
          /**
           * **先置 ref 再换 phase**：ref 是同步的，能挡住 effect 清理之后
           * 可能发生的第二次 tick；而 setPhase 是异步的，靠它防重来不及。
           */
          jumpingRef.current = true;
          void exchange(code);
          return;
        }
        if (data.status === "expired") {
          setPhase("error");
          setMessage("验证码已过期，请重新获取");
          return;
        }
        timer = window.setTimeout(tick, 3000);
      } catch {
        if (!stopped && !jumpingRef.current) timer = window.setTimeout(tick, 3000);
      }
    };

    timer = window.setTimeout(tick, 1500);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [phase, code, exchange]);

  const issue = async () => {
    setPhase("issuing");
    setMessage(null);
    try {
      const res = await fetch("/api/auth/wechat-code", { method: "POST" });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !data.code) {
        setPhase("error");
        setMessage(data.error ?? "获取验证码失败，请重试");
        return;
      }
      setCode(data.code);
      setPhase("waiting");
      // 自动复制：用户切到微信后直接粘贴，不用手抄 6 位数
      void navigator.clipboard?.writeText(data.code).then(
        () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 3000);
        },
        () => setCopied(false),
      );
    } catch {
      setPhase("error");
      setMessage("网络异常，请重试");
    }
  };

  if (phase === "idle" || phase === "issuing") {
    return (
      <div className="wechat-code-login">
        <p className="wechat-code-title">用微信登录</p>
        {/*
          公众号二维码：**可长按识别**（微信只禁止识别"登录码"，不禁止识别公众号）。
          这样用户既能长按二维码直接关注，也能走下面的验证码流程 —— 两条路并列，
          不用猜用户更习惯哪种。
          图片缺失时 onError 隐藏整块，不影响验证码这条路。
        */}
        {qrVisible && (
          <div className="wechat-code-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={MP_QR_SRC}
              alt="公众号「hangkathon.com杭客松」二维码"
              width={160}
              height={160}
              onError={() => setQrVisible(false)}
            />
            <p className="wechat-code-qr-hint">长按识别关注公众号，或搜索「hangkathon.com杭客松」</p>
          </div>
        )}
        <p className="wechat-code-body">
          关注后点下面按钮拿到 6 位数字，发给公众号即可完成登录。
        </p>
        <button type="button" className="primary-action wechat-code-btn" disabled={phase === "issuing"} onClick={() => void issue()}>
          {phase === "issuing" ? "正在生成…" : "获取 6 位验证码"}
        </button>
        {message && <p className="wechat-code-error" role="alert">{message}</p>}
      </div>
    );
  }

  if (phase === "done") {
    return <p className="wechat-code-body">登录成功，正在跳转…</p>;
  }

  return (
    <div className="wechat-code-login">
      <p className="wechat-code-title">请把验证码发给公众号</p>
      <div className="wechat-code-value" aria-label="登录验证码">
        {code}
      </div>
      <p className="wechat-code-body">
        {copied ? "已自动复制。" : ""}打开微信 → 搜索公众号「hangkathon.com杭客松」→
        把 <strong>{code}</strong> 发过去，页面会自动完成登录。
      </p>
      {copied && <p className="wechat-code-hint">已复制到剪贴板，直接在微信里粘贴即可。</p>}
      {phase === "waiting" && (
        <p className="wechat-code-status" aria-live="polite">
          <span className="wechat-code-spinner" aria-hidden="true" />
          等待公众号确认…
        </p>
      )}
      {phase === "exchanging" && <p className="wechat-code-status">正在完成登录…</p>}
      {/*
        手动兜底。公众号的回复里写着"如果没反应，点一下网页上的「我已完成」" ——
        那句话必须真的有对应按钮，否则就是一句空承诺（第一版就没做）。
        用途：轮询因为网络抖动停了、或者用户回了旧标签页，点一下立刻再查一次。
      */}
      {(phase === "waiting" || phase === "error") && code && (
        <button
          type="button"
          className="wechat-code-toggle wechat-code-done"
          onClick={() => {
            setMessage(null);
            jumpingRef.current = false;
            setPhase("waiting");
            void (async () => {
              const res = await fetch(`/api/auth/wechat-code/poll?code=${code}`, { cache: "no-store" });
              const data = (await res.json().catch(() => null)) as { status?: string } | null;
              if (data?.status === "ready") {
                jumpingRef.current = true;
                void exchange(code);
              } else {
                setMessage("还没收到公众号的确认，请确认已经把验证码发过去了。");
              }
            })();
          }}
        >
          我已完成，立即检查
        </button>
      )}
      {message && (
        <p className="wechat-code-error" role="alert">
          {message}
        </p>
      )}
      {phase === "error" && (
        <button type="button" className="primary-action wechat-code-btn" onClick={() => void issue()}>
          重新获取验证码
        </button>
      )}
      <button
        type="button"
        className="wechat-code-toggle"
        aria-expanded={showFallback}
        onClick={() => setShowFallback((v) => !v)}
      >
        {showFallback ? "收起" : "已关注用户，点此获取验证码"}
      </button>
      {showFallback && (
        <p className="wechat-code-body wechat-code-fallback">
          直接给公众号发任意一条消息，它会回同样的说明；登录仍需要上面这 6 位数。
        </p>
      )}
    </div>
  );
}

export default function SessionMenu() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
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
                手机端（含微信内置浏览器）：微信「网站应用」只能出二维码，而二维码就在
                用户自己屏幕上，扫不了；微信也禁止长按/相册识别登录码。所以手机端改走
                **公众号验证码**：网页给 6 位数 → 用户发给公众号 → 后端拿到 openid → 登录。

                订阅号不支持带参二维码和网页授权，但**接收消息**是基本能力 ——
                这就是这里能成立的原因。
              */}
              {onMobile && wechatProvider ? (
                <MobileCodeLogin />
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
                  已检测到微信环境：把上面的 6 位数直接发给公众号即可完成登录。
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
