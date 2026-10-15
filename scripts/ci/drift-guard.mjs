#!/usr/bin/env node
/**
 * 漂移守卫：把"只写在文档 / 只存在服务器上 / 只在某个人脑子里"的约定，变成 CI 可执行的断言。
 *
 * 每一条都来自**真实踩过的坑**，不是假想的规范：
 *
 *   1. timer 必须有安装脚本。2026-10-12 发现 backup / integrity / events 三个
 *      systemd timer 在整个仓库里出现 0 次（没有 cp、没有 enable）—— 它们靠早期人工
 *      操作装上去，任何一次重建机器都无法复现，而合规文档已经把"每日备份"写成了
 *      检查表 8.3.1 的正式答复。合规声明必须能由代码重现。
 *
 *   2. nginx vhost 必须引用公共反代片段。四个 proxy_set_header 原先抄了 4 遍，
 *      改 XFF 策略时漏了一处（本项目真实发生过）。
 *
 *   3. X-Forwarded-For 不得退回 $proxy_add_x_forwarded_for（追加模式可被客户端伪造，
 *      污染审计 IP、绕过按 IP 的限流）。这是安全评估里的 P2，修好之后不能改回去。
 *
 *   4. 部署脚本里不得出现"把退出码抹平"的写法（`cmd | gzip`、`|| echo 0`）。
 *      它们正是本轮修掉的那批静默失败。用模式匹配做粗筛，命中就要求人工确认。
 *
 * 用法：node scripts/ci/drift-guard.mjs
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const problems = [];
const notes = [];
const rel = (path) => path.replaceAll("\\", "/");
const read = (path) => readFileSync(path, "utf8");

/* ── 1. systemd timer 必须能被脚本重现安装 ───────────────────────────────── */

const TIMERS = ["hangkathon-ci", "hangkathon-backup", "hangkathon-integrity", "hangkathon-events"];
const installScript = "deploy/install-timers.sh";
const installerBody = existsSync(installScript) ? read(installScript) : "";

for (const name of TIMERS) {
  for (const suffix of [".service", ".timer"]) {
    const unit = `deploy/${name}${suffix}`;
    if (!existsSync(unit)) problems.push(`缺少 systemd 单元文件 ${unit}`);
  }
  if (!installerBody.includes(name)) {
    problems.push(`deploy/install-timers.sh 里没有安装 ${name} —— 该 timer 无法从仓库重建`);
  }
}

// 安装脚本得真的装上，不能只是提到名字
if (!/install\s+-m\s+644/.test(installerBody)) problems.push(`${installScript} 里没有 install -m 644 写入 /etc/systemd/system`);
if (!/systemctl\s+daemon-reload/.test(installerBody)) problems.push(`${installScript} 里没有 systemctl daemon-reload`);
if (!/systemctl\s+enable\s+--now/.test(installerBody)) problems.push(`${installScript} 里没有 systemctl enable --now`);

// setup-ci.sh 必须调用安装脚本，否则"一次性初始化"仍然装不全 timer
const setupBody = existsSync("deploy/setup-ci.sh") ? read("deploy/setup-ci.sh") : "";
if (!setupBody.includes("install-timers.sh")) {
  problems.push("deploy/setup-ci.sh 没有调用 install-timers.sh —— 新机器初始化后可能只有 ci timer 在跑");
}

/* ── 2 & 3. nginx 配置：公共片段 + XFF 覆盖语义 ──────────────────────────── */

const INCLUDE_PATH = "/www/server/panel/vhost/nginx/hangkathon-proxy-common.inc";
const mainVhost = read("deploy/nginx-hangkathon.com.conf");
const uptimeVhost = read("deploy/nginx-uptime.hangkathon.com.conf");
const proxyInc = read("deploy/nginx-proxy-common.inc");

for (const [name, body] of [["deploy/nginx-hangkathon.com.conf", mainVhost], ["deploy/nginx-uptime.hangkathon.com.conf", uptimeVhost]]) {
  if (!body.includes(`include ${INCLUDE_PATH};`)) {
    problems.push(`${name} 没有 include ${INCLUDE_PATH} —— 反代头又变成各写一份了`);
  }
  if (/X-Forwarded-For\s+\$proxy_add_x_forwarded_for/.test(body)) {
    problems.push(`${name} 出现追加式 XFF（\$proxy_add_x_forwarded_for）—— 客户端可伪造，必须用 $remote_addr 覆盖`);
  }
}

