"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Coins, MapPin } from "lucide-react";
import { CATEGORIES, categoryLabel, formatLabel, pricingLabel, prizeText, type Activity } from "@/lib/activity";
import "./board.css";

type PrizeFilter = "all" | "with" | "without";
type FormatFilter = "all" | "online" | "offline";
type CostFilter = "all" | "free" | "paid";
type Sort = "latest" | "prize" | "ending";

const PRIZE_FILTERS: { value: PrizeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "with", label: "有奖金" },
  { value: "without", label: "无奖金" },
];

const FORMAT_FILTERS: { value: FormatFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "online", label: "线上" },
  { value: "offline", label: "线下" },
];

const COST_FILTERS: { value: CostFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "free", label: "免费" },
  { value: "paid", label: "收费" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "latest", label: "最新发布" },
  { value: "prize", label: "奖金最高" },
  { value: "ending", label: "即将截止" },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`board-chip${active ? " is-active" : ""}`} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

export default function ActivityBoard({
  activities,
  localCount = 0,
  action,
}: {
  activities: Activity[];
  localCount?: number;
  action?: ReactNode;
}) {
  const [category, setCategory] = useState<string>("all");
  const [prize, setPrize] = useState<PrizeFilter>("all");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [cost, setCost] = useState<CostFilter>("all");
  const [sort, setSort] = useState<Sort>("latest");
  const [expandedIntro, setExpandedIntro] = useState<string | null>(null);

  const shown = useMemo(() => {
    const filtered = activities.filter((activity) => {
      if (category !== "all" && activity.category !== category) return false;
      if (prize === "with" && !(activity.awardsEnabled && activity.prizePool > 0)) return false;
      if (prize === "without" && activity.awardsEnabled && activity.prizePool > 0) return false;
      if (format !== "all" && activity.format !== format) return false;
      if (cost !== "all" && activity.pricing !== cost) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sort === "prize") sorted.sort((a, b) => b.prizePool - a.prizePool);
    else if (sort === "ending") sorted.sort((a, b) => (a.endsAt || "9999").localeCompare(b.endsAt || "9999"));
    else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted;
  }, [activities, category, prize, format, cost, sort]);

  const activeCount = [category !== "all", prize !== "all", format !== "all", cost !== "all"].filter(Boolean).length;

  function reset() {
    setCategory("all");
    setPrize("all");
    setFormat("all");
    setCost("all");
  }

  return (
    <section id="activities" className="board" aria-labelledby="board-title">
      <div className="board-head">
        <div>
          <p className="eyebrow">ACTIVITY BOARD</p>
          <h2 id="board-title">活动看板</h2>
          <p className="board-sub">每一场活动都欢迎个人参赛，组队信息由平台统一发布。按类别、奖金、形式和费用筛选，找到你想参加的那一场。</p>
        </div>
        <div className="board-head-actions">
          {action}
          <span className="demo-label">{localCount > 0 ? "含本机创建 · 未同步到服务器" : "演示数据 · 非真实活动"}</span>
        </div>
      </div>

      <div className="board-filters">
        <div className="board-filter-row">
          <span className="board-filter-label">类别</span>
          <div className="board-chips">
            <Chip active={category === "all"} onClick={() => setCategory("all")}>全部</Chip>
            {CATEGORIES.map((item) => (
              <Chip key={item.value} active={category === item.value} onClick={() => setCategory(item.value)}>
                {item.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="board-filter-row">
          <span className="board-filter-label">奖金</span>
          <div className="board-chips">
            {PRIZE_FILTERS.map((item) => (
              <Chip key={item.value} active={prize === item.value} onClick={() => setPrize(item.value)}>{item.label}</Chip>
            ))}
          </div>
        </div>

        <div className="board-filter-row">
          <span className="board-filter-label">形式</span>
          <div className="board-chips">
            {FORMAT_FILTERS.map((item) => (
              <Chip key={item.value} active={format === item.value} onClick={() => setFormat(item.value)}>{item.label}</Chip>
            ))}
          </div>
        </div>

        <div className="board-filter-row">
          <span className="board-filter-label">费用</span>
          <div className="board-chips">
            {COST_FILTERS.map((item) => (
              <Chip key={item.value} active={cost === item.value} onClick={() => setCost(item.value)}>{item.label}</Chip>
            ))}
          </div>
        </div>

        <div className="board-filter-row board-filter-foot">
          <span className="board-count">
            共 {shown.length} 场{activeCount > 0 && <button type="button" className="board-reset" onClick={reset}>清除筛选</button>}
          </span>
          <div className="board-chips">
            {SORTS.map((item) => (
              <Chip key={item.value} active={sort === item.value} onClick={() => setSort(item.value)}>{item.label}</Chip>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="board-empty">没有符合当前筛选的活动。换一组条件，或者清除筛选看看全部。</p>
      ) : (
        <div className="board-grid">
          {shown.map((activity) => (
            <article className="board-card" key={activity.id}>
              <div className="board-card-tags">
                <span className="is-category">{categoryLabel(activity.category)}</span>
                <span>{formatLabel(activity)}</span>
                <span>{pricingLabel(activity)}</span>
              </div>

              <h3 title={activity.title}>{activity.title}</h3>
              {activity.overview && (
                <p className={`board-card-intro${expandedIntro === activity.id ? " is-expanded" : ""}`}>
                  <span>{activity.overview}</span>
                  {activity.overview.length > 50 && (
                    <button
                      type="button"
                      className="board-card-expand"
                      aria-expanded={expandedIntro === activity.id}
                      aria-label={expandedIntro === activity.id ? "收起活动介绍" : "展开活动介绍"}
                      onClick={() => setExpandedIntro(expandedIntro === activity.id ? null : activity.id)}
                    >
                      {expandedIntro === activity.id ? "收起" : "展开"}
                    </button>
                  )}
                </p>
              )}

              <div className="board-prize">
                <Coins size={16} />
                <strong>{prizeText(activity)}</strong>
                {activity.awardsEnabled && activity.awards.length > 0 && (
                  <span>{activity.awards.length} 个奖项</span>
                )}
              </div>

              <dl className="board-card-meta">
                <div><dt><CalendarDays size={14} />时间</dt><dd>{activity.startsAt} 至 {activity.endsAt}</dd></div>
                <div>
                  <dt><MapPin size={14} />地点</dt>
                  <dd>{activity.format === "offline" ? activity.venue : "线上"}</dd>
                </div>
              </dl>

              <p className="board-card-host">主办方 · {activity.host}</p>
              <Link className="board-card-more" href={`/activities/${activity.slug}`} aria-label={`查看${activity.title}详情`}>
                查看详情 <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      )}

      <p className="board-note">
        三场示例活动均为虚构，用于展示活动看板的筛选与分类，不代表已举办、已开放报名或已有合作方。
        {localCount > 0 && " 由你在本机创建的活动也列在其中，保存在这台设备的浏览器里，尚未同步到服务器。"}
      </p>
    </section>
  );
}
