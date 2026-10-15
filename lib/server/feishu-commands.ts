/**
 * 管理命令的执行与结果渲染。
 *
 * 与 `feishu-admin.ts` 的分工：那里管**安全**（谁能发命令、哪些命令要二次确认），
 * 这里管**做什么**（调用哪个 lib/server 函数、回什么内容）。
 *
 * 关键约束：**这里不重新实现任何业务逻辑**，一律调用网页端 /manage 用的同一批函数
 * （lib/server/admin.ts、agents.ts、blacklist.ts、audit.ts）。这不是洁癖 ——
 * 一旦这里自己写一套 SQL，"网页端改了这里没改"就会变成一个没人记得的双写漂移，
 * 而且审核动作（授予角色、删除用户）是不可逆的，不能容忍两份实现给出不同结果。
 */

import {
  adminOverview,
  deleteActivity,
  deleteUser,
  listActivityJoinsAdmin,
  listActivitySubmissionsAdmin,
  listAllActivities,
  listExternalEventsAdmin,
  listUsers,
  removeJoinAdmin,
  refreshSubmissionAdmin,
  setActivityReview,
  setActivityVisibility,
  setExternalEventHidden,
  setSubmissionReview,
  setUserRole,
  deleteExternalEventAdmin,
} from "./admin";
import { listAgentApplications, reviewAgentApplication } from "./agents";
import { addToBlacklist, listBlacklist, revokeBlacklist } from "./blacklist";
import { listAuditLogs, verifyAuditChain } from "./audit";
import type { ServerUser } from "./users";

/** 群里列表最多显示多少条 —— 飞书单条消息有长度上限，截断比静默丢数据更诚实。 */
const MAX_ROWS = 20;

function clip(value: string, max = 40): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

const yesNo = (value: boolean) => (value ? "是" : "否");

/* ────────────────────────── 读命令 ────────────────────────── */

export type ReadResult = { text: string };

