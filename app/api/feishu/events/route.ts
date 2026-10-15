import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { databaseRequired } from "@/lib/server/http";
import {
  confirmCard,
  markEventOnce,
  parseInbound,
  replyToMessage,
  resultCard,
  sendChatCard,
  textCard,
} from "@/lib/server/feishu-api";
import { auditActionFor, CommandError, executeWrite, planWriteCommand, runReadCommand } from "@/lib/server/feishu-commands";
import { helpText, isWriteCommand, parseCommand, resolveOperator } from "@/lib/server/feishu-admin";

/**
 * 飞书事件入站端点（管理命令的入口）。
 *
 * **这是一个公网可访问的 POST 端点**，所以这里的每一行都在做同一件事：把"任何人可以往里打请求"
 * 变成"只有飞书能往里打请求，且只有白名单里的管理员能让它做事"。
 *
 * 顺序不能调换：
 *   1. 验签 + 时间窗（挡伪造与重放）—— 失败直接 401，且不回显原因（那是在送情报）
 *   2. url_verification challenge（飞书后台保存请求地址时的握手）
 *   3. event_id 去重（飞书在没收到 2xx 时会重投同一事件）
 *   4. 分发：im.message.receive_v1 = 命令；card.action.trigger = 卡片按钮
 *   5. **最后**才是 open_id → 站内管理员解析
 *
 * ── 为什么消息事件异步、卡片回调同步 ──────────────────────────────────────
 * 飞书要求 3 秒内响应，而"刷新作品指标"要调抖音接口、上限 12 秒。所以：
 *   - **消息事件**（跑一次查询、回一条结果）走 `void` 异步，1 秒内返回 200。
 *     代价是进程在任务完成前重启会丢这一次回复，用户重发一次即可。
 *   - **卡片回调**（执行变更、给出成败）必须同步返回，因为飞书靠返回值把按钮卡片
 *     替换成"已执行/失败"的终态 —— 异步的话用户点了按钮什么都看不到反馈，
 *     只会以为没点上，然后连点好几次。除了"刷新作品"可能超时（超时后飞书会重投，
 *     而刷新本身幂等），其余都是毫秒级的数据库操作。
 */
export const dynamic = "force-dynamic";

/**
 * 飞书事件载荷的**最小可信形状**。
 *
 * 刻意不用 any：这是外部输入，any 会让"字段可能不存在"在类型上消失，
 * 于是 `event.sender.sender_id.open_id` 这种链式访问会诱使人到处写 `!`。
 * 这里把所有字段都标成可选，强制调用方处理缺失 —— 真实事件里它们确实可能缺。
 */
type FeishuEvent = {
  sender?: { sender_id?: { open_id?: string } };
  message?: { message_id?: string; chat_id?: string; message_type?: string; content?: string };
  operator?: { operator_id?: string };
  action?: { value?: Record<string, string> };
};

const OK = () => new NextResponse("ok", { status: 200 });

/** 未配置加密密钥时一律拒绝：没有它就没有验签，等于把管理端口开到公网。 */
function requireEncryptKey(): string | null {
  return process.env.FEISHU_ENCRYPT_KEY?.trim() || null;
}

/**
 * 把入站请求的**形状**记下来（不记内容）。
 *
 * 为什么需要它：2026-10-15 排查时，"后台报返回数据不是合法 JSON"这个现象有两种完全不同的
 * 可能 —— ① 用户已经打开了加密策略，飞书发的是 `{"encrypt":"…"}`；② 飞书发的是表单编码
 * 而不是 JSON。两者都会走到"未配置密钥"那行日志，**光看日志分不出来**，于是只能靠猜，
 * 而猜错一次就是用户再等一个部署周期。所以这里把 content-type / UA / 字节数 /
 * 顶层键名 / 有没有 encrypt 记下来 —— 一行就能分辨，且不泄漏任何消息内容。
 *
 * 非 JSON 时只记清洗后的前 80 个字符：控制字符先清掉（否则外部内容能往日志里注入换行），
 * 截断防止刷屏。飞书的握手 challenge 本身不是敏感信息。
 */
function describeInbound(rawBody: string, request: Request): string {
  const contentType = request.headers.get("content-type") ?? "(none)";
  const userAgent = request.headers.get("user-agent") ?? "(none)";
  let shape: string;
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const keys = Object.keys(parsed).join(",");
    shape = `json keys=[${keys}] type=${JSON.stringify(parsed.type ?? null)} hasEncrypt=${typeof parsed.encrypt === "string"}`;
  } catch {
    const sanitized = rawBody
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, 80);
    shape = `non-json prefix="${sanitized}"`;
  }
  return `ct=${contentType} ua=${userAgent} bytes=${rawBody.length} ${shape}`;
}

