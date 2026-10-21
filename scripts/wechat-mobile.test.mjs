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
// login-panel.tsx 含 JSX 与 import，不能直接执行；只把纯函数抽出来测。
// 2026-10-21：UA 判定从 session-menu.tsx 迁到 app/login-panel.tsx（全站共用登录面板）。
async function loadDetectors() {
  const source = readFileSync(new URL("../app/login-panel.tsx", import.meta.url), "utf8");
  const start = source.indexOf("export function isWeChatBrowser");
  const end = source.indexOf("// lucide 不含品牌图标");
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

test("手机端走公众号验证码，不再渲染扫不掉的二维码", () => {
  const source = readFileSync(new URL("../app/login-panel.tsx", import.meta.url), "utf8");

  /**
   * 2026-10-21 改版：手机端（含微信内置浏览器）改用**公众号验证码**。
   * 原因：微信「网站应用」只能出二维码，而手机上二维码就在自己屏幕上；
   * 订阅号又不支持带参二维码与网页授权 —— 但**收消息**是订阅号的基本能力。
   * 所以手机端整块换成 MobileCodeLogin，桌面端保持扫码。
   */
  assert.match(source, /onMobile && wechatProvider \?/, "手机端要切到验证码流程");
  assert.match(source, /<MobileCodeLogin callbackUrl=\{callbackUrl\} \/>/, "必须渲染验证码组件");

  // 组件里要有关键三步：拿码 → 提示发给公众号 → 轮询换票
  assert.match(source, /export function MobileCodeLogin\(/, "组件必须存在");
  assert.match(source, /fetch\("\/api\/auth\/wechat-code", \{ method: "POST" \}\)/, "要能取码");
  assert.match(source, /\/api\/auth\/wechat-code\/poll\?code=/, "要轮询状态");
  assert.match(source, /method: "POST" \}\)/, "拿到 ready 后要换票");

  // 用户可读的关键文案
  assert.match(source, /请把验证码发给公众号/);
  assert.match(source, /已关注用户，点此获取验证码/, "需求要求的那个按钮文案");
  assert.match(source, /等待公众号确认/);

  // 界面上不能再有 GitHub / Google 的入口（先剥注释再查，注释里提"已废弃"是正常的）
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

test("全站登录入口只有一个实现：/create、/manage、/profile 都复用 LoginPanel", () => {
  const panel = readFileSync(new URL("../app/login-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /export function LoginPanel\(/, "共用面板必须导出");
  assert.match(panel, /export function WeChatBrowserNotice\(/, "微信内置浏览器提示必须存在");

  for (const file of [
    "../app/create/create-client.tsx",
    "../app/manage/manage-client.tsx",
    "../app/profile/profile-client.tsx",
    "../app/session-menu.tsx",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /from "\.\.?\/login-panel"/, `${file} 必须复用统一登录面板`);
    /**
     * 关键回归点：这些页面过去各自写 `<button onClick={() => signIn(...)}>`，
     * 手机端点了会跳 qrconnect（二维码在本机屏幕上，永远扫不掉），
     * 于是用户看到"已经登录了还提示登录"，或者干脆卡在扫码页。
     * 登录按钮只允许出现在 login-panel.tsx 里。
     */
    assert.equal(/signIn\(provider\.id/.test(source), false, `${file} 不该再自己调 signIn`);
  }
});

test("微信内置浏览器：提示「在浏览器打开」，且不谎称能自动跳转", () => {
  const panel = readFileSync(new URL("../app/login-panel.tsx", import.meta.url), "utf8");
  // 微信没有开放唤起外部浏览器的 JS API，所以只能给操作路径
  assert.match(panel, /在浏览器打开/, "必须给出明确的手指路径");
  assert.match(panel, /intent:\/\//, "Android 给一个尽力而为的 intent 链接");
  // 不能出现"自动打开/自动跳转"这类做不到的承诺
  const copy = panel.replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.equal(/自动(打开|跳转)(到)?浏览器/.test(copy), false, "不得承诺自动拉起外部浏览器");
});
