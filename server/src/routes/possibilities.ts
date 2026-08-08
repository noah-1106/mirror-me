import { Router } from 'express';
import { getLLMClient, model } from '../services/kimi';

const router = Router();

const BASINS = ['self', 'other', 'avoid'] as const;

export interface Possibility {
  label: string;
  basin: (typeof BASINS)[number];
  /** 孩子的话对这个方向的支撑强度 0-1 */
  strength: number;
}

const SYSTEM = `你是"可能性析取器"。孩子刚对世界之树说了一句话。从这句话和他最近的故事里，析出这句话真正包含的可能性方向——每个方向都将长成树上的一根新枝。

判据：
- 每个方向必须在孩子的话里有真实依据，不发明他没说的
- 方向之间要真的不同（动机/路径/对象不同），不是同一方向换个说法
- 每个方向给出：label（4-8 字，如"自己争取"）、basin（self=自己拿主意 / other=为别人期待 / avoid=回避）、strength（0-1，孩子的话对这个方向的支撑强度）
- 这句话单薄（敷衍/回避/没有实质内容）就只返回 1-2 个方向，绝不硬凑
- 最多 4 个方向

只输出 JSON：{"directions":[{"label":"自己争取","basin":"self","strength":0.8}]}`;

/** LLM 析取可能性方向：失败返回 null，调用方回落到公式造枝 */
export async function extractPossibilities(input: {
  transcript: string;
  history: string[];
  selfReferRate: number;
}): Promise<Possibility[] | null> {
  const client = getLLMClient();
  if (!client) return null;

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `孩子刚说：「${input.transcript.slice(0, 300)}」\n他最近说过：${input.history.map((h) => `「${h}」`).join('、')}`.slice(0, 1200),
        },
      ],
      max_tokens: 2000, // 推理模型先烧 token 思考，给足余量
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '');
    const raw = Array.isArray(parsed.directions) ? (parsed.directions as unknown[]) : [];
    const directions = raw
      .map((d): Possibility | null => {
        const item = d as Record<string, unknown>;
        const basin = BASINS.find((b) => b === item.basin);
        if (!basin || typeof item.label !== 'string' || !item.label.trim()) return null;
        const strength = typeof item.strength === 'number' ? item.strength : 0.5;
        return {
          label: item.label.trim().slice(0, 12),
          basin,
          strength: Math.min(1, Math.max(0.05, strength)),
        };
      })
      .filter((d): d is Possibility => d !== null)
      .slice(0, 4);
    return directions.length ? directions : null;
  } catch {
    return null;
  }
}

router.post('/', async (req, res) => {
  const { transcript, history, selfReferRate } = req.body ?? {};
  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'transcript required' });
  }
  const directions = await extractPossibilities({
    transcript,
    history: Array.isArray(history) ? history.map(String).slice(0, 8) : [],
    selfReferRate: typeof selfReferRate === 'number' ? selfReferRate : 0.5,
  });
  res.json({ directions });
});

export default router;
