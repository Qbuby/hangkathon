#!/usr/bin/env node
/**
 * mp-preview.mjs — 把小程序页面（WXML + WXSS）转成 HTML 并用 Chrome 截图，
 * 用于和网页真机基线做视觉比对。
 *
 * ⚠️ 这是**近似**渲染，不是微信真机。它不会执行页面 JS，数据来自 fixture。
 *    转不了的构造会进 skipped 列表，调用方必须把它们当作"未验证"。
 *
 * 用法：
 *   node tools/mp-preview.mjs <页面key> <输出目录>
 *
 * 页面 key 与 miniprogram/pages/<key>/<key>.wxml 对应；
 * fixture 在 tools/preview-fixtures/<key>.json；缺失时用 {} 并告警。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const CHROME = "/c/Program Files/Google/Chrome/Application/chrome.exe";
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const SCROLLS = [0, 900, 1800];

const key = process.argv[2];
const outDir = process.argv[3];
if (!key || !outDir) {
  console.error("用法：node tools/mp-preview.mjs <页面key> <输出目录>");
  process.exit(2);
}

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const MP = path.join(REPO, "miniprogram");
const pageDir = path.join(MP, "pages", key);
const wxmlPath = path.join(pageDir, `${key}.wxml`);
const pageWxssPath = path.join(pageDir, `${key}.wxss`);
const appWxssPath = path.join(MP, "app.wxss");
const fixturePath = path.join(REPO, "tools", "preview-fixtures", `${key}.json`);

if (!existsSync(wxmlPath)) {
  console.error(`找不到 ${wxmlPath}`);
  process.exit(2);
}

const skipped = [];
const warnSkip = (what) => {
  if (!skipped.includes(what)) skipped.push(what);
};

// ── 读取源码 ────────────────────────────────────────────────────────────────
const wxmlSrc = await readFile(wxmlPath, "utf8");
const pageWxss = existsSync(pageWxssPath) ? await readFile(pageWxssPath, "utf8") : "";
const appWxss = existsSync(appWxssPath) ? await readFile(appWxssPath, "utf8") : "";
let fixture = {};
if (existsSync(fixturePath)) {
  try {
    fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  } catch (error) {
    console.error(`fixture 解析失败：${error.message}`);
  }
} else {
  warnSkip(`缺少 fixture（tools/preview-fixtures/${key}.json），页面数据为空`);
}

// ── WXSS：rpx → px ────────────────────────────────────────────────────────
// 390px 视口下 1rpx = 390/750 px。
const RPX = 390 / 750;
function wxssToCss(src) {
  return src
    .replace(/(-?\d*\.?\d+)rpx/g, (_, n) => `${(Number(n) * RPX).toFixed(3)}px`)
    // page 选择器换成 body；小程序里 page 就是根
    .replace(/(^|[\s,{}])page(?=[\s,{])/g, "$1body")
    .replace(/@import\s+["'][^"']+["'];?/g, "");
}

// ── 组件内联 ───────────────────────────────────────────────────────────────
const COMPONENTS = {
  "site-header": { dir: path.join(MP, "components", "site-header"), file: "index" },
  "site-footer": { dir: path.join(MP, "components", "site-footer"), file: "index" },
  "login-sheet": { dir: path.join(MP, "components", "login-sheet"), file: "index" },
};

const componentCss = [];
const componentProps = {};
for (const [tag, meta] of Object.entries(COMPONENTS)) {
  const jsonPath = path.join(meta.dir, "index.json");
  const jsPath = path.join(meta.dir, "index.js");
  const props = {};
  if (existsSync(jsPath)) {
    // 只取 properties 的默认值：properties: { a: { type: String, value: "x" } } 或 a: String
    const src = await readFile(jsPath, "utf8");
    const block = /properties\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(src);
    if (block) {
      const body = block[1];
      for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{([\s\S]*?)\}/g)) {
        const name = m[1];
        const valueMatch = /value\s*:\s*([^,\n]+)/.exec(m[2]);
        if (valueMatch) {
          const raw = valueMatch[1].trim();
          props[name] =
            raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw.replace(/^["']|["']$/g, "");
        }
      }
    }
  }
  componentProps[tag] = props;
  const cssPath = path.join(meta.dir, "index.wxss");
  if (existsSync(cssPath)) componentCss.push(wxssToCss(await readFile(cssPath, "utf8")));
  if (existsSync(jsonPath)) {
    try {
      const cfg = JSON.parse(await readFile(jsonPath, "utf8"));
      if (cfg.styleIsolation && cfg.styleIsolation !== "apply-shared") {
        warnSkip(`组件 <${tag}> 使用了 styleIsolation=${cfg.styleIsolation}，变量可能不继承`);
      }
    } catch {
      /* 忽略 */
    }
  }
}

