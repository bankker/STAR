const FINALIZE_JSON = '只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码围栏。';

export function buildBlueprintMessages(artist, brief) {
  const a = artist || {};
  const system = [
    '你是一位专业作曲企划。根据艺人设定与创作诉求，产出一份"作曲蓝图"。',
    '蓝图需包含字段：title(歌名)、style(曲风，含 BPM/调式建议)、structure(分段，如 主歌/副歌/桥段)、lyrics(完整分段歌词，中文 5-350 字)、productionNotes(制作建议)。',
    FINALIZE_JSON,
  ].join('\n');
  const userContent = [
    `艺人：${a.name || ''}，人设：${a.persona || ''}，音乐风格倾向：${a.musicStyle || ''}，声线：${a.voiceProfile?.description || ''}。`,
    `创作诉求：${brief || '自由发挥，贴合艺人风格'}\n\n请输出作曲蓝图 JSON。`
  ].join('\n');
  return { system, messages: [{ role: 'user', content: userContent }] };
}

export function extractBlueprint(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('未在响应中找到 JSON');
  try { return JSON.parse(s.slice(a, b + 1)); }
  catch { throw new Error('蓝图 JSON 解析失败'); }
}

export function blueprintToRenderReq(blueprint, artist) {
  const bp = blueprint || {};
  const g = (artist?.gender || '').trim();
  const gender = g === '男' || /male/i.test(g) ? 'male' : (g === '女' || /female/i.test(g) ? 'female' : undefined);
  return {
    title: bp.title || '',
    lyrics: bp.lyrics || '',
    style: bp.style || artist?.musicStyle || '',
    gender,
  };
}
