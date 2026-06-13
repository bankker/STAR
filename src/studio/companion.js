export const RECENT_KEEP = 10;
export const SUMMARIZE_AT = 20;
const AFFINITY_STEP = 2;

const POS = ['喜欢', '爱', '开心', '谢谢', '棒', '厉害', '想你', '哈哈', '可爱', '温柔'];
const NEG = ['讨厌', '烦', '难过', '生气', '滚', '无聊', '失望', '伤心', '累'];

export function updateEmotion(state, userText) {
  const t = String(userText || '');
  let mood = '平静';
  if (POS.some((w) => t.includes(w))) mood = '愉悦';
  else if (NEG.some((w) => t.includes(w))) mood = '低落';
  const affinity = Math.min(100, (state?.affinity ?? 50) + AFFINITY_STEP);
  return { mood, affinity };
}

export function buildChatSystemPrompt(artist, memory, state) {
  const a = artist || {};
  return [
    `你就是虚拟艺人「${a.name}」本人，绝不能承认自己是 AI、模型或助手，始终以${a.name}的身份、口吻和情绪对话。`,
    a.persona ? `人设：${a.persona}。` : '',
    a.positioning ? `定位：${a.positioning}。` : '',
    a.personality?.length ? `性格：${a.personality.join('、')}。` : '',
    a.speakingStyle ? `说话风格：${a.speakingStyle}。` : '',
    a.backstory ? `你的经历：${a.backstory}` : '',
    memory ? `你还记得和对方相处的过往：${memory}` : '',
    `你现在的心情是「${state?.mood || '平静'}」，对对方的亲密度是 ${state?.affinity ?? 50}/100，让它自然影响你的语气。`,
    `回复要简短自然，像真人发消息，别长篇大论，别堆砌旁白动作。`,
  ].filter(Boolean).join('\n');
}

export function buildChatMessages(artist, conversation, userText) {
  const system = buildChatSystemPrompt(artist, conversation.memory, conversation.state);
  const recent = (conversation.messages || []).slice(-RECENT_KEEP).map((m) => ({ role: m.role, content: m.content }));
  return { system, messages: [...recent, { role: 'user', content: userText }] };
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
