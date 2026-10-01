/**
 * 杭客松的阵营体系：杭州全部 13 个县级行政区 + 「其他」。
 * 区由发起方在发布活动时选择（活动归属），参与者以个人账户参赛，不再选阵营。
 * 「其他」用于不属于任何一个区的活动（线上、跨区、杭州以外）；颜色在环形图、榜单徽标等处共用。
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
  { id: "other", name: "其他", color: "#a8b6c6" },
];

export function factionById(id: string): Faction | undefined {
  return FACTIONS.find((faction) => faction.id === id);
}
