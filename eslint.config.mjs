import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /**
     * 微信小程序工程（miniprogram/）不适用 Node/Next 的 lint 规则：
     *   · 微信运行时只支持 CommonJS 的 require()，不支持 ESM import ——
     *     而 eslint-config-next 的 no-require-imports 会把它整片标红；
     *   · 它不参与 Next 构建，也不进 Docker 镜像（作为独立工程交付，
     *     用微信开发者工具导入）。
     * 小程序自身的正确性由 scripts/wechat-mini.test.mjs 做静态契约检查
     * （页面注册完整性、Bearer 头、请求体字段名、AppID 不落库等）。
     */
    "miniprogram/**",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
