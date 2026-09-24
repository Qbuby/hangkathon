# 抖音作品数据获取方案

目标：用户在杭客松提交一条抖音作品分享链接后，平台能显示这条作品的**文案**与
**点赞 / 评论 / 转发 / 收藏数**。

**现状（2026-09-24）**：抓取已经跑通，代码在 `scripts/douyin/`（见该目录的 `vendor/README.md`）。
**还没有接进产品** —— 提交表单目前只存链接，不存指标。接入点见本文最后。

## 结论（先看这段）

1. **采用 Evil0ctal/Douyin_TikTok_Download_API v5.1.1 的 native 签名层，vendor 成纯脚本**。
   只需要 `abogus.py`、`sm3.py`、`websign.py` 三个文件，**纯标准库**，不要浏览器、
   不要 Postgres/Redis、不要任何 `pip install`。实测：详情接口 200，连续 16 次全成功。
2. **不部署上游那套服务**。v5.1.1 是一个自托管服务（FastAPI + Postgres + Redis + 身份池 +
   调度器 + MCP + 网页控制台），连它自己的 `dtk fetch`（"抓单条链接"那个命令）都要求
   `ctx.session`（Postgres）和 `pick_identity(ctx.session, …)`（身份池在库里）。那是要长期
   运维的一套东西，和杭客松"提交一条链接看一眼数据"的量级不匹配。
3. **并行保留手动填写 + 截图佐证**：零后端、零法律风险，而且截图比手填难伪造，
   正好对上平台「评审不能被流量逻辑带偏」的顾虑。建议作为默认路径，自动抓取作为加速项。
4. **不要**采用 RandallAnjie/Douyin-API（未声明许可证 = 无权使用）、LightJUNction/douyin（AGPL-3.0 + 形态是 CLI）、
   mafqla/douyin-api（GPL-3.0，且它自己的 issue 就是 cookie 失效）。
5. **抖音开放平台官方接口不满足需求**：它只能读「授权了你应用的账号自己」的作品，读不了任意用户贴的任意链接。
6. **必须接受的前提**：这本质上是在**绕过抖音的反爬签名**，违反抖音用户协议；
   国内已有 破坏计算机信息系统 / 不正当竞争 方向的判例先例。所以它只能作为**私有加速项**，
   不能做成公开 API，且要限流、缓存、只存公开指标、留投诉下架通道。

## 实测记录（2026-09-24，服务器 106.14.92.106）

用 `scripts/douyin/fetch.py`，即上面三个 vendor 文件，在服务器上跑：

| 项 | 结果 |
| --- | --- |
| 离线自检 `--self-check` | 7/7 通过（`a_bogus` 用上游 `decode()` 反解出 `aid=6383`、`page_id=6241`、`sdk=(1,0,1,0)`、`now_ms` 逐个对上） |
| 推荐流 `/aweme/v1/web/tab/feed/` | 200，269 KB |
| 作品详情 `/aweme/v1/web/aweme/detail/` | 200，132 KB，文案 + 点赞/评论/转发/收藏 + 作者 + 发布时间全部拿到 |
| 稳定性 A：固定 uifid + 固定 ttwid 连打 8 次 | **8/8** 成功，307–516 ms |
| 稳定性 B：每次换新 uifid + 新 ttwid 连打 8 次 | **8/8** 成功，331–511 ms |
| 身份来源 | **随机生成** 100 位 hex uifid 即可，不需要浏览器、不需要人工粘 cookie |
| 失败时的表现 | `403` + `status_msg` 里带 `Uifid Not Found` 或 `Signature Not Found` |

B 组全过说明**不需要身份池**——每次请求现造一个身份就行，这正好绕开了上游那套最重的部分
（身份池、Postgres、浏览器 RPC 的存在意义就是维护长期身份）。

