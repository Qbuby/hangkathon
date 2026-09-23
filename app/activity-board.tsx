"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Coins, MapPin } from "lucide-react";
import { CATEGORIES, categoryLabel, pricingLabel, prizeText, type Activity } from "@/lib/activity";
import "./board.css";

type PrizeFilter = "all" | "with" | "without";
type FormatFilter = "all" | "online" | "offline";
type CostFilter = "all" | "free" | "paid";
type Sort = "latest" | "prize" | "ending";
type GroupId = "ongoing" | "upcoming" | "past";

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

const GROUPS: { id: GroupId; title: string }[] = [
  { id: "ongoing", title: "进行中" },
  { id: "upcoming", title: "即将开始" },
  { id: "past", title: "已结束" },
];

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dateBadge(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return { month: "--", day: "??" };
  return { month: `${Number(match[2])}月`, day: String(Number(match[3])) };
}

/** 折叠态显示的介绍字数（超出则截断并给「展开更多」）。 */
const INTRO_CLAMP = 92;

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
  const router = useRouter();
  const [category, setCategory] = useState<string>("all");
  const [prize, setPrize] = useState<PrizeFilter>("all");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [cost, setCost] = useState<CostFilter>("all");
  const [sort, setSort] = useState<Sort>("latest");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

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

  const grouped = useMemo(() => {
    const today = todayKey();
    return {
      ongoing: shown.filter((a) => !(a.endsAt && a.endsAt < today) && !(a.startsAt && a.startsAt > today)),
      upcoming: shown.filter((a) => !!a.startsAt && a.startsAt > today),
      past: shown.filter((a) => !!a.endsAt && a.endsAt < today),
    } satisfies Record<GroupId, Activity[]>;
  }, [shown]);

  const activeCount = [category !== "all", prize !== "all", format !== "all", cost !== "all"].filter(Boolean).length;

  function reset() {
    setCategory("all");
    setPrize("all");
    setFormat("all");
    setCost("all");
  }

  function renderItem(activity: Activity) {
    const badge = dateBadge(activity.startsAt);
    const isExpanded = expandedCard === activity.id;
    const clamped = !isExpanded && activity.overview.length > INTRO_CLAMP;
    return (
      <article
        className="feed-item"
        key={activity.id}
        role="link"
        tabIndex={0}
        aria-label={`查看${activity.title}详情`}
        onClick={() => router.push(`/activities/${activity.slug}`)}
        onKeyDown={(event) => {
          if (event.key === "Enter") router.push(`/activities/${activity.slug}`);
        }}
      >
        <div className="feed-item-top">
          <div className={`feed-date is-${activity.category}`} aria-hidden="true">
            <span>{badge.month}</span>
            <strong>{badge.day}</strong>
          </div>
          <div className="feed-item-head">
            <h3>{activity.title}</h3>
            <p className="feed-when">{activity.startsAt} 至 {activity.endsAt}</p>
          </div>
        </div>
        <p className="feed-where">
          <MapPin size={13} aria-hidden="true" />
          {activity.format === "offline" && activity.venue ? activity.venue : "线上"}
          <span className="feed-sep" aria-hidden="true">·</span>
          {categoryLabel(activity.category)}
          <span className="feed-sep" aria-hidden="true">·</span>
          {pricingLabel(activity)}
        </p>
        {activity.overview && (
          <p className="feed-intro">
            {clamped ? `${activity.overview.slice(0, INTRO_CLAMP).trimEnd()}……` : activity.overview}
            {activity.overview.length > INTRO_CLAMP && (
              <>
                {" "}
                <button
                  type="button"
                  className="feed-more"
                  aria-expanded={isExpanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedCard(isExpanded ? null : activity.id);
                  }}
                >
                  {isExpanded ? "收起" : "展开更多"}
                </button>
              </>
            )}
          </p>
        )}
        <p className="feed-meta">
          <span className="feed-prize">
            <Coins size={13} aria-hidden="true" />
            {prizeText(activity)}
            {activity.awardsEnabled && activity.awards.length > 0 && <em>（{activity.awards.length} 个奖项）</em>}
          </span>
          <span className="feed-sep" aria-hidden="true">·</span>
          <span className="feed-host">主办方 {activity.host}</span>
        </p>
      </article>
    );
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
          {localCount > 0 && <span className="demo-label">本机活动仅保存在此设备</span>}
        </div>
      </div>

      <div className="board-body">
        <div className="board-feed">
          {shown.length === 0 ? (
            <p className="board-empty">没有符合当前筛选的活动。换一组条件，或者清除筛选看看全部。</p>
          ) : (
            GROUPS.filter((group) => grouped[group.id].length > 0).map((group) => (
              <div className="feed-group" key={group.id}>
                <div className="feed-group-head">
                  <h3>{group.title}</h3>
                  <span>{grouped[group.id].length} 场</span>
                </div>
                <div className="feed-list">
                  {grouped[group.id].map(renderItem)}
                </div>
              </div>
            ))
          )}
        </div>

        <aside className="board-side" aria-label="筛选与排序">
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

          <div className="board-filter-row">
            <span className="board-filter-label">排序</span>
            <div className="board-chips">
              {SORTS.map((item) => (
                <Chip key={item.value} active={sort === item.value} onClick={() => setSort(item.value)}>{item.label}</Chip>
              ))}
            </div>
          </div>

          <p className="board-count">
            共 {shown.length} 场
            {activeCount > 0 && <button type="button" className="board-reset" onClick={reset}>清除筛选</button>}
          </p>
        </aside>
      </div>

      <p className="board-note">
        {localCount > 0 && "本机创建的活动仅保存在此设备，尚未同步。"}
      </p>
    </section>
  );
}
