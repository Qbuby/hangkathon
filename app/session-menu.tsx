"use client";

import { useEffect, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { LogOut, UserRound, X } from "lucide-react";
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
    missing.push("GitHub 或 Google 其中一家的 OAuth 凭据");
  }
  return missing;
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

function initial(user: { name: string | null; email: string | null }) {
  const source = user.name?.trim() || user.email?.trim() || "";
  return source.slice(0, 1).toUpperCase() || "·";
}

export default function SessionMenu() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

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
          aria-label={user ? `账号：${user.name ?? user.email}` : "登录"}
        >
          {user ? (
            <span className="session-avatar" aria-hidden="true">{initial(user)}</span>
          ) : (
            <UserRound size={19} />
          )}
          <span className="session-label">{user ? user.name ?? user.email : "登录"}</span>
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
              <DialogTitle className="dialog-title">{user.name ?? user.email}</DialogTitle>
              <DialogDescription className="dialog-description">{user.email}</DialogDescription>
              <div className="dialog-note">
                <span>当前状态</span>
                <p>已通过第三方账号登录。账号信息仅用于显示登录状态，不会写入数据库或用于其他用途。</p>
              </div>
              <Button className="dialog-done" onClick={() => signOut({ callbackUrl: "/" })}>
                退出登录 <LogOut size={16} />
              </Button>
            </>
          ) : (
            <>
              <p className="eyebrow">SIGN IN</p>
              <DialogTitle className="dialog-title">登录杭客松</DialogTitle>
              <DialogDescription className="dialog-description">
                用 GitHub 或 Google 账号登录，之后可以用同一个身份发起活动、发布作品。
              </DialogDescription>
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
                    {provider.id === "github" ? <GitHubMark /> : <GoogleMark />}
                    <span>使用 {provider.name} 登录</span>
                    {!provider.configured && <span className="provider-state">未配置</span>}
                  </button>
                ))}
              </div>
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
