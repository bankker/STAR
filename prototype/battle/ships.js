// 星舰图鉴 · 我方/敌方星舰数据库（schema + seed）
// 用途：① scripts/gen-ships.mjs 批量预生成写实底图 → prototype/battle/ships/<id>.png + manifest.json
//       ② 前端 ui.js 按敌人名/阵营查图鉴取底图（命中 manifest 则用照片，否则回退 SVG）
// 约定：侧舷全身、深空背景、统一画风后缀，便于同屏一致；16:9 宽幅。

const STYLE = '，侧舷全身视角，深邃太空星海背景，电影级体积光，超高细节，硬核工业科幻，无文字、无UI、无水印、无人物';

export const SHIPS = [
  // —— 我方 ——
  { id: 'ally-flagship', side: 'ally', name: '奥德赛号', faction: '联合舰队', aspect: '16:9',
    prompt: '一艘写实科幻英雄主力巡洋舰，流线型青蓝色装甲，明亮的等离子引擎尾焰，舰桥与炮塔分明，威武而优雅' + STYLE },
  { id: 'ally-escort', side: 'ally', name: '护卫驱逐舰', faction: '联合舰队', aspect: '16:9',
    prompt: '一艘写实科幻护卫驱逐舰，青蓝涂装，灵巧轻装，发光推进器' + STYLE },

  // —— 敌方（按阵营区分视觉识别）——
  { id: 'enemy-empire', side: 'enemy', name: '帝国巡防舰', faction: '帝国', aspect: '16:9',
    prompt: '一艘写实科幻帝国战舰，灰白厚重装甲与暗红徽记，棱角分明，威严肃杀的军国气质' + STYLE },
  { id: 'enemy-raider', side: 'enemy', name: '掠夺者突击舰', faction: '掠夺者', aspect: '16:9',
    prompt: '一艘写实科幻海盗突击舰，锈蚀拼接的杂色装甲、外露武器与尖刺，橙黄警示涂装，凶悍粗野' + STYLE },
  { id: 'enemy-void', side: 'enemy', name: '虚空截击舰', faction: '虚空教团', aspect: '16:9',
    prompt: '一艘写实科幻异形战舰，紫黑几何装甲与幽紫能量纹路，诡异不对称，散发神秘威压' + STYLE },
  { id: 'enemy-drone', side: 'enemy', name: '废弃无人机母舰', faction: '中立残骸', aspect: '16:9',
    prompt: '一艘写实科幻废弃无人机控制舰，破损斑驳的灰暗船体、零星残存灯光，荒废冷峻' + STYLE },
  { id: 'enemy-boss', side: 'enemy', name: '帝国旗舰', faction: '帝国', boss: true, aspect: '16:9',
    prompt: '一艘巨型写实科幻旗舰母舰，密布炮塔与厚重多层装甲，中央巨大的紫色能量核心发光，极致压迫威严' + STYLE },
];

export const SHIP_BY_ID = Object.fromEntries(SHIPS.map((s) => [s.id, s]));
export const ALLY_FLAGSHIP_ID = 'ally-flagship';

// 敌人 → 图鉴 id（按 boss 标记 + 名称/阵营关键词，无需引擎改动）
export function enemyShipId(enemy = {}) {
  const name = enemy.name || '';
  const boss = enemy.isBoss || (enemy.maxHp || 0) >= 60 || /旗舰|母舰|boss|涅墨西斯|列日/i.test(name);
  if (boss) return 'enemy-boss';
  const f = enemy.fac || '';
  if (f === 'raider' || /掠夺|海盗|劫掠/.test(name)) return 'enemy-raider';
  if (f === 'void' || /虚空|截击|湮灭|教团/.test(name)) return 'enemy-void';
  if (f === 'neutral' || /无人机|废弃|残骸/.test(name)) return 'enemy-drone';
  return 'enemy-empire';
}
