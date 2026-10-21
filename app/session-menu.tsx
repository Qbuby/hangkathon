"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ArrowRight, LogOut, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { avatarInitial, displayEmail, displayName } from "@/lib/display-name";
import { LoginPanel } from "./login-panel";

/**
 * 顶栏的账号入口。
 *
 * 登录表单本身在 app/login-panel.tsx —— 首页、/create、/manage、/profile 共用同一个组件，
 * 手机端才会都走「公众号验证码」，不会再出现"某页还让你扫二维码"的不一致。
 */

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
 * 顶栏的展示名统一走 lib/display-name：
 * 微信账号没有昵称时，站内 email 是 `<openid>@wechat.user`，**绝不能直接显示** ——
 * 那等于把 openid 打在页面上（个人主页曾经就这样泄露过）。共享工具会换成
 * 「微信用户 · XXXX」的稳定短标签。
 */
function accountLabel(user: { name: string | null; email: string | null }): string {
  return displayName(user, "已登录");
}

export default function SessionMenu() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [open, setOpen] = useState(false);

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
          aria-label={user ? `账号：${accountLabel(user)}` : "登录"}
        >
          {user ? (
            <span className="session-avatar" aria-hidden="true">{avatarInitial(user)}</span>
          ) : (
            <UserRound size={19} />
          )}
          <span className="session-label">{user ? accountLabel(user) : "登录"}</span>
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
              <DialogTitle className="dialog-title">{accountLabel(user)}</DialogTitle>
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
                使用微信登录，之后可以用同一个身份发起活动、发布作品。
              </DialogDescription>
              <LoginPanel providers={providers} configured={ready} />
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
