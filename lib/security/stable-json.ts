/**
 * 稳定的 JSON 序列化：对象键按字典序递归排序。
 *
 * 审计哈希链要用它，原因是 detail 存的是 jsonb，而 **jsonb 不保证键序**（Postgres 会按内部
 * 规则重排）。写入时按 JS 对象顺序算哈希、校验时按读回顺序算哈希，两者对不上，
 * 完整性自检会把第一条就判成断链。排序之后，两边算出来的串必然一致。
 *
 * 独立成纯函数模块：既不依赖数据库，也能被 scripts/*.test.mjs 直接单测。
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}