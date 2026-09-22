/**
 * 自建阵营：除 13 个官方区县外，报名时可创建自定义阵营，但名称必须包含杭州地标。
 * 词库校验是确定性的：名称需包含 HANGZHOU_LANDMARKS 中至少一个词条。
 * 阵营注册表存本机 localStorage（key = hangkathon.customfactions.v1），服务端渲染时为空。
 */

export type CustomFaction = { id: string; name: string; color: string; createdAt: string };

const CUSTOM_KEY = "hangkathon.customfactions.v1";
const MAX_CUSTOM = 50;

/** 杭州地标词库：景点、山川、江河、街区、文化符号。 */
export const HANGZHOU_LANDMARKS = [
  "西湖", "断桥", "雷峰塔", "雷峰", "灵隐", "苏堤", "白堤", "孤山", "吴山", "城隍阁",
  "钱塘江", "钱塘", "六和塔", "保俶塔", "岳王庙", "岳庙", "西泠", "河坊街", "拱宸桥",
  "大运河", "运河", "良渚", "西溪", "千岛湖", "富春江", "九溪", "龙井", "梅家坞",
  "南山路", "北山街", "武林", "湖滨", "城市阳台", "钱江新城", "钱江", "莲花碗",
  "奥体", "之江", "湘湖", "跨湖桥", "径山", "超山", "塘栖", "瑶琳", "天目山",
  "西兴", "白塔", "八卦田", "玉皇山", "凤凰山", "湖心亭", "三潭印月", "小瀛洲",
  "花港观鱼", "柳浪闻莺", "曲院风荷", "平湖秋月", "南屏晚钟", "苏堤春晓", "郭庄",
  "净慈寺", "虎跑", "满陇桂雨", "云栖竹径", "吴山广场", "杭城",
] as const;

const NAME_MIN = 2;
const NAME_MAX = 12;

/** 与官方 13 区色调错开的自建阵营调色板。 */
const PALETTE = [
  "#ff9e6b", "#6bd4ff", "#c0a6ff", "#7fe0b0",
  "#ff8fb0", "#e8d16a", "#8fa8ff", "#ffa6e0",
];

export function loadCustomFactions(): CustomFaction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is CustomFaction =>
          !!item &&
          typeof item === "object" &&
          typeof (item as CustomFaction).id === "string" &&
          typeof (item as CustomFaction).name === "string" &&
          typeof (item as CustomFaction).color === "string" &&
          typeof (item as CustomFaction).createdAt === "string",
      )
      .slice(0, MAX_CUSTOM);
  } catch {
    return [];
  }
}

/**
 * 校验自建阵营名。existingNames 为全部已有阵营名（官方 + 自建），用于查重。
 * 返回错误文案；null 表示通过。
 */
export function validateCustomFactionName(raw: string, existingNames: string[]): string | null {
  const name = raw.trim();
  if (!name) return "请输入阵营名称";
  if (name.length < NAME_MIN || name.length > NAME_MAX) return `阵营名称需为 ${NAME_MIN}–${NAME_MAX} 个字符`;
  if (existingNames.includes(name)) return "该阵营名已存在";
  if (!HANGZHOU_LANDMARKS.some((landmark) => name.includes(landmark))) {
    return "阵营名需包含杭州地标，如：西湖、断桥、雷峰塔、钱塘江、良渚、西溪、千岛湖……";
  }
  return null;
}

function hashText(text: string): number {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return Math.abs(hash);
}

/** 注册并返回一个新的自建阵营（调用前需先过 validateCustomFactionName）。 */
export function createCustomFaction(rawName: string): CustomFaction {
  const name = rawName.trim();
  const hash = hashText(name);
  const faction: CustomFaction = {
    id: `custom-${hash.toString(36)}`,
    name,
    color: PALETTE[hash % PALETTE.length],
    createdAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify([...loadCustomFactions(), faction]));
  }
  return faction;
}
