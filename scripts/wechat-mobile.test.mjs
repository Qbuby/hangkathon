import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * 手机端微信登录的 UA 判定。
 *
 * 背景（2026-10-19 用户反馈「手机上登陆不了」）：微信「网站应用」的 qrconnect 在
 * **普通手机浏览器**里只会显示二维码 —— 二维码就在用户自己那块屏幕上，没法用同一台
 * 手机扫；微信又明确禁止长按/相册识别登录码（"该二维码仅支持在扫一扫时，通过摄像头
 * 来识别"）。而同一套 qrconnect 在**微信内置浏览器**里会变成「微信快捷登录」，
 * 轻触允许即可，根本不用扫码。
 *
 * 所以 UA 判定直接决定了用户看到的是"可用的引导"还是"永远扫不掉的二维码"。
 */
// session-menu.tsx 含 JSX 与 import，不能直接执行；只把两个纯函数抽出来测。
async function loadDetectors() {
  const source = readFileSync(new URL("../app/session-menu.tsx", import.meta.url), "utf8");
  const start = source.indexOf("export function isWeChatBrowser");
  const end = source.indexOf("function WeChatMark");
  assert.ok(start > 0 && end > start, "找不到 UA 判定函数（或锚点失效）");
  const snippet = source.slice(start, end);
  const js = ts.transpileModule(snippet, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

test("微信内置浏览器能被认出来（那里 qrconnect 会变成一键登录）", async () => {
  const { isWeChatBrowser } = await loadDetectors();
  const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x1800312c) NetType/WIFI Language/zh_CN";
  const android = "Mozilla/5.0 (Linux; Android 14; PKM110 Build/UKQ1.230924.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64 Weixin NetType/WIFI";
  assert.equal(isWeChatBrowser(ios), true);
  assert.equal(isWeChatBrowser(android), true);
  // 大小写不影响（微信 UA 历史上出现过小写 micromessenger）
  assert.equal(isWeChatBrowser(ios.toLowerCase()), true);
});

test("普通浏览器不能被误判成微信（误判会让手机用户看不到任何入口）", async () => {
  const { isWeChatBrowser } = await loadDetectors();
  for (const ua of [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ]) {
    assert.equal(isWeChatBrowser(ua), false, `不该误判：${ua.slice(0, 60)}`);
  }
});

test("移动端判定覆盖 iOS / Android / 鸿蒙，桌面不能误判", async () => {
  const { isMobileBrowser } = await loadDetectors();
  assert.equal(isMobileBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(isMobileBrowser("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), true);
  assert.equal(isMobileBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), true);
  assert.equal(isMobileBrowser("Mozilla/5.0 (Phone; HarmonyOS 4.0)"), true);
  assert.equal(isMobileBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  assert.equal(isMobileBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), false);
});

test("手机普通浏览器里必须给出路：不渲染扫码按钮，改为引导去微信打开", () => {
  const source = readFileSync(new URL("../app/session-menu.tsx", import.meta.url), "utf8");

  // 手机 + 非微信 → 引导而不是登录按钮（那个按钮点了只会出现扫不掉的二维码）
  assert.match(source, /mobileOutsideWeChat && wechatProvider \?/, "手机非微信环境要切换到引导");
  assert.match(source, /微信扫码要「另一台设备」才能完成/, "要解释为什么扫不了");
  assert.match(source, /复制本站网址/, "要给一个可操作的出路");

  // 微信内要提示会直接授权
  assert.match(source, /inWeChat && wechatProvider &&/, "微信内要给出一键授权提示");

  /**
   * 界面上不能再有 GitHub / Google 的入口。**先剥注释再查** ——
   * 注释里写着"已废弃"是正常的，直接对全文 grep 会误报。
   * （这轮已经三次踩在"静态断言匹配到了注释而不是代码"上。）
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.equal(/github/i.test(code), false, "界面不该再出现 GitHub");
  assert.equal(/google/i.test(code), false, "界面不该再出现 Google");
});

test("登录方式只有微信：provider 注册、环境变量、界面三处一致", () => {
  const auth = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/session/route.ts", import.meta.url), "utf8");
  const env = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

  /**
   * 2026-10-20 用户决定：GitHub / Google 直接废弃。
   * 关键点：**连 provider 注册一起删**，而不是只藏按钮 ——
   * 只要 provider 还注册着，/api/auth/signin/github 就仍然可达，
   * 一个"界面上看不见但直接访问能用"的入口等于绕过产品决定。
   */
  assert.equal(/providers\/github/.test(auth), false, "不该再 import GitHub provider");
  assert.equal(/providers\/google/.test(auth), false, "不该再 import Google provider");
  assert.equal(/providerConfigured\("github"\)/.test(auth), false, "不该再注册 GitHub provider");
  assert.equal(/providerConfigured\("google"\)/.test(auth), false, "不该再注册 Google provider");

  // oauthProviders 里只剩微信
  const list = auth.slice(auth.indexOf("export const oauthProviders"), auth.indexOf("/** 客户端登录按钮消费的列表"));
  assert.match(list, /id: "wechat"/);
  assert.equal((list.match(/id: "/g) ?? []).length, 1, "oauthProviders 里只能有一个 provider");

  // 环境变量说明里不该再出现那两家
  assert.equal(/AUTH_GITHUB_ID/.test(env), false, ".env.example 不该再有 GitHub");
  assert.equal(/AUTH_GOOGLE_ID/.test(env), false, ".env.example 不该再有 Google");

  // 会话接口不该再下发备用列表
  assert.equal(/fallbackProviders/.test(route), false, "session 不该再下发备用 provider");
});
