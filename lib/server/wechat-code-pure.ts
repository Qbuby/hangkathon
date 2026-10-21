/**
 * 验证码登录的**纯函数**（不依赖数据库与任何服务端模块）。
 *
 * 单独成文件是为了可测：`wechat-code-login.ts` 引了 `@/db`，
 * 而测试用 data: URL 跑转译后的代码，没法解析 `@/` 别名。
 * 把这些逻辑留在那边就只能测个寂寞，或者干脆不测 —— 而"生成随机码"
 * 和"规范化用户输入"恰恰是最容易写错、又最该有回归防护的两处。
 */

import { randomInt } from "node:crypto";

/**
 * 生成 6 位数字验证码。
 *
 * 用 `randomInt` 而不是 `Math.random()`：后者是可预测的 PRNG，
 * 而这条码是**登录凭据**（拿到它就等于拿到那个 openid 的登录态）。
 * 6 位 = 100 万种，配合"10 分钟 + 一次性 + 每 IP 每小时 20 次"，暴力猜中的概率可忽略。
 *
 * 允许前导 0（用户看到的是 6 位数，`000123` 也是合法码）。
 */
export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** 规范化用户发来的文本：去空白、全角数字转半角。用户从网页复制时可能带空格。 */
export function normalizeSubmittedCode(raw: string): string | null {
  const cleaned = raw
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)) // 全角→半角
    .replace(/\s+/g, "")
    .trim();
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}
