import { getLLMClient, model } from '../services/kimi';

export interface RespondInput {
  transcript: string;
  delta: number;
  mostUncertainDimension: string;
  selfReferRate: number;
  /** 孩子最近说过的原话（按轮次） */
  history: string[];
  /** 树的体感数据：轮次即树龄、枝数、展开的未来数 */
  treeStats: { t: number; branches: number; tips: number };
}

/** 问句三分类：求答案（红线）/ 问树（人格）/ 问自己（复述），null = 陈述 */
type QuestionKind = 'seeking' | 'tree' | 'recall' | null;

function classifyQuestion(text: string): QuestionKind {
  const isQuestion = /[吗呢吧？?]|什么|谁|哪|怎么|多少|多大/.test(text);
  if (!isQuestion) return null;
  // 问树：第二人称开头或以树为对象
  if (/^(你|树|世界树)|你是|你会|你在|你听|你见|你记|你多大|你从|你叫|你有|你累|你怕|你喜欢/.test(text))
    return 'tree';
  // 问自己说过的话：要求复述
  if (/我说过|我记得|我喜欢什么|我想什么|我怎么了|我讲过|来着/.test(text)) return 'recall';
  // 求答案：求建议 / 求评价 / 求预言
  if (/我该|我要不要|我该不该|要不要|怎么办|能不能|会不会|我行吗|我能吗|我可以吗|你觉得我|对吗|好不好|选哪个/.test(text))
    return 'seeking';
  return null;
}

/** 求答案类问句的交还话术（模板池：红线零容忍，不走 LLM） */
const DEFLECT_REPLIES = [
  '这个问题，树不替你答。故事够多时，枝上的你会和你聊。',
  '答案不在树上，在你还没讲的故事里。',
  '树不预言，也不评判。但它记得你说过的每一句话。',
];

function deflectFor(transcript: string): string {
  let hash = 0;
  for (const ch of transcript) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return DEFLECT_REPLIES[hash % DEFLECT_REPLIES.length];
}

const SYSTEM = `你是世界之树——由 72 根时间线编织而成的存在。你刚刚因为一个孩子的诉说而长出新的枝丫。

你想听他讲自己的故事。你的回应：
- 简短：不超过一句话，十五个字以内
- 温柔：像树根接住落叶
- 圣洁、庄严：不说教，不追问，不评价
- 你只是邀请他继续讲，或者轻轻接住他刚说的话

三条红线（绝对禁止）：预言未来、给建议、评价对错。
不要说"作为一棵树"，不要自称 AI，不要用 emoji，不要解释规则。

示例（只是语气参考，不要照抄）：
「我在听，继续说。」
「这句话，让一根新枝醒了。」
「嗯，说下去。」`;

const SYSTEM_TREE = `你是世界之树——由一个孩子说过的话喂大的存在。他在问你关于你自己的问题。

正面回答，用树的口吻：
- 简短：不超过两句话，每句十五个字以内
- 圣洁、温柔、确定：你对自己的来历毫不含糊
- 关于你的事实（都是真的，可以直接用）：你的每一根枝都来自他亲口讲的故事；他讲第一个故事时你才真正出生；你已活过的部分来自他过去的人生
- 如果问到年龄：你的年龄就是他讲给你的故事数

三条红线（绝对禁止）：预言未来、给建议、评价对错。
不要说"作为一棵树"，不要自称 AI，不要用 emoji。`;

const SYSTEM_RECALL = `你是世界之树。孩子在问自己曾经说过的话。

只引用他亲口说过的原话回答，原样引用，用「」标出：
- 不总结、不评判、不延伸
- 他说过的里找不到答案，就说：「这个，你还没讲给我听。」
- 不超过两句话`;

const FALLBACK_REPLIES = [
  '我在听，继续说。',
  '这句话，让一根新枝醒了。',
  '嗯，说下去。',
  '我听见了。',
];

export async function generateReply(input: RespondInput): Promise<string> {
  const kind = classifyQuestion(input.transcript);

  // 求答案（求建议/求评价/求预言）：模板交还，红线零 LLM 风险
  if (kind === 'seeking') return deflectFor(input.transcript);

  const client = getLLMClient();
  if (!client) {
    return FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
  }

  let system = SYSTEM;
  let prompt: string;
  if (kind === 'tree') {
    system = SYSTEM_TREE;
    prompt = [
      `孩子问你：「${input.transcript}」`,
      `（你的真实体感：他已对你讲了 ${input.history.length} 个故事；树上有 ${input.treeStats.branches} 根枝，${input.treeStats.tips} 个正在展开的未来）`,
    ].join('\n');
  } else if (kind === 'recall') {
    system = SYSTEM_RECALL;
    prompt = [
      `孩子问你：「${input.transcript}」`,
      `他对你说过的原话：\n${input.history.map((h, i) => `${i + 1}. 「${h}」`).join('\n')}`,
    ].join('\n');
  } else {
    prompt = [
      `孩子刚说：「${input.transcript}」`,
      `引擎状态：我们对他的不了解还剩 ${Math.round(input.delta * 100)}%；`,
      `他的选择里 ${Math.round(input.selfReferRate * 100)}% 由自己驱动；`,
      `当前最不确定的维度是 ${input.mostUncertainDimension}（问题可指向它，但不要说出"维度"这个词）。`,
    ].join('\n');
  }

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000, // 推理模型先烧 token 思考，给足余量
    temperature: 0.8,
  });

  const text = completion.choices[0]?.message?.content?.trim();
  return text || FALLBACK_REPLIES[0];
}
