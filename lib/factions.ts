/**
 * 杭客松的阵营体系：杭州行政范围的十区两县一市，共 13 个县级行政区。
 * 用户报名活动后选择一个阵营，在该活动内锁定不可更改；阵营贡献值按区县汇总。
 * 颜色在环形图、榜单徽标等处共用。
 */
export type FactionType = "district" | "county" | "city";

export type Faction = { id: string; name: string; color: string; type: FactionType };

/** 十区 */
export const FACTIONS: Faction[] = [
  { id: "shangcheng", name: "上城区", color: "#54d7ff", type: "district" },
  { id: "gongshu", name: "拱墅区", color: "#8fd8c4", type: "district" },
  { id: "xihu", name: "西湖区", color: "#7fd48d", type: "district" },
  { id: "binjiang", name: "滨江区", color: "#7a9dff", type: "district" },
  { id: "xiaoshan", name: "萧山区", color: "#b992ff", type: "district" },
  { id: "yuhang", name: "余杭区", color: "#ffb46b", type: "district" },
  { id: "linping", name: "临平区", color: "#ff8fa8", type: "district" },
  { id: "qiantang", name: "钱塘区", color: "#e8d16a", type: "district" },
  { id: "fuyang", name: "富阳区", color: "#c3e06a", type: "district" },
  { id: "linan", name: "临安区", color: "#57d4c0", type: "district" },
  /** 两县 */
  { id: "tonglu", name: "桐庐县", color: "#f27fd9", type: "county" },
  { id: "chunan", name: "淳安县", color: "#ff7a7a", type: "county" },
  /** 一市（县级市） */
  { id: "jiande", name: "建德市", color: "#9b8cff", type: "city" },
];

/** 选阵营弹窗的分组顺序与标题。 */
export const FACTION_GROUPS: { type: FactionType; label: string }[] = [
  { type: "district", label: "十区 · 市辖区" },
  { type: "county", label: "两县" },
  { type: "city", label: "一市 · 县级市" },
];

export function factionById(id: string): Faction | undefined {
  return FACTIONS.find((faction) => faction.id === id);
}
