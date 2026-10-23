# 微信小程序端

小程序是杭客松的第三个入口。它与网页端**共用同一套用户体系**，靠 `unionid` 打通。

## 为什么能打通（以及什么情况下打不通）

同一个微信号，在三个应用里的 **openid 各不相同**：

| 应用 | 登录方式 | openid 前缀（示例） |
|---|---|---|
| 网站应用 | 电脑扫码 `qrconnect` | `owu1v2…` |
| 公众号（订阅号） | 6 位验证码 | `oe8Tr3…` |
| 小程序 | `wx.login()` | 又是另一个 |

只有 **unionid 相同**（前提：三者绑在同一个微信开放平台账号下）。

所以身份解析永远是：**先按 unionid 认人 → 再按占位邮箱 → 最后才新建**，
唯一实现是 `lib/server/wechat-identity.ts` 的 `resolveWechatUser()`。

> **打不通的唯一情形**：小程序没有绑定到那个开放平台账号。此时
> `jscode2session` 不返回 unionid，小程序用户会落在一条独立的
> `<小程序 openid>@wechat.user` 行上，永远认不出网页端的老账号。
> 这一点无法在代码层补救，只能在微信后台绑定。

## 完整链路

```
小程序 wx.login()  →  code（5 分钟有效，只能用一次）
    → POST /api/auth/wechat-mini  { code }
        → 服务端 GET sns/jscode2session  →  { openid, unionid? }
        → resolveWechatUser({ openId, unionId })
        → getWechatSessionIdentity(userId)   ← 取真实 email/name/image
        → encode() 签 JWT
    ← { token, email, name, expiresAt } + Set-Cookie
    → 之后每个请求带 Authorization: Bearer <token>
```

## 为什么必须加 Bearer 通道

`wx.request` **不像浏览器那样自动保存并回放 cookie**。服务端原有认证只读 cookie
（`currentUser()` → `auth()`），所以小程序里每个接口都会 401。

现在 `lib/server/users.ts` 的 `currentUser()` 有两级：

1. 先走 `auth()`（浏览器 cookie）
2. cookie 没解出身份时，再读 `Authorization: Bearer <token>`（`bearerSession()`）

两个解析出来的都是同一个 JWT，因此**下游 48 个 `requireUser/requireAdmin/requirePublisher`
调用点一个都不用改**。

### salt 必须两个都试

Auth.js 的 JWT 加密 salt **就是 cookie 名**：

- https → `__Secure-authjs.session-token`
- http → `authjs.session-token`

小程序线上永远走 https，但本地调试、或反向代理漏传 `x-forwarded-proto` 时
可能签发另一个。`bearerSession()` 两个都试一次，代价只是一次 HMAC 派生。

## 小程序工程

目录 `miniprogram/`，原生 WXML/WXSS/JS，**零构建步骤**：

```
miniprogram/
  project.config.json   ← appid 是占位符，导入后自己填
  app.js / app.json / app.wxss
  utils/
    request.js          ← Bearer 头、401 清 token、429 带 retry-after
    auth.js             ← wx.login → 换 token；401 可静默重登
    format.js           ← 展示名（与 lib/display-name 同算法）、日期、贡献值
  pages/
    activities/         活动看板（公开，未登录也能看）
    activity-detail/    详情 + 报名 + 邀请
    leaderboard/        排行榜
    profile/            我的（勋章、报名、入口）
    submit/             提交作品（抖音链接）
    create/             发起活动（三级门禁：登录 → 代理商 → 表单）
    manage/             管理端（仅 admin：活动/作品/代理商审核）
```

### 页面 ↔ 接口

| 页面 | 接口 |
|---|---|
| 活动看板 | `GET /api/activities` |
| 活动详情 | `GET /api/activities/[slug]` |
| 报名 | `POST /api/activities/[slug]/join` |
| 提交作品 | `POST /api/activities/[slug]/submissions` |
| 我的 | `GET /api/me` |
| 排行榜 | `GET /api/leaderboard`（新增，网页也复用） |
| 发起活动 | `GET /api/agent/session` → `POST /api/agent/application` → `POST /api/activities` |
| 管理端 | `POST/GET /api/admin/*` |

## 配置

`.env.example` / 服务器 `/opt/hangkathon/.env`：

```dotenv
WECHAT_MINI_ID=wx...          # 小程序 AppID
WECHAT_MINI_SECRET=...        # 小程序 AppSecret
```

**微信后台需要手动做两件事**：

1. 小程序后台 → 开发管理 → 开发设置 → **服务器域名 → request 合法域名**
   加入 `https://hangkathon.com`
   （必须 HTTPS、已备案、不能带端口与路径）
2. 确认小程序已绑定到与公众号相同的**微信开放平台账号**（否则拿不到 unionid）

然后把 AppID/AppSecret 填进服务器 `.env`（权限 600），重启容器即生效。

## 限流

`POST /api/auth/wechat-mini` 落在 nginx 既有的 `location /api/auth/`（10 次/分钟/IP），
应用层再叠一层 `RULES.signin`（同样 10 次/分钟）。

小程序只在**冷启动**与 **401 重登**时调用，正常用户远低于这个频率。
如果将来出现运营商 NAT 导致同 IP 大量用户，需要给这个路由单独开一个 zone
（参考 `wechat-code/poll` 的 `api_poll` 做法）。

## 检查

```bash
node --test scripts/wechat-mini.test.mjs     # 15 条：URL/返回值/身份/会话/隐私/工程完整性
node scripts/security/authz-matrix.mjs       # /api/auth/wechat-mini 判定为 public（登录入口）
```

## 踩过的坑

1. **不要自己 insert users**。小程序登录必须走 `resolveWechatUser()` ——
   仓库里特意有测试断言登录路由不出现 `insert(schema.users)`。
2. **不要用 openid 现拼 email 签会话**。必须用 `getWechatSessionIdentity(userId).email`，
   否则合并过的账号会被立刻再建一行（网页端真踩过，昵称与报名全丢）。
3. **不要保存 `session_key`**。它只在解密 `encryptedData`（手机号等）时需要；
   本期不取手机号，多存一份密钥就多一份泄露面。
4. **管理端请求体字段名各不相同**：
   - 作品审核 → `{ status }`
   - 代理商审核 → `{ decision }`
   - 活动审核 → `{ reviewStatus }`
   写错不会报错，只会 400「缺少 status」之类的提示。
5. **`wx.request` 不会自动带 cookie**，所以每个请求都必须显式加 `Authorization`；
   同时服务端也下发了 cookie，是为了 web-view 场景能复用同一套逻辑。

## 明确不做（本期）

- 手机号获取（需 `getPhoneNumber` + 解密 `session_key`，且要企业主体）
- 小程序内支付、订阅消息
- 小程序端 localStorage 兜底（没有 `DATABASE_URL` 的部署直接提示"未配置后端"）
- 发起活动的富文本编辑（小程序端用默认评审维度与不设奖项，精细配置请用网页）
