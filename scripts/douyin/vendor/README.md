# vendor/ —— 抖音签名实现（来自 Evil0ctal v5.1.1）

`fetch.py` 不自己实现签名。这里放的是上游的签名层，逐字复制，没有改动。

## 出处

- 上游：<https://github.com/Evil0ctal/Douyin_TikTok_Download_API>
- 版本：**v5.1.1**，commit `737bf3dfe9de1dbff57990c0ec4c9e02c75c3d0f`
- 许可：**Apache-2.0**（上游仓库根目录 `LICENSE`；上游无 `NOTICE` 文件）
- 复制时间：2026-09-24

## 复制了什么

| 本仓库路径 | 上游路径 | sha256 |
| --- | --- | --- |
| `dtk/signing/native/abogus.py` | `src/dtk/signing/native/abogus.py` | `59e0cd823175cd77dd83b8edc3d7deed985276c7056acd80fe9666cfa0f3a488` |
| `dtk/signing/native/sm3.py` | `src/dtk/signing/native/sm3.py` | `6ad3947e11670a2bdb1fd33980f1d3da007b76421b79c95a1586455c02069669` |
| `dtk/signing/native/websign.py` | `src/dtk/signing/native/websign.py` | `b31e1809de52e43f8098cbc903746d342b2128d56907542ca118af56d9c6010b` |

三个文件**字节一致**（`scripts/douyin/vendor.test.mjs` 会守住这一点）。它们只依赖标准库
（`abogus` 额外依赖同目录的 `sm3`），所以这里不需要 `gmssl`、不需要 `httpx`。

`dtk/`、`dtk/signing/`、`dtk/signing/native/` 三层的 `__init__.py` 是**本仓库新建的空文件**：
上游的 `native/__init__.py` 会 import `signer` 和 `tokens`，那两个文件依赖 `httpx` 和
`dtk.core.*`，而杭客松只用得到纯标准库的那部分。保留上游的包路径（而不是改名）
是为了让这三个文件能保持逐字不动，重新同步时直接覆盖即可。

## 为什么用这一份，而不是别的

- **许可干净**。`abogus.py` 的文件头写着：这个模块是上游**为了许可问题重做的**——
  上一版是 GPL-3.0 代码的移植，无法以 Apache-2.0 发布，所以他们对着抖音自己的
  `bdms.js` 重新逆向了一遍。`websign.py` 同样是上游从 `runtime_bundler_34.js` 的
  字节码 VM 里自己解出来的。社区里流传更广的那份 `abogus.py`（JohnserfSeed 写的，
  jiji262/douyin-downloader 等仓库在用）文件头自称 Apache-2.0，但它所属项目的许可
  与上游说法冲突，用它等于把不确定的许可带进本仓库。
- **没有第三方依赖**。上游自带纯 Python 的 SM3（`sm3.py`），所以不需要 `gmssl`，
  也就不需要任何 `pip install`。旧那份实现要打 `hashlib.new("sm3")` 的垫片。
- **自带解码器**。`abogus.decode()` 能把一个 `a_bogus` 反解回它内部的字段，
  于是"签名算对了"这件事可以在**离线**状态下被证明（见 `fetch.py --self-check`），
  而不是靠"请求恰好没被拒"——上游文档明确说平台只会抽样检查，请求成功说明不了什么。

## 没有复制什么

`signer.py`、`tokens.py`、`registry.py`、`protection.py`、`xbogus.py`、`tiktok_sign.py`、
`decoding.py` 都没有复制。它们是签名层的外围（身份池、浏览器 RPC 回退、TikTok 支持、
离线分析工具），依赖 `httpx` / `dtk.core` / `pydantic`，杭客松用不到。

## 怎么重新同步

```bash
SHA=<新的上游 commit>
for f in abogus sm3 websign; do
  curl -fsSL "https://raw.githubusercontent.com/Evil0ctal/Douyin_TikTok_Download_API/$SHA/src/dtk/signing/native/$f.py" \
    -o "scripts/douyin/vendor/dtk/signing/native/$f.py"
done
node --test scripts/douyin/vendor.test.mjs   # 会打印新的 sha256
```

换版本时把上表的 sha256 和 commit 一起更新，并在 `docs/douyin-data.md` 记一笔。

## 这个签名的寿命

两个签名都是**按站点**的常量，字节改 SDK 就会变：

- `websign.SALT` 是 `douyin_web` 站点（SDK `project-id=34`）专用；上游文档说另一个
  字节系站点加载不同 bundle 就会用另一个 salt。
- `abogus` 的常量（`SDK_VERSION`、`PAGE_ID`、`AID` 等）对应 `bdms.js` v1.0.1.19-fix.01；
  上游记录过 a_bogus 在 2025-02 变过一次输出长度。

失效时的表现是**响亮**的：详情接口回 `403` 且 `status_msg` 里带
`Uifid Not Found` 或 `Signature Not Found`。`fetch.py` 会把这个消息原样带出来，
所以健康检查看这一句就够了，不用猜。
