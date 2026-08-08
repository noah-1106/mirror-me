import { Router } from 'express';
import { getLLMClient, model } from '../services/kimi';

const router = Router();

const BASINS = ['self', 'other', 'avoid'] as const;
const DIMENSIONS = ['energy', 'relation', 'confidence', 'stress', 'curiosity'] as const;

const SYSTEM = `你是儿童对话的打标器。给孩子刚说的一句话打两个标签，只输出 JSON，不要任何解释：

1. basin（这句话的驱动来自哪里）：
   - "self"：他自己拿主意、表达自己的意愿或感受
   - "other"：为别人的期待/评价而做选择（爸妈、老师、同学、大家）
   - "avoid"：回避、敷衍、没有实质内容

2. dimensions（这句话触及的心理维度，1-2 个）：
   energy（精力/做事劲头）、relation（关系/同伴家人）、confidence（自信/自我评价）、stress（压力/焦虑）、curiosity（好奇/探索欲）

输出格式（严格遵守）：{"basin":"self","dimensions":["confidence"]}`;

export interface TagResult {
  basin: (typeof BASINS)[number];
  dimensions: string[];
}

/** LLM 打标：失败返回 null，调用方回落到正则启发式 */
export async function tagTurn(transcript: string): Promise<TagResult | null> {
  const client = getLLMClient();
  if (!client) return null;

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: transcript.slice(0, 300) },
      ],
      max_tokens: 2000, // 推理模型先烧 token 思考（长 system prompt 会思考更久），给足余量
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });
    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw);
    const basin = BASINS.find((b) => b === parsed.basin);
    if (!basin) return null;
    const dimensions = (Array.isArray(parsed.dimensions) ? (parsed.dimensions as unknown[]) : [])
      .filter((d): d is string => typeof d === 'string')
      .filter((d) => (DIMENSIONS as readonly string[]).includes(d))
      .slice(0, 2);
    return { basin, dimensions: dimensions.length ? dimensions : [basin] };
  } catch {
    return null;
  }
}

router.post('/', async (req, res) => {
  const { transcript } = req.body ?? {};
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'transcript required' });
  }
  const tag = await tagTurn(transcript);
  res.json({ tag });
});

export default router;