上游自己的文档（`src/dtk/signing/protection.py`）在 2026-09-08 量到的是「详情接口 3/8」，
但它同时写明：native 签名在 24/24 次请求上返回了数据，只有 cookie 罐里**没有** uifid 时
才需要浏览器。我们的量法（每次新造 uifid）结果更好，说明当时的 3/8 更像是身份罐的问题，
不是签名的问题。

## 候选方案对比

| 方案 | 形态 | 要 Cookie/密钥 | 能读任意链接 | 成本 | 维护 | 法律风险 |
| --- | --- | --- | --- | --- | --- | --- |
| **vendor v5.1.1 签名层（已采用）** | 单个 Python 脚本，纯标准库 | 不要（uifid 现造） | ✅ | 0（服务器已有） | 签名轮换时要跟着上游更新 | 高：明确绕过反爬 |
| 部署 Evil0ctal v5.1.1 整套服务 | FastAPI + Postgres + Redis + 身份池 + 浏览器 RPC | 要（身份池 + 密钥） | ✅ | 免费但要长期运维一套服务 | 你要自己跟反爬对抗 | 高 |
| TikHub.io（备选托管） | 商业 API（付费） | 只要 API Key | ✅ | $0.001–0.01/次，最低充 $5 | 供应商承担 | 中：有合同，但供应商抓取未获抖音授权 |
| mafqla/douyin-api | Flask 包一层抖音内部接口 | **必须 Cookie** | ✅ | 免费 | GPL-3.0；issue 就是 cookie 失效 | 高 |
| RandallAnjie/Douyin-API | Cloudflare Worker | Cookie + token | ✅ | 免费 | 1 star、3 个月没动、demo 已 401 | 高，且**未声明许可证 = 无权使用** |
| LightJUNction/douyin | Rust CLI + MCP | Cookie 或 OAuth | ✅ | 免费 | AGPL-3.0 会触发网络使用开源义务 | 高 |
| 抖音开放平台 OAuth | 官方 | client_secret + 用户授权 | ❌ 只能读自己的作品 | 免费 | 官方维护，最稳 | 无 |
| 手动填写 + 截图 | 前端表单 | 无 | ✅（人工） | 0 | 无 | 无 |

## 为什么许可要挑：两份 `abogus.py` 不一样

社区里流传更广的那份 `abogus.py`（JohnserfSeed 写，jiji262/douyin-downloader 等在用）
文件头自称 Apache-2.0，但它所属项目的许可与上游说法冲突。v5.1.1 的文件头明确写着：
**上一版是 GPL-3.0 代码的移植、无法以 Apache-2.0 发布，所以他们对着抖音自己的
`bdms.js` 重新逆向了一遍**。`websign.py` 同样是上游自己从 `runtime_bundler_34.js` 的
字节码 VM 里解出来的。选这一份，许可链是清楚的；顺带还少了 `gmssl` 依赖
（上游自带纯 Python 的 SM3）。细节见 `scripts/douyin/vendor/README.md`。

## 推荐架构

```
浏览器（hangkathon.net 或自托管站点）
   │  POST /api/activities/<slug>/submissions { url }   ← 只有分享链接，不带任何密钥
   ▼
服务端路由
   │  isValidDouyinUrl → 查缓存（按 aweme_id）→ 未命中才出网
   ▼
子进程：python3 scripts/douyin/fetch.py <url>            ← 300–500 ms，无端口、无常驻服务
   │  解析分享短链 → 造随机 uifid → a_bogus + Argus 签名 → 取详情
   ▼
返回 { caption, diggCount, commentCount, shareCount, collectCount, fetchedAt } → 写回提交记录
```

为什么这样切：

- **没有密钥可泄露**。uifid 是每次现造的，不需要账号 cookie，所以没有"Cookie 放哪"的问题。
- **没有常驻服务要养**。一个子进程，不开端口，不占内存，崩了就是这一次提交没有指标。
- **大陆 IP 成功率更好**。你那台阿里云机器在国内，比 Vercel 的海外出口更容易拿到数据。
- **缓存按 `aweme_id`**。作品数据变化慢，缓存能同时省调用量和降低被风控的概率。

