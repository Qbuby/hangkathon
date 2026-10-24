#!/usr/bin/env node
/**
 * mp-design-capture.mjs — 用本机 Chrome + CDP 抓取移动端页面的视觉基线。
 *
 * 用法（输出目录必须是绝对路径；Git Bash 的 /d/... 写法也接受）：
 *   node /d/program/hangkathon-repo/tools/mp-design-capture.mjs \
 *     /d/program/hangkathon-repo/outputs/visual-baseline [http://127.0.0.1:5173]
 *
 * 页面来源优先级：argv[3] > MP_CAPTURE_BASE_URL > TEST_BASE_URL > http://127.0.0.1:5173
 * 本工具只负责抓取，不会启动站点；请先把本地站点跑起来。
 *
 * 输出：
 *   <out>/manifest.json
 *   <out>/<page>-<index>.png
 *
 * 任何一步失败都会把真实错误打到 stderr 并以 1 退出；不会静默跳过页面。
 * Chrome 由本脚本自己 spawn，结束（成功或失败）都会 kill 并删除临时 profile。
 */

import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Git Bash / MSYS 路径；Node 内会先转成 Windows 绝对路径。 */
const DEFAULT_CHROME = "/c/Program Files/Google/Chrome/Application/chrome.exe";

const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const SCROLL_POSITIONS = [0, 900, 1800];
const DOM_SETTLE_MS = 5000;
const MAX_STYLE_ENTRIES = 400;
// page 是 manifest 里的页面标识，也是截图文件名的前缀；取路由去掉前导斜杠、'/' 换 '-'。
const PAGES = [
  { page: "activities", route: "/activities" },
  { page: "activities-guoqing-77", route: "/activities/guoqing-77" },
  { page: "leaderboard", route: "/leaderboard" },
  { page: "profile", route: "/profile" },
  // 网页的 /create 是代理商门禁页（未登录会显示"先登录，再发起活动"），
  // 小程序里对应"发起活动"，同样要把这个门禁态对齐。
  { page: "create", route: "/create" },
];

const STYLE_SNAPSHOT_EXPRESSION = `(() => {
  const max = ${MAX_STYLE_ENTRIES};
  // “可见”按 CSS 可见性判定：参与布局、没有 display:none / visibility:hidden /
  // opacity:0，且盒子非零（display:contents 除外）；不限于当前视口内。
  const skipTags = new Set([
    "script", "style", "noscript", "template", "meta", "link", "title", "head",
    "source", "track", "base", "param",
  ]);
  // 不在这里用正则字面量：这段代码内嵌在模板字符串里，反斜杠转义很容易写错。
  const hasVisibleBackground = (value) => {
    if (!value || value === "transparent") return false;
    const open = value.indexOf("(");
    const close = value.lastIndexOf(")");
    if (open === -1 || close === -1) return true;
    const body = value.slice(open + 1, close);
    // 现代语法 color()/lab()/oklch()/rgb(0 0 0 / 0)：斜杠后的分量是 alpha。
    const slash = body.lastIndexOf("/");
    if (slash !== -1) {
      return Number(body.slice(slash + 1).trim().replace("%", "")) > 0;
    }
    // Chrome 的 computed style 对 rgb()/rgba() 通常输出逗号分隔；第 4 个分量是 alpha。
    if (value.startsWith("rgba(")) {
      const parts = body.split(",");
      return !(parts.length === 4 && Number(parts[3].trim()) === 0);
    }
    return true;
  };

  const candidates = [];
  let index = 0;
  for (const el of document.querySelectorAll("*")) {
    index += 1;

    const tagName = el.tagName;
    if (skipTags.has(tagName.toLowerCase())) continue;

    const style = getComputedStyle(el);
    if (style.display === "none") continue;
    if (style.visibility !== "visible") continue;
    if (Number(style.opacity) === 0) continue;
    if (
      typeof el.checkVisibility === "function" &&
      !el.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        opacityProperty: true,
        visibilityProperty: true,
      })
    ) {
      continue;
    }

    // display:contents 的元素没有自己的盒子，但它的文本/背景由子元素绘制，
    // 因此不能因为 rect 是 0×0 就判为不可见。
    const rect = el.getBoundingClientRect();
    if (style.display !== "contents" && rect.width === 0 && rect.height === 0) continue;

    const textContent = (el.textContent ?? "").trim();
    const backgroundColor = style.backgroundColor;
    const hasBackground = hasVisibleBackground(backgroundColor);
    // 要求：只保留有文本内容或有背景色的元素。
    if (!textContent && !hasBackground) continue;

    // 400 个名额优先给“自己直接渲染文本”的元素，其次是带背景色的容器，
    // 最后才是只有后代文本的布局祖先 —— 否则 html/body/main 会先占满额度。
    let hasDirectText = false;
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim()) {
        hasDirectText = true;
        break;
      }
    }

    candidates.push({
      priority: hasDirectText ? 0 : hasBackground ? 1 : 2,
      index,
      entry: {
        tagName,
        className: el.getAttribute("class") ?? "",
        color: style.color,
        backgroundColor,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        padding: style.padding,
        margin: style.margin,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        display: style.display,
        position: style.position,
        width: style.width,
        height: style.height,
      },
    });
  }

  candidates.sort((a, b) => a.priority - b.priority || a.index - b.index);
  const selected = candidates.slice(0, max);
  selected.sort((a, b) => a.index - b.index);
  return selected.map((candidate) => candidate.entry);
})()`;

