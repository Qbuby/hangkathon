import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { clientIp, enforceRateLimit, RULES } from "@/lib/server/rate-limit";
import { writeAudit } from "@/lib/server/audit";
import { handleRouteError } from "@/lib/server/http";

/**
 * 第三方登录入口限流（检查表 8.2b）。
 * 正常人一分钟点一次就够，脚本几十秒就能把回调打满 —— 这里按 IP 挡住，
 * 挡住的请求写一条 security 类的审计日志，便于事后看到谁在试。
 */
async function guard(request: Request) {
  const ip = clientIp(request);
  await enforceRateLimit("signin", `signin:${ip}`, RULES.signin);
  return null;
}

const authHandlers = handlers;

export async function GET(request: NextRequest) {
  try {
    const limited = await guard(request);
    if (limited) return limited;
    return authHandlers.GET(request);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const limited = await guard(request);
    if (limited) return limited;
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/signin/")) {
      // 被限流拦下时这里走不到，但失败尝试本身要留痕：登录失败是安全事件的常见入口。
      await writeAudit(
        {
          category: "security",
          action: "auth.signin_attempt",
          result: "success",
          targetType: "auth",
          targetId: url.pathname.split("/").pop() ?? null,
          detail: { provider: url.pathname.split("/").pop() ?? null },
        },
        request,
      );
    }
    return authHandlers.POST(request);
  } catch (error) {
    return handleRouteError(error);
  }
}