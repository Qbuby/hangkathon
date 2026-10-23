const { get, ApiError } = require("../../utils/request");
const { ensureLogin, logout, getCachedUser } = require("../../utils/auth");
const { displayName, avatarInitial, formatNumber, honorLevel, formatDate } = require("../../utils/format");

/**
 * 我的 —— 与网页 /profile 对齐：
 *   勋章卡（星 / 档位 / 贡献值 / 进度）→ 我的报名 → 更多操作。
 *
 * 数据：
 *   GET /api/me           → user + joins(activityId) + submissionCount
 *   GET /api/activities   → 用 activityId 关联出活动标题与 slug（/api/me 不返回标题）
 *   GET /api/leaderboard  → 勋章档位（避免前端硬编码 500/2000/6000/15000）
 *   GET /api/agent/session→ canPublish
 */
Page({
  data: {
    loading: true,
    error: "",
    loggedIn: false,
    user: null,
    nameText: "",
    avatarText: "·",
    pointsText: "0",
    level: { stars: 1, title: "初来数字市民", next: null },
    nextText: "",
    progress: 0,
    joins: [],
    joinCount: 0,
    submissionCount: 0,
    canPublish: false,
    isAdmin: false,
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  async refresh() {
    this.setData({ loading: true, error: "" });
    try {
      const cached = getCachedUser();
      if (!cached) await ensureLogin();

      const [me, board, activities] = await Promise.all([
        get("/api/me", { silent: true }),
        get("/api/leaderboard", { silent: true }).catch(() => ({ honorLevels: [] })),
        get("/api/activities", { silent: true }).catch(() => ({ activities: [] })),
      ]);

      const user = me.user || null;
      if (!user) {
        this.setData({ loading: false, loggedIn: false });
        return;
      }

      const honorLevels = (board && board.honorLevels) || [];
      // 贡献值结算尚未接入（CONTRIBUTIONS 为空），与网页 /profile 口径一致按 0 展示
      const points = 0;
      const level = honorLevel(points, honorLevels);

      // /api/me 只给 activityId，标题要从活动列表里关联
      const byId = new Map();
      for (const item of activities.activities || []) byId.set(item.id, item);
      const joins = (me.joins || []).map((row) => {
        const act = byId.get(row.activityId);
        return {
          activityId: row.activityId,
          slug: act ? act.slug : "",
          title: act ? act.title : "（活动已下线）",
          joinedAt: formatDate(row.joinedAt),
          invited: Boolean(row.invitedBy),
        };
      });

      let canPublish = false;
      try {
        const agent = await get("/api/agent/session", { silent: true });
        canPublish = Boolean(agent.canPublish);
      } catch {
        /* 门禁探针失败不影响页面 */
      }

      this.setData({
        loading: false,
        loggedIn: true,
        user,
        nameText: displayName(user, "数字市民"),
        avatarText: avatarInitial(user),
        pointsText: formatNumber(points),
        level,
        nextText: level.next
          ? "距 ★" + level.next.stars + " " + level.next.title + " 还差 " + formatNumber(level.next.min - points) + " 贡献值"
          : "已达最高星级。",
        progress: level.progress,
        joins,
        joinCount: joins.length,
        submissionCount: me.submissionCount || 0,
        canPublish,
        isAdmin: user.role === "admin",
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof ApiError ? error.message : "加载失败",
      });
    }
  },

  onLogin() {
    ensureLogin(true)
      .then(() => this.refresh())
      .catch((error) => wx.showToast({ title: error.message || "登录失败", icon: "none" }));
  },

  onLogout() {
    wx.showModal({
      title: "退出登录",
      content: "退出后需要重新用微信登录。",
      success: (res) => {
        if (!res.confirm) return;
        logout();
        this.setData({ loggedIn: false, user: null, joins: [] });
        wx.showToast({ title: "已退出", icon: "success" });
      },
    });
  },

  openActivity(event) {
    const slug = event.currentTarget.dataset.slug;
    if (!slug) {
      wx.showToast({ title: "该活动已下线", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/activity-detail/activity-detail?slug=" + encodeURIComponent(slug) });
  },

  goActivities() {
    wx.switchTab({ url: "/pages/activities/activities" });
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/create/create" });
  },

  goManage() {
    wx.navigateTo({ url: "/pages/manage/manage" });
  },
});