/** 把 Git Bash/MSYS 的 /c/... 或 /cygdrive/c/... 转成 Windows 绝对路径。 */
function toAbsoluteLocalPath(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error(`路径参数无效: ${String(input)}`);
  }
  if (process.platform === "win32") {
    const cygdrive = /^\/cygdrive\/([a-zA-Z])(?:\/(.*))?$/.exec(input);
    const msys = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(input);
    const match = cygdrive ?? msys;
    // 只有盘符真实存在时才按 MSYS 路径转换，避免把普通 POSIX 路径
    // （如 /tmp/x，其中 t 恰好是字母）误当成 T:\mp\x。
    if (match && existsSync(`${match[1].toUpperCase()}:\\`)) {
      const rest = (match[2] ?? "").replace(/\//g, "\\");
      return `${match[1].toUpperCase()}:\\${rest}`;
    }
  }
  return path.resolve(input);
}

function formatError(error, depth = 0) {
  if (!(error instanceof Error)) return String(error);
  const lines = [error.stack ?? `${error.name}: ${error.message}`];
  if (error.cause && depth < 5) {
    lines.push(`Caused by: ${formatError(error.cause, depth + 1)}`);
  }
  return lines.join("\n");
}

async function assertChromeExecutable(chromePath) {
  let info;
  try {
    info = await stat(chromePath);
  } catch (error) {
    throw new Error(`找不到 Chrome 可执行文件: ${chromePath}`, { cause: error });
  }
  if (!info.isFile()) {
    throw new Error(`Chrome 路径不是文件: ${chromePath}`);
  }
}

function parseBaseUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (error) {
    throw new Error(`无效的 base URL: ${input}`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`base URL 必须是 http/https，收到: ${input}`);
  }
  // 路由都以 "/" 开头，带路径前缀会被 new URL(route, base) 丢掉 —— 与其悄悄抓错，
  // 不如要求传站点 origin（可带端口）。
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`base URL 只能是站点 origin（可带端口），不要带路径/查询/锚点: ${input}`);
  }
  return url;
}

