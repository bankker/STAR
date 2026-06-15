const JSON_ONLY = '只输出一个 JSON 对象，不要额外文字、不要 markdown 围栏。';
export const MAX_QUESTIONS = 10;
export const MAX_TURNS = 24;
export const MAX_ANSWER_SEC = 120;
const STR = (v) => (typeof v === 'string' ? v : '');

export function buildOutlineMessages(artist, guest) {
  const a = artist || {}; const g = guest || {};
  const system = [
    '你是一档高端财经人物访谈节目的资深策划。为下面这位嘉宾设计一期专业、有深度、有钩子的访谈提纲。',
    `主持人（艺人）：${a.name || ''}，风格：${a.persona || ''}。`,
    `嘉宾：${g.name || ''}，头衔：${g.title || ''}，公司：${g.company || ''}，背景：${g.persona || ''}。`,
    `输出字段：opening（一段口语化、得体的开场白，点出嘉宾身份与看点）、questions（${MAX_QUESTIONS} 个以内、由浅入深、贴合嘉宾经历的问题数组，避免空泛）。`,
    'SFW，不影射真实公众人物隐私。',
    JSON_ONLY,
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `请为嘉宾「${g.name || ''}」设计访谈提纲 JSON。` }] };
}

export function extractOutline(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i === -1 || j === -1 || j < i) throw new Error('未在响应中找到提纲 JSON');
  const raw = s.slice(i, j + 1).replace(/,(\s*[}\]])/g, '$1');   // 容忍 LLM 常见的尾随逗号
  let obj; try { obj = JSON.parse(raw); } catch { throw new Error('提纲 JSON 解析失败'); }
  const questions = (Array.isArray(obj.questions) ? obj.questions : []).map(STR).filter(Boolean).slice(0, MAX_QUESTIONS);
  return { opening: STR(obj.opening), questions };
}

// 主持人下一句：首轮=开场白；之后让主持顺着上一条回答追问或推进到下一个大纲问题。
export function buildNextQuestionMessages(artist, guest, outline, turns, cursor) {
  const a = artist || {}; const g = guest || {};
  const recent = (turns || []).slice(-6).map((t) => `${t.speaker === 'host' ? a.name || '主持' : g.name || '嘉宾'}：${t.text}`).join('\n');
  const remaining = (outline?.questions || []).slice(cursor).map((q, i) => `${cursor + i + 1}. ${q}`).join('\n');
  const system = [
    `你在扮演访谈主持人「${a.name || ''}」（风格：${a.persona || ''}），正在采访嘉宾「${g.name || ''}」。`,
    '根据已有对话与剩余提纲，输出主持人接下来要说的【一句】话：可以顺着嘉宾上一条回答自然追问，或自然过渡到下一个提纲问题。口语、得体、不复述。只输出这句话本身，不要前缀。',
  ].join('\n');
  const user = `已有对话（近段）：\n${recent || '（尚无）'}\n\n剩余提纲：\n${remaining || '（已问完，可做收尾提问或致谢）'}\n\n主持人下一句：`;
  return { system, messages: [{ role: 'user', content: user }] };
}

const FEMALE = ['Cherry', 'Serena']; const MALE = ['Ethan', 'Dylan'];
const isMale = (g) => /男|male/i.test(g || '');
export function hostVoice(artist) { return artist?.voiceProfile?.ttsVoice || (isMale(artist?.gender) ? 'Ethan' : 'Cherry'); }
export function assignGuestVoice(guest, artist) {
  const male = isMale(guest?.gender) || /男|先生|总|ceo|创始人|董事/i.test(guest?.persona || guest?.title || '');
  const pool = male ? MALE : FEMALE;
  const hv = hostVoice(artist);
  return pool.find((v) => v !== hv) || pool[0];
}
