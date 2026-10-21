import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

/**
 * 品牌名唯一性（2026-10-21 用户定的**全局严格约束**）。
 *
 * 用户反馈截图：「关于」页的小标题用了另一套罗马化拼法（h-a-n-g-k-e-s-o-n-g），
 * 与 logo 上的 `Hangkathon`、域名 `hangkathon.com`、结构化数据全都对不上。
 *
 * 这个测试做两件事：
 *   1. 纯函数级：BRAND 常量本身符合约定；
 *   2. 仓库级：**任何文件里出现那个错拼（大小写都不行）都算失败**。
 *      扫描范围排除 .git / node_modules / dist，但包含 .md 文档 —— 文档里的错名
 *      会顺着复制粘贴回到代码里，所以才一起管。
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * 错拼的检测正则**由片段拼出来**：如果这里直接写正字面量，这个测试文件自己就会
 * 命中规则 —— 要么得把它豁免掉（等于留一个可以藏错拼的文件），要么规则永远红。
 */
const WRONG_BRAND = new RegExp(["hangkes", "ong"].join(""), "i");

/** 二进制/生成物目录，不参与文本扫描。 */
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", ".wrangler", "vendor"]);

/** 历史归档不追溯：这些文件记录的是当时的事实，改掉反而失真。 */
const SKIP_FILES = new Set(["design-qa.md", "交接说明.md", "package-lock.json"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) {
      const name = relative(ROOT, full).replaceAll("\\", "/");
      if (SKIP_FILES.has(name)) continue;
      if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp4|zip|gz|dump|pdf)$/i.test(name)) continue;
      // 仅扫文本文件，过大的一律跳过（防止误读二进制）
      if (stat.size > 2_000_000) continue;
      out.push(full);
    }
  }
  return out;
}

const loadBrand = async () => {
  const source = readFileSync(new URL("../lib/brand.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

test("BRAND 常量：英文名只有 Hangkathon 这一种拼法", async () => {
  const { BRAND } = await loadBrand();
  assert.equal(BRAND.en, "Hangkathon");
  assert.equal(BRAND.upper, "HANGKATHON");
  assert.equal(BRAND.zh, "杭客松");
  assert.equal(BRAND.domain, "hangkathon.com");
  // 大写形式必须与 en 严格对应（防止有人只改一处）
  assert.equal(BRAND.upper, BRAND.en.toUpperCase());
});

test("仓库里不存在那套错误拼法（大小写都不允许）", () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // 二进制文件按 utf8 读会出现替换字符；含 NUL 的直接跳过
    if (text.includes("\u0000")) continue;
    if (WRONG_BRAND.test(text)) offenders.push(relative(ROOT, file).replaceAll("\\", "/"));
  }
  assert.deepEqual(
    offenders,
    [],
    `这些文件用了错误的英文名 错误的英文名拼法（必须统一为 Hangkathon）：\n  ${offenders.join("\n  ")}`,
  );
});

test("用户可见的英文品牌名都来自 BRAND（不允许各处手写）", () => {
  const about = readFileSync(new URL("../app/about/page.tsx", import.meta.url), "utf8");
  const section = readFileSync(new URL("../app/about-section.tsx", import.meta.url), "utf8");
  assert.match(about, /ABOUT \{BRAND\.upper\}/, "关于页小标题必须用品牌常量");
  assert.match(section, /ABOUT \{BRAND\.upper\}/, "首页关于区块小标题必须用品牌常量");

  const header = readFileSync(new URL("../app/site-header.tsx", import.meta.url), "utf8");
  assert.match(header, /\$\{BRAND\.zh\} \$\{BRAND\.en\}/, "logo alt 必须用品牌常量");

  const jsonld = readFileSync(new URL("../lib/seo/jsonld.ts", import.meta.url), "utf8");
  assert.match(jsonld, /SITE_NAME_EN = BRAND\.en/, "结构化数据的英文名必须来自品牌常量");
});