/** 去掉末尾斜杠后比较路径；根路径保留为 "/"。 */
function normalizePathname(pathname) {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** 读取 PNG 的 IHDR 尺寸，用来验证截图真的按 390×844 @2x 出图。 */
function readPngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    return null;
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 单个 CDP WebSocket 连接：请求/响应 + 事件等待。 */
class CDP {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();
  #closed = false;

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      let text;
      const data = event.data;
      if (typeof data === "string") {
        text = data;
      } else if (data instanceof ArrayBuffer) {
        text = Buffer.from(data).toString("utf8");
      } else if (Buffer.isBuffer(data)) {
        text = data.toString("utf8");
      } else if (typeof Blob !== "undefined" && data instanceof Blob) {
        data
          .text()
          .then((value) => this.#dispatch(value))
          .catch((error) => console.error(`[capture] 读取 CDP 消息失败: ${formatError(error)}`));
        return;
      } else {
        console.error(`[capture] 无法解析的 CDP 消息类型: ${Object.prototype.toString.call(data)}`);
        return;
      }
      this.#dispatch(text);
    });
    socket.addEventListener("close", (event) => {
      this.#closed = true;
      const reason = `DevTools WebSocket 已关闭 (code=${event.code}${event.reason ? `, reason=${event.reason}` : ""})`;
      const error = new Error(reason);
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    });
  }

  static connect(wsUrl, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(wsUrl);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // 忽略：已经连不上时 close 也可能抛错。
        }
        finish(reject, new Error(`连接 DevTools WebSocket 超时 (${timeoutMs}ms): ${wsUrl}`));
      }, timeoutMs);

      socket.addEventListener(
        "open",
        () => finish(resolve, new CDP(socket)),
        { once: true },
      );
      socket.addEventListener(
        "error",
        (event) => {
          const detail = event?.error?.message ?? event?.message ?? "unknown error";
          try {
            socket.close();
          } catch {
            // 已经关闭。
          }
          finish(reject, new Error(`连接 DevTools WebSocket 失败: ${wsUrl}: ${detail}`));
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        (event) => {
          finish(
            reject,
            new Error(`DevTools WebSocket 在连接完成前关闭 (code=${event.code}): ${wsUrl}`),
          );
        },
        { once: true },
      );
    });
  }

  #dispatch(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      console.error(`[capture] 收到无法解析的 CDP 消息: ${formatError(error)}`);
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        const data = message.error.data === undefined ? "" : ` data=${JSON.stringify(message.error.data)}`;
        pending.reject(
          new Error(
            `CDP ${pending.method} 失败: ${message.error.message ?? "unknown error"} (code=${message.error.code})${data}`,
          ),
        );
        return;
      }
      pending.resolve(message.result ?? {});
      return;
    }

    if (message.method) {
      const handlers = this.#handlers.get(message.method);
      if (!handlers) return;
      for (const handler of [...handlers]) {
        try {
          handler(message.params ?? {});
        } catch (error) {
          console.error(
            `[capture] 处理 CDP 事件 ${message.method} 时出错: ${formatError(error)}`,
          );
        }
      }
    }
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.#closed) {
      return Promise.reject(new Error(`CDP 连接已关闭，无法发送 ${method}`));
    }
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP 调用超时 (${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.#socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error(`发送 CDP 命令失败: ${method}`, { cause: error }));
      }
    });
  }

  on(method, handler) {
    let handlers = this.#handlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#handlers.delete(method);
    };
  }

  close() {
    try {
      this.#socket.close();
    } catch {
      // 已经关闭。
    }
  }
}

async function canListenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

async function findFreePort() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 30000 + randomInt(0, 30000);
    if (await canListenOnPort(port)) return port;
    console.warn(`[capture] 调试端口 ${port} 被占用，换一个端口重试`);
  }
  throw new Error("连续 30 次都没有找到可用的高位调试端口");
}

function chromeArguments(port, profileDir) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-crash-reporter",
    "--metrics-recording-only",
    "--mute-audio",
    "--noerrdialogs",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "about:blank",
  ];
}

