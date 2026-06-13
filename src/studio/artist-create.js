const INTERVIEW_SYSTEM = `你是一位资深的虚拟艺人企划（星探/经纪人）。你正在通过对话帮玩家"捏"出一个虚拟艺人。
规则：
- 一次只问一个问题，循序渐进了解：想要的气质与人设、性别、音乐与内容风格、外貌气质、艺名想法、背景设定偏好。
- 语气专业、有亲和力，像真正的星探。
- 不要罗列要点，不要输出 JSON 或档案；自然对话即可。
- 当你判断已收集到足够信息时，提示玩家"可以点【生成档案】了"，但不要自己输出档案内容。`;

const FINALIZE_SYSTEM = `你是虚拟艺人档案生成器。根据访谈记录，生成一个完整、真实可信的虚拟艺人档案。
访谈未覆盖的字段你要发挥专业判断自动补全，使艺人像一个真实存在的人——尤其 backstory 要有血肉、有细节。
全部内容必须 SFW、虚构人物，不得影射真实公众人物。
只输出一个 JSON 对象，不要任何额外文字，不要 markdown 代码围栏。字段：
{
  "name": "中文或中英艺名",
  "gender": "性别",
  "persona": "人设关键词，如 冷艳/元气/知性",
  "positioning": "定位，如 电子歌手",
  "backstory": "200字以内的成长经历/出身/转折，有真实感",
  "personality": ["性格特质", "..."],
  "coreAppeal": "核心吸引力一句话",
  "speakingStyle": "说话风格描述",
  "voiceProfile": { "description": "声线描述" },
  "visualIdentity": "外貌/造型/气质的视觉描述，用于图像生成",
  "musicStyle": "音乐风格倾向"
}`;

export function buildInterviewMessages(history) {
  const messages = Array.isArray(history) ? history : [];
  return { system: INTERVIEW_SYSTEM, messages };
}

export function buildFinalizeMessages(transcript) {
  const text = typeof transcript === 'string'
    ? transcript
    : (Array.isArray(transcript)
        ? transcript.map((m) => `${m.role === 'assistant' ? '企划' : '玩家'}：${m.content}`).join('\n')
        : '');
  return {
    system: FINALIZE_SYSTEM,
    messages: [{ role: 'user', content: `访谈记录：\n${text}\n\n请只输出档案 JSON。` }],
  };
}

export function extractProfileJson(text) {
  if (typeof text !== 'string') throw new Error('无文本可解析');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('未在响应中找到 JSON');
  return JSON.parse(s.slice(a, b + 1));
}

export function buildPortraitPrompt(artist, stylePrompt) {
  const base = (artist.visualIdentity || '').trim()
    || `${artist.persona || ''} ${artist.positioning || ''} 虚拟艺人`.trim();
  const style = (stylePrompt || '').trim();
  return [base, style, '高质量定妆照，人像特写，虚拟人物，SFW'].filter(Boolean).join('，');
}
