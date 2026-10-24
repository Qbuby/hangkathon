const { get } = require("../../utils/request");
const { ensureLogin } = require("../../utils/auth");

/**
 * 活动看板 —— 与网页 /activities 逐项对齐。
 *
 * 网页的结构（app/activity-board.tsx）：
 *   1. 页头：LOCAL EVENTS / 本地赛事 / 一段说明 / 四步流程 / 发起活动按钮
 *   2. 筛选面板：类别 · 奖金 · 形式 · 费用 · 排序 · 日期范围
 *   3. 信息流：按「进行中 / 即将开始 / 已结束」分组，每条带日期徽章 + 标题 +
 *      时间 + 地点来源 + 简介 + 查看详情
 *   4. 末尾再挂一段「国内平台活动」（外部抓取的赛事）
 *
 * 小程序照这个顺序做，样式对齐 board.css 的关键值：
 *   卡片圆角 16rpx→ 这里用 24rpx（小程序 rpx 与 CSS px 的 2 倍关系）
 *   日期徽章 58×58 → 96×96rpx，按类别渐变
 */

const CATEGORIES = [
  { value: "all", label: "全部" },
  { value: "creation", label: "内容创作" },
  { value: "tooling", label: "工具与效率" },
  { value: "city", label: "城市与生活" },
  { value: "research", label: "技术探索" },
  { value: "community", label: "社区共创" },
];

const PRIZE_FILTERS = [
  { value: "all", label: "全部" },
  { value: "with", label: "有奖金" },
  { value: "without", label: "无奖金" },
];

const FORMAT_FILTERS = [
  { value: "all", label: "全部" },
  { value: "online", label: "线上" },
  { value: "offline", label: "线下" },
];

const COST_FILTERS = [
  { value: "all", label: "全部" },
  { value: "free", label: "免费" },
  { value: "paid", label: "收费" },
];

const SORTS = [
  { value: "latest", label: "最新发布" },
  { value: "prize", label: "奖金最高" },
  { value: "ending", label: "即将截止" },
];

const FLOW_STEPS = ["发现活动", "报名参加", "完成作品/任务", "获得荣誉"];

/** 日期徽章：月 / 日 + 按类别取渐变色（与 board.css 的 .feed-date 三档一致）。 */
const DATE_STYLES = {
  competition: "linear-gradient(145deg,#f3bd3e,#d99318)",
  award: "linear-gradient(145deg,#f484a3,#d9547a)",
  local: "linear-gradient(145deg,#54cfc4,#1f9e8a)",
  default: "linear-gradient(145deg,#5fc8ff,#1b9cfc)",
};

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dateBadge(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return { month: "--", day: "??" };
  return { month: Number(match[2]) + "月", day: match[3] };
}

function categoryLabel(value) {
  const hit = CATEGORIES.find((item) => item.value === value);
  return hit && hit.value !== "all" ? hit.label : "其他";
}