function spawnChrome(chromePath, port, profileDir) {
  const child = spawn(chromePath, chromeArguments(port, profileDir), {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  let spawnError = null;
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-16000);
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  return {
    child,
    getStderr: () => stderr,
    getSpawnError: () => spawnError,
  };
}

async function waitForChromeEndpoint(processInfo, port, profileDir, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  const devtoolsUrlPattern =
    /DevTools listening on ws:\/\/[^\s]*:(\d+)\/devtools\/browser\/[^\s]+/;
  const activePortFile = path.join(profileDir, "DevToolsActivePort");

  while (Date.now() < deadline) {
    const spawnError = processInfo.getSpawnError();
    if (spawnError) {
      throw new Error(`无法启动 Chrome: ${spawnError.message}`, { cause: spawnError });
    }
    const { child, getStderr } = processInfo;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Chrome 提前退出 (exitCode=${child.exitCode}, signal=${child.signalCode})。` +
          `\nChrome stderr:\n${getStderr().trim() || "(空)"}`,
      );
    }

    const stderr = getStderr();
    // 端口冲突时 Chrome 可能不退出，只是不带 DevTools 继续跑 —— 必须识别 stderr，
    // 否则会连到占用该端口的另一个 Chrome 实例上。
    if (
      /Could not bind|Cannot listen|bind\(\) failed|Cannot start http server for devtools|DevToolsActivePort file wasn't written/i.test(
        stderr,
      )
    ) {
      throw new Error(
        `Chrome 无法在 127.0.0.1:${port} 上开启 DevTools（端口可能被占用）。` +
          `\nChrome stderr:\n${stderr.trim()}`,
      );
    }

    const marker = devtoolsUrlPattern.exec(stderr);
    if (marker && Number(marker[1]) !== port) {
      throw new Error(
        `Chrome 报告的 DevTools 端口是 ${marker[1]}，与请求的 ${port} 不一致。\nChrome stderr:\n${stderr.trim()}`,
      );
    }

    // 本进程的 user-data-dir 里由 Chrome 自己写出的端口文件，是“这个端点属于我”
    // 最可靠的证据；/json/version 谁都能应答，文件只可能由本进程的 Chrome 写入。
    let ownEndpoint = Boolean(marker);
    try {
      const activePort = (await readFile(activePortFile, "utf8")).split(/\r?\n/);
      const filePort = Number(activePort[0]);
      if (Number.isInteger(filePort) && filePort > 0 && filePort !== port) {
        throw new Error(
          `Chrome 写出的 DevToolsActivePort 是 ${filePort}，与请求的 ${port} 不一致`,
        );
      }
      ownEndpoint = ownEndpoint || filePort === port;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      lastError = new Error("Chrome 尚未写出 DevToolsActivePort");
    }

    if (ownEndpoint) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          const info = await response.json();
          if (typeof info.webSocketDebuggerUrl === "string" && info.webSocketDebuggerUrl) {
            return info;
          }
          lastError = new Error("/json/version 没有返回 webSocketDebuggerUrl");
        } else {
          lastError = new Error(
            `GET /json/version 返回 HTTP ${response.status} ${response.statusText}`,
          );
        }
      } catch (error) {
        lastError = error;
      }
    }
    await delay(200);
  }

  throw new Error(
    `等待本进程的 Chrome DevTools 端点超时 (${timeoutMs}ms, port=${port}): ` +
      `${lastError?.message ?? "无响应"}\nChrome stderr:\n${processInfo.getStderr().trim() || "(空)"}`,
  );
}

async function stopChrome(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  // spawn 直接失败时没有 pid，也没有什么可 kill 的。
  if (!child.pid) return;

  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  }

  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill(process.platform === "win32" ? undefined : "SIGKILL");
    } catch {
      // taskkill 之后进程可能恰好退出。
    }
  }

  const exited = await waitForChildExit(child, 5000);
  if (!exited) {
    throw new Error(`Chrome 进程 ${child.pid} 未能在 5 秒内退出`);
  }
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function removeProfile(profileDir) {
  if (!profileDir) return;
  let lastError = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      if (existsSync(profileDir)) {
        throw new Error("目录仍然存在");
      }
      return;
    } catch (error) {
      lastError = error;
      await delay(200 * attempt);
    }
  }
  throw new Error(
    `删除临时 Chrome profile 失败: ${profileDir}: ${lastError?.message ?? "unknown error"}`,
    { cause: lastError },
  );
}

/** 当前正在运行的 Chrome 句柄，供信号处理做同步兜底清理。 */
let activeChrome = null;

function emergencyCleanup(signal) {
  const active = activeChrome;
  activeChrome = null;
  console.error(`[capture] 收到 ${signal}，正在终止 Chrome 并删除临时 profile`);
  if (active?.child?.pid) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(active.child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        active.child.kill("SIGKILL");
      }
    } catch (error) {
      console.error(`[capture] 信号清理时终止 Chrome 失败: ${formatError(error)}`);
    }
  }
  if (active?.profileDir) {
    try {
      rmSync(active.profileDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`[capture] 信号清理时删除临时 profile 失败: ${formatError(error)}`);
    }
  }
  process.exit(1);
}

process.once("SIGINT", () => emergencyCleanup("SIGINT"));
process.once("SIGTERM", () => emergencyCleanup("SIGTERM"));

async function startChrome(chromePath, attempts = 6) {
  let lastFailure = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const port = await findFreePort();
    const profileDir = await mkdtemp(path.join(os.tmpdir(), "mp-design-capture-"));
    const processInfo = spawnChrome(chromePath, port, profileDir);
    const chromeHandle = { ...processInfo, port, profileDir };
    // 在等待 DevTools 端点期间也登记句柄，Ctrl+C 时也能清理干净。
    activeChrome = chromeHandle;
    console.log(
      `[capture] 启动 Chrome (${attempt}/${attempts}) port=${port} profile=${profileDir}`,
    );
    try {
      await waitForChromeEndpoint(processInfo, port, profileDir);
      return chromeHandle;
    } catch (error) {
      lastFailure = error;
      // 启动失败也必须把这一轮的进程与临时 profile 清干净；
      // 清理本身失败说明有资源泄漏，直接报错，不带着脏状态继续重试。
      try {
        await stopChrome(processInfo.child);
        await removeProfile(profileDir);
      } catch (cleanupError) {
        console.error(`[capture] 启动失败的清理过程出错: ${formatError(cleanupError)}`);
        throw new Error(
          `Chrome 启动失败，且清理失败。启动错误: ${error.message}；清理错误: ${cleanupError.message}`,
          { cause: cleanupError },
        );
      } finally {
        if (activeChrome === chromeHandle) activeChrome = null;
      }
      if (attempt === attempts) break;
      console.warn(
        `[capture] Chrome 启动未就绪，换端口重试: ${error.message.split("\n")[0]}`,
      );
    }
  }
  throw new Error(`Chrome 启动失败（已尝试 ${attempts} 次）: ${lastFailure?.message ?? "unknown"}`, {
    cause: lastFailure,
  });
}

async function pickPageTarget(port) {
  const base = `http://127.0.0.1:${port}`;
  const listResponse = await fetch(`${base}/json/list`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!listResponse.ok) {
    throw new Error(`读取 Chrome 目标列表失败: HTTP ${listResponse.status} ${listResponse.statusText}`);
  }
  const targets = await listResponse.json();
  let pageTarget = Array.isArray(targets)
    ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
    : null;

  if (!pageTarget) {
    const createResponse = await fetch(`${base}/json/new?${encodeURIComponent("about:blank")}`, {
      method: "PUT",
      signal: AbortSignal.timeout(5000),
    });
    if (!createResponse.ok) {
      throw new Error(
        `创建 Chrome 页面目标失败: HTTP ${createResponse.status} ${createResponse.statusText}`,
      );
    }
    pageTarget = await createResponse.json();
  }

  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error("Chrome 没有返回可连接的页面目标 (webSocketDebuggerUrl)");
  }
  return {
    ...pageTarget,
    webSocketDebuggerUrl: normalizeDevtoolsWsUrl(pageTarget.webSocketDebuggerUrl, port),
  };
}

/** Chrome 监听在 127.0.0.1；把 localhost / [::1] 统一成 127.0.0.1，避免 IPv6 解析连错。 */
function normalizeDevtoolsWsUrl(wsUrl, port) {
  let parsed;
  try {
    parsed = new URL(wsUrl);
  } catch (error) {
    throw new Error(`Chrome 返回了无效的 DevTools WebSocket URL: ${wsUrl}`, { cause: error });
  }
  if (parsed.protocol !== "ws:") {
    throw new Error(`DevTools WebSocket URL 协议异常: ${wsUrl}`);
  }
  const reportedPort = parsed.port === "" ? 80 : Number(parsed.port);
  if (reportedPort !== port) {
    throw new Error(
      `DevTools WebSocket URL 的端口是 ${reportedPort}，与请求的 ${port} 不一致: ${wsUrl}`,
    );
  }
  parsed.hostname = "127.0.0.1";
  return parsed.toString();
}

async function evaluate(cdp, expression, { awaitPromise = false, timeoutMs = 60000 } = {}) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: false,
    },
    timeoutMs,
  );
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception;
    const description =
      exception?.description ?? result.exceptionDetails.text ?? "页面内执行抛出异常";
    throw new Error(`Runtime.evaluate 执行失败: ${description}`);
  }
  return result.result?.value;
}

