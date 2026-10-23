const { get, ApiError } = require("../../utils/request");
const { ensureLogin, logout, getCachedUser } = require("../../utils/auth");
const { displayName, avatarInitial, timeAgo, formatNumber, honorLevel, formatDate } = require("../../utils/format");

/**
 * 我的：身份、勋章、我的报名、我的作品、入口。
 *
 * 数据来源：
 *   GET /api/me           → { user, joins, submissionCount }（唯一返回 id/role 的接口）
 *   GET /api/leaderboard  → honorLevels（勋章档位，避免前端硬编码阈值）
 *   GET /api/agent/session→ canPublish（决定要不要显示"发起活动"入口）
 */
Page({
  data: {
    loading: true,
    error: "",
    loggedIn: false,
    user: null,
    nameText: "",
    avatarText: "·",
    points: 0,
    level: null,
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
      // 先确认会话。没 token 时 fetchSession 直接返回 null，不会弹授权。
      const cached = getCachedUser();
      if (!cached) {
        await ensureLogin();
      }
      const [me, board] = await Promise.all([
        get("/api/me", { silent: true }),
        get("/api/leaderboard", { silent: true }).catch(() => ({ honorLevels: [] })),
      ]);

      const user = me.user || null;
      if (!user) {
        this.setData({ loading: false, loggedIn: false });
        return;
      }

      const honorLevels = (board && board.honorLevels) || [];
      // 贡献值结算尚未接入（CONTRIBUTIONS 为空），这里按 0 展示，
      // 与网页端 /profile 的口径一致 —— 不编造数字。
      const points = 0;
      const level = honorLevel(user ? 0 : points, honorLevels);

      const joins = (me.joins || []).map((row) => ({
        activityId: row.activityId,
        joinedAt: formatDate(row.joinedAt),
        ago: timeAgo(row.joinedAt),
        invited: Boolean(row.invitedBy),
      }));

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
        points,
        level,
        nextText: level.next ? "距 ★" + level.next.stars + " " + level.next.title + " 还差 " + formatNumber(level.next.min - points) + " 贡献值" : "已达最高星级",
        progress: level.progress,
        joins,
        joinCount: joins.length,
        submissionCount: me.submissionCount || 0,
        canPublish,
        isAdmin: user.role === "admin",
      });
    } catch (error) {
      // 401 时 ensureLogin 已经处理过；其他错误给一次重试机会
      this.setData({ loading: false, error: error instanceof ApiError ? error.message : "加载失败" });
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
        if (res.confirm) {
          logout();
          this.setData({ loggedIn: false, user: null });
          wx.showToast({ title: "已退出", icon: "success" });
        }
      },
    });
  },

  openActivity(event) {
    const id = event.currentTarget.dataset.id;
    // joins 里存的是 activityId（UUID），详情页要 slug。这里退回看板页让用户自己点。
    wx.switchTab({ url: "/pages/activities/activities" });
    if (id) {
      wx.showToast({ title: "请在看板中打开该活动", icon: "none" });
    }
  },

  goCreate() {
    wx.navigateTo({ url: "/pages/create/create" });
  },

  goManage() {
    wx.navigateTo({ url: "/pages/manage/manage" });
  },
});