if (!/X-Forwarded-For\s+\$remote_addr/.test(proxyInc)) {
  problems.push("deploy/nginx-proxy-common.inc 没有用 $remote_addr 覆盖 X-Forwarded-For");
}
if (!/X-Forwarded-Proto\s+\$scheme/.test(proxyInc)) {
  problems.push("deploy/nginx-proxy-common.inc 缺少 X-Forwarded-Proto");
}

// 片段扩展名不能是 .conf：宝塔 nginx.conf 里有 `include .../vhost/nginx/*.conf;`，
// 被当成独立配置加载时 proxy_set_header 不在 server/location 上下文里，nginx -t 会直接失败。
if (existsSync("deploy/nginx-proxy-common.conf")) {
  problems.push("反代公共片段不能叫 .conf（会被宝塔的 include .../*.conf 当独立配置加载导致 nginx -t 失败），应为 .inc");
}

/* ── 4. 部署脚本不得抹平退出码 ───────────────────────────────────────────── */

/**
 * 这些模式是"命令失败但脚本继续"的常见形态。允许列表里的是确实无所谓的场景
 * （清理/提示类命令），命中其他位置就要求人工确认 —— 每一步都是踩过的：
 *   · `pg_dump | gzip`   → pg_dump 的退出码被 gzip 覆盖
 *   · `... || echo 0`    → 数据库连不上被读成"计数为 0"
 *   · `docker inspect | while read` → 子 shell 里的 fail=1 丢失
 */