export async function runReadCommand(name: string, args: string[]): Promise<ReadResult> {
  switch (name) {
    case "总览": {
      const o = await adminOverview();
      return {
        text: [
          "**总览**",
          `用户 ${o.users} · 活动 ${o.activities} · 报名 ${o.joins} · 作品 ${o.submissions}`,
          "",
          `待审活动 ${o.pendingActivities} · 待审作品 ${o.pendingReviews} · 待审代理商 ${o.pendingAgents}`,
        ].join("\n"),
      };
    }

    case "活动": {
      if (args.length === 0) {
        const rows = await listAllActivities();
        if (rows.length === 0) return { text: "还没有任何活动。" };
        const lines = rows.slice(0, MAX_ROWS).map((r) => {
          const flags = [r.visibility === "public" ? "公开" : r.visibility === "unlisted" ? "不公开" : r.visibility, r.reviewStatus === "published" ? "已审" : "**待审**", r.seeded ? "预置" : "用户"].join("/");
          return `\`${r.slug}\` ${clip(r.title, 24)} · ${flags} · 报名 ${r.joinCount} · 作品 ${r.submissionCount}`;
        });
        const tail = rows.length > MAX_ROWS ? `\n…共 ${rows.length} 条，只显示前 ${MAX_ROWS} 条` : "";
        return { text: `**活动（${rows.length}）**\n${lines.join("\n")}${tail}\n\n看详情：活动 <slug>` };
      }
      return activityDetail(args[0]);
    }

    case "用户": {
      const rows = await listUsers();
      if (rows.length === 0) return { text: "还没有用户。" };
      const lines = rows.slice(0, MAX_ROWS).map(
        (u) => `\`${shortId(u.id)}\` ${clip(u.email, 28)} ${clip(u.name ?? "—", 12)} · ${u.role} · 活动 ${u.activityCount} 报名 ${u.joinCount} 作品 ${u.submissionCount}`,
      );
      const tail = rows.length > MAX_ROWS ? `\n…共 ${rows.length} 条，只显示前 ${MAX_ROWS} 条` : "";
      return { text: `**用户（${rows.length}）**\n${lines.join("\n")}${tail}` };
    }

    case "代理商": {
      const rows = await listAgentApplications();
      if (rows.length === 0) return { text: "还没有代理商申请。" };
      const label = { pending: "待审核", approved: "已通过", rejected: "已驳回" } as const;
      const lines = rows.slice(0, MAX_ROWS).map(
        (r) => `\`${shortId(r.id)}\` ${clip(r.contactName, 10)} · ${clip(r.userEmail ?? "—", 24)} · ${label[r.status]} · ${clip(r.organization, 18)}`,
      );
      const pending = rows.filter((r) => r.status === "pending").length;
      const tail = rows.length > MAX_ROWS ? `\n…共 ${rows.length} 条，只显示前 ${MAX_ROWS} 条` : "";
      return { text: `**代理商申请（${rows.length}，待审 ${pending}）**\n${lines.join("\n")}${tail}\n\n通过：代理商通过 <id> [备注]` };
    }

    case "赛事": {
      const rows = await listExternalEventsAdmin();
      if (rows.length === 0) return { text: "全球赛事还是空的（每天 07:30 自动抓取）。" };
      const lines = rows.slice(0, MAX_ROWS).map((r) => `\`${shortId(r.id)}\` [${r.source}] ${clip(r.title, 30)}${r.hidden ? " · 已隐藏" : ""}`);
      return { text: `**全球赛事（${rows.length}）**\n${lines.join("\n")}` };
    }

    case "黑名单": {
      const rows = await listBlacklist();
      if (rows.length === 0) return { text: "黑名单是空的。" };
      const lines = rows.slice(0, MAX_ROWS).map(
        (b) => `\`${shortId(b.id)}\` ${clip(b.email, 26)} · ${clip(b.reason, 20)} · ${b.source} · ${b.revokedAt ? "已解除" : "生效中"}`,
      );
      return { text: `**黑名单（${rows.length}）**\n${lines.join("\n")}` };
    }

    case "审计": {
      const limit = Math.min(Math.max(Number(args[0]) || 10, 1), MAX_ROWS);
      const rows = await listAuditLogs({ limit });
      if (rows.length === 0) return { text: "审计日志为空。" };
      /**
       * 只给摘要。**刻意不把 IP / UA / 端口倒进群聊**：群消息留在飞书侧、转发出去撤不回，
       * 而这些字段正是 8.4.3 可溯源三件套的一部分。需要看全量请去 /manage 的审计日志标签。
       */
      const lines = rows.map((r) => `${r.createdAt.slice(5, 16).replace("T", " ")} \`${r.category}\` ${r.action} ${r.userEmail ? clip(r.userEmail, 20) : "系统"}`);
      const overview = await verifyAuditChain(200);
      return {
        text: [
          `**最近 ${rows.length} 条审计**`,
          ...lines,
          "",
          `哈希链校验：${overview.ok ? `通过（抽查 ${overview.checked} 条）` : `**断链，首个断点 ${overview.brokenAt}**`}`,
          "（IP/UA 等字段不在群里展示，全量请看 /manage）",
        ].join("\n"),
      };
    }

    default:
      throw new CommandError(`未知命令「${name}」。发「帮助」看可用命令。`);
  }
}

async function activityDetail(slug: string): Promise<ReadResult> {
  const rows = await listAllActivities();
  const row = rows.find((r) => r.slug === slug);
  if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。用「活动」列出全部。`);
  const submissions = await listActivitySubmissionsAdmin(row.id);
  const joins = await listActivityJoinsAdmin(row.id);
  const subLines = submissions.slice(0, 8).map(
    (s) => `\`${shortId(s.id)}\` ${s.reviewStatus} · ${clip(s.authorName ?? s.userEmail, 14)} · ❤️${s.diggCount ?? "-"} 💬${s.commentCount ?? "-"}${s.metricsError ? " · 指标失败" : ""}`,
  );
  const joinLines = joins.slice(0, 8).map((j) => `${clip(j.name ?? j.email, 16)}（${clip(j.email, 20)}）`);
  return {
    text: [
      `**${row.title}**`,
      `slug \`${row.slug}\` · ${row.visibility === "public" ? "公开" : "不公开"} · ${row.reviewStatus === "published" ? "已审" : "**待审**"} · ${row.seeded ? "预置活动" : "用户创建"}`,
      `发起人 ${clip(row.ownerName ?? row.ownerEmail ?? "—", 20)} · ${row.district} · 报名 ${row.joinCount} · 作品 ${row.submissionCount}`,
      "",
      `**作品（${submissions.length}）**`,
      subLines.length > 0 ? subLines.join("\n") : "（无）",
      "",
      `**报名（${joins.length}）**`,
      joinLines.length > 0 ? joinLines.join("\n") : "（无）",
    ].join("\n"),
  };
}

