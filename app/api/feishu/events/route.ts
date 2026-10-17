import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { databaseRequired } from "@/lib/server/http";
import {
  confirmCard,
  consumeConfirmToken,
  markEventOnce,
  newConfirmToken,
  parseInbound,
  peekDecrypted,
  replyToMessage,
  sendChatCard,
  textCard,
  type FeishuCard,
  updateChatCard,
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
  /** 卡片消息 id —— 用来把那张卡片原地换成终态。 */
  open_message_id?: string;
  context?: { open_message_id?: string };
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
    shape = `json keys=[${keys}] type=${JSON.stringify(parsed.type ?? null)} hasEncrypt=${typeof parsed.encrypt === "string"} signed=${Boolean(request.headers.get("x-lark-signature"))}`;
  } catch {
    const sanitized = rawBody
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, 80);
    shape = `non-json prefix="${sanitized}"`;
  }
  /**
   * 验签头的实际取值也记下来。2026-10-16 卡在「时间戳不是数字」上 ——
   * 说明头**在**但值解析不出来，而不看实际值就只能猜。timestamp/nonce 本身不是机密，
   * signature 只记长度与前 8 位（不落全量签名，避免日志里留下可复用的凭据）。
   */
  const ts = request.headers.get("x-lark-request-timestamp");
  const nonce = request.headers.get("x-lark-request-nonce");
  const sig = request.headers.get("x-lark-signature");
  const sigInfo = sig ? `len=${sig.length} head=${sig.slice(0, 8)}` : "(无)";
  return `ct=${contentType} ua=${userAgent} bytes=${rawBody.length} ${shape} ts=${JSON.stringify(ts)} nonce=${JSON.stringify(nonce)} sig=${sigInfo}`;
}

/** 没有密钥时也要能读明文握手，所以单独留一个不抛异常的 JSON.parse。 */
function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 旁路调用：不抛异常，但**必须留下痕迹**。
 *
 * 这段代码原先到处是 `.catch(() => {})`，结果 2026-10-15 出了个很难查的现象：
 * 用户发了命令、日志显示鉴权正常拦截，但机器人**一声不吭** —— 回复失败了，
 * 而失败被空 catch 吞得干干净净。这正是本仓库反复吃的那类"静默失败"：
 * 现象在用户侧，原因在日志里查不到。空 catch 只在两种地方站得住：
 * 审计写入（audit.ts 自身永不抛）、以及这里这种"失败也不该影响主流程"的旁路。
 */
function bestEffort(label: string, work: Promise<unknown>): void {
  work.catch((error) => {
    console.error(`[feishu-bot] ${label} 失败：${String(error instanceof Error ? error.message : error)}`);
  });
}

