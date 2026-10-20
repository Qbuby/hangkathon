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
function loadModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

// session-menu.tsx 含 JSX 与 import，不能直接执行；只把两个纯函数抽出来测。
async function loadDetectors() {
  const source = readFileSync(new URL("../app/session-menu.tsx", import.meta.url), "utf8");
  const start = source.indexOf("export function isWeChatBrowser");
  const end = source.indexOf("function GoogleMark");
  assert.ok(start > 0 && end > start, "找不到 UA 判定函数");
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

test("手机普通浏览器里必须给出路：不渲染扫码按钮、备用登录默认展开", () => {
  const source = readFileSync(new URL("../app/session-menu.tsx", import.meta.url), "utf8");

  // 手机 + 非微信 → 显示引导而不是登录按钮
  assert.match(source, /mobileOutsideWeChat && wechatProvider \?/, "手机非微信环境要切换到引导");
  assert.match(source, /微信扫码要「另一台设备」才能完成/, "要解释为什么扫不了");
  assert.match(source, /复制网址/, "要给一个可操作的出路");

  // 备用登录方式默认展开（否则用户只看到一条引导，没有任何可点的入口）
  assert.match(source, /const fallbackOpen = showFallback \|\| mobileOutsideWeChat;/,
    "手机普通浏览器上备用登录必须默认展开");

  // 微信内要提示会直接授权
  assert.match(source, /inWeChat && wechatProvider &&/, "微信内要给出一键授权提示");
});

test("会话接口下发备用 provider（否则手机上无从登录）", () => {
  const route = readFileSync(new URL("../app/api/session/route.ts", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
  assert.match(route, /fallbackProviders: fallbackLoginProviders/);
  assert.match(auth, /export const fallbackLoginProviders/);
  // 备用列表必须是「已配置」的，不能把没配凭据的塞进去变成又一个死按钮
  assert.match(auth, /HIDDEN_LOGIN_PROVIDERS\.includes\(provider\.id\) && provider\.configured/);
});
