# 手机端登录：公众号验证码

手机端的登录通道。电脑端仍然用微信「网站应用」扫码。

## 为什么需要它

微信「网站应用」的 qrconnect 在手机浏览器里**物理上无法完成**：

- 二维码就在用户自己那块屏幕上，同一台手机扫不了自己
- 微信明确禁止长按/相册识别登录码（「该二维码仅支持在扫一扫时，通过摄像头来识别」）
- 微信内置浏览器里同样是二维码 —— 页面里那个「微信快捷登录」是给**装了桌面微信客户端**
  的场景准备的（它会探测 `localhost.weixin.qq.com:13013-14015`），手机上探测不到

而公众号（订阅号）又有两条路被微信关掉：

| 能力 | 订阅号 | 服务号 |
|---|---|---|
| 生成带参数二维码（scene） | ❌ 仅「服务号（仅认证）」 | ✅ |
| 网页授权 `snsapi_userinfo` | ❌ 仅服务号 | ✅ |
| **接收用户消息** | ✅ | ✅ |

所以用到的是最后一行：**把验证码发给公众号**。

## 完整链路

```
手机打开本站 → 登录弹窗点「获取 6 位验证码」
    → POST /api/auth/wechat-code          生成 6 位码，10 分钟有效，自动复制到剪贴板
    → 用户切到微信，把码发给公众号
    → 微信推送消息到 /api/wechat/mp        验签 →（安全模式）解密 → 取 openid
                                          → 调 user/info 取 unionid
                                          → 绑定到那条码，被动回复"登录确认成功"
    → 网页轮询 /api/auth/wechat-code/poll  看到 ready
    → POST 同一地址                        原子消费 + 签发会话 cookie
    → 整页刷新，登录完成
```

## 新老账号统一

公众号与网站应用绑在同一个开放平台账号下 → **同一个微信号在两个应用里 openid 不同、
unionid 相同**。所以 `user/info` 拿到的 unionid 是关联两种登录方式的钥匙。

`resolveUserId` 的查找顺序：

1. 按 unionid 找历史记录（同一微信号此前用公众号登录过）
2. 按 openid 找历史记录（同一公众号账号此前登录过）
3. 都没有 → 新建 `users` 行，email 合成 `<openid>@wechat.user`
   —— 与扫码登录**完全同一个约定**，因此两种方式落到同一行，不会裂号

### 已知限制：现有的老账号无法自动合并

2026-10-21 之前用扫码登录的 5 个账号，当初只存了网站应用的 openid，**没有存 unionid**。
所以这些人第一次用公众号登录会**新建一个账号**，不会自动认领老的。

补救方式（任选）：

```sql
-- 手工把某个公众号身份并到老账号
-- 1. 先让该用户用公众号登录一次，拿到新的 openid
-- 2. 查出新账号与老账号的 id
select id, email, name, created_at from users where email like '%@wechat.user' order by created_at;
-- 3. 把业务数据迁到老账号（示例：报名）
update joins set user_id = '<老账号id>' where user_id = '<新账号id>' on conflict do nothing;
-- 4. 删掉新账号（级联清理它剩下的东西）
delete from users where id = '<新账号id>';
```

## 安全设计

| 措施 | 防的是什么 |
|---|---|
| **微信签名校验**（sha1，排序后拼接） | 伪造推送。不验签的话，猜中 6 位码就能把自己的 openid 绑上去冒充登录 |
| **安全模式 AES-256-CBC 解密** | 消息内容被中间人看到；解密前先验 `msg_signature` |
| 6 位数 + 10 分钟有效 | 暴力枚举（100 万空间 × 10 分钟窗口 × 每 IP 每小时 20 次） |
| `crypto.randomInt` 而非 `Math.random` | PRNG 可预测 |
| 一次性消费（`UPDATE ... WHERE status='bound' RETURNING`） | 同一张码换出两份登录态（并发请求只有一个能拿到行） |
| `WHERE status='pending'` 的绑定更新 | 两个人抢同一个码时，后到者不能顶掉先到者 |
| 两层限流（路由层每分钟 / 业务层每小时） | 刷表与瞬时爆破 |

**没配 `WECHAT_MP_TOKEN` 时端点整体返回 503** —— 宁可不可用，也不能无验签运行。

## 公众号后台配置

设置与开发 → 基本配置 → 服务器配置：

```
URL:            https://hangkathon.com/api/wechat/mp
Token:          <任意字符串，与服务器 .env 的 WECHAT_MP_TOKEN 一致>
EncodingAESKey: <点"随机生成"，43 位>
消息加解密方式:  安全模式（推荐）
```

相关环境变量：

```
WECHAT_MP_ID=wx...        # 公众号 AppID
WECHAT_MP_SECRET=...      # 用于调 user/info 取 unionid
WECHAT_MP_TOKEN=...       # 验签用
WECHAT_MP_AES_KEY=...     # 安全模式解密用
```

首次填 URL 时微信会发一个 GET，要求原样返回 `echostr` —— 已经实现（`GET /api/wechat/mp`）。

## 检查

```
node --test scripts/wechat-code-login.test.mjs   # 10 条：验签/XML/验证码/静态不变量
node scripts/security/authz-matrix.mjs           # /api/wechat/mp 判定为 signature
```

## 踩过的坑

1. **迁移文件光放在 `drizzle/` 下不够**，必须登记进 `drizzle/meta/_journal.json`。
   否则迁移器只跑登记过的，日志却照说「已应用」——线上表现为"表不存在"，
   而 `__drizzle_migrations` 的行数看起来是对的。
2. **微信的签名算法与飞书那套完全不同**：微信是 `sha1(排序后直接拼接)`，
   飞书是 `sha256(timestamp+nonce+encryptKey+body)`。抄错会让**所有真实消息被拒**，
   症状只是"公众号里发消息没反应"，日志里才看得到 401。
3. **安全模式的签名要把 encrypt 一起参与排序**，与明文模式不是同一个函数。
