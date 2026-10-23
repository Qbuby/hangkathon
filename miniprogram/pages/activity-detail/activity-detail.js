const { get, post, ApiError } = require("../../utils/request");
const { ensureLogin, getCachedUser } = require("../../utils/auth");
const { formatDateRange, formatNumber } = require("../../utils/format");

/**
 * 活动详情 + 报名 + 提交作品入口 + 邀请。
 *
 * ── 404 的语义 ──────────────────────────────────────────────────────────
 * 服务端对「活动不存在」「已下线」「待审核且不是发起人」一律返回 404
 * （见 lib/server/activities.ts 的 getActivityBySlug）。这是刻意的：不能让
 * 未公开活动被探测到。所以这里的文案要写成"不存在或尚未公开"，不能写"已删除"。
 */
Page({
  data: {
    slug: "",
    activity: null,
    joined: false,
    joinedAt: "",
    joinCount: 0,
    loading: true,
    error: "",
    joining: false,
  },

  onLoad(query) {
    const slug = decodeURIComponent(query.slug || "");
    this.setData({ slug });
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
      this.setData({
        activity: activity
          ? {
              ...activity,
              dateText: formatDateRange(activity.startsAt, activity.endsAt),
              prizeText: activity.prizePool > 0 ? "¥" + formatNumber(activity.prizePool) : "无奖金",
              criteriaText: (activity.criteria || [])
                .map((item) => item.name + " " + item.weight + "%")
                .join(" · "),
              awardsText: (activity.awards || [])
                .map((item) => item.name + "（" + item.slots + " 名）" + (item.reward ? "：" + item.reward : ""))
                .join("\n"),
            }
          : null,
        joined: Boolean(data.joined),
        joinedAt: data.joinedAt || "",
        joinCount: data.joinCount || 0,
        loading: false,
      });
      wx.setNavigationBarTitle({ title: activity ? activity.title : "活动详情" });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 404
          ? "活动不存在，或尚未公开"
          : error.message || "加载失败";
      this.setData({ loading: false, error: message });
    }
  },

  /** 报名：未登录时先静默登录，401 再重试一次。 */
  async onJoin() {
    if (this.data.joining) return;
    this.setData({ joining: true });
    try {
      await ensureLogin();
      await this.joinOnce();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // token 在服务端已失效（例如换了 AUTH_SECRET），强制重登后重试一次
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

  /** 去提交作品页（需登录）。 */
  async onSubmitWork() {
    try {
      await ensureLogin();
      wx.navigateTo({ url: "/pages/submit/submit?slug=" + encodeURIComponent(this.data.slug) });
    } catch (error) {
      wx.showToast({ title: error.message || "请先登录", icon: "none" });
    }
  },

  /** 复制邀请链接：邀请人用当前账号的展示名。 */
  async onInvite() {
    const user = getCachedUser();
    if (!user) {
      try {
        await ensureLogin();
      } catch (error) {
        wx.showToast({ title: "请先登录", icon: "none" });
        return;
      }
    }
    const me = getCachedUser() || {};
    // 与服务端 identityName 的口径一致：服务端按展示名匹配邀请人
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
      success() {
        wx.showToast({ title: "邀请链接已复制", icon: "success" });
      },
    });
  },

  onShareAppMessage() {
    const activity = this.data.activity;
    return {
      title: activity ? activity.title : "杭客松",
      path: "/pages/activity-detail/activity-detail?slug=" + encodeURIComponent(this.data.slug),
    };
  },
});