export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;

  const rawBody = await request.text().catch(() => "");
  console.error(`[feishu-bot] 收到入站请求：${describeInbound(rawBody, request)}`);

  /**
   * ── url_verification 握手：最先处理，且**不要求验签** ──────────────────
   *
   * 这是本文件踩过两次坑的地方，事实记全（2026-10-15）：
   *
   *   ① 飞书点「保存」时会 POST 一个 challenge 握手，要求原样回 JSON。最初把它排在
   *      `requireEncryptKey()` 之后 → 没配密钥就 503 → 后台报「返回数据不是合法的JSON格式」，
   *      看着像 URL 不合法，其实是死锁。
   *   ② 排到前面之后仍然 401，日志显示**三个验签头一个都没有**
   *      （`ua=Go-http-client/1.1`、body 只有 `{encrypt}`、signature 三头全缺）。
   *      原因是 `parseInbound` 「先验签后解密」，而开了加密策略后飞书发来的握手是
   *      **加密但不带签名**的 —— 握手是建立信任的第一步，不可能用还没建立的信任自证。
   *
   * 所以这里用 `peekDecrypted`（只解密、不验签）把 challenge 取出来回显。
   * 这是安全的：结果**只用于回显一个字符串**，不读库、不落状态、不返回任何站内数据；
   * 而且它是完整解密，解不开就是解不开。**真正的事件一律走下面的 parseInbound，
   * 那里验签是强制的**（伪造签名 / 无签名头 → 401，均已实测）。
   *
   * 三种形态都认（都实测踩到过）：明文 JSON、加密信封、表单编码。
   */
  const encryptKey = requireEncryptKey();
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(rawBody);
    const challenge = form.get("challenge");
    if (form.get("type") === "url_verification" && challenge) {
      return NextResponse.json({ challenge });
    }
  } else {
    const peeked = encryptKey ? peekDecrypted(rawBody, encryptKey) : safeJsonParse(rawBody);
    if (peeked?.type === "url_verification" && typeof peeked.challenge === "string") {
      return NextResponse.json({ challenge: peeked.challenge });
    }
  }

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
    });
    console.error(`[feishu-bot] 拒绝未授权的 open_id=${openId ?? "(空)"} 的命令「${command.name}」`);
    bestEffort(
      "回复未授权提示",
      replyToMessage(
        messageId,
        "未授权：你的账号不在杭客松机器人管理员白名单里。如需开通，请让管理员在服务器 .env 的 FEISHU_ADMINS 里加入你的 open_id（该次请求已记入管理端审计日志，可在 /manage 查看）。",
      ),
    );
    return;
  }

  if (command.name === "帮助") {
    bestEffort("回复帮助", replyToMessage(messageId, helpText()));
    return;
  }

  if (isWriteCommand(command.name)) {
    try {
      const plan = await planWriteCommand(command.name, command.args);
      await sendChatCard(chatId, confirmCard(plan.title, plan.body, { command: plan.command, token: newConfirmToken() }, plan.danger));
      bestEffort("回复确认卡片提示", replyToMessage(messageId, "已生成确认卡片，请核对后点「确认执行」。"));
    } catch (error) {
      bestEffort("回复命令错误", replyToMessage(messageId, commandErrorText(error)));
    }
    return;
  }

  try {
    const result = await runReadCommand(command.name, command.args);
    await sendChatCard(chatId, textCard(`杭客松 · ${command.name}`, result.text.split("\n")));
  } catch (error) {
    bestEffort("回复命令错误", replyToMessage(messageId, commandErrorText(error)));
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
/**
 * 卡片回调的响应体。
 *
 * **必须至少带 `toast` 或 `card` 之一**，两者都缺时飞书报 `code: 200671`
 * （2026-10-15 用户点「取消」实际撞到：我当时返回的是空对象 `{}`）。
 * 所以这里把 toast 做成**强制参数** —— 让"忘了给提示"在类型上就写不出来。
 *
 * `card` 用来把按钮卡片替换成终态：点完之后按钮消失、结果显示在原处，
 * 群里不会留下一张还能再点的卡片。
 */
function cardActionResponse(
  toast: { type: "success" | "error" | "info" | "warning"; content: string },
  /** 终态卡片；给了就把原卡片原地换掉（按钮消失）。 */
  terminal?: { messageId: string | undefined; title: string; lines: string[]; ok: boolean },
): NextResponse {
  if (terminal?.messageId) {
    // 异步换卡片，不挡响应 —— 飞书要求快速回包，而更新卡片是一次出站请求。
    // 换不掉也只是按钮留在原地（功能不受影响），所以同样走 bestEffort。
    bestEffort(
      "更新卡片为终态",
      updateChatCard(terminal.messageId, terminalCard(terminal.title, terminal.lines, terminal.ok)),
    );
  }
  return NextResponse.json({ toast });
}

/**
 * 终态卡片：没有按钮、只有一行结果说明。
 * 必须是 **2.0** 结构 —— 消息更新接口会用它去覆盖一张 2.0 卡片，
 * 混成 1.0 会报 `schemaV2 card can not change schemaV1`（实测）。
 */
function terminalCard(title: string, lines: string[], ok: boolean): FeishuCard {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: title }, template: ok ? "green" : "grey" },
    body: { elements: [{ tag: "markdown", content: lines.join("\n") }] },
  };
}