Page({
  data: {
    flowSteps: FLOW_STEPS,
    categories: CATEGORIES,
    prizeFilters: PRIZE_FILTERS,
    formatFilters: FORMAT_FILTERS,
    costFilters: COST_FILTERS,
    sorts: SORTS,

    // 筛选状态（"all" 表示不限）
    category: "all",
    prize: "all",
    format: "all",
    cost: "all",
    sort: "latest",
    dateFrom: "",
    dateTo: "",
    filterOpen: false,

    loading: true,
    error: "",
    /** 底层错误详情（域名未白名单 / 证书 / 超时），用于自助排查 */
    errorDetail: "",
    apiBase: "",
    groups: [],
    mineCount: 0,
    externalEvents: [],
    curatedEvents: [],
    externalLoading: true,
  },

  onLoad() {
    this.load();
    this.loadExternal();
  },

  onPullDownRefresh() {
    Promise.all([this.load(), this.loadExternal()]).then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await get("/api/activities", { silent: true });
      this.raw = (data.activities || []).map((item) => ({
        ...item,
        badge: dateBadge(item.startsAt),
        badgeColor: DATE_STYLES[categoryStyle(item.category)] || DATE_STYLES.default,
        whenText: whenText(item.startsAt),
        whereText: whereText(item),
        categoryText: categoryLabel(item.category),
        intro: clampIntro(item.overview || item.subtitle || ""),
        isPending: item.reviewStatus === "pending",
      }));
      this.setData({
        loading: false,
        mineCount: this.raw.filter((item) => item.mine).length,
      });
      this.applyFilters();
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || "加载失败",
        // 把底层 errMsg 一并发出来，方便判断是白名单、证书还是网络问题
        errorDetail: (error.extra && error.extra.detail) || "",
        apiBase: require("../../utils/request").BASE_URL,
      });
    }
  },

  async loadExternal() {
    try {
      const data = await get("/api/events", { silent: true });
      const all = (data.events || []).map((event) => ({
        ...event,
        badge: dateBadge(event.startsAt || event.deadlineAt),
        badgeColor: DATE_STYLES[sourceStyle(event.category)] || DATE_STYLES.competition,
        whenText: whenText(event.startsAt || event.deadlineAt),
        whereText: [event.location, event.online ? "线上" : "", event.source ? "来源 " + sourceLabel(event.source) : ""]
          .filter(Boolean)
          .join(" · "),
        intro: clampIntro(event.descriptionZh || event.description || event.detailTextZh || event.detailText || ""),
        // 精选卡片文案更长（人工撰写），截断放宽到 90 字
        curatedIntro: clampText(event.descriptionZh || event.description || "", 90),
        prizeText: event.prize || "",
      }));
      // 人工精选与自动抓取分开：精选在前（与网页端一致），数量通常个位数
      this.setData({
        curatedEvents: all.filter((event) => event.source === "curated"),
        externalEvents: all.filter((event) => event.source !== "curated").slice(0, 20),
        externalLoading: false,
      });
    } catch {
      this.setData({ curatedEvents: [], externalEvents: [], externalLoading: false });
    }
  },

  /** 应用全部筛选并分组（进行中 / 即将开始 / 已结束）。 */
  applyFilters() {
    const { category, prize, format, cost, sort, dateFrom, dateTo } = this.data;
    const today = todayKey();

    let list = (this.raw || []).filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (prize === "with" && !(item.prizePool > 0 || (item.awards && item.awards.length))) return false;
      if (prize === "without" && (item.prizePool > 0 || (item.awards && item.awards.length))) return false;
      if (format !== "all" && item.format !== format) return false;
      if (cost === "free" && item.pricing === "paid") return false;
      if (cost === "paid" && item.pricing !== "paid") return false;
      const start = String(item.startsAt || "").slice(0, 10);
      const end = String(item.endsAt || "").slice(0, 10);
      if (dateFrom && end && end < dateFrom) return false;
      if (dateTo && start && start > dateTo) return false;
      return true;
    });

    if (sort === "prize") {
      list = list.slice().sort((a, b) => (b.prizePool || 0) - (a.prizePool || 0));
    } else if (sort === "ending") {
      list = list.slice().sort((a, b) => String(a.endsAt || "9999").localeCompare(String(b.endsAt || "9999")));
    } else {
      list = list.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }

    const groups = [];
    const ongoing = [];
    const upcoming = [];
    const past = [];
    for (const item of list) {
      const start = String(item.startsAt || "").slice(0, 10);
      const end = String(item.endsAt || "").slice(0, 10);
      if (end && end < today) past.push(item);
      else if (start && start > today) upcoming.push(item);
      else ongoing.push(item);
    }
    if (ongoing.length) groups.push({ id: "ongoing", title: "进行中", items: ongoing });
    if (upcoming.length) groups.push({ id: "upcoming", title: "即将开始", items: upcoming });
    if (past.length) groups.push({ id: "past", title: "已结束", items: past });

    this.setData({ groups });
  },

  toggleFilter() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },

  pickFilter(event) {
    const { field, value } = event.currentTarget.dataset;
    this.setData({ [field]: value });
    this.applyFilters();
  },

  onDateChange(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
    this.applyFilters();
  },

  clearFilters() {
    this.setData({ category: "all", prize: "all", format: "all", cost: "all", sort: "latest", dateFrom: "", dateTo: "" });
    this.applyFilters();
  },

  openDetail(event) {
    const slug = event.currentTarget.dataset.slug;
    wx.navigateTo({ url: "/pages/activity-detail/activity-detail?slug=" + encodeURIComponent(slug) });
  },

  openExternal(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    // 外部赛事是第三方站点，小程序里不能直接跳外链，复制链接让用户去浏览器打开
    wx.setClipboardData({
      data: url,
      success() {
        wx.showModal({
          title: "链接已复制",
          content: "外部赛事页面需要在浏览器中打开，链接已复制到剪贴板。",
          showCancel: false,
        });
      },
    });
  },

  async goCreate() {
    try {
      await ensureLogin();
      wx.navigateTo({ url: "/pages/create/create" });
    } catch (error) {
      wx.showToast({ title: error.message || "请先登录", icon: "none" });
    }
  },

  onRetry() {
    this.load();
    this.loadExternal();
  },

  onShareAppMessage() {
    return { title: "杭客松 · 本地赛事", path: "/pages/activities/activities" };
  },
});

// ── 纯函数 ────────────────────────────────────────────────────────────────
function categoryStyle(category) {
  if (category === "creation") return "competition";
  if (category === "community") return "award";
  if (category === "city") return "local";
  return "default";
}

function sourceStyle(category) {
  if (category === "hackathon") return "competition";
  if (category === "award") return "award";
  return "local";
}

function sourceLabel(source) {
  const map = {
    hudongba: "互动吧",
    topcoder: "Topcoder",
    mlh: "MLH",
    drivendata: "DrivenData",
    contestwatchers: "Contest Watchers",
    xprize: "XPRIZE",
    studentcompetitions: "Student Competitions",
    curated: "杭客松精选",
  };
  return map[source] || source;
}

function whenText(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "时间待定";
  return text.slice(5).replace("-", "月") + "日 开始";
}

function whereText(item) {
  const parts = [];
  if (item.format === "offline") parts.push(item.venue || "线下");
  else parts.push("线上");
  if (item.district && item.district !== "other") parts.push(districtName(item.district));
  return parts.filter(Boolean).join(" · ");
}

function districtName(id) {
  const map = {
    shangcheng: "上城区",
    gongshu: "拱墅区",
    xihu: "西湖区",
    binjiang: "滨江区",
    xiaoshan: "萧山区",
    yuhang: "余杭区",
    linping: "临平区",
    qiantang: "钱塘区",
    fuyang: "富阳区",
    linan: "临安区",
    tonglu: "桐庐县",
    chunan: "淳安县",
    jiande: "建德市",
    other: "其他",
  };
  return map[id] || "";
}

/** 简介截断：网页端是 clampIntro，这里保持同样的观感。 */
function clampIntro(text) {
  return clampText(text, 62);
}

function clampText(text, limit) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}