/* ────────────────────────── 写命令：确认卡片 ────────────────────────── */

export type ConfirmPlan = {
  /** 卡片标题，如「确认：公开活动」 */
  title: string;
  /** 卡片正文（给人事先看清楚将要发生什么）。 */
  body: string;
  /** 放进按钮 value 的指令；点「确认」后由 executeWrite 原样执行。 */
  command: string;
  /** 危险操作用红色按钮。 */
  danger: boolean;
};

/**
 * 把一条写命令翻译成「要不要执行」的卡片。
 *
 * **这里不做任何写操作** —— 所有真正的变更都在 executeWrite 里，那是唯一被回调触达的地方。
 */
export async function planWriteCommand(name: string, args: string[]): Promise<ConfirmPlan> {
  const need = (count: number, usage: string) => {
    if (args.length < count) throw new CommandError(`用法：${name} ${usage}`);
  };

  switch (name) {
    case "公开":
    case "下线": {
      need(1, "<slug>");
      const slug = args[0];
      const rows = await listAllActivities();
      const row = rows.find((r) => r.slug === slug);
      if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。`);
      if (name === "公开" && row.reviewStatus !== "published") {
        return {
          title: "确认：审核通过活动",
          body: `活动《${clip(row.title, 30)}》（\`${slug}\`）当前是**待审核**。\n审核通过后它会出现在公开列表里。`,
          command: `通过审核 ${slug}`,
          danger: false,
        };
      }
      const target = name === "公开" ? "public" : "unlisted";
      const word = name === "公开" ? "设为公开" : "设为不公开（从列表隐藏，链接仍可访问）";
      if (row.visibility === target) throw new CommandError(`已经是「${word}」状态，无需操作。`);
      return {
        title: `确认：${word}`,
        body: `活动《${clip(row.title, 30)}》（\`${slug}\`）\n\n${word}。`,
        command: `${name} ${slug}`,
        danger: false,
      };
    }

    case "删除活动": {
      need(1, "<slug>");
      const slug = args[0];
      const rows = await listAllActivities();
      const row = rows.find((r) => r.slug === slug);
      if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。`);
      if (row.seeded) throw new CommandError("预置活动拒绝删除（代码里会种回来）。要下线请用「下线」。");
      return {
        title: "确认：删除活动（不可撤销）",
        body: `即将删除《${clip(row.title, 30)}》（\`${slug}\`）\n\n其 ${row.joinCount} 条报名与 ${row.submissionCount} 条作品会**一并删除**，不可撤销。`,
        command: `删除活动 ${slug}`,
        danger: true,
      };
    }

    case "通过作品":
    case "驳回作品":
    case "撤回作品": {
      need(2, "<活动slug> <作品id>");
      const [slug, id] = args;
      const row = (await listAllActivities()).find((r) => r.slug === slug);
      if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。`);
      const sub = (await listActivitySubmissionsAdmin(row.id)).find((s) => s.id === id || s.id.startsWith(id));
      if (!sub) throw new CommandError(`活动 \`${slug}\` 下没有作品 \`${id}\`。`);
      const status = name === "通过作品" ? "approved" : name === "驳回作品" ? "rejected" : "pending";
      return {
        title: `确认：作品${status === "approved" ? "通过" : status === "rejected" ? "驳回" : "撤回为待审"}`,
        body: `作品 \`${shortId(sub.id)}\`\n作者 ${clip(sub.authorName ?? sub.userEmail, 20)}\n当前状态 ${sub.reviewStatus} → ${status}`,
        command: `${name} ${slug} ${sub.id}`,
        danger: false,
      };
    }

    case "刷新作品": {
      need(2, "<活动slug> <作品id>");
      const [slug, id] = args;
      const row = (await listAllActivities()).find((r) => r.slug === slug);
      if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。`);
      const sub = (await listActivitySubmissionsAdmin(row.id)).find((s) => s.id === id || s.id.startsWith(id));
      if (!sub) throw new CommandError(`活动 \`${slug}\` 下没有作品 \`${id}\`。`);
      return {
        title: "确认：刷新作品指标",
        body: [
          `作品 \`${shortId(sub.id)}\`（${clip(sub.authorName ?? sub.userEmail, 18)}）`,
          `当前 ❤️${sub.diggCount ?? "-"} 💬${sub.commentCount ?? "-"} ↗${sub.shareCount ?? "-"} ⭐${sub.collectCount ?? "-"}`,
          "",
          "会重新抓取该作品的点赞/评论/转发/收藏。",
        ].join("\n"),
        command: `刷新作品 ${slug} ${sub.id}`,
        danger: false,
      };
    }

    case "移除报名": {
      need(2, "<slug> <userId>");
      const [slug, userId] = args;
      const row = (await listAllActivities()).find((r) => r.slug === slug);
      if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。`);
      const joins = await listActivityJoinsAdmin(row.id);
      const hit = joins.find((j) => j.userId === userId || j.userId.startsWith(userId));
      if (!hit) throw new CommandError(`活动 \`${slug}\` 下没有用户 \`${userId}\` 的报名。`);
      return {
        title: "确认：移除报名",
        body: `移除 ${clip(hit.name ?? hit.email, 20)}（${hit.email}）在《${clip(row.title, 24)}》的报名。`,
        command: `移除报名 ${slug} ${hit.userId}`,
        danger: false,
      };
    }

    case "代理商通过":
    case "代理商驳回": {
      need(1, "<申请id> [备注]");
      const id = args[0];
      const rows = await listAgentApplications();
      const app = rows.find((r) => r.id === id || r.id.startsWith(id));
      if (!app) throw new CommandError(`没有 id 为 \`${id}\` 的代理商申请。用「代理商」列出全部。`);
      if (app.status !== "pending") throw new CommandError(`该申请已经是「${app.status}」，不能重复处理。`);
      const note = args.slice(1).join(" ") || null;
      const approve = name === "代理商通过";
      return {
        title: approve ? "确认：通过代理商申请（授予发布权）" : "确认：驳回代理商申请",
        body: [
          `申请人 ${clip(app.contactName, 14)} · ${clip(app.userEmail ?? "—", 24)}`,
          `机构 ${clip(app.organization, 24)} · ${app.phone}`,
          "",
          clip(app.statement, 160),
          approve ? "\n\n通过后对方**立即获得发布活动的权限**。" : note ? `\n\n备注：${clip(note, 80)}` : "",
        ].join("\n"),
        command: `${name} ${app.id}${note ? ` ${note}` : ""}`,
        danger: approve,
      };
    }

    case "设为代理商":
    case "设为用户":
    case "设为管理员": {
      need(1, "<userId>");
      const id = args[0];
      const user = (await listUsers()).find((u) => u.id === id || u.id.startsWith(id));
      if (!user) throw new CommandError(`没有 id 为 \`${id}\` 的用户。用「用户」列出全部。`);
      const role = name === "设为代理商" ? "agent" : name === "设为管理员" ? "admin" : "user";
      return {
        title: `确认：把 ${clip(user.email, 24)} 设为 ${role}`,
        body: `${clip(user.name ?? "—", 14)}（${user.email}）\n当前角色 ${user.role} → ${role}${role === "admin" ? "\n\n**管理员能删除活动、删除用户、拉黑**。" : ""}`,
        command: `${name} ${user.id}`,
        danger: role === "admin",
      };
    }

    case "删除用户": {
      need(1, "<userId>");
      const id = args[0];
      const user = (await listUsers()).find((u) => u.id === id || u.id.startsWith(id));
      if (!user) throw new CommandError(`没有 id 为 \`${id}\` 的用户。`);
      return {
        title: "确认：删除用户（不可撤销）",
        body: `删除 ${clip(user.name ?? "—", 14)}（${user.email}）\n\nTA 发起的 ${user.activityCount} 场活动会级联删除，报名 ${user.joinCount}、作品 ${user.submissionCount} 一并清理。审计日志保留。`,
        command: `删除用户 ${user.id}`,
        danger: true,
      };
    }

    case "拉黑": {
      need(2, "<邮箱> <理由>");
      const email = args[0].trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CommandError("邮箱格式不正确。");
      const reason = args.slice(1).join(" ");
      return {
        title: "确认：加入黑名单",
        body: `${email}\n\n理由：${reason}\n\n被拉黑的邮箱无法登录。`,
        command: `拉黑 ${email} ${reason}`,
        danger: true,
      };
    }

    case "解拉黑": {
      need(1, "<id>");
      const id = args[0];
      const entry = (await listBlacklist()).find((b) => b.id === id || b.id.startsWith(id));
      if (!entry) throw new CommandError(`黑名单里没有 id 为 \`${id}\` 的条目。`);
      if (entry.revokedAt) throw new CommandError("该条目已解除过。");
      return {
        title: "确认：解除黑名单",
        body: `${entry.email}（${entry.reason}）`,
        command: `解拉黑 ${entry.id}`,
        danger: false,
      };
    }

    case "隐藏赛事":
    case "显示赛事":
    case "删除赛事": {
      need(1, "<赛事id>");
      const id = args[0];
      const row = (await listExternalEventsAdmin()).find((e) => e.id === id || e.id.startsWith(id));
      if (!row) throw new CommandError(`没有 id 为 \`${id}\` 的赛事。`);
      const hidden = name === "隐藏赛事";
      if (name !== "删除赛事" && row.hidden === hidden) throw new CommandError("已经是目标状态。");
      return {
        title: `确认：${name === "删除赛事" ? "删除赛事（可重抓恢复）" : hidden ? "隐藏赛事" : "显示赛事"}`,
        body: `[${row.source}] ${clip(row.title, 40)}\n${row.url}`,
        command: `${name} ${row.id}`,
        danger: name === "删除赛事",
      };
    }

    default:
      throw new CommandError(`未知命令「${name}」。发「帮助」看可用命令。`);
  }
}