/**
 * 卡片回调里的"那张卡片"的消息 id。
 * v1 与 v2 把它放在不同位置（`event.open_message_id` vs `event.context.open_message_id`），
 * 两个都读 —— 实测哪个有效就用哪个，另一个读不到自然就是 undefined。
 */
function cardMessageId(event: FeishuEvent | undefined): string | undefined {
  return event?.open_message_id ?? event?.context?.open_message_id;
}

async function handleCardAction(event: FeishuEvent | undefined): Promise<NextResponse> {
  const openId: string | undefined = event?.operator?.operator_id;
  const value = (event?.action?.value ?? {}) as Record<string, string>;
  const command = typeof value.command === "string" ? value.command.trim() : "";

  /**
   * 「取消」：**不执行任何东西**（这是它存在的全部意义）。
   *
   * 响应里**只带 toast、不带 card**：2026-10-16 实测带 card 时飞书报 200672，
   * 大概率是回调响应的 card 按 1.0 结构校验、而我的卡片带 `schema: "2.0"`。
   * 与其赌一个猜出来的格式，不如只回最保守的 toast —— 按钮留在原地只是观感问题，
   * 而重复点击会不会重复执行由下面的**一次性令牌**兜住，那才是安全问题。
   */
  // 卡片消息 id 的位置实测确认一下（v1 在 event 上、v2 在 event.context 下）
  console.error(`[feishu-bot] 卡片回调：open_message_id=${event?.open_message_id ?? "(无)"} context.open_message_id=${event?.context?.open_message_id ?? "(无)"}`);

  if (!command) {
    return cardActionResponse(
      { type: "info", content: "已取消，没有执行任何操作" },
      { messageId: cardMessageId(event), title: "已取消", lines: ["没有执行任何操作。"], ok: false },
    );
  }

  const operator = await resolveOperator(openId);
  if (!operator) {
    await writeAudit({
      category: "security",
      action: "feishu.bot.denied",
      method: "POST",
      path: "/api/feishu/events",
      detail: { stage: "card-action", openId: openId ?? null, command },
    });
    return cardActionResponse(
      { type: "error", content: "未授权，操作没有执行" },
      { messageId: cardMessageId(event), title: "未执行", lines: ["你的账号不在管理员白名单里，本次操作没有执行。"], ok: false },
    );
  }

  const args = command.split(/\s+/).slice(1);

  /**
   * 一次性令牌：同一张卡片的按钮被点第二次时，这里直接挡住。
   * event_id 去重挡不住这个 —— 两次点击是两个不同的 event_id。
   * 删除用户、删活动这类不可逆操作，不能指望"用户只点一次"。
   */
  if (!consumeConfirmToken(value.token)) {
    console.error(`[feishu-bot] 拒绝重复执行（令牌已消费）：${command}`);
    return cardActionResponse(
      { type: "warning", content: "这条确认已经处理过了，不会重复执行" },
      { messageId: cardMessageId(event), title: "已处理过", lines: ["这条确认之前已经处理过，不会重复执行。"], ok: false },
    );
  }

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
    });
    console.error(`[feishu-bot] ${operator.email} 通过飞书执行：${command}`);
    // 结果行放进 toast —— 卡片不再被替换，这是用户点完唯一能看到的反馈
    const summary = result.lines.join(" ").slice(0, 90);
    return cardActionResponse(
      { type: "success", content: summary || "已执行" },
      { messageId: cardMessageId(event), title: "已执行", lines: result.lines, ok: true },
    );
  } catch (error) {
    const text = commandErrorText(error);
    await writeAudit({
      category: "admin",
      action: "feishu.command.failed",
      user: operator.user,
      method: "POST",
      path: "/api/feishu/events",
      detail: { via: "feishu", feishuOpenId: operator.openId, command, args, error: text },
    });
    console.error(`[feishu-bot] 命令失败：${command}`, error);
    return cardActionResponse(
      { type: "error", content: "执行失败" },
      { messageId: cardMessageId(event), title: "执行失败", lines: [text], ok: false },
    );
  }
}
