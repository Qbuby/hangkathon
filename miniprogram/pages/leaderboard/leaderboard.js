const { get } = require("../../utils/request");
const { formatNumber, displayName } = require("../../utils/format");
const { getCachedUser } = require("../../utils/auth");

/**
 * 排行榜。
 *
 * 数据来自新增的 GET /api/leaderboard —— 与网页版同一份计算
 * （lib/contribution.ts 的 platformTotals），所以两端数字一定一致。
 *
 * ⚠️ 已知事实：`CONTRIBUTIONS` 目前是空对象（贡献值结算流程还没接），
 * 所以「累计荣誉值 / 个人榜 / 战队榜」都会是 0 或空。这里如实展示空状态，
 * 不编造数据，也不隐藏这几个板块（否则用户以为功能坏了）。
 */
Page({
  data: {
    loading: true,
    error: "",
    totals: null,
    districts: [],
    honorLevels: [],
    activityCount: 0,
    totalText: "0",
    citizenCount: 0,
    myTitle: "登录后，这里就是你的荣誉面板",
    mySub: "报名一场活动、完成一件作品，荣誉就会开始积累。",
    teams: [],
    topUsers: [],
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await get("/api/leaderboard", { silent: true });
      const totals = data.totals || {};
      this.setData({
        totals,
        districts: data.districts || [],
        honorLevels: data.honorLevels || [],
        activityCount: data.activityCount || 0,
        totalText: formatNumber(totals.total || 0),
        citizenCount: totals.citizenCount || 0,
        teams: (totals.teams || []).map((team) => ({
          ...team,
          pointsText: formatNumber(team.points),
        })),
        topUsers: (totals.users || []).slice(0, 20).map((row, index) => ({
          ...row,
          rank: index + 1,
          pointsText: formatNumber(row.points),
        })),
        loading: false,
      });
      this.refreshMyHonor();
    } catch (error) {
      this.setData({ loading: false, error: error.message || "加载失败" });
    }
  },

  /** 「我的荣誉」：登录后显示展示名与当前贡献值（结算未接入，按 0 展示）。 */
  refreshMyHonor() {
    const user = getCachedUser();
    if (!user) return;
    this.setData({
      myTitle: displayName(user, "数字市民"),
      mySub: "贡献值 0 · 初来数字市民。报名参加活动后，这里会开始积累。",
    });
  },

  onRetry() {
    this.load();
  },

  onShareAppMessage() {
    return {
      title: "杭客松 · 荣誉榜",
      path: "/pages/leaderboard/leaderboard",
    };
  },
});
