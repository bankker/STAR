const JSON_ONLY = '只输出一个 JSON 对象，不要额外文字、不要 markdown 围栏。';

export function buildPlanMessages(artist, topic) {
  const a = artist || {};
  const system = [
    '你是一档人物访谈节目的策划。为下面这位虚拟艺人设计一期访谈企划。',
    `艺人：${a.name || ''}，人设：${a.persona || ''}，定位：${a.positioning || ''}，背景：${a.backstory || ''}。`,
    '企划含字段：guestProfile(嘉宾画像一段)、angle(切入角度)、questions(6-8 个有深度、贴合艺人的问题数组)。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `嘉宾：${a.name || ''}\n访谈主题：${topic || '围绕艺人的音乐与成长'}\n\n请输出访谈企划 JSON。` }] };
}

export function buildScriptMessages(artist, plan) {
  const a = artist || {};
  const qs = (plan?.questions || []).map((q, i) => `${i + 1}. ${q}`).join('\n');
  const system = [
    `你在写一档访谈节目的完整逐字稿，对话双方是"记者"和虚拟艺人"${a.name || ''}"。`,
    `艺人需全程 in-character（人设：${a.persona || ''}，说话风格贴合其背景：${a.backstory || ''}），回答有血肉、自然口语。`,
    '输出字段：dialogue —— 一个数组，每项 {speaker: "记者" 或艺人名, text: 一句话台词}，记者提问、艺人作答交替，约 10-16 轮。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `访谈问题：\n${qs || '自由发挥'}\n\n请输出完整对话 JSON。` }] };
}

export function extractDialogue(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('未在响应中找到对话 JSON');
  let obj; try { obj = JSON.parse(s.slice(a, b + 1)); } catch { throw new Error('对话 JSON 解析失败'); }
  const d = Array.isArray(obj.dialogue) ? obj.dialogue : (Array.isArray(obj) ? obj : null);
  if (!d || !d.length) throw new Error('对话为空');
  return d.filter((x) => x && x.text).map((x) => ({ speaker: String(x.speaker || '记者'), text: String(x.text) }));
}
