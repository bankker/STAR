// 短剧纯函数：脚本提示词/解析、配音分配、成本估算。无 I/O。
const JSON_ONLY = '只输出一个 JSON 对象，不要额外文字、不要 markdown 围栏。';
export const MAX_CAST = 3;
export const MAX_SCENES = 8;
export const MAX_LINES_PER_SCENE = 6;
export const MAX_LINE_CHARS = 200;
export const MAX_EPISODES = 6;
const I2V_USD_PER_SCENE = 0.5;   // 万相 i2v 单镜量级（与 costs.js i2v perSecond=0.1 × 5s 对齐）

const STR = (v) => (typeof v === 'string' ? v : '');

export function buildScriptMessages(artist, brief) {
  const a = artist || {};
  const b = brief || {};
  const system = [
    '你是竖屏短剧的编剧。主演是下面这位虚拟艺人，请创作分集短剧剧本，并设计需要的配角。',
    `主演：${a.name || ''}，性别：${a.gender || ''}，人设：${a.persona || ''}，外观：${a.visualIdentity || ''}，背景：${a.backstory || ''}。`,
    `题材：${b.theme || '都市悬疑'}；集数：${Math.min(b.episodeCount || 1, MAX_EPISODES)}；单集时长约 ${b.durationSec || 90} 秒。`,
    '输出字段：',
    `- cast：配角数组（不含主演，≤${MAX_CAST} 个），每项 {name, role(角色定位), appearance(外观一句), gender}。`,
    `- episodes：分集数组，每项 {title, scenes}；scenes ≤${MAX_SCENES} 个，每项 {setting(镜头/场景), action(动作情绪), characters(出镜角色名数组), lines}；lines ≤${MAX_LINES_PER_SCENE} 句，每句 {character(说话角色名或"旁白"), text(≤${MAX_LINE_CHARS}字), emotion}。`,
    '题材 SFW，不得影射真实公众人物。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `请为主演「${a.name || ''}」创作短剧剧本 JSON。` }] };
}

// artist 预留参数：后续用于把台词 character 归一到主演名（暂未启用，签名稳定供端点调用）。
export function extractScript(text, artist) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i === -1 || j === -1 || j < i) throw new Error('未在响应中找到剧本 JSON');
  let obj; try { obj = JSON.parse(s.slice(i, j + 1)); } catch { throw new Error('剧本 JSON 解析失败'); }
  const cast = (Array.isArray(obj.cast) ? obj.cast : []).slice(0, MAX_CAST).map((c, k) => ({
    name: STR(c.name) || `配角${k + 1}`, role: STR(c.role), appearance: STR(c.appearance), gender: STR(c.gender),
  }));
  const eps = (Array.isArray(obj.episodes) ? obj.episodes : []).slice(0, MAX_EPISODES).map((e, ei) => ({
    title: STR(e.title) || `第${ei + 1}集`,
    scenes: (Array.isArray(e.scenes) ? e.scenes : []).slice(0, MAX_SCENES).map((sc) => ({
      setting: STR(sc.setting), action: STR(sc.action),
      characters: Array.isArray(sc.characters) ? sc.characters.map(STR).filter(Boolean) : [],
      lines: (Array.isArray(sc.lines) ? sc.lines : []).slice(0, MAX_LINES_PER_SCENE).map((l) => ({
        character: STR(l.character) || '旁白', text: STR(l.text).slice(0, MAX_LINE_CHARS), emotion: STR(l.emotion),
      })).filter((l) => l.text),
    })).filter((sc) => sc.lines.length),
  })).filter((e) => e.scenes.length);
  if (!eps.length) throw new Error('剧本无有效场景');
  return { cast, episodes: eps };
}

export function buildCastPortraitPrompt(castMember) {
  const c = castMember || {};
  return `角色定妆照，竖屏半身，${c.appearance || ''}，${c.role || ''}，电影感打光，干净背景，SFW`;
}

export function buildScenePrompt(artist, scene, cast, consistencyMode) {
  const a = artist || {};
  const names = (scene.characters || []);
  const looks = names.map((n) => {
    // 旁白为画外音不出镜（返回空被下方 filter 丢弃）；主演带一致性包外观，配角带其人设外观。
    if (n === a.name || n === '旁白') return a.name === n ? `${a.name}（${a.visualIdentity || ''}）` : '';
    const m = (cast || []).find((c) => c.name === n);
    return m ? `${m.name}（${m.appearance || ''}）` : n;
  }).filter(Boolean).join('，');
  const tag = consistencyMode === 'image_ref' ? '' : '，保持人物外观一致';
  return `竖屏电影分镜：${scene.setting || ''}；${scene.action || ''}；出镜：${looks}${tag}；9:16，电影级打光，SFW`;
}

export function buildI2vPrompt(scene) {
  return `${scene.action || ''}；自然运镜，轻微镜头推移，写实`.trim();
}

const FEMALE_VOICES = ['Cherry', 'Serena'];
const MALE_VOICES = ['Ethan', 'Dylan'];
const isMale = (g) => /男|male/i.test(g || '');

export function assignVoices(cast, artist) {
  const map = {};
  let fi = 0; let mi = 0;
  for (const c of cast || []) {
    const g = c.isLead ? (artist?.gender || c.gender) : c.gender;
    map[c.id] = isMale(g) ? MALE_VOICES[mi++ % MALE_VOICES.length] : FEMALE_VOICES[fi++ % FEMALE_VOICES.length];
  }
  map.__narrator = 'Chelsie';   // 旁白固定
  return map;
}

export function estimateEpisodeCost(episode, tier) {
  const n = (episode?.scenes || []).length;
  return tier === 'high' ? +(n * I2V_USD_PER_SCENE).toFixed(2) : 0;
}
