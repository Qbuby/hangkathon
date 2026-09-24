import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 作品数据抓取：起一个子进程跑 scripts/douyin/fetch.py，把它的 JSON 结果读回来。
 *
 * 刻意不做成常驻服务：一次提交一次调用，300–500 ms，不开端口、不占内存。
 * 这个部署没有 python（或没放脚本）时**不是错误**，只是拿不到数据 —— 提交本身
 * 必须照样成立，所以调用方拿到的是 error 字段而不是异常。
 */

/** 实测一次 300–500 ms；给足余量，但别让一次提交挂太久。 */
const TIMEOUT_MS = 12_000;

export type WorkMetrics = {
  awemeId?: string;
  caption?: string;
  authorName?: string;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  collectCount?: number;
  fetchedAt: string;
};

export type MetricsResult = { metrics: WorkMetrics } | { error: string };

function scriptPath(): string {
  return process.env.DOUYIN_FETCH_SCRIPT ?? path.join(process.cwd(), "scripts", "douyin", "fetch.py");
}

function pythonBin(): string {
  return process.env.DOUYIN_PYTHON ?? "python3";
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * 把脚本的 stdout 读成指标。单独拆出来是为了能不起进程直接测 ——
 * 失败路径（脚本崩了、上游 403、作品被删）都要落到 error 上而不是抛出去。
 */
export function readMetrics(stdout: string): MetricsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: "抓取脚本没有返回可解析的结果" };
  }
  if (!parsed || typeof parsed !== "object") return { error: "抓取脚本没有返回可解析的结果" };
  const payload = parsed as Record<string, unknown>;
  if (payload.ok !== true) {
    return { error: asText(payload.error) ?? "抓取失败，稍后可手动刷新" };
  }
  return {
    metrics: {
      awemeId: asText(payload.awemeId),
      caption: asText(payload.caption),
      authorName: asText(payload.authorName),
      diggCount: asCount(payload.diggCount),
      commentCount: asCount(payload.commentCount),
      shareCount: asCount(payload.shareCount),
      collectCount: asCount(payload.collectCount),
      fetchedAt: asText(payload.fetchedAt) ?? new Date().toISOString(),
    },
  };
}

export async function fetchWorkMetrics(url: string): Promise<MetricsResult> {
  const script = scriptPath();
  if (!existsSync(script)) {
    return { error: "这个部署没有启用作品数据抓取" };
  }

  return new Promise<MetricsResult>((resolve) => {
    const child = spawn(pythonBin(), [script, url, "--timeout", "10"], {
      timeout: TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });

    // 脚本把结果放在 stdout、诊断放在 stderr，所以退出码不为 0 时 stdout 里
    // 仍然是一个 { ok: false, error } —— 优先用它，比退出码信息量大。
    child.on("error", (error) => resolve({ error: `无法启动抓取脚本：${error.message}` }));
    child.on("close", () => {
      const result = readMetrics(stdout);
      if ("metrics" in result) return resolve(result);
      resolve({ error: result.error || stderr.trim().slice(0, 200) || "抓取失败" });
    });
  });
}