async function componentWxml(tag) {
  const meta = COMPONENTS[tag];
  if (!meta) return null;
  const p = path.join(meta.dir, "index.wxml");
  return existsSync(p) ? readFile(p, "utf8") : null;
}

// ── 模板求值 ───────────────────────────────────────────────────────────────
function evalExpr(expr, scope) {
  try {
    // 只允许简单表达式；`new Function` 在这里是可接受的，因为输入是我们自己的模板
    const fn = new Function("scope", `with (scope) { return (${expr}); }`);
    const value = fn(scope);
    return value === undefined || value === null ? "" : value;
  } catch {
    warnSkip(`表达式求值失败：${expr}`);
    return "";
  }
}

function interpolate(text, scope) {
  return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => String(evalExpr(expr.trim(), scope)));
}

// ── 极简 WXML → HTML ──────────────────────────────────────────────────────
const TAG_MAP = {
  view: "div",
  text: "span",
  image: "img",
  button: "button",
  "scroll-view": "div",
  picker: "div",
  navigator: "a",
  block: null, // 不输出标签
  form: "form",
  input: "input",
  textarea: "textarea",
  switch: "input",
  label: "label",
  icon: "i",
};

/** 把属性串解析成 { attrs, bindings }。 */
function parseAttrs(raw) {
  const attrs = {};
  // 属性值可能是 "..." 或 '...'；值里允许出现 >（例如 {{a > b}}）
  const re = /([A-Za-z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'))?/g;
  let m;
  while ((m = re.exec(raw))) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : true;
  }
  return attrs;
}


/** 取 wx:if / wx:elif 的表达式；布尔属性（无值）按 true 处理。 */
function condExpr(value) {
  if (value === true) return "true";
  if (typeof value !== "string") return "false";
  return value.replace(/^\{\{|\}\}$/g, "").trim() || "false";
}

let renderedNodes = 0;

function renderNode(node, scope) {
  if (node.type === "text") return interpolate(node.text, scope);

  const tag = node.tag;
  const attrs = node.attrs;

  // wx:for
  if (attrs["wx:for"] !== undefined) {
    const list = evalExpr(condExpr(attrs["wx:for"]), scope);
    const itemName = attrs["wx:for-item"] || "item";
    const indexName = attrs["wx:for-index"] || "index";
    if (!Array.isArray(list)) {
      warnSkip(`wx:for 的值不是数组：${attrs["wx:for"]}`);
      return "";
    }
    const clone = { ...node, attrs: { ...attrs } };
    delete clone.attrs["wx:for"];
    delete clone.attrs["wx:for-item"];
    delete clone.attrs["wx:for-index"];
    delete clone.attrs["wx:key"];
    return list
      .map((item, index) => renderNode(clone, { ...scope, [itemName]: item, [indexName]: index }))
      .join("");
  }

  // wx:if / wx:elif / wx:else 由父级预处理；这里只处理单独的 wx:if
  if (attrs["wx:if"] !== undefined) {
    const ok = evalExpr(condExpr(attrs["wx:if"]), scope);
    if (!ok) return "";
  }
  if (attrs["wx:else"] !== undefined && attrs["wx:else"] !== false) {
    // 到达这里说明父级没有处理，按渲染处理
  }

  // 自定义组件：读它的 wxml 内联
  if (COMPONENTS[tag]) {
    return renderComponent(tag, attrs, scope);
  }

  const htmlTag = TAG_MAP[tag];
  if (htmlTag === null) {
    // block：只渲染子节点
    return renderChildren(node.children, scope);
  }
  if (htmlTag === undefined) {
    warnSkip(`未知标签 <${tag}>（按 div 渲染）`);
  }
  const outTag = htmlTag ?? "div";

  renderedNodes += 1;

  const parts = [];
  const classAttr = attrs.class ? ` class="${interpolate(attrs.class, scope)}"` : "";
  if (classAttr) parts.push(classAttr.trim());

  const styleAttr = attrs.style ? ` style="${interpolate(attrs.style, scope)}"` : "";
  if (styleAttr) parts.push(styleAttr.trim());

  if (outTag === "img") {
    let src = attrs.src ? interpolate(attrs.src, scope) : "";
    if (src.startsWith("/")) src = `file://${REPO}${src}`;
    parts.push(`src="${src}"`);
    if (attrs.mode && attrs.mode !== "scaleToFill") {
      // 近似：用 object-fit 表达 aspectFit/aspectFill
      const fit = attrs.mode === "aspectFill" ? "cover" : attrs.mode === "aspectFit" ? "contain" : "fill";
      parts.push(`style="object-fit:${fit}"`);
    }
    if (attrs.alt) parts.push(`alt="${interpolate(attrs.alt, scope)}"`);
    return `<img ${parts.join(" ")}>`;
  }

  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith("wx:") || name.startsWith("bind") || name.startsWith("catch") || name === "class" || name === "style") continue;
    if (outTag === "input" && name === "type") {
      parts.push(`type="${value === "number" ? "text" : interpolate(String(value), scope)}"`);
      continue;
    }
    if (outTag === "input" && name === "value") {
      parts.push(`value="${interpolate(String(value), scope)}"`);
      continue;
    }
    if (name === "placeholder") {
      parts.push(`placeholder="${interpolate(String(value), scope)}"`);
      continue;
    }
    if (name === "src") {
      let src = interpolate(String(value), scope);
      if (src.startsWith("/")) src = `file://${REPO}${src}`;
      parts.push(`src="${src}"`);
      continue;
    }
  }

  const inner =
    outTag === "input" || outTag === "img"
      ? ""
      : renderChildren(node.children, scope);

  return `<${outTag} ${parts.join(" ")}>${inner}</${outTag}>`;
}

