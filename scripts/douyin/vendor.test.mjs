import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 逐字复制自 Evil0ctal/Douyin_TikTok_Download_API v5.1.1（commit 737bf3d）。
// 哈希写死在这里，是为了守住「没被改动」这句话——一旦有人顺手改了 vendor 里的
// 代码，出处和许可声明就都不成立了。换版本时同步更新 vendor/README.md 的表。
const VENDORED = {
  "dtk/signing/native/abogus.py": "59e0cd823175cd77dd83b8edc3d7deed985276c7056acd80fe9666cfa0f3a488",
  "dtk/signing/native/sm3.py": "6ad3947e11670a2bdb1fd33980f1d3da007b76421b79c95a1586455c02069669",
  "dtk/signing/native/websign.py": "b31e1809de52e43f8098cbc903746d342b2128d56907542ca118af56d9c6010b",
};

test("vendored signer files are byte-identical to upstream", () => {
  for (const [relative, expected] of Object.entries(VENDORED)) {
    const path = new URL(`./vendor/${relative}`, import.meta.url);
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert.equal(digest, expected, `${relative} 被改过，出处声明失效`);
  }
});

// 上游自带纯 Python 的 SM3，所以这里不需要 gmssl；也不需要任何别的第三方包。
// 列黑名单而不是解析 import 语句：docstring 里就有 "from one of those strings"
// 这种句子，用正则认 import 会认错。
test("vendored signer needs nothing but the standard library", () => {
  const forbidden = ["gmssl", "httpx", "pydantic", "structlog", "requests", "redis", "aiohttp"];
  for (const relative of Object.keys(VENDORED)) {
    const source = readFileSync(new URL(`./vendor/${relative}`, import.meta.url), "utf8");
    const found = forbidden.filter((name) => new RegExp(`^\\s*(?:import|from)\\s+${name}\\b`, "m").test(source));
    assert.deepEqual(found, [], `${relative} 引入了第三方包：${found.join(", ")}`);
  }
});

// 真正的行为验证在 fetch.py --self-check 里：它用上游自带的 decode() 把一个
// a_bogus 反解回内部字段。这里只是把它接进 node --test，好让它在 CI 里也跑。
// 离线，不联网。
test("fetch.py self-check passes offline", (t) => {
  const python = ["python3", "python"].find((candidate) => {
    const probe = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[0])"], {
      encoding: "utf8",
    });
    return probe.status === 0 && probe.stdout.trim() === "3";
  });
  if (!python) {
    t.skip("没有 python3，跳过（抓取脚本只在服务器上跑）");
    return;
  }
  const result = spawnSync(python, ["fetch.py", "--self-check"], {
    cwd: new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `自检失败：\n${result.stderr}`);
  assert.match(result.stderr, /自检通过/);
});
