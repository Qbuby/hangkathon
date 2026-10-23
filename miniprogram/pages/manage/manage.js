const { get, request } = require("../../utils/request");
const { ensureLogin, getCachedUser } = require("../../utils/auth");
const { formatDate } = require("../../utils/format");

/**
 * 管理端（仅 admin）。
 *
 * 手机上真正用得上的只有三件事，所以只做这三件：
 *   1. 活动审核：pending 的活动批准/删除
 *   2. 作品审核：pending 的作品通过/驳回
 *   3. 代理商申请：通过/驳回
 *
 * 用户管理、黑名单、审计日志这些低频且需要细看内容的操作留在网页 /manage ——
 * 把它们塞进小程序只会做出一堆难用又危险的表单。
 */
Page({
  data: {
    phase: "loading", // loading | forbidden | ready
    error: "",
    tab: "activities", // activities | submissions | agents
    tabs: [
      { id: "activities", name: "活动审核" },
      { id: "submissions", name: "作品审核" },
      { id: "agents", name: "代理商" },
    ],
    activities: [],
    submissions: [],
    agents: [],
    overview: null,
    busyId: "",
  },

  onShow() {
    this.boot();
  },

  async boot() {
    this.setData({ phase: "loading", error: "" });
    try {
      await ensureLogin();
      const session = await get("/api/admin/session", { silent: true });
      if (!session.user) {
        this.setData({ phase: "forbidden", error: "请先登录" });
        return;
      }
      if (!session.admin) {
        this.setData({ phase: "forbidden", error: "当前账号不是管理员" });
        return;
      }
      this.setData({ phase: "ready" });
      await this.loadAll();
    } catch (error) {
      this.setData({ phase: "forbidden", error: error.message || "无法进入管理端" });
    }
  },

  async loadAll() {
    const [overview, activities, agents] = await Promise.all([
      get("/api/admin/overview", { silent: true }).catch(() => null),
      get("/api/admin/activities", { silent: true }).catch(() => ({ activities: [] })),
      get("/api/admin/agents", { silent: true }).catch(() => ({ applications: [] })),
    ]);

    const pendingActivities = (activities.activities || [])
      .filter((item) => item.reviewStatus === "pending")
      .map((item) => ({
        ...item,
        dateText: item.startsAt && item.endsAt ? item.startsAt + " 至 " + item.endsAt : "待定",
      }));

    const pendingAgents = (agents.applications || []).filter((item) => item.status === "pending");

    this.setData({
      overview: overview || null,
      activities: pendingActivities,
      agents: pendingAgents,
    });
    await this.loadSubmissions(pendingActivities);
  },

  /** 作品审核需要一个活动一个活动地拉（服务端按 slug 查）。 */
  async loadSubmissions(pendingActivities) {
    const all = [];
    // 只拉待审核活动 + 已发布活动里还有待审作品的那些；这里简化成拉前 10 场活动
    const targets = (pendingActivities.length ? pendingActivities : []).slice(0, 10);
    for (const activity of targets) {
      try {
        const data = await get(
          "/api/admin/activities/" + encodeURIComponent(activity.slug) + "/submissions",
          { silent: true },
        );
        for (const sub of data.submissions || []) {
          if (sub.reviewStatus === "pending") {
            all.push({ ...sub, activityTitle: activity.title, submittedText: formatDate(sub.submittedAt) });
          }
        }
      } catch {
        /* 单场失败不影响其它 */
      }
    }
    this.setData({ submissions: all });
  },

  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.id });
  },

  /** 活动：批准上线 / 删除。 */
  async reviewActivity(event) {
    const slug = event.currentTarget.dataset.slug;
    const action = event.currentTarget.dataset.action;
    if (this.data.busyId) return;

    if (action === "delete") {
      const confirmed = await confirmModal("删除活动", "删除后无法恢复，确定删除吗？");
      if (!confirmed) return;
    }

    this.setData({ busyId: slug });
    try {
      await request("/api/admin/activities/" + encodeURIComponent(slug), {
        method: action === "delete" ? "DELETE" : "PATCH",
        data: action === "delete" ? undefined : { reviewStatus: "published" },
        silent: true,
      });
      wx.showToast({ title: action === "delete" ? "已删除" : "已通过", icon: "success" });
      await this.boot();
    } catch (error) {
      wx.showModal({ title: "操作失败", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      this.setData({ busyId: "" });
    }
  },

  /** 作品：通过 / 驳回。 */
  async reviewSubmission(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    if (this.data.busyId) return;

    this.setData({ busyId: id });
    try {
      await request("/api/admin/submissions/" + encodeURIComponent(id), {
        method: "PATCH",
        // 服务端 /api/admin/submissions/[id] 读的是 `status`（不是 reviewStatus）
        data: { status },
        silent: true,
      });
      wx.showToast({ title: status === "approved" ? "已通过" : "已驳回", icon: "success" });
      await this.boot();
    } catch (error) {
      wx.showModal({ title: "操作失败", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      this.setData({ busyId: "" });
    }
  },

  /** 代理商：通过 / 驳回。 */
  async reviewAgent(event) {
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    if (this.data.busyId) return;

    this.setData({ busyId: id });
    try {
      await request("/api/admin/agents/" + encodeURIComponent(id), {
        method: "PATCH",
        // 服务端 /api/admin/agents/[id] 读的是 `decision`（不是 status）
        data: { decision: status },
        silent: true,
      });
      wx.showToast({ title: status === "approved" ? "已通过" : "已驳回", icon: "success" });
      await this.boot();
    } catch (error) {
      wx.showModal({ title: "操作失败", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      this.setData({ busyId: "" });
    }
  },

  copyUrl(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.setClipboardData({ data: url });
  },

  onRetry() {
    this.boot();
  },
});

function confirmModal(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}