export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;

  const rawBody = await request.text().catch(() => "");
  console.error(`[feishu-bot] 收到入站请求：${describeInbound(rawBody, request)}`);

  /**
   * ── url_verification 握手必须放在最前面，且不需要任何密钥 ──────────────
   *
   * 飞书后台点「保存」时会 POST 一个 `challenge` 握手，要求我们**原样回 JSON** 才算地址有效。
   * 这个握手是**不签名、不加密**的 —— 它出现的时候开发者还没机会去配 Encrypt Key。
   *
   * 原先的实现把 `requireEncryptKey()` 放在前面，没配就回 503，于是后台永远拿不到
   * 合法 JSON（2026-10-15 用户实际撞上，看起来像"URL 不合法"）。
   *
   * 放开验签在这里是安全的：下面两个分支都**只把 challenge 原样回显**，
   * 不读库、不落状态、不返回任何站内数据。它们唯一的作用是确认这个 URL 活着。
   *
   * **两种编码都要认**（第二种是实际踩到的）：JSON 体，以及
   * `application/x-www-form-urlencoded` 的表单体。后者用 JSON.parse 会直接抛，
   * 于是 falls through 到密钥检查 —— 症状和"加密了"一模一样，光看日志分不出来。
   */
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(rawBody);
    const challenge = form.get("challenge");
    if (form.get("type") === "url_verification" && challenge) {
      return NextResponse.json({ challenge });
    }
  } else {
    try {
      const maybeChallenge = JSON.parse(rawBody) as { challenge?: unknown; type?: unknown };
      if (maybeChallenge.type === "url_verification" && typeof maybeChallenge.challenge === "string") {
        return NextResponse.json({ challenge: maybeChallenge.challenge });
      }
    } catch {
      // 不是合法 JSON：交给下面的验签路径去拒绝（那里会给出更准确的拒绝理由）
    }
  }

  const encryptKey = requireEncryptKey();
  if (!encryptKey) {
    console.error("[feishu-bot] 未配置 FEISHU_ENCRYPT_KEY，拒绝所有入站请求");
    return new NextResponse("not configured", { status: 503 });
  }

  const parsed = parseInbound(rawBody, {
    timestamp: request.headers.get("x-lark-request-timestamp"),
    nonce: request.headers.get("x-lark-request-nonce"),
    signature: request.headers.get("x-lark-signature"),
  }, encryptKey);

  if (!parsed.ok) {
    console.error(`[feishu-bot] 拒绝请求：${parsed.reason}`);
    return new NextResponse("unauthorized", { status: 401 });
  }

  const payload = parsed.payload as {
    challenge?: string;
    type?: string;
    header?: { event_id?: string; event_type?: string };
    event?: FeishuEvent;
  };

  // 加密模式下 challenge 在密文里，走到这里说明验签已过，照样原样回显
  if (payload.type === "url_verification" && typeof payload.challenge === "string") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const eventId = payload.header?.event_id ?? "";
  if (eventId && !markEventOnce(eventId)) return OK();

  const eventType = payload.header?.event_type ?? "";
  if (eventType === "card.action.trigger") {
    return handleCardAction(payload.event);
  }
  if (eventType !== "im.message.receive_v1") {
    console.error(`[feishu-bot] 忽略未订阅的事件类型 ${eventType}`);
    return OK();
  }

  // 消息命令异步跑，但把异常吞掉：飞书看到 5xx 会重投一个已经回复过的命令
  void (async () => {
    try {
      await handleMessage(payload.event);
    } catch (error) {
      console.error("[feishu-bot] 处理消息失败", error);
    }
  })();
  return OK();
}

/* ────────────────────────── 群消息里的命令 ────────────────────────── */

