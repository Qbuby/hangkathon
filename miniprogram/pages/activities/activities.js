const { get } = require("../../utils/request");
const { formatDateRange } = require("../../utils/format");

/**
 * 活动看板。
 *
 * 公开接口，未登录也能看 —— 这是刻意的：小程序的第一屏不能是登录墙，
 * 否则大部分人会在授权框前就退出。
 */

const DISTRICTS = [
  { id: "", name: "全部" },
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

Page({
  data: {
    /** 全部活动（带展示用派生字段） */
    all: [],
    /** 当前筛选后要渲染的列表 —— 模板里不能调函数，必须在 JS 里算好 */
    activities: [],
    loading: true,
    error: "",
    district: "",
    districts: DISTRICTS,
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
      const data = await get("/api/activities", { silent: true });
      const list = (data.activities || []).map((item) => ({
        ...item,
        dateText: formatDateRange(item.startsAt, item.endsAt),
        districtText: districtName(item.district),
        priceText: item.pricing === "paid" ? item.fee || "收费" : "免费",
      }));
      this.setData({ all: list, loading: false });
      this.applyFilter();
    } catch (error) {
      this.setData({ loading: false, error: error.message || "加载失败" });
    }
  },

  /** 本地筛选，避免每次切区都请求一次（活动总数很小）。 */
  applyFilter() {
    const { all, district } = this.data;
    this.setData({
      activities: district ? all.filter((item) => item.district === district) : all,
    });
  },

  onDistrictTap(event) {
    this.setData({ district: event.currentTarget.dataset.id });
    this.applyFilter();
  },

  openDetail(event) {
    const slug = event.currentTarget.dataset.slug;
    wx.navigateTo({ url: "/pages/activity-detail/activity-detail?slug=" + encodeURIComponent(slug) });
  },

  onRetry() {
    this.load();
  },

  onShareAppMessage() {
    return {
      title: "杭客松 · 世界 AI 上杭州",
      path: "/pages/activities/activities",
    };
  },
});

function districtName(id) {
  const hit = DISTRICTS.find((item) => item.id === id);
  return hit ? hit.name : "其他";
}
