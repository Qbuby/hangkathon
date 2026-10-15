# 飞书群里的管理端（在群里 @机器人 操作 /manage）

把 /manage 的全部操作搬到飞书群里：@机器人 发一条命令就能查数据、改数据。
**不需要打开网页。**

## 三个机器人/通道，别搞混

| 东西 | 能力 | 用在哪 |
|---|---|---|
| **群自定义机器人** webhook（`FEISHU_WEBHOOK_URL`） | **只能发** | 提交代理商申请 → 群里收提醒 |
| **自建应用**（`FEISHU_APP_ID` + `FEISHU_APP_SECRET`） | **能收能发** | 事件订阅到 `/api/feishu/events`，跑管理命令 |
| 部署告警（`deploy/feishu-alert.mjs`） | 单向 | 备份 / 自检 / CI 告警 |

**关键限制**：群自定义机器人的 webhook 是"只发"的，拿不到群里任何消息。
所以"在群里和机器人交互"这件事**不可能靠 webhook 实现**，必须用自建应用的
事件订阅（`im.message.receive_v1` + 卡片回调）。群里会显示成两个不同的机器人。

## 安全模型（改代码前先读这段）

`/api/feishu/events` 是一个**公网可访问的 POST 端点**，而它能执行管理员操作
（授予角色、删除用户、删活动、拉黑）。所以顺序是固定的：

1. **验签 + 时间窗** → 失败 401，且不回显原因（那是在送情报）
2. `url_verification` challenge（飞书后台保存请求地址时的握手）
3. **event_id 去重**（飞书在没收到 2xx 时会重投同一事件 → "点一下确认"会执行两次）
4. 分发：消息事件 / 卡片回调
5. **最后**才解析操作者

授权只看 `FEISHU_ADMINS` 白名单。**「在群里」不等于「有权限」** —— 群里任何人都能
@机器人，未授权者一律拒绝、不回显任何管理数据，只写审计。

四条容易被绕过、所以逐条钉死了的不变量：

| 不变量 | 破了会怎样 | 谁在守 |
|---|---|---|
| `const parsed = parseInbound(...)` 且检查 `parsed.ok` | 公网可伪造事件 = /manage 开放 | drift-guard + 单测（查的是赋值与判断，不是"文件里出现过"） |
| `Math.abs(nowMs - tsMs) > MAX_CLOCK_SKEW_MS` | 抓包重放无限期有效 | 同上 |
| `seenEvents.has(eventId)` | 点一下执行两次 | 同上 |
| 两条入站路径各 `await resolveOperator(openId)` 一次 | 群里任何人都能点别人发出的确认卡片 | 同上 |

还有一条语义上的：`resolveOperator` 必须用 `getUserByEmail`（查）而不是
`ensureUser`（upsert）。用后者的话，白名单里写错一个邮箱就会**凭空造出一个账号**。

## 写操作为什么要二次确认

不是因为防攻击者（签名已经挡住了），而是防**误操作与被诱导**：
群里有人贴一段看起来像命令的文本、或者手滑多点一次，都不该立刻生效。
所以收到写命令只产生一张确认卡片，点按钮才执行；按钮回调同样验签、同样查白名单、
同样按 event_id 去重。

`planWriteCommand` 里**不允许**出现任何写函数调用 —— drift-guard 会逐个点名检查
（`setUserRole` / `deleteUser` / `deleteActivity` / `reviewAgentApplication` …）。

## 业务逻辑不重写

命令层**调用与网页端完全相同的 `lib/server/*` 函数**。这不是洁癖：
审核动作（授予角色、删除用户）是不可逆的，两份实现迟早会漂移，
而且漂移之后没人记得。审计也走同一个 `writeAudit`，`detail` 里额外带
`via: "feishu"` 与操作者 open_id —— 审计日志 append-only，事后补不了。

## 命令表

**读**（直接回结果）

```
总览            活动 [slug]        用户        代理商
赛事            黑名单            审计 [条数]
```

**写**（回确认卡片，点按钮才执行）

```
公开 <slug>                 下线 <slug>              删除活动 <slug>
通过作品 <slug> <id>        驳回作品 <slug> <id>     撤回作品 <slug> <id>
刷新作品 <slug> <id>        移除报名 <slug> <userId>
代理商通过 <id> [备注]      代理商驳回 <id> [备注]
设为代理商 <userId>         设为用户 <userId>        设为管理员 <userId>
删除用户 <userId>           拉黑 <邮箱> <理由>       解拉黑 <id>
隐藏赛事 <id>               显示赛事 <id>           删除赛事 <id>
```

支持英文别名（`overview` / `agents` / `help` …）。
**不做模糊匹配**：拼错的词会落到"未知命令"而不是猜一个相近的写操作 ——
在管理命令上猜错代价比报错大得多。

## 刻意不做的事

- **审计日志在群里只给摘要**：IP / UA / 端口不在群里展示。群消息留在飞书侧、
  转发出去撤不回，而这些字段正是 8.4.3 可溯源三件套的一部分。
  要看全量请去 /manage。
- **不接受自由文本的任意 SQL 式操作**：命令是封闭枚举，不是 eval。
- **不在群里显示任何未授权者的 open_id**：写进审计日志，管理员自己查。

## 飞书后台配置（需要你做，代码这边已经就绪）

在**自建应用**的后台（不是群自定义机器人）：

1. **事件与回调 → 事件配置**
   - 请求地址：`https://hangkathon.com/api/feishu/events`
   - 订阅方式：把请求地址配置到开发者后台（收到 challenge 后会显示验证成功）
   - 添加事件：`接收消息 im.message.receive_v1`
2. **事件与回调 → 加密策略 → Encrypt Key**
   - 打开，取到字符串填进服务器 `/opt/hangkathon/.env` 的 `FEISHU_ENCRYPT_KEY=`
   - （选填）Verification Token 一并填上，便于日后排查
3. **权限管理**：`im:message`（接收 @机器人消息）、`im:message:send_as_bot`（发回复与卡片）、
   `card:write`（发交互卡片）。加权限后要**发布版本**才会生效。
4. **把应用拉进群**：应用没在群里就收不到消息。
5. 服务器 `.env` 加：
   ```
   FEISHU_ENCRYPT_KEY=<上面取到的>
   FEISHU_ADMINS=ou_你的openid=你的站内邮箱
   ```
   然后 `docker compose up -d` 重建（`.env` 不在 git 里，CI 不会覆盖它）。

拿自己的 open_id：在群里 @机器人 发任意命令，未授权时会回一条说明，
同时把 open_id 记进管理端审计日志（`category=security`、`action=feishu.bot.denied`）。

**没配 `FEISHU_ENCRYPT_KEY` 时端点整体返回 503** —— 宁可不可用，
也不能无验签运行。

## 检查

```
node --test scripts/feishu-bot.test.mjs      # 9 个用例：验签/解密/去重/解析/静态不变量
node scripts/ci/drift-guard.mjs              # 静态不变量 + 「plan 里不许写数据」
node scripts/security/authz-matrix.mjs       # 该路由的守卫判定为 signature
```

变异测试记录：删时间窗、删去重、卡片回调不复查操作者、用 ensureUser 造账号、
plan 阶段就写数据、入站不验签 —— 六条全部被 drift-guard 与单测**双层**抓到。
（第一轮只有单测抓到，因为 drift-guard 当时查的是"文件里出现过某个符号"，
把调用改成不使用就骗过去了；守卫已改成查具体那一行。）
