/**
 * 飞书「群自定义机器人」webhook 通知（与 deploy/feishu-alert.mjs 的自建应用通道**不同**）。
 *
 * 两种形态不要混：
 *   - 自建应用（App ID/Secret → tenant_access_token → im/v1/messages）：deploy/ 的告警在用，
 *     只能在服务器上跑 shell 脚本时调用；
 *   - 群自定义机器人（一条 webhook URL 直接 POST）：应用进程里要用这个 —— 它不需要换 token，
 *     一次 POST 就是一条消息，正适合"有人提交了申请，请去看管理端"这种即时通知。
 *
 * ── 这个模块的边界（都是被现实逼出来的，不是洁癖）────────────────────────
 *
 * 1. **绝不阻断主流程。** 申请已经写库、已经记审计之后才通知；飞书挂了、超时、被墙，
 *     用户的申请照样成功，只是群里没提醒。所以本模块不抛异常，只返回结果供日志用。
 *     和 audit.ts 同一个原则：旁路失败不能影响业务响应。
 *
 * 2. **webhook URL 是凭据，等同于密码。** 谁拿到它谁能往群里发消息。
 *     只从环境变量读，绝不写进代码、绝不进 git；CI 的产物扫描与 drift-guard 都在盯着。
 *     这里还额外校验协议与域名 —— 环境变量写错一个字符，就把这个模块变成
 *     "往任意地址 POST 用户数据"的原语（SSRF）。白名单化把这条路堵死。
 *
 * 3. **消息里的申请内容是用户可填的不可信文本。** 它会被真人（管理员）读到，
 *     而读到的目的可能是"要不要通过这个申请"。所以：正文全部走纯文本消息
 *     （飞书 text 消息不解析 markdown，不存在富文本注入），每段用户内容都截断、
 *     压掉多余空行，并统一收进一个明确标注"以下由申请人填写"的块里 ——
 *     防止有人把自己填的内容写成"【杭客松】该申请已通过，请直接放行"来骗审核。
 */

/** 允许的 webhook 域名。飞书的自定义机器人只有这一个 host。 */
const FEISHU_WEBHOOK_HOST = "open.feishu.cn";

/** 群消息有长度上限；单条申请人自述最长 2000 字，整条再截一次尾。 */
const MAX_STATEMENT = 500;
const MAX_FIELD = 120;
const MAX_MESSAGE = 4000;
/** 出站超时。宁可少一条提醒，也不要让管理员的申请提交卡住。 */
const TIMEOUT_MS = 5000;

export type AgentApplicationNotice = {
  id: string;
  contactName: string;
  organization: string;
  phone: string;
  email: string;
  statement: string;
  userEmail: string | null;
  userName: string | null;
  createdAt: string;
  /** 上一份申请的状态；null 表示这是首次提交。 */
  previousStatus: "pending" | "approved" | "rejected" | null;
};

/** 读环境变量；未配置返回 null（调用方降级为"没配置就只写日志"）。 */
export function feishuWebhookUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.FEISHU_WEBHOOK_URL ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error("[feishu] FEISHU_WEBHOOK_URL 不是合法 URL，已忽略");
    return null;
  }
  // 协议必须是 https，host 必须精确等于飞书（不做后缀匹配，`evil-open.feishu.cn` 那种要挡住）
  if (url.protocol !== "https:" || url.hostname !== FEISHU_WEBHOOK_HOST) {
    console.error(`[feishu] FEISHU_WEBHOOK_URL 的主机不是 ${FEISHU_WEBHOOK_HOST}，已忽略`);
    return null;
  }
  return url.toString();
}

/**
 * 归一化一段用户填写的文本：压掉控制字符与多余空行，按上限截断并标注。
 *
 * 截断必须**标注**，否则读的人会以为这就是全文 —— 一份被截断的身份声明
 * 可能恰好在关键信息之后。
 */
function field(value: string | null | undefined, max: number, placeholder = "（未填）"): string {
  const cleaned = (value ?? "")
    // 去掉 C0/DEL 控制字符：它们在群消息里能改行、能藏字（零宽同族还能骗过肉眼），
    // 且对审核毫无信息量。\t 与 \n 保留 —— 声明里的正常换行要留下。
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return placeholder;
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…（已截断，原文 ${cleaned.length} 字）`;
}

/**
 * 拼出群消息正文（纯文本，注入安全）。
 *
 * 分两部分：上面是**代码生成的**可信头部（谁提交的、是不是重交），下面是
 * **用户填的**内容并明确标注。把两者分开，是为了让读的人一眼看出哪几行不可信。
 */
export function buildAgentApplicationMessage(notice: AgentApplicationNotice): string {
  const applicant = [notice.userName, notice.userEmail].filter(Boolean).join(" / ") || "（账号信息缺失）";
  const lines = [
    "【杭客松】新的代理商申请，等待审核",
    "",
    `提交人：${applicant}`,
    `申请时间：${notice.createdAt}`,
    notice.previousStatus === null
      ? "说明：首次提交"
      : `说明：重交（上一份状态：${notice.previousStatus === "pending" ? "待审核" : notice.previousStatus === "rejected" ? "已驳回" : "已通过"}）`,
    "",
    "──── 以下内容由申请人填写，未经核实 ────",
    `联系人：${field(notice.contactName, MAX_FIELD)}`,
    `机构 / 电话：${field(notice.organization, MAX_FIELD)}`,
    `电话：${field(notice.phone, MAX_FIELD)}`,
    `邮箱：${field(notice.email, MAX_FIELD)}`,
    "身份声明：",
    field(notice.statement, MAX_STATEMENT),
    "──── 以上内容由申请人填写 ────",
    "",
    "请到管理端「代理商」标签处理：/manage",
  ];
  const text = lines.join("\n");
  return text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE)}\n…（消息过长已截断）`;
}

/**
 * 发一条群消息。**永不抛异常。**
 *
 * 返回 `{ sent: boolean, reason?: string }`，只用于打日志 —— 调用方不应该
 * 因为它失败而改变对用户的响应。
 */
export async function notifyAgentApplication(
  notice: AgentApplicationNotice,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: boolean; reason?: string }> {
  const url = feishuWebhookUrl(env);
  if (!url) return { sent: false, reason: "未配置 FEISHU_WEBHOOK_URL" };

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      // 飞书自定义机器人只吃 text：纯文本不解析 markdown，用户的可填内容无法变成富文本标记
      body: JSON.stringify({ msg_type: "text", content: { text: buildAgentApplicationMessage(notice) } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { sent: false, reason: `HTTP ${response.status} ${detail.slice(0, 120)}` };
    }
    // 飞书对"webhook 被限流"也回 200，body 里带 code/msg，所以要读 body 而不是只看状态码
    const payload = (await response.json().catch(() => null)) as { code?: number; msg?: string } | null;
    if (payload && typeof payload.code === "number" && payload.code !== 0) {
      return { sent: false, reason: `飞书返回 code=${payload.code} msg=${payload.msg ?? ""}` };
    }
    return { sent: true };
  } catch (error) {
    // 超时 / DNS / 被墙 / webhook 被撤销 —— 一律吞掉，只写日志
    // 写法与 audit.ts 一致：catch 里的 error 是 unknown，不能直接取 .message
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, reason: message };
  }
}