const MASKING_PATTERNS = [
  { re: /pg_dump[^|\n]*\|\s*(gzip|docker)/, why: "pg_dump 接了管道：退出码会被下游命令覆盖" },
  { re: /psql[^|\n]*\|\|[^|\n]*echo\s+["']?[0-9?]/, why: "psql 失败被 || echo 数字 抹平" },
  { re: /docker\s+inspect[^|\n]*\|\s*while/, why: "docker inspect 进了管道：子 shell 里的判定结果会丢失" },
];

const DEPLOY_SCRIPTS = readdirSync("deploy")
  .filter((name) => name.endsWith(".sh"))
  .map((name) => join("deploy", name));

for (const path of DEPLOY_SCRIPTS) {
  // 守卫脚本本身引用了这些模式（用来解释问题），跳过
  if (rel(path).endsWith("fault-injection.sh")) continue;
  const body = read(path);
  for (const { re, why } of MASKING_PATTERNS) {
    for (const line of body.split("\n")) {
      if (re.test(line) && !line.trimStart().startsWith("#")) {
        problems.push(`${rel(path)}：${why} —— ${line.trim().slice(0, 100)}`);
      }
    }
  }
}

/* ── 5. CI 与本地门禁共用同一份测试发现逻辑 ─────────────────────────────── */

const ciYml = read(".github/workflows/ci.yml");
if (/node\s+--test\s+scripts\/\*\.test\.mjs/.test(ciYml)) {
  problems.push("ci.yml 又用回了手写 glob（scripts/*.test.mjs）—— 会漏掉子目录里的测试且静默通过");
}
if (!ciYml.includes("unit-tests.mjs")) {
  problems.push("ci.yml 的 test job 没有走 scripts/ci/unit-tests.mjs 统一发现");
}
if (!ciYml.includes("shellcheck")) problems.push("ci.yml 缺少 shellcheck job（运维脚本 0 静态检查）");
if (!ciYml.includes("actionlint")) problems.push("ci.yml 缺少 actionlint job（workflow 自身无检查）");
if (!ciYml.includes("db-schema.test.mjs")) problems.push("ci.yml 缺少数据库层测试（迁移/触发器/限流 SQL 无回归防护）");

// 权限最小化：顶层给 contents: read，不要 write
if (/permissions:\s*write/.test(ciYml)) problems.push("ci.yml 里出现了 permissions: write —— 应保持 contents: read 最小权限");

/* ── 5b. SEO 的几条硬约束 ─────────────────────────────────────────────────── */

/**
 * JSON-LD 必须经 lib/seo 的安全序列化注入。
 *
 * 为什么升级成 CI 守卫：`JSON.stringify` 不转义 `<`，而活动标题/简介是用户可填字段。
 * 受控实验确认过：标题里带 `</script>` 就能提前闭合脚本块，往页面里注入**真实标记**
 * （一个 robots meta、一个隐藏 div、一条外站垃圾链），脚本本身被 CSP 挡住，但标记挡不住。
 * 这个坑从"有人新写一个页面、顺手用了 JSON.stringify"那一刻就会回来，所以必须机器盯着。
 */
const APP_DIR = "app";
const walkApp = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkApp(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
};

for (const file of walkApp(APP_DIR)) {
  const body = read(file);
  const usesLdJson = body.includes("application/ld+json") || body.includes("<JsonLd");
  if (!usesLdJson) continue;
  // 允许两种写法：用 JsonLd 组件，或自己调 toJsonLdScript
  const safe = body.includes("<JsonLd") || body.includes("toJsonLdScript");
  if (!safe) {
    problems.push(
      `${rel(file)}：注入了 application/ld+json 但没走 lib/seo 的安全序列化。` +
        `JSON.stringify 不转义 <，用户填的标题里带 </script> 就能往页面注入真实标记。改用 <JsonLd data={...} />。`,
    );
  }
}

// noindex 必须真的落在不该收录的页面上
for (const [page, label] of [
  ["app/manage/page.tsx", "管理端口"],
  ["app/auth-error/page.tsx", "登录失败页"],
]) {
  if (!existsSync(page)) {
    problems.push(`缺少 ${page}（${label} 应带 noindex）`);
    continue;
  }
  const body = read(page);
  if (!/robots:\s*\{[^}]*index:\s*false/s.test(body)) {
    problems.push(`${page}：${label} 没有 noindex —— 客户端组件导不出 metadata，得有一层服务端薄壳`);
  }
}

// robots.txt 必须显式声明 AI 搜索类爬虫（"AI 能不能引用本页"不该靠通配符解释）
const robotsTs = read("app/robots.ts");
for (const bot of ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"]) {
  if (!robotsTs.includes(bot)) {
    problems.push(`app/robots.ts 未显式声明 ${bot} —— AI 搜索可见性取决于逐条声明，不能只写 User-agent: *`);
  }
}
// 这两对爬虫最容易被混为一谈，注释里必须说清各自管什么，避免后来人改错
if (!robotsTs.includes("GPTBot") && !robotsTs.includes("训练")) {
  problems.push("app/robots.ts 里没有区分搜索类与训练类爬虫 —— 容易把 OAI-SearchBot 与 GPTBot 搞混");
}

// sitemap 不得再输出已废弃字段
const sitemapTs = read("app/sitemap.ts");
for (const dead of ["priority", "changeFrequency"]) {
  if (new RegExp(`\\b${dead}:`).test(sitemapTs)) {
    problems.push(`app/sitemap.ts 仍在输出 ${dead} —— Google 已明确忽略这两个字段`);
  }
}

/**
 * 已下线地址的 410 必须一直挂在 middleware 上，且必须有测试守着。
 *
 * 为什么值得一条守卫：这条逻辑的失效方式是**静默**的 —— 有人重构 middleware
 * （比如为了改 CSP 重写整个函数体）时顺手删掉那个 if 分支，线上表现不是报错，
 * 而是"已下线的地址又变回 404"。没人会收到告警，只有下次翻索引时才发现。
 */
const mw = read("middleware.ts");
if (!mw.includes("retiredActivitySlugPath")) {
  problems.push("middleware.ts 里没有已下线地址的 410 分支 —— 它会静默退化成 404，没有任何报错");
}
if (!mw.includes("status: 410")) {
  problems.push("middleware.ts 里没有 status: 410 —— 判定逻辑在但状态码不是 410");
}
// 顺序断言：.net 是整站跳转，在它上面出 410 与"只做跳转"矛盾
const hostGuardAt = mw.indexOf("hostNeedsRedirect(request.headers.get");
const slugGuardAt = mw.indexOf("retiredActivitySlugPath(url.pathname)");
if (hostGuardAt < 0 || slugGuardAt < 0 || hostGuardAt > slugGuardAt) {
  problems.push("middleware.ts 里必须先判跳转域名再判已下线 slug —— 顺序反了之后 .net 上会出 410");
}
if (!existsSync("scripts/seo-retired.test.mjs")) {
  problems.push("缺少 scripts/seo-retired.test.mjs —— 410 判定（含「不该命中」的反例）没有回归防护");
}

/* ── 5c. 凭据不入源码 ─────────────────────────────────────────────────────── */

/**
 * 飞书群机器人 webhook URL 等同于密码：拿到它就能往群里发消息。
 * 这是本仓库里**唯一一个会被写进应用源码**的凭据（其余都在 .env / 服务器侧），
 * 所以要在源码层面盯着 —— 只扫构建产物不够：产物扫描发生在构建之后，
 * 而硬编码的字面量早就跟着 git 走了一圈了。
 */
const SECRET_LITERAL_PATTERNS = [
  { label: "飞书群机器人 webhook", pattern: /open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{8,}/ },
];
// 只扫会被打进产物或直接跑的目录；docs 与 .env.example 里写形态说明是允许的
// （.env.example 里的示例是 <uuid> 占位，匹配不到"像凭据"的形态）。
const sourceFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // 与 discoverTests 同一条排除：第三方快照与构建产物里全是别人的凭据形态
      if (!["node_modules", ".next", "dist", "vendor", ".git"].includes(entry.name)) sourceFiles(full, out);
    } else if (/\.(ts|tsx|mjs|js|sh)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

for (const dir of ["app", "lib", "scripts", "deploy", "db"]) {
  if (!existsSync(dir)) continue;
  for (const file of sourceFiles(dir)) {
    const body = read(file);
    for (const { label, pattern } of SECRET_LITERAL_PATTERNS) {
      if (pattern.test(body)) {
        problems.push(`${rel(file)}：出现硬编码的${label} —— 它等同于密码，只能放服务器 .env（读 env.FEISHU_WEBHOOK_URL）`);
      }
    }
  }
}

// 通知是旁路：被删掉不会报错，只会让"有人提交申请"这件事静默地没人知道
const agentRoute = read("app/api/agent/application/route.ts");
if (!agentRoute.includes("notifyAgentApplication")) {
  problems.push("app/api/agent/application/route.ts 没有接飞书通知 —— 提交代理商申请时群里收不到提醒，且不会报错");
}
if (/await\s+notifyAgentApplication/.test(agentRoute)) {
  problems.push("app/api/agent/application/route.ts 里 await 了通知 —— 它是旁路，await 会让申请人等飞书响应");
}

/* ── 5d. 飞书管理命令的安全不变量 ─────────────────────────────────────────── */

/**
 * `/api/feishu/events` 是一个**公网可打**的端点，而它能执行管理员操作
 * （授予角色、删除用户、删活动）。它的失效方式全是静默的：
 * 少一次验签 = 攻击者能伪造事件；少一次去重 = 点一下执行两次；
 * 少一次操作者复查 = 群里任何人都能点别人发出的确认卡片。
 * 所以这四条逐条用静态检查盯着。
 */
const feishuRoute = read("app/api/feishu/events/route.ts");
const feishuApi = read("lib/server/feishu-api.ts");
const feishuAdmin = read("lib/server/feishu-admin.ts");
const feishuCommands = read("lib/server/feishu-commands.ts");

/**
 * 这几条查的是**具体那一行**而不是"文件里出现过这个符号"——
 * 只查符号存在的话，把调用改成不被使用、把声明留着就能骗过。
 * 变异测试 A/B/F 就是这么试的（A/B 第一次只查符号存在，全都漏了）。
 */
if (!/const\s+parsed\s*=\s*parseInbound\(/.test(feishuRoute)) {
  problems.push("app/api/feishu/events 没有把 parseInbound 的结果赋给 parsed —— 验签必须真的决定这个请求放不放行，而不是调用一次就丢掉");
}
if (!/if\s*\(!parsed\.ok\)/.test(feishuRoute)) {
  problems.push("app/api/feishu/events 没有检查 parsed.ok —— 验签失败必须被挡下来");
}
if (!feishuRoute.includes("FEISHU_ENCRYPT_KEY")) {
  problems.push("app/api/feishu/events 没有检查 FEISHU_ENCRYPT_KEY —— 未配置时必须整体拒绝而不是放行");
}
if (!/Math\.abs\(nowMs\s*-\s*tsMs\)\s*>\s*MAX_CLOCK_SKEW_MS/.test(feishuApi)) {
  problems.push("lib/server/feishu-api.ts 的时间窗比较被删掉了 —— 没有它，抓包重放可以无限期有效");
}
if (!/seenEvents\.has\(eventId\)/.test(feishuApi)) {
  problems.push("lib/server/feishu-api.ts 的事件去重判断被删掉了 —— 飞书未收到 2xx 会重投，「点一下确认」会执行两次");
}
if (!feishuApi.includes("timingSafeEqual")) {
  problems.push("lib/server/feishu-api.ts 缺少定时安全比较 —— 签名用普通字符串比较会泄露前缀信息");
}
// 两条入站路径（群消息命令 / 卡片回调）必须各自解析一次操作者。卡片会出现在群里，
// 群里任何人都能点 —— 不能假设"下这条命令的人 == 点确认的人"。
const operatorResolutions = (feishuRoute.match(/await resolveOperator\(openId\)/g) ?? []).length;
if (operatorResolutions < 2) {
  problems.push(`app/api/feishu/events 里只解析了 ${operatorResolutions} 次操作者 —— 群消息命令与卡片回调两条路径都必须各自解析（卡片可被别人点）`);
}
if (!feishuApi.includes("markEventOnce")) {
  problems.push("lib/server/feishu-api.ts 缺少事件去重 —— 飞书未收到 2xx 会重投，「点一下确认」会执行两次");
}
if (!feishuRoute.includes("markEventOnce(")) {
  problems.push("app/api/feishu/events 没有做 event_id 去重");
}
// 卡片回调必须重新鉴权：不能假设"下命令的人 == 点确认的人"
if (!/handleCardAction[\s\S]{0,4000}resolveOperator/.test(feishuRoute)) {
  problems.push("app/api/feishu/events 的卡片回调没有重新解析操作者 —— 群里任何人都能点别人发出的确认卡片");
}
// 白名单只能是封闭集合，不能靠"哪个文件 import 了 parseInbound"
if (!feishuAdmin.includes("FEISHU_ADMINS") || !feishuAdmin.includes("getUserByEmail")) {
  problems.push("lib/server/feishu-admin.ts 的操作者解析必须基于 FEISHU_ADMINS 白名单 + users 表查询");
}
if (/\bensureUser\b/.test(feishuAdmin)) {
  problems.push("lib/server/feishu-admin.ts 调用了 ensureUser —— 它会 upsert 造账号，远程操作的操作者必须查不到就是查不到");
}
// 写操作只能从 executeWrite 落地；确认卡片阶段不许改数据
const planSection = feishuCommands.slice(
  feishuCommands.indexOf("export async function planWriteCommand"),
  feishuCommands.indexOf("export async function executeWrite"),
);
for (const mutating of [
  "setActivityReview(", "setActivityVisibility(", "deleteActivity(", "setSubmissionReview(",
  "reviewAgentApplication(", "setUserRole(", "deleteUser(", "addToBlacklist(",
  "revokeBlacklist(", "setExternalEventHidden(", "deleteExternalEventAdmin(", "removeJoinAdmin(",
]) {
  if (planSection.includes(mutating)) {
    problems.push(`lib/server/feishu-commands.ts 的 planWriteCommand 里出现了写操作 ${mutating} —— 确认卡片阶段只描述、绝不执行`);
  }
}
if (!existsSync("scripts/feishu-bot.test.mjs")) {
  problems.push("缺少 scripts/feishu-bot.test.mjs —— 验签/解密/去重/命令解析没有回归防护");
}


/* ── 6. 告警链路：死人开关必须真的被调到 ─────────────────────────────────── */

const commonLib = read("deploy/lib/common.sh");
if (!/hk_ping\s*\(\)/.test(commonLib)) problems.push("deploy/lib/common.sh 缺少 hk_ping（死人开关）");
// 三条链都要接上带外告警：备份（aurora）、自检（integrity）、部署（ci）。
// hk_finish 内部已经 ping，所以"用 hk_finish"也算接上。
const PING_CHAINS = [
  ["deploy/backup.sh", "备份"],
  ["deploy/integrity-check.sh", "完整性自检"],
  ["deploy/ci.sh", "部署"],
];
for (const [path, label] of PING_CHAINS) {
  if (!existsSync(path)) {
    problems.push(`${label}链的脚本不存在：${path}`);
    continue;
  }
  const body = read(path);
  if (!body.includes("hk_ping ") && !body.includes("hk_finish")) {
    problems.push(`${label}链（${path}）没有接死人开关：hk_ping 与 hk_finish 都没被调用`);
  }
}

/* ── 输出 ───────────────────────────────────────────────────────────────── */

for (const note of notes) console.log(`[注] ${note}`);
if (problems.length === 0) {
  console.log("漂移守卫：全部通过。");
  console.log(`  · ${TIMERS.length} 个 timer 均有单元文件与安装路径`);
  console.log("  · nginx vhost 引用公共反代片段且 XFF 为覆盖模式");
  console.log(`  · ${DEPLOY_SCRIPTS.length} 个部署脚本未发现退出码抹平写法`);
  console.log("  · CI 与本地门禁共用测试发现；含 shellcheck / actionlint / db 层");
  console.log("  · 死人开关已在备份、自检、部署三条链上埋点");
  process.exit(0);
}
console.log("漂移守卫发现问题：");
for (const problem of problems) console.log(`  - ${problem}`);
process.exit(1);