/** 挂一个 DOMContentLoaded 监听；由调用方负责取消。 */
function waitForDomContentEvent(cdp) {
  let off;
  const promise = new Promise((resolve) => {
    off = cdp.on("Page.domContentEventFired", () => resolve());
  });
  return { promise, cancel: () => off?.() };
}

/**
 * 等新文档的 DOMContentLoaded。
 * 事件正常到达时立即返回；事件在导航提交瞬间丢失时，以 readyState + 路径轮询兜底。
 * 路径校验保证读到的不是导航前那一页残留的 complete。
 * `domEvent` 由调用方在导航**之前**挂好传入，避免错过事件。
 */
async function waitForDomContentLoaded(cdp, url, domEvent, timeoutMs = 120000) {
  const expectedPath = normalizePathname(new URL(url).pathname);
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let eventFired = false;
  const eventWatch = domEvent.promise.then(() => {
    eventFired = true;
  });

  try {
    for (;;) {
      try {
        lastState = await evaluate(
          cdp,
          `({ readyState: document.readyState, pathname: location.pathname })`,
          { timeoutMs: 5000 },
        );
      } catch (error) {
        // 导航提交的瞬间执行上下文会被销毁，读到异常是正常的；继续等。
        // 连接本身断了就不可能再等到结果，必须立刻失败。
        if (/CDP 连接已关闭|DevTools WebSocket 已关闭/.test(error.message)) {
          throw new Error(`等待 DOMContentLoaded 期间 DevTools 连接失败: ${url}`, {
            cause: error,
          });
        }
        lastState = { error: error.message };
      }

      if (
        lastState &&
        lastState.readyState !== "loading" &&
        normalizePathname(String(lastState.pathname)) === expectedPath
      ) {
        return;
      }
      if (Date.now() >= deadline) break;

      // 事件当闹钟用；即使事件丢了，最多 200ms 后也会自己醒来看一眼状态。
      // 事件已经触发时不能再拿它做 race（会立刻 resolve 造成忙轮询）。
      if (eventFired) {
        await delay(200);
      } else {
        await Promise.race([eventWatch, delay(200)]);
      }
    }
  } finally {
    domEvent.cancel();
  }

  throw new Error(
    `等待 DOMContentLoaded 超时 (${timeoutMs}ms): ${url}，最后状态 ${JSON.stringify(lastState)}`,
  );
}

