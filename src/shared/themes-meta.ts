/** Lightweight theme metadata shared by the settings grid and the overlay.
 *  (The heavy animation/sound logic lives in src/overlay/themes.) */

export interface ThemeMeta {
  id: string;
  name: string; // 中文名
  category: string; // 风格标签
  /** Two colors for the settings card swatch gradient. */
  swatch: [string, string];
  /** Short flavour text. */
  blurb: string;
  /** Lazy-loaded preview artwork shown in the animation library. */
  preview: string;
}

export const THEME_META: ThemeMeta[] = [
  {
    id: "cyberpunk",
    name: "赛博朋克",
    category: "Cyberpunk",
    swatch: ["#ff2e9a", "#15e1ff"],
    blurb: "霓虹故障 · 数字雨",
    preview: "/themes/cyberpunk.webp",
  },
  {
    id: "tech",
    name: "科技 HUD",
    category: "Sci-Fi",
    swatch: ["#16e0ff", "#1666ff"],
    blurb: "全息环 · 扫描线",
    preview: "/themes/tech.webp",
  },
  {
    id: "wuxia",
    name: "武侠",
    category: "Martial Arts",
    swatch: ["#e8b84b", "#b3151b"],
    blurb: "剑气 · 泼墨 · 金书",
    preview: "/themes/wuxia.webp",
  },
  {
    id: "ink",
    name: "水墨",
    category: "Ink Wash",
    swatch: ["#2b2b2b", "#9aa0a6"],
    blurb: "宣纸 · 飞白 · 墨点",
    preview: "/themes/ink.webp",
  },
  {
    id: "cartoon",
    name: "卡通",
    category: "Cartoon",
    swatch: ["#ff5d8f", "#ffd23f"],
    blurb: "弹跳 · 漫画爆点",
    preview: "/themes/cartoon.webp",
  },
  {
    id: "flame",
    name: "烈焰",
    category: "Fire",
    swatch: ["#ff7b00", "#ff2e2e"],
    blurb: "火星 · 热浪 · 爆燃",
    preview: "/themes/flame.webp",
  },
  {
    id: "lowhp",
    name: "红色警报",
    category: "Alert",
    swatch: ["#ff1a1a", "#4a0000"],
    blurb: "低血量 · 呼吸红晕 · 心跳",
    preview: "/themes/lowhp.webp",
  },
  {
    id: "frost",
    name: "冰霜",
    category: "Ice",
    swatch: ["#bfeaff", "#3aa0ff"],
    blurb: "冰晶 · 飘雪 · 碎裂",
    preview: "/themes/frost.webp",
  },
  {
    id: "galaxy",
    name: "星空",
    category: "Cosmic",
    swatch: ["#7b5cff", "#1a1040"],
    blurb: "星海 · 曲速 · 星云",
    preview: "/themes/galaxy.webp",
  },
  {
    id: "retro",
    name: "复古街机",
    category: "Retro",
    swatch: ["#39ff14", "#0b3d0b"],
    blurb: "CRT · 像素 · 8-bit",
    preview: "/themes/retro.webp",
  },
  {
    id: "gold",
    name: "黄金庆典",
    category: "Celebration",
    swatch: ["#ffd700", "#ff8c00"],
    blurb: "金箔 · 烟花 · 礼花",
    preview: "/themes/gold.webp",
  },
  {
    id: "smoke",
    name: "烟雾",
    category: "Realistic Smoke",
    swatch: ["#c9ced8", "#5b606c"],
    blurb: "顶部喷涌 · 写实 · 渐散",
    preview: "/themes/smoke.webp",
  },
];

export function themeName(id: string): string {
  return THEME_META.find((t) => t.id === id)?.name ?? id;
}
