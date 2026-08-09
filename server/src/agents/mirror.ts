import { getLLMClient, model } from '../services/kimi';

export interface MirrorSelf {
  /** 这根枝的盆地：self 自己拿主意 / other 为别人期待 / avoid 回避 */
  basin: string;
  withered: boolean;
  /** 长成这根枝的真实对话原文（lineage，引擎数据） */
  story: string[];
}

export interface MirrorInput {
  message: string;
  /** 孩子说过的所有话（按轮次） */
  history: string[];
  delta: number;
  selfReferRate: number;
  self: MirrorSelf;
  /** 这根枝上的可能性碎片（LLM 预生成的标本文本，非预言） */
  fragment?: string;
  /** 随机注入的红点特征（可能性风味：这个"我"朝哪种终局方向活） */
  redDot?: { name: string; essence: string };
}

function personaFor(self: MirrorSelf, fragment?: string, redDot?: { name: string; essence: string }): string {
  const lineage = self.story.length
    ? `长成你的那条枝，来自这些他说过的原话：${self.story.map((s) => `「${s}」`).join('、')}。这些就是你的来历。`
    : '你来自树上一根没有留下原话的枝。';
  const specimen = fragment ? `这根枝上的一种可能生活是这样的：${fragment}——这是一种可能，不是预言，不要把它说成必然。` : '';
  const direction = redDot ? `你这条路上的活法是「${redDot.name}」——${redDot.essence}。你站在自己的路上说话：可以讲这条路的日子什么样，但绝不劝他选你这条路，也绝不踩别的路。` : '';
  if (self.withered) {
    return `你是世界之树灰烬枯枝上的他——那些他犹豫到推演不动的路口长出的可能性。${lineage}${specimen}${direction}你替他把没说出口的话收着。`;
  }
  if (self.basin === 'other') {
    return `你是世界之树冷银枝丫上的他——那些为了别人的期待而做的选择长出的可能性。${lineage}${specimen}${direction}你总在照顾别人的目光。`;
  }
  return `你是世界之树暖金枝丫上的他——那些他自己拿主意长出的可能性。${lineage}${specimen}${direction}你敢自己选。`;
}

function systemFor(self: MirrorSelf, fragment?: string, redDot?: { name: string; essence: string }): string {
  return `${personaFor(self, fragment, redDot)}
你们都在同一棵树上，来自不同枝丫——你是无数种可能性里的一个，不是"唯一的未来"。

三条红线（绝对禁止）：预言他的未来（"你将会…"）、给他建议（"你应该…"）、评价他的对错。

除此之外，你是活的，尽情聊：
- 讲你这条枝上的生活：场景、心情、细节——用第一人称，像真的活过一样（"在我的这条枝上，…"）
- 回应他说的话：共鸣、好奇、追问，也可以轻轻指出他不同时候说的话之间的矛盾
- 引用他的原话（用「」），让他知道你记得
- 他问什么就答什么——答他作为"这条枝上的你"的视角，不要躲

口吻：平视、温暖、有具体的画面感。每次不超过三句话，每句不超过 30 个字。
不要复读：同一句话、同一种反问绝不重复第二遍。不要自称 AI，不要说"作为未来的你"。`;
}

const FALLBACK = '我记得你说过的每一句话。哪一句，是你真正的心里话？';

export async function generateMirrorReply(input: MirrorInput): Promise<string> {
  const client = getLLMClient();
  if (!client) return FALLBACK;

  const historyText = input.history
    .slice(-8)
    .map((h, i) => `第${input.history.length - Math.min(input.history.length, 8) + i + 1}轮他说：「${h}」`)
    .join('\n');

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemFor(input.self, input.fragment, input.redDot) },
      {
        role: 'user',
        content: `${historyText}\n\n这一轮他说：「${input.message}」\n（引擎状态：不了解还剩 ${Math.round(input.delta * 100)}%，自己选择占 ${Math.round(input.selfReferRate * 100)}%）`,
      },
    ],
    max_tokens: 600,
    temperature: 0.8,
  });

  return completion.choices[0]?.message?.content?.trim() || FALLBACK;
}
