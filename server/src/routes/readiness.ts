import { Router } from 'express';
import { getLLMClient, model } from '../services/kimi';

const router = Router();

const SYSTEM = `你是"故事充分度"的裁判。一个孩子对一棵树讲了自己的若干片段，只有当收集到的故事足够撑起一场"与未来的自己对话"时，才允许开门。

判据（必须全部满足才 ready）：
1. 具体性：至少有 2 个具体的事件或场景，不是空泛的情绪词
2. 自我暴露：孩子谈到了自己真实的在意、矛盾或渴望
3. 多样性：故事触及至少 2 个不同的生活面（如学业/关系/家庭/爱好）

只输出 JSON：{"ready":true,"reason":"一句话理由"}
拿不准就 ready:false——宁可让孩子多讲一轮。`;

/** LLM + 引擎统计共同判定故事充分度：失败返回 null，调用方按引擎规则兜底 */
export async function judgeReadiness(input: {
  history: string[];
  convergeCount: number;
  delta: number;
  selfReferRate: number;
}): Promise<{ ready: boolean; reason: string } | null> {
  const client = getLLMClient();
  if (!client) return null;

  const stories = input.history
    .slice(-12)
    .map((h, i) => `${i + 1}. ${h}`)
    .join('\n');

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `孩子讲过的片段：\n${stories}\n\n（引擎状态：已收敛 ${input.convergeCount} 次，不了解度剩 ${Math.round(input.delta * 100)}%，自我驱动占 ${Math.round(input.selfReferRate * 100)}%）`,
        },
      ],
      max_tokens: 2000, // 推理模型先烧 token 思考（长 system prompt 会思考更久），给足余量
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '');
    return {
      ready: parsed.ready === true,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 100) : '',
    };
  } catch {
    return null;
  }
}

router.post('/', async (req, res) => {
  const { history, convergeCount, delta, selfReferRate } = req.body ?? {};
  const result = await judgeReadiness({
    history: Array.isArray(history) ? history.map(String).slice(0, 20) : [],
    convergeCount: typeof convergeCount === 'number' ? convergeCount : 0,
    delta: typeof delta === 'number' ? delta : 1,
    selfReferRate: typeof selfReferRate === 'number' ? selfReferRate : 0.5,
  });
  res.json({ result });
});

export default router;
