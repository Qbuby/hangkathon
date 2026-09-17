#!/usr/bin/env node
/**
 * Vercel reads the `build` script from package.json in preference to the
 * framework default, so a plain `npm run build` there would emit the
 * Vinext/Cloudflare output in `dist/` and leave Vercel with no `.next`
 * directory to serve. Build for whichever host is actually running.
 *
 * Vercel sets VERCEL=1 for every build, so this stays deterministic.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Node refuses to spawn a `.cmd` shim without a shell, so drive the Next CLI
// through this same Node binary instead of the node_modules/.bin shim.
function nextBuildCommand() {
  try {
    return [process.execPath, [require.resolve("next/dist/bin/next"), "build"]];
  } catch {
    return [process.platform === "win32" ? "npx.cmd" : "npx", ["next", "build"]];
  }
}

const onVercel = Boolean(process.env.VERCEL);
const [command, args] = onVercel
  ? nextBuildCommand()
  : [process.execPath, ["scripts/run-framework.mjs", "build"]];

console.log(`[build] ${onVercel ? "Vercel" : "Cloudflare/Sites"} target`);

const child = spawn(command, args, {
  stdio: "inherit",
  shell: command.endsWith(".cmd"),
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
child.on("error", (error) => {
  console.error("[build] failed to start:", error.message);
  process.exit(1);
});
