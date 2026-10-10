import Link from "next/link";
import { ArrowRight } from "lucide-react";
import SiteHeader from "./site-header";
import "./activities/[slug]/detail.css";

/**
 * 全站 404：找不到的路径（含没找到的活动）统一落到这里，返回真正的 404 状态码。
 * 有这页之前，`/activities/<不存在的 slug>` 会返回 200 + 一句"没有找到这场活动" ——
 * 状态码撒谎会让爬虫把无限多的垃圾 URL 当成有效页面收录。
 */
export default function NotFound() {
  return (
    <main className="detail-page">
      <SiteHeader />
      <div className="detail-notfound">
        <div className="detail-notfound-card">
          <p className="eyebrow">NOT FOUND</p>
          <h1>没有找到这个页面</h1>
          <p>页面可能已被删除，或者地址拼错了。可以从活动看板重新找找。</p>
          <p className="notfound-actions">
            <Link className="primary-action" href="/activities">去活动看板 <ArrowRight size={17} /></Link>
            <Link className="secondary-action" href="/">返回首页 <ArrowRight size={17} /></Link>
          </p>
        </div>
      </div>
    </main>
  );
}
