"use client";

/**
 * 数据层开关：配了数据库的部署（自托管那份）走服务端 API；
 * 没有数据库的部署（Vercel）回落到原来的 localStorage，行为与改动前一致。
 */

let modePromise: Promise<boolean> | null = null;

export function hasServerData(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  modePromise ??= fetch("/api/session", { cache: "no-store" })
    .then((response) => response.json() as Promise<{ database?: boolean }>)
    .then((data) => Boolean(data.database))
    .catch(() => false);
  return modePromise;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string })?.error ?? `请求失败（${response.status}）`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}