async function renderComponent(tag, attrs, outerScope) {
  const src = await componentWxml(tag);
  if (!src) {
    warnSkip(`组件 <${tag}> 没有 wxml`);
    return "";
  }
  const defaults = componentProps[tag] || {};
  const scope = { ...defaults };
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("wx:") || k.startsWith("bind") || k === "class" || k === "style") continue;
    scope[k] = typeof v === "string" && v.includes("{{") ? evalExpr(v.replace(/^\{\{|\}\}$/g, ""), outerScope) : v;
  }
  // 组件里也常引用页面数据：把外层 scope 作为兜底
  const merged = { ...outerScope, ...scope };
  renderedNodes += 1;
  return `<div class="mp-component mp-${tag}">${renderChildren(parse(src), merged)}</div>`;
}

/** 极简 WXML 解析：只处理匹配良好的标签与文本。 */
function parse(src) {
  const root = { type: "root", tag: "root", attrs: {}, children: [] };
  const stack = [root];
  // 属性段用引号配平来匹配，避免 {{a > b}} 里的 > 提前结束标签
  const re = /<!--[\s\S]*?-->|<\/([A-Za-z][-\w]*)\s*>|<([A-Za-z][-\w]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      // 闭合标签
      const name = m[1];
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (m[2]) {
      const node = { type: "element", tag: m[2], attrs: parseAttrs(m[3] || ""), children: [] };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
      continue;
    }
    if (m[5]) {
      const text = m[5];
      if (text.trim()) stack[stack.length - 1].children.push({ type: "text", text });
    }
  }
  return root.children;
}