/* ────────────────────────── 写命令：执行 ────────────────────────── */

/** 命令用错了 / 目标不存在。区别于"执行失败"，前者是可预期的用户错误。 */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

export type ExecResult = { ok: boolean; lines: string[] };

/**
 * 真正执行一条写命令。**只应被卡片回调触达**，不要在收到命令文本时直接调用。
 *
 * 操作者 user 来自 open_id 解析（白名单 + users 表），所以这里的每一次变更
 * 在审计里都是"某个真实管理员做的"，与网页端同源。
 */
export async function executeWrite(command: string, user: ServerUser): Promise<ExecResult> {
  const parts = command.split(/\s+/).filter(Boolean);
  const name = parts[0];
  const args = parts.slice(1);

  switch (name) {
    case "通过审核": {
      const slug = args[0];
      await setActivityReview(slug, "published");
      return { ok: true, lines: [`已审核通过 \`${slug}\`，活动进入公开列表。`] };
    }
    case "公开": {
      const slug = args[0];
      await setActivityReview(slug, "published");
      await setActivityVisibility(slug, "public");
      return { ok: true, lines: [`已审核通过并设为公开：\`${slug}\``] };
    }
    case "下线": {
      const slug = args[0];
      await setActivityVisibility(slug, "unlisted");
      return { ok: true, lines: [`已设为不公开（链接仍可访问）：\`${slug}\``] };
    }
    case "删除活动": {
      const slug = args[0];
      await deleteActivity(slug);
      return { ok: true, lines: [`已删除活动 \`${slug}\`（含其报名与作品）。`] };
    }

    case "通过作品":
    case "驳回作品":
    case "撤回作品": {
      const [slug, id] = args;
      const row = (await listAllActivities()).find((r) => r.slug === slug);
      if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。`);
      const status = name === "通过作品" ? "approved" : name === "驳回作品" ? "rejected" : "pending";
      await setSubmissionReview(id, status);
      return { ok: true, lines: [`作品 \`${shortId(id)}\` → ${status}`] };
    }
    case "刷新作品": {
      const row = await refreshSubmissionAdmin(args[1]);
      if (!row) throw new CommandError("作品不存在或已被删除。");
      return {
        ok: true,
        lines: [
          `已刷新作品 \`${shortId(row.id)}\` 的指标：`,
          `❤️ ${row.diggCount ?? "-"}　💬 ${row.commentCount ?? "-"}　↗ ${row.shareCount ?? "-"}　⭐ ${row.collectCount ?? "-"}`,
          row.metricsError ? `⚠️ ${row.metricsError}` : "",
        ].filter(Boolean),
      };
    }
    case "移除报名": {
      const [slug, userId] = args;
      const row = (await listAllActivities()).find((r) => r.slug === slug);
      if (!row) throw new CommandError(`没有 slug 为 \`${slug}\` 的活动。`);
      await removeJoinAdmin(row.id, userId);
      return { ok: true, lines: [`已移除 ${clip(userId, 12)} 在 \`${slug}\` 的报名。`] };
    }

    case "代理商通过":
    case "代理商驳回": {
      const id = args[0];
      const note = args.slice(1).join(" ") || null;
      await reviewAgentApplication(user, id, name === "代理商通过" ? "approved" : "rejected", note);
      return {
        ok: true,
        lines: [name === "代理商通过" ? `已通过申请 \`${shortId(id)}\`，对方已获得发布权限。` : `已驳回申请 \`${shortId(id)}\`。`, note ? `备注：${note}` : ""].filter(Boolean),
      };
    }

    case "设为代理商":
    case "设为用户":
    case "设为管理员": {
      const role = name === "设为代理商" ? "agent" : name === "设为管理员" ? "admin" : "user";
      await setUserRole(user.id, args[0], role);
      return { ok: true, lines: [`已将 \`${shortId(args[0])}\` 的角色设为 ${role}。`] };
    }
    case "删除用户": {
      await deleteUser(user.id, args[0]);
      return { ok: true, lines: [`已删除用户 \`${shortId(args[0])}\`。`] };
    }

    case "拉黑": {
      const email = args[0];
      const reason = args.slice(1).join(" ") || "（未填写理由）";
      await addToBlacklist({ email, reason, source: "platform", hits: 1, effectiveUntil: null, createdBy: user.id });
      return { ok: true, lines: [`已将 ${email} 加入黑名单。`] };
    }
    case "解拉黑": {
      const ok = await revokeBlacklist(args[0], user.id);
      if (!ok) throw new CommandError("解除失败：条目不存在或已解除。");
      return { ok: true, lines: [`已解除黑名单条目 \`${shortId(args[0])}\`。`] };
    }

    case "隐藏赛事":
    case "显示赛事": {
      await setExternalEventHidden(args[0], name === "隐藏赛事");
      return { ok: true, lines: [`已${name === "隐藏赛事" ? "隐藏" : "显示"}赛事 \`${shortId(args[0])}\`。`] };
    }
    case "删除赛事": {
      await deleteExternalEventAdmin(args[0]);
      return { ok: true, lines: [`已删除赛事 \`${shortId(args[0])}\`（下次抓取会重新入库）。`] };
    }

    default:
      throw new CommandError(`未知写命令「${name}」。`);
  }
}

/** 写命令的审计 action 名映射：让群里做的操作在审计日志里与网页端同前缀、可检索。 */
export function auditActionFor(command: string): { category: "admin" | "security"; action: string } {
  const name = command.split(/\s+/)[0];
  if (name === "拉黑" || name === "解拉黑") {
    return { category: "security", action: name === "拉黑" ? "blacklist.add" : "blacklist.revoke" };
  }
  return { category: "admin", action: `feishu.${name}` };
}

export { yesNo };
