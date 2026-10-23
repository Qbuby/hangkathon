const { get, post, ApiError } = require("../../utils/request");
const { ensureLogin, getCachedUser } = require("../../utils/auth");
const { formatNumber } = require("../../utils/format");

/**
 * 活动详情 —— 与网页 /activities/[slug] 的结构对齐：
 *   1. 标题区：大标题 + 副标题 + 主办方 + 联系方式
 *   2. 关键信息卡：类别 / 时间 / 所属区 / 地点 / 奖金 / 费用 / 报名 / 活动代号
 *   3. 活动说明
 *   4. 报名区（已报名则展示个人参赛徽标 + 邀请链接 + 提交作品入口）
 *   5. 我的作品
 *
 * 404 的语义：服务端对「不存在 / 已下线 / 待审且非发起人」一律 404（刻意的，
 * 不能让未公开活动被探测），所以文案写"不存在或尚未公开"，不写"已删除"。
 */

const DISTRICTS = {
  shangcheng: { name: "上城区", color: "#54d7ff" },
  gongshu: { name: "拱墅区", color: "#8fd8c4" },
  xihu: { name: "西湖区", color: "#7fd48d" },
  binjiang: { name: "滨江区", color: "#7a9dff" },
  xiaoshan: { name: "萧山区", color: "#b992ff" },
  yuhang: { name: "余杭区", color: "#ffb46b" },
  linping: { name: "临平区", color: "#ff8fa8" },
  qiantang: { name: "钱塘区", color: "#e8d16a" },
  fuyang: { name: "富阳区", color: "#c3e06a" },
  linan: { name: "临安区", color: "#57d4c0" },
  tonglu: { name: "桐庐县", color: "#f27fd9" },
  chunan: { name: "淳安县", color: "#ff7a7a" },
  jiande: { name: "建德市", color: "#9b8cff" },
  other: { name: "其他", color: "#a8b6c6" },
};

const CATEGORY_LABELS = {
  creation: "内容创作",
  tooling: "工具与效率",
  city: "城市与生活",
  research: "技术探索",
  community: "社区共创",
};

const JOIN_POLICY_LABELS = {
  anyone: "所有人可报名",
  link: "凭邀请链接报名",
  email: "限定邮箱域名",
};

Page({
  data: {
    slug: "",
    activity: null,
    facts: [],
    joined: false,
    joinedAt: "",
    joinCount: 0,
    loading: true,
    error: "",
    joining: false,
    mySubmissions: [],
    inviteCopied: false,
  },

  onLoad(query) {
    this.setData({ slug: decodeURIComponent(query.slug || "") });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await get(`/api/activities/${encodeURIComponent(this.data.slug)}`, { silent: true });
      const activity = data.activity || null;
      if (!activity) {
        this.setData({ loading: false, error: "活动不存在，或尚未公开" });
        return;
      }

      const district = DISTRICTS[activity.district] || DISTRICTS.other;
      const criteriaText = (activity.criteria || [])
        .map((item) => item.name + " " + item.weight + "%")
        .join(" · ");
      const awardsText = (activity.awards || [])
        .map((item) => item.name + "（" + item.slots + " 名）" + (item.reward ? "：" + item.reward : ""))
        .join("\n");

      const facts = [
        { label: "类别", value: CATEGORY_LABELS[activity.category] || "其他" },
        {
          label: "时间",
          value: activity.startsAt && activity.endsAt ? activity.startsAt + " 至 " + activity.endsAt : "待定",
        },
        { label: "所属区", value: district.name, color: district.color },
        { label: "地点", value: activity.format === "offline" ? activity.venue || "待定" : "线上" },
        { label: "奖金", value: prizeText(activity) },
        { label: "费用", value: activity.pricing === "paid" ? activity.fee || "收费" : "免费" },
        { label: "报名", value: JOIN_POLICY_LABELS[activity.joinPolicy] || "所有人可报名" },
        { label: "活动代号", value: activity.slug },
      ];

      this.setData({
        activity: {
          ...activity,
          criteriaText,
          awardsText,
          categoryText: CATEGORY_LABELS[activity.category] || "其他",
        },
        facts,
        joined: Boolean(data.joined),
        joinedAt: data.joinedAt || "",
        joinCount: data.joinCount || 0,
        loading: false,
      });
      wx.setNavigationBarTitle({ title: activity.title });

      // 已报名才去读自己的作品（未报名时服务端也会返回空，但省一次请求）
      if (data.joined) await this.loadSubmissions();
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 404
          ? "活动不存在，或尚未公开"
          : error.message || "加载失败";
      this.setData({ loading: false, error: message });
    }
  },

  async loadSubmissions() {
    try {
      const data = await get(`/api/activities/${encodeURIComponent(this.data.slug)}/submissions`, {
        silent: true,
      });
      this.setData({ mySubmissions: data.submissions || [] });
    } catch {
      this.setData({ mySubmissions: [] });
    }
  },

  async onJoin() {
    if (this.data.joining) return;
    this.setData({ joining: true });
    try {
      await ensureLogin();
      await this.joinOnce();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        try {
          await ensureLogin(true);
          await this.joinOnce();
        } catch (retryError) {
          wx.showToast({ title: retryError.message || "报名失败", icon: "none" });
        }
      } else {
        wx.showToast({ title: error.message || "报名失败", icon: "none" });
      }
    } finally {
      this.setData({ joining: false });
    }
  },

  async joinOnce() {
    await post(`/api/activities/${encodeURIComponent(this.data.slug)}/join`, {});
    wx.showToast({ title: "报名成功", icon: "success" });
    await this.load();
  },

  async onSubmitWork() {
    try {
      await ensureLogin();
      wx.navigateTo({ url: "/pages/submit/submit?slug=" + encodeURIComponent(this.data.slug) });
    } catch (error) {
      wx.showToast({ title: error.message || "请先登录", icon: "none" });
    }
  },

  async onInvite() {
    try {
      await ensureLogin();
    } catch (error) {
      wx.showToast({ title: "请先登录", icon: "none" });
      return;
    }
    const me = getCachedUser() || {};
    const inviter = me.name || me.email || "";
    const link =
      "https://hangkathon.com/activities/" +
      encodeURIComponent(this.data.slug) +
      "?invite=" +
      encodeURIComponent(this.data.activity.district) +
      "&by=" +
      encodeURIComponent(inviter);
    wx.setClipboardData({
      data: link,
      success: () => {
        this.setData({ inviteCopied: true });
        wx.showToast({ title: "邀请链接已复制", icon: "success" });
      },
    });
  },

  onCopyWork(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.url });
  },

  onShareAppMessage() {
    const activity = this.data.activity;
    return {
      title: activity ? activity.title : "杭客松",
      path: "/pages/activity-detail/activity-detail?slug=" + encodeURIComponent(this.data.slug),
    };
  },
});

function prizeText(activity) {
  if (activity.prizePool > 0) return "¥" + formatNumber(activity.prizePool);
  if (activity.awardsEnabled && (activity.awards || []).length > 0) return "荣誉奖项";
  return "无奖金";
}
