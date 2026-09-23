"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { animate, type JSAnimation } from "animejs";
import { Coins, MapPin } from "lucide-react";
import { CATEGORIES, categoryLabel, pricingLabel, prizeText, type Activity } from "@/lib/activity";
import { prefersReducedMotion, usePageMotion } from "./motion-scope";
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
  mode = "local",
  loaded = true,
  action,
}: {
  activities: Activity[];
  /** local：数据只在这台设备的浏览器里；server：数据在服务端数据库里。 */
  mode?: "local" | "server";
  loaded?: boolean;
  action?: ReactNode;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<string>("all");
  const [prize, setPrize] = useState<PrizeFilter>("all");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [cost, setCost] = useState<CostFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<Sort>("latest");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const shown = useMemo(() => {
    const filtered = activities.filter((activity) => {
      if (category !== "all" && activity.category !== category) return false;
      if (prize === "with" && !(activity.awardsEnabled && activity.prizePool > 0)) return false;
      if (prize === "without" && activity.awardsEnabled && activity.prizePool > 0) return false;
      if (format !== "all" && activity.format !== format) return false;
      if (cost !== "all" && activity.pricing !== cost) return false;
      // 日期区间取「有交集」：活动结束不早于起始日，且开始不晚于结束日
      if (from && (activity.endsAt || activity.startsAt) < from) return false;
      if (to && (activity.startsAt || activity.endsAt) > to) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sort === "prize") sorted.sort((a, b) => b.prizePool - a.prizePool);
    else if (sort === "ending") sorted.sort((a, b) => (a.endsAt || "9999").localeCompare(b.endsAt || "9999"));
    else sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted;
  }, [activities, category, prize, format, cost, from, to, sort]);

  const grouped = useMemo(() => {
    const today = todayKey();
    return {
      ongoing: shown.filter((a) => !(a.endsAt && a.endsAt < today) && !(a.startsAt && a.startsAt > today)),
      upcoming: shown.filter((a) => !!a.startsAt && a.startsAt > today),
      past: shown.filter((a) => !!a.endsAt && a.endsAt < today),
    } satisfies Record<GroupId, Activity[]>;
  }, [shown]);

  const activeCount = [category !== "all", prize !== "all", format !== "all", cost !== "all", from !== "" || to !== ""].filter(Boolean).length;

  /** 服务端模式下，当前登录用户发起的活动数（本地模式恒为 0）。 */
  const mineCount = activities.filter((activity) => (activity as { mine?: boolean }).mine).length;

  // 筛选/排序/日期变化后，新列表（含分组标题与计数）重新错峰入场。
  usePageMotion("board", { signature: shown.map((activity) => activity.id).join(",") });

  /** 简介展开/收起：先量高度，换完内容再从旧高度过渡到新高度。 */
  const introNodes = useRef(new Map<string, HTMLParagraphElement>());
  const introAnim = useRef<JSAnimation | null>(null);
  const pendingToggle = useRef<{ id: string; from: number } | null>(null);

  function toggleIntro(id: string, expanded: boolean) {
    const node = introNodes.current.get(id);
    if (node && !prefersReducedMotion()) {
      pendingToggle.current = { id, from: node.getBoundingClientRect().height };
    }
    setExpandedCard(expanded ? null : id);
  }

  useLayoutEffect(() => {
    const pending = pendingToggle.current;
    pendingToggle.current = null;
    if (!pending) return;
    const node = introNodes.current.get(pending.id);
    if (!node) return;
    const to = node.getBoundingClientRect().height;
    introAnim.current?.revert();
    if (Math.abs(to - pending.from) < 1) return;
    node.style.overflow = "hidden";
    introAnim.current = animate(node, {
      height: [`${pending.from}px`, `${to}px`],
      opacity: [0.55, 1],
      duration: 280,
      ease: "out(2)",
      onComplete: () => {
        node.style.height = "";
        node.style.overflow = "";
      },
    });
  }, [expandedCard]);

  function reset() {
    setCategory("all");
    setPrize("all");
    setFormat("all");
    setCost("all");
    setFrom("");
    setTo("");
  }

  function renderItem(activity: Activity) {
    const badge = dateBadge(activity.startsAt);
    const isExpanded = expandedCard === activity.id;
    const clamped = !isExpanded && activity.overview.length > INTRO_CLAMP;
    return (
      <article
        className="feed-item"
        key={activity.id}
        data-reveal="item"
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
          <p
            className="feed-intro"
            ref={(node) => {
              if (node) introNodes.current.set(activity.id, node);
              else introNodes.current.delete(activity.id);
            }}
          >
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
                    toggleIntro(activity.id, isExpanded);
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
          <p className="eyebrow" data-reveal="block">ACTIVITY BOARD</p>
          <h2 id="board-title" data-reveal="block">活动看板</h2>
          <p className="board-sub" data-reveal="block">每一场活动都欢迎个人参赛，组队信息由平台统一发布。按类别、奖金、形式和费用筛选，找到你想参加的那一场。</p>
        </div>
        <div className="board-head-actions">
          {action}
          {mode === "local" && activities.length > 0 && <span className="demo-label">本机活动仅保存在此设备</span>}
          {mode === "server" && mineCount > 0 && <span className="demo-label">我发起的 {mineCount} 场</span>}
        </div>
      </div>

      <div className="board-body">
        <div className="board-feed">
          {shown.length === 0 ? (
            <p className="board-empty" data-reveal="item">
              {loaded ? "没有符合当前筛选的活动。换一组条件，或者清除筛选看看全部。" : "正在读取活动…"}
            </p>
          ) : (
            GROUPS.filter((group) => grouped[group.id].length > 0).map((group) => (
              <div className="feed-group" key={group.id}>
                <div className="feed-group-head" data-reveal="item">
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
          <div className="board-filter-row" data-reveal="block">
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

          <div className="board-filter-row" data-reveal="block">
            <span className="board-filter-label">奖金</span>
            <div className="board-chips">
              {PRIZE_FILTERS.map((item) => (
                <Chip key={item.value} active={prize === item.value} onClick={() => setPrize(item.value)}>{item.label}</Chip>
              ))}
            </div>
          </div>

          <div className="board-filter-row" data-reveal="block">
            <span className="board-filter-label">形式</span>
            <div className="board-chips">
              {FORMAT_FILTERS.map((item) => (
                <Chip key={item.value} active={format === item.value} onClick={() => setFormat(item.value)}>{item.label}</Chip>
              ))}
            </div>
          </div>

          <div className="board-filter-row" data-reveal="block">
            <span className="board-filter-label">费用</span>
            <div className="board-chips">
              {COST_FILTERS.map((item) => (
                <Chip key={item.value} active={cost === item.value} onClick={() => setCost(item.value)}>{item.label}</Chip>
              ))}
            </div>
          </div>

          <div className="board-filter-row" data-reveal="block">
            <span className="board-filter-label">日期</span>
            <div className="board-dates">
              <input
                type="date"
                className="board-date"
                aria-label="起始日期"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
              />
              <span className="board-dates-sep" aria-hidden="true">至</span>
              <input
                type="date"
                className="board-date"
                aria-label="结束日期"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>

          <div className="board-filter-row" data-reveal="block">
            <span className="board-filter-label">排序</span>
            <div className="board-chips">
              {SORTS.map((item) => (
                <Chip key={item.value} active={sort === item.value} onClick={() => setSort(item.value)}>{item.label}</Chip>
              ))}
            </div>
          </div>

          <p className="board-count" data-reveal="item">
            共 {shown.length} 场
            {activeCount > 0 && <button type="button" className="board-reset" onClick={reset}>清除筛选</button>}
          </p>
        </aside>
      </div>

      <p className="board-note" data-reveal="block">
        {mode === "local" && activities.length > 0 && "本机创建的活动仅保存在此设备，尚未同步。"}
      </p>
    </section>
  );
}
