import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production validator without adding a runtime/test dependency.
const source = readFileSync(new URL("../lib/submission.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { isValidDouyinUrl, normalizeUrl } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const valid = [
  "https://v.douyin.com/iR5kX9y/",
  "http://v.douyin.com/iR5kX9y", // no trailing slash
  "v.douyin.com/iR5kX9y/", // scheme optional
  "https://www.douyin.com/video/7301234567890123456",
  "https://www.douyin.com/video/7301234567890123456?from_tab_name=main",
  "https://iesdouyin.com/share/video/7301234567890123456/",
];

const invalid = [
  "",
  "   ",
  "not a url",
  "https://example.com/video/123",
  "https://douyin.com.evil.com/x",
  "https://www.douyin.com/", // no share id in path
  "https://www.douyin.com/user/123", // not a video path — still has a path segment, see note below
  "ftp://v.douyin.com/abc/",
  "javascript:alert(1)",
];

test("accepts douyin share links", () => {
  for (const url of valid) assert.ok(isValidDouyinUrl(url), `should accept: ${url}`);
});

test("rejects non-douyin and malformed links", () => {
  for (const url of invalid) assert.ok(!isValidDouyinUrl(url), `should reject: ${url}`);
});

test("normalizeUrl adds https when missing", () => {
  assert.equal(normalizeUrl("v.douyin.com/abc/"), "https://v.douyin.com/abc/");
  assert.equal(normalizeUrl("https://v.douyin.com/abc/"), "https://v.douyin.com/abc/");
});
