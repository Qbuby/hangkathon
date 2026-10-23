const { get, post, ApiError } = require("../../utils/request");
const { ensureLogin, getCachedUser } = require("../../utils/auth");
const { displayName } = require("../../utils/format");

/**
 * 提交作品：只接受抖音链接。
 *
 * 服务端校验链（顺序与提示语必须对上，否则用户看不懂为什么失败）：
 *   400 → 不是抖音链接（isValidDouyinUrl）
 *   422 → 不是 https 或不是抖音站内作品页（screenSubmissionUrl）
 *   422 → 作品文案命中违法有害词库（会自动拉黑，提示语来自服务端）
 *   429 → 写接口限流（5 次/分钟/账号）
 *   201 → 成功，返回抓取到的互动数据（可能带 metricsError，但提交本身成立）
 */
Page({
  data: {
    slug: "",
    activity: null,
    loading: true,
    error: "",
    url: "",
    submitting: false,
    /** 提交成功后的结果卡（含抓取到的数据） */
    result: null,
    mySubmissions: [],
  },

  onLoad(query) {
    const slug = decodeURIComponent(query.slug || "");
    this.setData({ slug });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      await ensureLogin();
      const data = await get(`/api/activities/${encodeURIComponent(this.data.slug)}`, { silent: true });
      const submissions = await get(`/api/activities/${encodeURIComponent(this.data.slug)}/submissions`, {
        silent: true,
      }).catch(() => ({ submissions: [] }));
      this.setData({
        activity: data.activity || null,
        mySubmissions: submissions.submissions || [],
        loading: false,
      });
      wx.setNavigationBarTitle({ title: "提交作品" });
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof ApiError && error.status === 401 ? "请先登录" : error.message || "加载失败",
      });
    }
  },

  onUrlInput(event) {
    this.setData({ url: event.detail.value });
  },

  async onSubmit() {
    const url = this.data.url.trim();
    if (!url) {
      wx.showToast({ title: "请粘贴抖音作品链接", icon: "none" });
      return;
    }
    if (this.data.submitting) return;

    this.setData({ submitting: true, result: null });
    try {
      const data = await post(
        `/api/activities/${encodeURIComponent(this.data.slug)}/submissions`,
        { url },
        { timeout: 30000 }, // 服务端会去抓抖音数据，12 秒可能不够
      );
      this.setData({ result: data.submission || null, url: "" });
      wx.showToast({ title: "提交成功", icon: "success" });
      await this.load();
    } catch (error) {
      // 400/422 服务端已经给了具体原因，直接用它的 message；429 补一句等待时间
      let message = error.message || "提交失败";
      if (error instanceof ApiError && error.status === 429) {
        message = "提交太频繁，请 " + (error.extra.retryAfter || 60) + " 秒后再试";
      }
      wx.showModal({ title: "提交未成功", content: message, showCancel: false });
    } finally {
      this.setData({ submitting: false });
    }
  },

  copyUrl(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.url });
  },
});
