/**
 * 飞书群里的管理命令层。
 *
 * 目标：在群里 @机器人 就能完成 /manage 的全部操作，不必开网页。
 *
 * ── 这个模块的安全模型（先读这段再改代码）──────────────────────────────
 *
 * 1. **「在群里」不等于「有权限」。** 群里任何人都能 @机器人。授权只看
 *    `FEISHU_ADMINS` 里的 open_id 白名单 —— 与网页端看 `ADMIN_EMAILS` 是同一件事，
 *    只是身份标识不同（网页是邮箱，飞书是 open_id）。未授权者一律拒绝并**只写审计**，
 *    不回显任何管理数据。
 *
 * 2. **操作者必须解析成一个真实的站内用户。** 不是为了审计好看，是因为
 *    `agent_applications.reviewed_by` 是指向 users.id 的 uuid 外键，
 *    `setUserRole/deleteUser` 还要用 operatorId 做"不能改自己"的判断。
 *    所以 `FEISHU_ADMINS` 配的是 `open_id=邮箱`，邮箱在 users 表里查到行才算数 ——
 *    这样远程操作走的是和网页端**完全相同**的那条代码路径与审计记录。
 *
 * 3. **写操作必须二次确认。** 命令只产生一张确认卡片，点按钮才执行。卡片回调
 *    同样验签、同样查白名单、同样按 event_id 去重。理由不是防攻击者（签名已经防住了），
 *    而是防**误操作与被诱导**：群里贴一段像命令的文本、或有人起哄，都不该立刻生效。
 *
 * 4. **所有动作都落审计。** 与网页端同一个 writeAudit，action 前缀 `admin.`，
 *    detail 里额外带 `via: "feishu"` 与操作者 open_id —— 出事后要能分清是人点的网页还是群里点的卡片。
 *
 * 5. **不实现的操作**：审计日志导出、黑名单增删虽然 /manage 里有，这里**也实现了**，
 *    但审计日志在群里只给条数与最近若干条的摘要（IP/UA 等字段脱敏）——
 *    群消息会留在飞书侧、转发出去也不可撤回，往群里倒全量审计等于把可溯源信息扩散出去。
 */

import type { ServerUser } from "./users";

/** 命令解析结果。 */
export type ParsedCommand = { name: string; args: string[]; raw: string };

/**
 * 从消息文本里解析命令。
 *
 * 飞书群里 @机器人 时，`content.text` 形如 `@_user_1 帮助` 或 `@杭客松 帮助`
 * （`@_user_1` 是飞书给 @提及 生成的占位符）。这里把提及前缀去掉，容忍全角/半角空格。
 *
 * **不做模糊匹配**：`帮助` 与 `help` 都收，但拼错的词会落到"未知命令"而不是"猜一个"——
 * 在管理命令上猜错代价比报错大得多。
 */
export function parseCommand(text: string): ParsedCommand | null {
  // 去掉 @_user_N 占位符与 @机器人名，以及它们后面跟的空格
  const cleaned = text
    .replace(/@_user_\d+/g, " ")
    .replace(/@[^\s@]{1,32}/g, " ")
    .trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const aliases: Record<string, string> = {
    help: "帮助",
    "?": "帮助",
    菜单: "帮助",
    overview: "总览",
    概览: "总览",
    act: "活动",
    acts: "活动",
    users: "用户",
    agent: "代理商",
    agents: "代理商",
    audit: "审计",
    log: "审计",
    bl: "黑名单",
    ban: "拉黑",
    events: "赛事",
    ok: "确认",
    y: "确认",
  };
  const head = (aliases[parts[0].toLowerCase()] ?? parts[0]);
  return { name: head, args: parts.slice(1), raw: cleaned };
}

/**
 * 解析 `FEISHU_ADMINS` 白名单：`open_id=邮箱` 逗号分隔。
 *
 * 例：`ou_aaa=owner@example.com,ou_bbb=ops@example.com`
 * 用 open_id 而不是邮箱做键，是因为消息事件里**只有 open_id**（飞书不在消息事件里给邮箱）。
 */
export function parseAdminBindings(raw: string | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of (raw ?? "").split(",")) {
    const entry = item.trim();
    if (!entry) continue;
    const at = entry.indexOf("=");
    if (at <= 0) continue;
    const openId = entry.slice(0, at).trim();
    const email = entry.slice(at + 1).trim().toLowerCase();
    // 只接受 ou_ 开头的 open_id 与像邮箱的值，避免 .env 里写错格式后静默半生效
    if (!/^ou_[A-Za-z0-9]+$/.test(openId)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    map.set(openId, email);
  }
  return map;
}

export type ResolvedOperator = { openId: string; user: ServerUser; email: string };

/**
 * 把 open_id 解析成站内管理员用户。
 *
 * 找不到就返回 null —— 调用方必须按"未授权"处理。这里刻意**不做任何降级**：
 * 宁可把一个配错的管理员挡在门外，也不要让远程操作以一个查不到的身份落到库里。
 */
export async function resolveOperator(
  openId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedOperator | null> {
  const openIdValue = (openId ?? "").trim();
  if (!openIdValue) return null;
  const binding = parseAdminBindings(env.FEISHU_ADMINS).get(openIdValue);
  if (!binding) return null;
  const { getUserByEmail } = await import("./users");
  const user = await getUserByEmail(binding);
  // 必须真的是管理员：白名单里写了一个普通用户的邮箱时不能放行
  if (!user || user.role !== "admin") return null;
  return { openId: openIdValue, user, email: binding };
}

/* ────────────────────────── 命令元数据 ────────────────────────── */

/**
 * 写操作清单：这些命令**只生成确认卡片**，不在第一次收到命令时就执行。
 *
 * 这份清单同时被 `/api/feishu/events` 用来区分「读命令直接回」与「写命令回确认卡片」，
 * 所以它是唯一的真相来源 —— 别在别处再写一遍 if 判断。
 */
export const WRITE_COMMANDS = new Set([
  "公开",
  "下线",
  "删除活动",
  "通过作品",
  "驳回作品",
  "撤回作品",
  "刷新作品",
  "移除报名",
  "代理商通过",
  "代理商驳回",
  "设为代理商",
  "设为用户",
  "设为管理员",
  "删除用户",
  "拉黑",
  "解拉黑",
  "隐藏赛事",
  "显示赛事",
  "删除赛事",
]);

export function isWriteCommand(name: string): boolean {
  return WRITE_COMMANDS.has(name);
}

const HELP_LINES = [
  "**读操作**（直接回结果）",
  "总览 · 活动 · 活动 <slug> · 用户 · 代理商 · 赛事 · 黑名单 · 审计 [条数]",
  "",
  "**写操作**（回确认卡片，点按钮才执行）",
  "公开 <slug> / 下线 <slug> / 删除活动 <slug>",
  "通过作品 <id> / 驳回作品 <id> / 撤回作品 <id> / 刷新作品 <id>",
  "移除报名 <slug> <userId>",
  "代理商通过 <id> [备注] / 代理商驳回 <id> [备注]",
  "设为代理商 <userId> / 设为用户 <userId> / 设为管理员 <userId> / 删除用户 <userId>",
  "拉黑 <邮箱> <理由> / 解拉黑 <id>",
  "隐藏赛事 <id> / 显示赛事 <id> / 删除赛事 <id>",
];

export function helpText(): string {
  return ["**杭客松管理命令**", ...HELP_LINES, "", "所有操作都会写入审计日志，与网页端 /manage 同源。"].join("\n");
}
