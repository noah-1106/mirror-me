import { Router } from 'express';
import { getLLMClient, model } from '../services/kimi';

const router = Router();

/** 会话内碎片缓存：同一 self 的同一组原话只生成一次 */
const fragmentCache = new Map<string, string>();

const SYSTEM = `你是"可能性碎片"的书写者。给你一个孩子说过的话和一根树枝的盆地属性，你写出这根枝上的一种可能生活的片段——不是预言（绝不能说"你将会"），而是标本（"有一种可能……"）。

规则：
- 第一行视角：从那句话出发，想象一种合理的延展
- 2-3 句，每句不超过 20 字，总共不超过 50 字
- 具体、有画面感，不评判、不建议
- 枯枝（withered）：写被搁置的可能，语气怜惜但不悲伤
- 他引（other）：写活在别人目光里的可能
- 自引（self）：写自己拿主意舒展生长的可能`;

function cacheKey(basin: string, withered: boolean, story: string[]): string {
  return `${basin}|${withered}|${story.join('|').slice(0, 200)}`;
}

/** 生成可能性碎片：失败返回空串，mirror 人设回落到只用原话 lineage */
export async function generateFragment(input: {
  basin: string;
  withered: boolean;
  story: string[];
}): Promise<string> {
  const key = cacheKey(input.basin, input.withered, input.story);
  const cached = fragmentCache.get(key);
  if (cached !== undefined) return cached;

  const client = getLLMClient();
  if (!client) return '';

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `盆地：${input.basin}${input.withered ? '（枯枝）' : ''}\n孩子说过的话：${input.story.map((s) => `「${s}」`).join('、')}`,
        },
      ],
      max_tokens: 2000, // 推理模型先烧 token 思考（长 system prompt 会思考更久），给足余量
      temperature: 0.9,
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    if (text) fragmentCache.set(key, text); // 空结果不缓存，下次重试
    return text;
  } catch {
    return '';
  }
}

router.post('/', async (req, res) => {
  const { basin, withered, story } = req.body ?? {};
  const fragment = await generateFragment({
    basin: typeof basin === 'string' ? basin : 'self',
    withered: withered === true,
    story: Array.isArray(story) ? story.map(String).slice(0, 10) : [],
  });
  res.json({ fragment });
});

export default router;