// ── 组装 HTML ─────────────────────────────────────────────────────────────
const nodes = parse(wxmlSrc);

/**
 * 渲染一组兄弟节点，并在这一层按顺序处理 wx:if / wx:elif / wx:else。
 *
 * 必须放在渲染时做，而不是预先遍历：条件里常常引用 wx:for 的循环变量
 * （例如 wx:if="{{act.isPending}}"），那个变量只在渲染该条数据时才存在。
 */
function renderChildren(list, scope) {
  let branchTaken = false;
  const out = [];
  for (const node of list) {
    if (node.type !== "element") {
      out.push(renderNode(node, scope));
      continue;
    }
    const a = node.attrs;
    const hasIf = a["wx:if"] !== undefined;
    const hasElif = a["wx:elif"] !== undefined;
    const hasElse = a["wx:else"] !== undefined;

    if (hasIf) {
      const ok = Boolean(evalExpr(condExpr(a["wx:if"]), scope));
      branchTaken = ok;
      if (ok) out.push(renderNode({ ...node, attrs: stripCondAttrs(a) }, scope));
      continue;
    }
    if (hasElif) {
      if (branchTaken) continue;
      const ok = Boolean(evalExpr(condExpr(a["wx:elif"]), scope));
      branchTaken = ok;
      if (ok) out.push(renderNode({ ...node, attrs: stripCondAttrs(a) }, scope));
      continue;
    }
    if (hasElse) {
      const ok = !branchTaken;
      branchTaken = false;
      if (ok) out.push(renderNode({ ...node, attrs: stripCondAttrs(a) }, scope));
      continue;
    }
    branchTaken = false;
    out.push(renderNode(node, scope));
  }
  return out.join("");
}

function stripCondAttrs(attrs) {
  const next = { ...attrs };
  delete next["wx:if"];
  delete next["wx:elif"];
  delete next["wx:else"];
  return next;
}

const body = renderChildren(parse(wxmlSrc), { ...fixture });

const css = [
  `html,body{margin:0;padding:0;background:#fff;}`,
  `body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;}`,
  `.mp-component{display:block;}`,
  wxssToCss(appWxss),
  ...componentCss,
  wxssToCss(pageWxss),
].join("\n");

const statusBar = typeof fixture.__statusBarHeight === "number" ? fixture.__statusBarHeight : 44;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=390, initial-scale=1">
<style>${css}
/* 预览专用：模拟状态栏 */
.mp-statusbar{height:${statusBar}px;background:transparent;}
</style></head>
<body><div class="mp-statusbar"></div>${body}</body></html>`;

await mkdir(outDir, { recursive: true });
const htmlPath = path.join(outDir, "index.html");
await writeFile(htmlPath, html, "utf8");

// ── 截图 ──────────────────────────────────────────────────────────────────
async function freePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

function toWin(p) {
  // /c/Program Files/... → C:\Program Files\...
  const m = /^\/([A-Za-z])\/(.*)$/.exec(p);
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}` : p;
}

const port = await freePort();
const profile = await mkdtemp(path.join(os.tmpdir(), "mp-preview-"));
const chrome = spawn(
  toWin(CHROME),
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${toWin(profile)}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
const shots = [];
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await delay(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch {
      /* 还没起来 */
    }
  }
  if (!target) throw new Error("Chrome 未就绪（CDP 端口无响应）");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  const send = (method, params) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  await send("Page.navigate", { url: `file:///${htmlPath.replace(/\\/g, "/").replace(/^\//, "")}` });
  await delay(1200);

  for (let i = 0; i < SCROLLS.length; i += 1) {
    await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${SCROLLS[i]})` });
    await delay(350);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = path.join(outDir, `${key}-${i}.png`);
    await writeFile(file, Buffer.from(shot.result.data, "base64"));
    shots.push(file);
  }
} finally {
  try {
    ws?.close();
  } catch {
    /* 忽略 */
  }
  chrome.kill();
  await delay(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(
  JSON.stringify({
    html: htmlPath,
    shots,
    renderedNodes,
    skipped,
  }),
);