### 部署上的一个约束

跑这个脚本需要 **Python 3.10+**（vendor 的代码用了 `zip(strict=)` 和 `dataclass(slots=)`）。
服务器上现成有 `python3.11`。但应用镜像是 `node:22-alpine`，**没有 python**，
所以要么在 runner 阶段加 `apk add python3`（约 +50 MB 镜像），要么把脚本放在宿主机上由
应用通过子进程/本地接口调用。前者简单、可复现，推荐前者。

## 你那台阿里云轻量服务器的具体注意事项

1. **域名 + 备案**：实测结论是——**用域名访问一律被备案拦截**（403 + "Non-compliance ICP Filing"），
   **连 3210 这种非标端口也拦**，因为拦截看的是 Host 头而不是端口；只有 IP 直连不受影响。
   所以这台机器上的抓取脚本**按 IP + 非标端口自用没问题，给公网域名用则必须先 ICP 备案**。
   （早期文档里"非标端口不触发备案"的说法是错的，已按实测改正。）
2. **资源要留够**。这台是 2C2G，已经在跑宝塔 nginx + PostgreSQL + 杭客松应用。
   纯脚本方案的增量几乎为零，这也是它比部署整套服务更合适的原因之一。
3. **阿里云会对滥用投诉做处置**。抓取流量异常、被投诉，可能收到工单甚至停机。
   这也是「限流 + 缓存 + 不公开」的现实理由，不只是法律理由。
4. **签名会轮换，这是常态化运维**。`websign.SALT` 是按站点的常量，`abogus` 的常量对应
   `bdms.js` 的某个版本；字节改 SDK 就会变。失效时是 403 + `Uifid/Signature Not Found`，
   很响亮。建议加一个每天跑一次的 `fetch.py --self-check`（离线，不联网）+ 每周抓一条
   已知链接的健康检查。
5. **留一条下架通道**。如果被要求删除某条作品的数据，要能一条命令删掉。

## 代码接入点（真正动手时改这些地方）

1. `lib/submission.ts`：`SubmissionRecord` 扩成
   `{ url, submittedAt, caption?, diggCount?, commentCount?, shareCount?, collectCount?, fetchedAt? }`，
   容错读老记录（老记录没有这些字段也要能读，现在 localStorage 里已经有数据了）。
2. `db/schema.ts` 的 `submissions` 表加同名可空列 + 一条 drizzle 迁移。
3. 提交路由 `app/api/activities/[slug]/submissions/route.ts`：入库后起子进程抓一次，
   抓到就写指标，抓不到就留空并**照常返回 201**（抓取失败不该让用户提交不了）。
4. 新增 `app/api/activities/[slug]/submissions/refresh/route.ts`：手动刷新单条。
   **不要自动轮询**，省调用也省风控。
5. 详情页「作品提交」列表：每条行内显示文案摘要 + 点赞/评论/转发，加「刷新数据」按钮。
   注意现在提交是**只有本人可见**（`listSubmissions(activityId, userId)`），
   指标默认也就只有本人可见——要变成评审/榜单可见，得先决定这件事（见下）。
6. 保留手动填写作为兜底：抓取失败时允许用户自己填数字并附截图。
7. 统一 `README.md` 的口径：`README.md` 写着「创建流程里没有任何要求填写外部网址的字段」，
   但详情页已经有抖音链接提交表单了。这条要么改文档、要么改产品，不能两存。

## 待你决定

- **指标给谁看**：现在提交记录是「只有本人可见」。作品指标要不要给评审 / 榜单看？
  这件事会决定第 5 步怎么改（也牵动现在还是空的贡献/榜单那条线）。
- **是否接受「绕过反爬」这一法律前提**；若不接受，就只能走**手动填写 + 截图**或**官方 OAuth**。
- **抓取放在哪**：进应用镜像（`apk add python3`，简单）还是放宿主机（镜像不变，多一层调用）。
