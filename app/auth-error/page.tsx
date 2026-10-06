import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PageMotion from "../motion-mount";
import { oauthProviders, sessionSecretConfigured } from "@/auth";

const EXPLANATIONS: Record<string, string> = {
  Configuration: "服务端认证配置不完整，登录无法启动。",
  AccessDenied: "授权被取消，或者这个账号没有访问权限。",
  Verification: "登录链接已经失效，请重新发起登录。",
  OAuthSignin: "无法连接到登录服务商，请稍后重试。",
  OAuthCallback: "服务商回调校验失败，通常是这里的回调地址和 OAuth 应用里登记的不一致。",
  OAuthAccountNotLinked: "这个邮箱已经用另一种方式登录过。",
  Callback: "登录回调处理失败。",
};

/**
 * Auth.js sends failures here. Its own page only says to read the server logs,
 * which leaves the operator guessing, so this one names the error and reports
 * which credentials the running deployment is actually missing.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const code = error ?? "Configuration";

  const missing: string[] = [];
  if (!sessionSecretConfigured) missing.push("AUTH_SECRET");
  if (!oauthProviders.some((provider) => provider.configured)) {
    missing.push("任一第三方登录的 OAuth 凭据");
  }

  return (
    <main className="auth-error">
      <PageMotion page="auth-error" />
      <div className="auth-error-card">
        <p className="eyebrow" data-reveal="block">SIGN IN FAILED</p>
        <h1 className="dialog-title" data-reveal="block">登录没有完成</h1>
        <p className="dialog-description" data-reveal="block">
          {EXPLANATIONS[code] ?? "登录过程中出现未知错误。"}
        </p>

        <div className="dialog-note" data-reveal="block">
          <span>错误代码</span>
          <p>{code}</p>
        </div>

        {missing.length > 0 && (
          <div className="dialog-note" data-reveal="block">
            <span>当前部署缺少</span>
            <p>{missing.join(" 和 ")}。在部署环境补上并重新部署后即可登录。</p>
          </div>
        )}

        <Link className="auth-error-back" href="/" data-reveal="block">
          <ArrowLeft size={16} /> 返回首页
        </Link>
      </div>
    </main>
  );
}