/**
 * 主文档的 Network.responseReceived 理论上先于 DOMContentLoaded 到达，
 * 但事件跨域投递仍可能晚一点；短轮询避免偶发“拿不到响应”的假失败。
 */
async function waitForDocumentResponse(documentResponses, loaderId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (loaderId) {
      const response = documentResponses.get(loaderId);
      if (response) return response;
    } else if (documentResponses.size > 0) {
      return [...documentResponses.values()].at(-1);
    }
    if (Date.now() >= deadline) return null;
    await delay(50);
  }
}

async function capturePage(cdp, { page, route }, baseUrl, outDir) {
  const url = new URL(route, baseUrl).toString();
  console.log(`[capture] ${page} → ${url}`);

  const documentResponses = new Map();
  const offResponse = cdp.on("Network.responseReceived", (params) => {
    if (params.type === "Document" && params.loaderId) {
      documentResponses.set(params.loaderId, params.response);
    }
  });

  try {
    // 每个页面都显式设置一次，避免任何状态泄漏。
    await cdp.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
    // 让当前 target 保持前台，避免后台节流影响 rAF / 定时器。
    await cdp.send("Page.bringToFront");

    // 监听要在导航前挂上，否则 DOMContentLoaded 可能在 Page.navigate 返回前就触发。
    const domReady = waitForDomContentEvent(cdp);
    let navigation;
    try {
      navigation = await cdp.send("Page.navigate", { url }, 60000);
    } catch (error) {
      domReady.cancel();
      throw error;
    }
    if (navigation.errorText) {
      domReady.cancel();
      throw new Error(`导航失败 ${url}: ${navigation.errorText}`);
    }
    await waitForDomContentLoaded(cdp, url, domReady);

    // 需求：DOMContentLoaded 之后固定等待 5 秒（动画与数据请求）。
    await delay(DOM_SETTLE_MS);

    // 确认事件确实对应新文档（防止收到同一 target 上残留的旧事件）。
    const readyState = await evaluate(cdp, `document.readyState`);
    if (readyState !== "interactive" && readyState !== "complete") {
      throw new Error(`DOMContentLoaded 已触发但 document.readyState=${String(readyState)}: ${url}`);
    }

    // 390 是**布局视口**宽度：mobile=true 时如果页面没有 width=device-width，
    // 布局视口会回落到 980px，截出来的图仍然存在、但内容被缩小 —— 必须识别。
    const metrics = await evaluate(
      cdp,
      `({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
      })`,
    );
    if (
      !metrics ||
      metrics.innerWidth !== VIEWPORT.width ||
      metrics.innerHeight !== VIEWPORT.height ||
      metrics.devicePixelRatio !== VIEWPORT.deviceScaleFactor
    ) {
      throw new Error(
        `视口参数未按预期生效: 期望 ${VIEWPORT.width}×${VIEWPORT.height} @${VIEWPORT.deviceScaleFactor}x，` +
          `实际 ${metrics?.innerWidth}×${metrics?.innerHeight} @${metrics?.devicePixelRatio}x ` +
          `(viewport meta: ${JSON.stringify(metrics?.viewportMeta)})`,
      );
    }

    // 有 loaderId 时必须精确匹配，避免把上一页的响应误当成本页成功。
    // 重定向链复用同一个 loaderId，map 里保留的是最后的响应。
    const loaderId = navigation.loaderId;
    const documentResponse = await waitForDocumentResponse(documentResponses, loaderId);
    if (!documentResponse) {
      throw new Error(`没有收到主文档的网络响应（loaderId=${loaderId ?? "?"}）: ${url}`);
    }
    if (typeof documentResponse.status === "number" && documentResponse.status >= 400) {
      throw new Error(
        `页面返回 HTTP ${documentResponse.status} ${documentResponse.statusText ?? ""}: ${url}`,
      );
    }
    // 200 也可能是被重定向到了登录页/错误页。final URL 与请求的路径不一致时，
    // 截出来的就不是基线要的那一页 —— 明确失败，别交一张“看似成功”的图。
    const requestedPath = normalizePathname(new URL(url).pathname);
    const finalPath = normalizePathname(new URL(documentResponse.url).pathname);
    if (requestedPath !== finalPath) {
      throw new Error(
        `页面被重定向到不同路径: 请求 ${requestedPath}，最终 ${finalPath} (${documentResponse.url})`,
      );
    }

    // 前端水合之后也可能发生客户端跳转（例如被重定向到登录页）。
    const landing = await evaluate(
      cdp,
      `({ pathname: location.pathname, href: location.href })`,
    );
    if (!landing || typeof landing.pathname !== "string") {
      throw new Error(`读取页面地址失败: ${JSON.stringify(landing)}`);
    }
    if (normalizePathname(landing.pathname) !== requestedPath) {
      throw new Error(
        `页面在渲染后跳转到了不同路径: 请求 ${requestedPath}，当前 ${landing.pathname} (${landing.href})`,
      );
    }

    // globals.css 里 html { scroll-behavior: smooth }，基线截图需要瞬时滚动。
    // 这段改动在样式快照之前做：scroll-behavior 不在快照字段里，但先固定
    // “快照取在滚动 0”这一前提，避免浏览器恢复上次滚动位置造成两张图状态不一致。
    await evaluate(
      cdp,
      `document.documentElement.style.setProperty("scroll-behavior", "auto", "important"); true`,
    );
    await evaluate(
      cdp,
      `(async () => {
        window.scrollTo(0, 0);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
        );
        return true;
      })()`,
      { awaitPromise: true },
    );

    const styles = await evaluate(cdp, STYLE_SNAPSHOT_EXPRESSION);
    if (!Array.isArray(styles)) {
      throw new Error(`计算样式快照返回的不是数组: ${typeof styles}`);
    }
    if (styles.length === 0) {
      throw new Error(`计算样式快照为空：页面没有可见文本或背景色元素 (${url})`);
    }
    if (styles.length > MAX_STYLE_ENTRIES) {
      throw new Error(`计算样式快照超过上限: ${styles.length} > ${MAX_STYLE_ENTRIES}`);
    }
    console.log(`[capture] ${page} HTTP ${documentResponse.status}，样式条目 ${styles.length}`);

    const shots = [];
    for (let index = 0; index < SCROLL_POSITIONS.length; index++) {
      const top = SCROLL_POSITIONS[index];
      const scrollState = await evaluate(
        cdp,
        `(async () => {
          window.scrollTo(0, ${top});
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
          );
          return {
            scrollY: window.scrollY,
            innerHeight: window.innerHeight,
            documentHeight: document.documentElement.scrollHeight,
          };
        })()`,
        { awaitPromise: true },
      );
      if (
        !scrollState ||
        typeof scrollState.scrollY !== "number" ||
        typeof scrollState.innerHeight !== "number" ||
        typeof scrollState.documentHeight !== "number"
      ) {
        throw new Error(`滚动状态读取失败: ${JSON.stringify(scrollState)}`);
      }
      // 页面比目标位置短时 scrollY 会被 clamp，这是正常的；但“够长却没滚过去”
      // 说明滚动没有生效（例如 body 被锁住或用了内部滚动容器），必须报错而不是
      // 悄悄交三张同一位置的截图。
      const maxScroll = Math.max(0, scrollState.documentHeight - scrollState.innerHeight);
      const expectedScrollY = Math.min(top, maxScroll);
      if (Math.abs(scrollState.scrollY - expectedScrollY) > 2) {
        throw new Error(
          `滚动未生效: 目标 ${top}，期望 scrollY≈${expectedScrollY}，实际 ${scrollState.scrollY} ` +
            `(视口 ${scrollState.innerHeight}，文档高 ${scrollState.documentHeight})`,
        );
      }
      // 给合成器一帧以上的时间把滚动后的图层画出来。
      await delay(250);

      // 滚动后可能有迟到的布局变化（字体加载、图片撑高、滚动锚定），
      // 截图前再确认一次位置；漂了就重新滚，仍不对就报错。
      const settled = await evaluate(
        cdp,
        `({ scrollY: window.scrollY, innerHeight: window.innerHeight, documentHeight: document.documentElement.scrollHeight })`,
      );
      const settledExpected = Math.min(
        top,
        Math.max(0, (settled?.documentHeight ?? 0) - (settled?.innerHeight ?? 0)),
      );
      if (Math.abs((settled?.scrollY ?? Number.NaN) - settledExpected) > 2) {
        await evaluate(cdp, `window.scrollTo(0, ${top}); true`);
        await delay(150);
        const verified = await evaluate(cdp, `window.scrollY`);
        if (Math.abs(verified - settledExpected) > 2) {
          throw new Error(
            `截图前滚动位置漂移: 目标 ${top}，期望 scrollY≈${settledExpected}，实际 ${verified}`,
          );
        }
      }

      const screenshot = await cdp.send(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        },
        60000,
      );
      if (typeof screenshot.data !== "string" || screenshot.data.length === 0) {
        throw new Error(`Page.captureScreenshot 没有返回图片数据: ${page} @ scrollY=${top}`);
      }

      const shotPath = path.resolve(outDir, `${page}-${index}.png`);
      const buffer = Buffer.from(screenshot.data, "base64");
      if (buffer.length === 0) {
        throw new Error(`截图解码后为空: ${page} @ scrollY=${top}`);
      }
      const pngSize = readPngSize(buffer);
      if (!pngSize) {
        throw new Error(`截图不是有效 PNG（signature/IHDR 不匹配）: ${page} @ scrollY=${top}`);
      }
      const expectedWidth = VIEWPORT.width * VIEWPORT.deviceScaleFactor;
      const expectedHeight = VIEWPORT.height * VIEWPORT.deviceScaleFactor;
      if (pngSize.width !== expectedWidth || pngSize.height !== expectedHeight) {
        throw new Error(
          `截图尺寸不符合 ${VIEWPORT.width}×${VIEWPORT.height} @${VIEWPORT.deviceScaleFactor}x: ` +
            `实际 ${pngSize.width}×${pngSize.height}（期望 ${expectedWidth}×${expectedHeight}）`,
        );
      }
      await writeFile(shotPath, buffer);
      shots.push(shotPath);
      console.log(
        `[capture] ${page} 截图 ${index} scrollY=${scrollState?.scrollY ?? "?"} ` +
          `(${buffer.length} bytes) → ${shotPath}`,
      );
    }

    return { page, url, shots, styles };
  } catch (error) {
    throw new Error(`抓取 ${page} (${url}) 失败`, { cause: error });
  } finally {
    offResponse();
  }
}

