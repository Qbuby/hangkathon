const { get, post, ApiError } = require("../../utils/request");
const { ensureLogin, getCachedUser } = require("../../utils/auth");
const { displayName } = require("../../utils/format");

/**
 * 发起活动。三级门禁，与网页 /create 完全一致：
 *   1. 未登录 → 静默登录（wx.login 不需要用户授权）
 *   2. 已登录但 role 不是 agent/admin → 显示代理商申请表单
 *   3. 代理商 → 显示活动创建表单
 *
 * 表单字段与服务端 lib/activity.ts 的 validateAll 对齐；权重必须合计 100，
 * 这里直接给一个默认三维度（40/30/30），用户不用自己算。
 */
const DISTRICTS = [
  { id: "shangcheng", name: "上城区" },
  { id: "gongshu", name: "拱墅区" },
  { id: "xihu", name: "西湖区" },
  { id: "binjiang", name: "滨江区" },
  { id: "xiaoshan", name: "萧山区" },
  { id: "yuhang", name: "余杭区" },
  { id: "linping", name: "临平区" },
  { id: "qiantang", name: "钱塘区" },
  { id: "fuyang", name: "富阳区" },
  { id: "linan", name: "临安区" },
  { id: "tonglu", name: "桐庐县" },
  { id: "chunan", name: "淳安县" },
  { id: "jiande", name: "建德市" },
  { id: "other", name: "其他" },
];

const CATEGORIES = [
  { value: "creation", label: "内容创作" },
  { value: "tooling", label: "工具与效率" },
  { value: "city", label: "城市与生活" },
  { value: "research", label: "技术探索" },
  { value: "community", label: "社区共创" },
];

const SUBMISSION_TYPES = [
  { value: "writeup", label: "文字说明" },
  { value: "files", label: "代码/文件" },
  { value: "video", label: "视频" },
  { value: "demo", label: "可运行演示" },
  { value: "live", label: "现场演示" },
];

const EMPTY_FORM = {
  title: "",
  slug: "",
  subtitle: "",
  category: "creation",
  district: "other",
  overview: "",
  host: "",
  contact: "",
  format: "offline",
  venue: "",
  pricing: "free",
  fee: "",
  startsAt: "",
  endsAt: "",
  judging: "judges",
  visibility: "public",
  joinPolicy: "anyone",
};

