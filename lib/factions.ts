/**
 * 杭客松的阵营体系：杭州全部 13 个区县（10 区 + 3 县市）。
 * 用户报名活动后选择一个阵营，在该活动内锁定不可更改；阵营贡献值按区县汇总。
 * 颜色在环形图、榜单徽标等处共用。
 */
export type Faction = { id: string; name: string; color: string };

export const FACTIONS: Faction[] = [
  { id: "shangcheng", name: "上城区", color: "#54d7ff" },
  { id: "gongshu", name: "拱墅区", color: "#8fd8c4" },
  { id: "xihu", name: "西湖区", color: "#7fd48d" },
  { id: "binjiang", name: "滨江区", color: "#7a9dff" },
  { id: "xiaoshan", name: "萧山区", color: "#b992ff" },
  { id: "yuhang", name: "余杭区", color: "#ffb46b" },
  { id: "linping", name: "临平区", color: "#ff8fa8" },
  { id: "qiantang", name: "钱塘区", color: "#e8d16a" },
  { id: "fuyang", name: "富阳区", color: "#c3e06a" },
  { id: "linan", name: "临安区", color: "#57d4c0" },
  { id: "tonglu", name: "桐庐县", color: "#f27fd9" },
  { id: "chunan", name: "淳安县", color: "#ff7a7a" },
  { id: "jiande", name: "建德市", color: "#9b8cff" },
];

export function factionById(id: string): Faction | undefined {
  return FACTIONS.find((faction) => faction.id === id);
}
