export const RECENT_KEEP = 10;
export const SUMMARIZE_AT = 20;
const AFFINITY_STEP = 2;

const POS = ['喜欢', '爱', '开心', '谢谢', '棒', '厉害', '想你', '哈哈', '可爱', '温柔'];
const NEG = ['讨厌', '烦', '难过', '生气', '滚', '无聊', '失望', '伤心', '累'];

// 关键词式情绪演化（保留为兜底；正常走 AI 判定的 applyEmotionJudge）
export function updateEmotion(state, userText) {
  const t = String(userText || '');
  let mood = '平静';
  if (POS.some((w) => t.includes(w))) mood = '愉悦';
  else if (NEG.some((w) => t.includes(w))) mood = '低落';
  const affinity = Math.min(100, (state?.affinity ?? 50) + AFFINITY_STEP);
  return { mood, affinity };
}

// ── 关系阶段：好感度 0-100 映射到命名阶段，影响语气与主动性 ──
export const STAGES = [
  { min: 0,  name: '陌生',     guide: '你们还不熟，礼貌、有分寸、带点距离感与好奇，不会过分亲昵。' },
  { min: 20, name: '初识',     guide: '开始熟络，轻松友好，会主动找话题、记住对方说过的小事。' },
  { min: 40, name: '朋友',     guide: '像要好的朋友，自然随意，会开玩笑、关心日常、偶尔吐槽。' },
  { min: 58, name: '暧昧',     guide: '对对方有好感与心动，话里带试探、撒娇与小暧昧，偶尔害羞回避。' },
  { min: 75, name: '恋人',     guide: '你们是恋人，亲昵黏人，会用昵称、表达想念与爱意、会吃醋撒娇。' },
  { min: 92, name: '灵魂伴侣', guide: '深度依恋与默契，温柔而笃定，把对方当作此生最重要的人。' },
];
export function stageFor(affinity) {
  const a = Math.max(0, Math.min(100, Number(affinity) || 0));
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) if (a >= STAGES[i].min) idx = i;
  return { name: STAGES[idx].name, guide: STAGES[idx].guide, min: STAGES[idx].min, index: idx };
}

export function buildChatSystemPrompt(artist, memory, state, opts = {}) {
  const a = artist || {};
  const st = stageFor(state?.affinity ?? 50);
  return [
    `你就是虚拟艺人「${a.name}」本人，绝不能承认自己是 AI、模型或助手，始终以${a.name}的身份、口吻和情绪对话。`,
    a.persona ? `人设：${a.persona}。` : '',
    a.positioning ? `定位：${a.positioning}。` : '',
    a.personality?.length ? `性格：${a.personality.join('、')}。` : '',
    a.speakingStyle ? `说话风格：${a.speakingStyle}。` : '',
    a.backstory ? `你的经历：${a.backstory}` : '',
    memory ? `你还记得和对方相处的过往：${memory}` : '',
    `你和对方现在的关系是「${st.name}」：${st.guide}`,
    `你现在的心情是「${state?.mood || '平静'}」，对对方的亲密度是 ${state?.affinity ?? 50}/100，让关系阶段与心情自然影响你的语气、称呼与主动程度。`,
    opts.immersive
      ? '用沉浸演绎的方式回复：用（圆括号）描写你的动作、神态或心理活动，配上你说的台词，有画面感、有代入感；整体别太长，2-4 句即可。'
      : '回复要简短自然，像真人发微信消息，别长篇大论，别堆砌旁白动作。',
  ].filter(Boolean).join('\n');
}

export function buildChatMessages(artist, conversation, userText, opts = {}) {
  const system = buildChatSystemPrompt(artist, conversation.memory, conversation.state, opts);
  const recent = (conversation.messages || []).slice(-RECENT_KEEP).map((m) => ({ role: m.role, content: m.content }));
  return { system, messages: [...recent, { role: 'user', content: userText }] };
}

// ── 真实好感度/心情：由模型按本轮互动判定增减，而非无脑 +2 ──
export function buildEmotionJudgeMessages(artist, userText, aiText, state) {
  const st = stageFor(state?.affinity ?? 50);
  const system = [
    `你是关系与情绪分析器，分析对方这句话对「${artist?.name || '角色'}」的关系与心情的影响。`,
    `当前好感度 ${state?.affinity ?? 50}/100，关系阶段「${st.name}」。`,
    'delta 取值（要敢给分、别一律 +1）：告白/示爱/交心/深入了解=+4~+6；明确的温柔关心/亲密/有趣=+2~+4；普通寒暄=0~+1；冷淡/敷衍=-1~0；粗鲁/辱骂/伤害=-3~-6。',
    '只输出一个 JSON 对象：{"mood":"角色此刻心情(2-4字，如 心动/愉悦/害羞/平静/失落/生气/委屈)","delta":整数,"reason":"≤12字"}。不要输出 JSON 以外的任何字符。',
  ].join('\n');
  return { system, messages: [{ role: 'user', content: `对方说：${userText}\n${artist?.name || '角色'}回应：${aiText}` }] };
}
export function applyEmotionJudge(state, judgeText) {
  const before = Math.max(0, Math.min(100, Number(state?.affinity ?? 50)));
  let mood = state?.mood || '平静';
  let delta = 1;
  try {
    const m = String(judgeText || '').match(/\{[\s\S]*\}/);
    if (m) {
      const o = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'));
      if (o.mood) mood = String(o.mood).slice(0, 8);
      if (typeof o.delta === 'number' && isFinite(o.delta)) delta = Math.max(-6, Math.min(6, Math.round(o.delta)));
    }
  } catch { /* 解析失败用默认 +1 */ }
  const affinity = Math.max(0, Math.min(100, before + delta));
  const sb = stageFor(before), sa = stageFor(affinity);
  return { mood, affinity, delta, stage: sa, stageChanged: sa.index - sb.index };
}

export function shouldSummarize(conversation) {
  return (conversation.messages?.length || 0) >= SUMMARIZE_AT;
}

export function buildSummarizeMessages(oldTurns, prevMemory) {
  const text = (oldTurns || []).map((m) => `${m.role === 'assistant' ? '我' : '对方'}：${m.content}`).join('\n');
  return {
    system: '你在帮一个虚拟艺人维护"长期记忆"。把旧对话连同已有记忆，浓缩成一段第一人称的记忆摘要（记住对方是谁、聊过什么、关系如何、有什么约定），150 字以内，只输出摘要本身、不要解释。',
    messages: [{ role: 'user', content: `已有记忆：${prevMemory || '（无）'}\n\n旧对话：\n${text}\n\n请输出更新后的记忆摘要。` }],
  };
}