Page({
  data: {
    /** loading | login | apply | form | done */
    phase: "loading",
    error: "",
    districts: DISTRICTS,
    categories: CATEGORIES,
    submissionTypes: SUBMISSION_TYPES,
    form: null,
    applyForm: { contactName: "", organization: "", phone: "", email: "", statement: "" },
    application: null,
    busy: false,
    created: null,
  },

  onLoad() {
    const user = getCachedUser() || {};
    this.setData({
      form: {
        ...EMPTY_FORM,
        // 主持人名预填展示名；微信占位账号不预填（会让活动页出现"微信用户 · XXXX"）
        host: user.email && String(user.email).indexOf("@wechat.user") === -1 ? displayName(user, "") : "",
      },
    });
    this.boot();
  },

  async boot() {
    this.setData({ phase: "loading", error: "" });
    try {
      await ensureLogin();
      const agent = await get("/api/agent/session", { silent: true });
      const application = agent.application || null;
      if (agent.canPublish) {
        this.setData({ phase: "form", application });
        return;
      }
      // 已有未通过的申请：把内容填回去让用户改
      if (application) {
        this.setData({
          phase: "apply",
          application,
          applyForm: {
            contactName: application.contactName || "",
            organization: application.organization || "",
            phone: application.phone || "",
            email: application.email || "",
            statement: application.statement || "",
          },
        });
        return;
      }
      this.setData({ phase: "apply", application: null });
    } catch (error) {
      this.setData({
        phase: "login",
        error: error instanceof ApiError && error.status === 401 ? "" : error.message || "",
      });
    }
  },

  // ── 表单输入 ────────────────────────────────────────────────────────────
  onField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ["form." + field]: event.detail.value });
  },

  onPickDistrict(event) {
    this.setData({ "form.district": DISTRICTS[event.detail.value].id });
  },

  onPickCategory(event) {
    this.setData({ "form.category": CATEGORIES[event.detail.value].value });
  },

  onFormat(event) {
    this.setData({ "form.format": event.currentTarget.dataset.value });
  },

  onPricing(event) {
    this.setData({ "form.pricing": event.currentTarget.dataset.value });
  },

  onPickDate(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ["form." + field]: event.detail.value });
  },

  /** 从标题自动生成代号（服务端要求 [a-z0-9-]）。 */
  onTitleInput(event) {
    const title = event.detail.value;
    this.setData({ "form.title": title });
    if (!this.data.form.slug) {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      if (slug) this.setData({ "form.slug": slug });
    }
  },

  // ── 提交活动 ────────────────────────────────────────────────────────────
  async onCreate() {
    const form = this.data.form;
    const missing = [];
    if (!form.title.trim()) missing.push("活动名称");
    if (!form.slug.trim()) missing.push("活动代号");
    if (!form.subtitle.trim()) missing.push("一句话说明");
    if (!form.host.trim()) missing.push("主办方");
    if (!form.contact.trim()) missing.push("联系方式");
    if (!form.startsAt) missing.push("开始日期");
    if (!form.endsAt) missing.push("截止日期");
    if (form.format === "offline" && !form.venue.trim()) missing.push("活动地点");
    if (missing.length) {
      wx.showModal({ title: "还有必填项", content: "请补充：" + missing.join("、"), showCancel: false });
      return;
    }
    if (form.endsAt < form.startsAt) {
      wx.showModal({ title: "日期不对", content: "截止日期不能早于开始日期。", showCancel: false });
      return;
    }
    if (this.data.busy) return;

    this.setData({ busy: true });
    try {
      const data = await post("/api/activities", {
        ...form,
        prizePool: 0,
        submissionTypes: ["writeup", "demo"],
        criteria: [
          { name: "完成度", weight: 40 },
          { name: "创意", weight: 30 },
          { name: "可用性", weight: 30 },
        ],
        awardsEnabled: false,
        awards: [],
        emailDomain: "",
      });
      this.setData({ phase: "done", created: data.activity || null });
      wx.showToast({ title: "已提交审核", icon: "success" });
    } catch (error) {
      // 400 可能带字段级错误
      let message = error.message || "提交失败";
      if (error instanceof ApiError && error.extra && error.extra.errors) {
        const fields = Object.keys(error.extra.errors);
        if (fields.length) message = fields.map((k) => error.extra.errors[k]).join("；");
      }
      wx.showModal({ title: "提交未成功", content: message, showCancel: false });
    } finally {
      this.setData({ busy: false });
    }
  },

  // ── 代理商申请 ──────────────────────────────────────────────────────────
  onApplyField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ ["applyForm." + field]: event.detail.value });
  },

  async onApply() {
    const form = this.data.applyForm;
    if (!form.contactName.trim()) {
      wx.showToast({ title: "请填写联系人", icon: "none" });
      return;
    }
    if (!form.phone.trim()) {
      wx.showToast({ title: "请填写联系电话", icon: "none" });
      return;
    }
    if (form.statement.trim().length < 10) {
      wx.showToast({ title: "身份声明至少 10 个字", icon: "none" });
      return;
    }
    if (this.data.busy) return;

    this.setData({ busy: true });
    try {
      await post("/api/agent/application", form);
      wx.showModal({
        title: "已提交",
        content: "申请已提交，审核通过后即可发起活动。",
        showCancel: false,
        success: () => this.boot(),
      });
    } catch (error) {
      wx.showModal({ title: "提交未成功", content: error.message || "请稍后重试", showCancel: false });
    } finally {
      this.setData({ busy: false });
    }
  },

  goActivities() {
    wx.switchTab({ url: "/pages/activities/activities" });
  },

  onRetry() {
    this.boot();
  },
});
