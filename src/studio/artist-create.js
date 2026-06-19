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
        ? transcript.map((m) => `${m.role === 'assistant' ? '企划' : '玩家'}：${m.content ?? ''}`).join('\n')
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
  try { return JSON.parse(s.slice(a, b + 1).replace(/,(\s*[}\]])/g, '$1')); }   // 容忍尾随逗号
  catch { throw new Error('响应中 JSON 解析失败'); }
}

// 把外形描述里的「否定子句」拆到负向提示词——图像模型无法理解「不要X」，写在正向里反而会画出 X（扇子等）。
// 否定子句（不要带扇子/没有刘海/去掉眼镜…）→ 提取被否定物（扇子/刘海/眼镜）进 negative；其余留在 positive。
const LOOK_NEG_RE = /^(?:不要|不想要|不带|不需要|不能|没有|别|去掉|去除|避免|拒绝|不出现|不可以|不准|不许|禁止|不再|no|without)\s*(?:再)?\s*(?:带|戴|有|出现|穿|拿|拿着|带着|包含|包括|配|附带)?\s*/i;
export function splitLook(text) {
  const t = (text || '').trim();
  const pos = [], neg = [];
  if (t) for (const raw of t.split(/[，,、。.;；\n]+/)) {
    const c = raw.trim(); if (!c) continue;
    if (LOOK_NEG_RE.test(c)) { const x = c.replace(LOOK_NEG_RE, '').trim(); if (x) neg.push(x); }
    else pos.push(c);
  }
  return { positive: pos.join('，'), negative: neg.join(', ') };
}

// 定妆照专用：强制头肩特写大头照（不出全身），背景虚化、棚拍布光
const PORTRAIT_QUALITY = '精致立体的五官，皮肤质感真实细腻有光泽，专业棚拍柔光布光，85mm 人像镜头浅景深、背景虚化，高级感氛围，电影级精修调色，超高清';
const PORTRAIT_FRAME = '头肩特写大头照，镜头只拍头部到肩膀的近距离正脸肖像，脸部居中占据画面主体，杂志封面式肖像构图';
// 返回 { prompt, negative }。opts.overrideLook 非空时，用它作为外形描述（覆盖档案 visualIdentity），放最前加强权重
export function buildPortraitPrompt(artist, stylePrompt, opts = {}) {
  const look = (opts.overrideLook || '').trim();
  if (look) {
    const lk = splitLook(look);
    const t = lk.positive || look;
    return { prompt: [`一位${t}的虚拟人物，外形特征严格按描述呈现：${t}`, PORTRAIT_FRAME, PORTRAIT_QUALITY, 'SFW'].join('，'), negative: lk.negative };
  }
  const vi = splitLook(artist.visualIdentity);
  const st = splitLook(stylePrompt);
  const base = vi.positive || `${artist.persona || ''} ${artist.positioning || ''} 虚拟艺人`.trim();
  return {
    prompt: [PORTRAIT_FRAME, base, st.positive, PORTRAIT_QUALITY, '虚拟人物，SFW'].filter(Boolean).join('，'),
    negative: [vi.negative, st.negative].filter(Boolean).join(', '),
  };
}

const SHOT_WORD = { 近景: '近景特写', 中景: '半身中景', 全景: '全身全景' };

// 美学/摄影质量后缀：精致五官 + 真实皮肤质感 + 专业布光 + 人像镜头 + 电影级调色，整体更耐看
const QUALITY_SUFFIX = '超高清写真大片，精致立体的五官，五官端正比例协调，干净通透的皮肤质感与自然细腻的光泽，专业棚拍柔光布光，85mm 人像镜头浅景深，高级感氛围，电影级精修调色，写实细节丰富';

// 返回 { prompt, negative }
export function buildPhotoPrompt(artist, opts = {}) {
  const vi = splitLook(artist?.visualIdentity);
  const st = splitLook(opts.stylePrompt);
  const base = vi.positive || `${artist?.persona || ''} ${artist?.positioning || ''} 虚拟艺人`.trim();
  const shot = SHOT_WORD[opts.shot] || opts.shot || '';
  return {
    prompt: [base, shot, st.positive, QUALITY_SUFFIX, '虚拟人物，SFW'].filter(Boolean).join('，'),
    negative: [vi.negative, st.negative].filter(Boolean).join(', '),
  };
}