async function main() {
  if (typeof WebSocket !== "function" || typeof fetch !== "function") {
    throw new Error(
      `需要 Node 22+ 的全局 WebSocket/fetch（当前 ${process.version}: ` +
        `WebSocket=${typeof WebSocket}, fetch=${typeof fetch}）`,
    );
  }

  const outArg = process.argv[2];
  if (!outArg) {
    throw new Error(
      "缺少输出目录。用法: node tools/mp-design-capture.mjs <out-dir> [base-url]",
    );
  }
  const outDir = toAbsoluteLocalPath(outArg);
  await mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.json");
  // 上一次运行的 manifest 必须先删掉：本次若中途失败，绝不能留下一个
  // 看起来“完整”的旧基线让后续步骤误用。
  await rm(manifestPath, { force: true });

  const baseInput =
    process.argv[3] ??
    process.env.MP_CAPTURE_BASE_URL ??
    process.env.TEST_BASE_URL ??
    "http://127.0.0.1:5173";
  const baseUrl = parseBaseUrl(baseInput);

  const chromePath = toAbsoluteLocalPath(process.env.CHROME_PATH ?? DEFAULT_CHROME);
  await assertChromeExecutable(chromePath);
  console.log(`[capture] Chrome: ${chromePath}`);
  console.log(`[capture] 页面来源: ${baseUrl.toString()}`);
  console.log(`[capture] 输出目录: ${outDir}`);

  let chrome = null;
  let cleanupFailure = null;

  try {
    chrome = await startChrome(chromePath);
    const pageTarget = await pickPageTarget(chrome.port);
    const cdp = await CDP.connect(pageTarget.webSocketDebuggerUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

      const entries = [];
      for (const page of PAGES) {
        entries.push(await capturePage(cdp, page, baseUrl, outDir));
      }

      const manifest = {
        capturedAt: new Date().toISOString(),
        entries,
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      console.log(`[capture] 完成：${PAGES.length} 个页面，manifest → ${manifestPath}`);
    } finally {
      cdp.close();
    }
  } finally {
    if (chrome) {
      try {
        await stopChrome(chrome.child);
      } catch (error) {
        cleanupFailure = cleanupFailure ?? error;
        console.error(`[capture] 结束 Chrome 进程失败: ${formatError(error)}`);
      }
      try {
        await removeProfile(chrome.profileDir);
      } catch (error) {
        cleanupFailure = cleanupFailure ?? error;
        console.error(`[capture] 删除临时 profile 失败: ${formatError(error)}`);
      }
      if (activeChrome === chrome) activeChrome = null;
    }
  }

  if (cleanupFailure) throw cleanupFailure;
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
  // 有些情况下 undici/WebSocket 的句柄会让进程多停一会儿。这里必须让定时器
  // 保持事件循环（不能 unref），否则句柄还在时进程会一直挂着，退出码永远不落地。
  setTimeout(() => process.exit(1), 1000);
});