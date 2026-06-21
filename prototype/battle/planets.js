// 行星图鉴 · 星图节点用写实行星底图（schema + seed）
// 用途：scripts/gen-planets.mjs 批量生成（黑底）→ cutout 抠透明 → prototype/battle/planets/<scheme>.png
//       前端 ui.js 按 nodeScheme(node) 取图鉴行星；命中 manifest 用照片，否则回退 planetSVG。
const STYLE = '，单颗行星正面、居中且占满画面，纯黑色背景，无星空、无文字、无UI、无飞船、无外溢光晕，写实天文摄影质感，超高细节，清晰边缘';

export const PLANETS = [
  { scheme: 'earth', prompt: '一颗写实类地行星，蓝色海洋、绿色大陆、漩涡状白色云层与蔚蓝大气层' + STYLE },
  { scheme: 'mars', prompt: '一颗写实红色岩质行星，赭红与橙褐地表、撞击坑与峡谷，稀薄红色大气' + STYLE },
  { scheme: 'moon', prompt: '一颗写实灰色卫星，密布环形山的灰白岩石地表，无大气，冷峻' + STYLE },
  { scheme: 'gas', prompt: '一颗写实气态巨行星，橙金与赭色横向云带、巨大风暴红斑' + STYLE },
  { scheme: 'ice', prompt: '一颗写实冰雪行星，青白与浅蓝冰盖、纤薄淡蓝大气' + STYLE },
  { scheme: 'void', prompt: '一颗写实诡异行星，幽紫云带与暗黑紫色地表，神秘压抑' + STYLE },
];
export const PLANET_BY_SCHEME = Object.fromEntries(PLANETS.map((p) => [p.scheme, p]));
