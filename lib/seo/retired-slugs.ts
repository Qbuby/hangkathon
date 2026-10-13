/**
 * 已永久下线的活动 slug —— 这些地址返回 **410 Gone**，而不是 404。
 *
 * 为什么要区分 404 与 410：
 *   404 = "现在找不到"（地址可能拼错、活动可能暂时隐藏、以后可能回来）；
 *   410 = "永久没了，不会再回来"。
 *
 * 诚实说明：**没有实测证据表明 410 比 404 更快被移出索引。** 两者都表达"不该收录"，
 * 主流搜索引擎都把两者当作移除信号。把"永久下线"说成 410 的价值在于**信号精确**
 * —— 对一个确知不会回来的地址，不应该用留了余地的 404 去表达。不要拿它当"加速下线"的手段。
 *
 * 为什么会有这份名单（2026-10-13）：
 *   用户在 Google 里仍能搜到 `hangkathon.net/activities/midautumn-poetry`。
 *   那页的**内容在 2026-09-22 就已删除**（库里只剩 guoqing-77），
 *   搜索摘要里显示的其实是站点级兜底文案。也就是说：一个已无内容的地址
 *   当时只表达了"现在找不到"。既然它确实是永久下线，就该说得更明确。
 *
 * 名单只增不减。真要复活某场活动，请用**新的 slug 重新发布**，
 * 不要把 slug 从名单里删掉 —— 删掉等于对搜索引擎说"它回来了"，
 * 而那个地址的历史已经被当作死链处理过了。
 *
 * 不变量：名单里的 slug **不得**出现在 PUBLISHED_ACTIVITIES 里
 * （否则 middleware 会把一页本该能访问的内容打成 410）。
 * `scripts/seo-retired.test.mjs` 会对此断言。
 */
export const RETIRED_ACTIVITY_SLUGS: readonly string[] = [
  // 2026-09-22 上线清理时删除：两场演示用虚构活动 + 一场真实但已结束的中秋活动
  "midautumn-poetry",
  "shop-ai-assistant",
  "city-memory-map",
];

export function isRetiredActivitySlug(slug: string): boolean {
  return RETIRED_ACTIVITY_SLUGS.includes(slug);
}

/**
 * 从请求路径里认出"已下线活动的详情页"，返回匹配到的 slug，否则 null。
 *
 * 只匹配**恰好一层**的活动详情路径：`/activities/<slug>` 与 `/activities/<slug>/`。
 * 刻意不匹配 `/activities/<slug>/xxx` —— 那不是活动详情页，是另一个从未存在过的地址，
 * 给它 410 没有意义（交给普通 404）。
 *
 * slug 先 decodeURIComponent 再比对：`/activities/midautumn%2Dpoetry` 与
 * `/activities/midautumn-poetry` 在 Next 的路由解析下指向同一页，只认字面量会漏掉编码形态。
 * 解不出来（畸形百分号编码）就当不认识，交给 404 —— 这里宁可漏也不误伤。
 *
 * 大小写不敏感是**有意**的：Next 的路由本身大小写敏感（`/activities/Midautumn-Poetry`
 * 会走普通 404），但搜索索引里可能出现大小写变体，而 slug 全是小写字母数字连字符，
 * 归一化后比对不会撞到别的活动。
 */
export function retiredActivitySlugPath(pathname: string): string | null {
  const match = /^\/activities\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const normalized = slug.toLowerCase();
  return RETIRED_ACTIVITY_SLUGS.includes(normalized) ? normalized : null;
}
