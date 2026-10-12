/**
 * 结构化数据注入组件。**服务端组件**——必须在首屏 HTML 里就带着，
 * 不能靠客户端再插（GPTBot / PerplexityBot 这类爬虫不执行 JS，看了等于没看；
 * Google 也明确说 JS 生成的 Product/Offer 类标记处理会更慢更不可靠）。
 *
 * 安全：**只接受对象**，内部一律走 toJsonLdScript 转义。
 * 刻意不接受"已经 stringify 好的字符串"——那种签名会让人直接把 JSON.stringify
 * 的结果塞进来，而 JSON.stringify **不转义 `<`**，数据里的 `</script>` 就能提前
 * 闭合脚本块（实测会让页面里真的多出一个 robots meta 与一条外站垃圾链接）。
 * 把唯一的正确路径做成唯一可用的路径。
 *
 * 不依赖 CSP：受控实验证明 CSP 不拦 application/ld+json（带不带 nonce 都能被解析），
 * 所以转义是唯一防线。
 */
import { toJsonLdScript } from "@/lib/seo/jsonld";

export default function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLdScript(data) }} />;
}