async function handleMessage(event: FeishuEvent | undefined) {
  if (!event) return;
  const openId: string | undefined = event?.sender?.sender_id?.open_id;
  const messageId: string | undefined = event?.message?.message_id;
  const chatId: string | undefined = event?.message?.chat_id;
  const messageType: string | undefined = event?.message?.message_type;

  // 只处理文本；图片/文件/表情一律忽略
  if (messageType !== "text" || !messageId || !chatId) return;

  let text = "";
  try {
    text = JSON.parse(event?.message?.content ?? "{}").text ?? "";
  } catch {
    return;
  }

  const command = parseCommand(text);
  if (!command) return;

  const operator = await resolveOperator(openId);
  if (!operator) {
    /**
     * 拒绝时**不回显任何管理数据**，也**不回显对方的 open_id**：
     * 未授权者的 open_id 写进审计日志，管理员去 /manage 的审计日志里查就行，
     * 没必要在群里喊出来（群里人多，且 open_id 属于个人信息）。
     */
    await writeAudit({
      category: "security",
      action: "feishu.bot.denied",
      method: "POST",
      path: "/api/feishu/events",
      detail: { stage: "command", openId: openId ?? null, chatId, command: command.name },
    }).catch(() => {});
    console.error(`[feishu-bot] 拒绝未授权的 open_id=${openId ?? "(空)"} 的命令「${command.name}」`);
    await replyToMessage(
      messageId,
      "未授权：你的账号不在杭客松机器人管理员白名单里。如需开通，请让管理员在服务器 .env 的 FEISHU_ADMINS 里加入你的 open_id（该次请求已记入管理端审计日志，可在 /manage 查看）。",
    ).catch(() => {});
    return;
  }

  if (command.name === "帮助") {
    await replyToMessage(messageId, helpText()).catch(() => {});
    return;
  }

  if (isWriteCommand(command.name)) {
    try {
      const plan = await planWriteCommand(command.name, command.args);
      await sendChatCard(chatId, confirmCard(plan.title, plan.body, { command: plan.command }, plan.danger));
      await replyToMessage(messageId, "已生成确认卡片，请核对后点「确认执行」。").catch(() => {});
    } catch (error) {
      await replyToMessage(messageId, commandErrorText(error)).catch(() => {});
    }
    return;
  }

  try {
    const result = await runReadCommand(command.name, command.args);
    await sendChatCard(chatId, textCard(`杭客松 · ${command.name}`, result.text.split("\n")));
  } catch (error) {
    await replyToMessage(messageId, commandErrorText(error)).catch(() => {});
  }
}

function commandErrorText(error: unknown): string {
  return error instanceof CommandError
    ? `命令有问题：${error.message}`
    : `执行失败：${String(error instanceof Error ? error.message : error)}`;
}

/* ────────────────────────── 卡片按钮 ────────────────────────── */

/**
 * 卡片回调：**这里会真正改数据**，是整个功能里安全要求最高的入口。四道闸：
 *   1. 验签与时间窗（路由层已做，同一段代码，不可绕过）
 *   2. event_id 去重（飞书对卡片回调同样会重投 —— 不去重就是「点一下执行两次」）
 *   3. **再次**解析操作者：不能假设"下这条命令的人 == 点确认的人"，
 *      卡片会出现在群里，群里任何人都能点
 *   4. 命令串只接受 planWriteCommand 产出的形态，executeWrite 里再做一次存在性检查
 */
async function handleCardAction(event: FeishuEvent | undefined): Promise<NextResponse> {
  const openId: string | undefined = event?.operator?.operator_id;
  const value = (event?.action?.value ?? {}) as Record<string, string>;
  const command = typeof value.command === "string" ? value.command.trim() : "";

  // 点了「取消」：不回话。卡片本身已经是终态，不需要再打扰群里。
  if (!command) return NextResponse.json({});

  const operator = await resolveOperator(openId);
  if (!operator) {
    await writeAudit({
      category: "security",
      action: "feishu.bot.denied",
      method: "POST",
      path: "/api/feishu/events",
      detail: { stage: "card-action", openId: openId ?? null, command },
    }).catch(() => {});
    return NextResponse.json({ card: resultCard("未授权", ["你的账号不在管理员白名单里，本次操作没有执行。"], false) });
  }

  const args = command.split(/\s+/).slice(1);
  try {
    const result = await executeWrite(command, operator.user);
    const { category, action } = auditActionFor(command);
    await writeAudit({
      category,
      action,
      user: operator.user,
      method: "POST",
      path: "/api/feishu/events",
      targetType: "feishu_command",
      targetId: command,
      /**
       * via / feishuOpenId 是关键：日后要能分清这次变更是在群里点的卡片，还是在网页上点的。
       * 审计日志一旦 append-only 就改不了，缺了这个字段以后没法补。
       */
      detail: { via: "feishu", feishuOpenId: operator.openId, command, args },
    }).catch(() => {});
    console.error(`[feishu-bot] ${operator.email} 通过飞书执行：${command}`);
    return NextResponse.json({ card: resultCard(`已执行：${command.split(/\s+/)[0]}`, result.lines, true) });
  } catch (error) {
    const text = commandErrorText(error);
    await writeAudit({
      category: "admin",
      action: "feishu.command.failed",
      user: operator.user,
      method: "POST",
      path: "/api/feishu/events",
      detail: { via: "feishu", feishuOpenId: operator.openId, command, args, error: text },
    }).catch(() => {});
    console.error(`[feishu-bot] 命令失败：${command}`, error);
    return NextResponse.json({ card: resultCard("执行失败", [text], false) });
  }
}
