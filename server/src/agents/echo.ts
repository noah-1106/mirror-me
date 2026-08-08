import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { FProfile, ResponseField } from '@oasis/shared';
import { getLLMClient, model } from '../services/kimi';

const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(
  join(__dirname, '../prompts/echo.system.txt'),
  'utf-8'
);

const dimensionQuestions: Record<string, string[]> = {
  energy: ['你现在有力气为自己做这件事吗？', '这件事让你更有劲，还是更累？'],
  relation: ['这个选择会让你的朋友怎么看你？', '你更在乎谁的想法？'],
  confidence: ['你相信自己能选对吗？', '如果没有正确答案，你还敢选吗？'],
  stress: ['你现在是不是有点紧张？', '是什么让你觉得有压力？'],
  curiosity: ['你更想试试看，还是再等等？', '是什么让你好奇？'],
};

export async function generateEchoQuestion(
  dimension: string,
  R: ResponseField,
  profile: FProfile
): Promise<{ dimension: string; text: string }> {
  const client = getLLMClient();
  if (!client) {
    return fallbackForDimension(dimension, R, profile);
  }

  try {
    const prompt = systemPrompt
      .replace('{dimension}', dimension)
      .replace('{energy}', R.energy.toFixed(2))
      .replace('{relation}', R.relation.toFixed(2))
      .replace('{confidence}', R.confidence.toFixed(2))
      .replace('{stress}', R.stress.toFixed(2))
      .replace('{curiosity}', R.curiosity.toFixed(2))
      .replace('{selfReferRate}', profile.selfReferRate.toFixed(2))
      .replace(
        '{dimensions}',
        Object.entries(profile.dimensionDistribution)
          .map(([k, v]) => `${k}:${v.toFixed(2)}`)
          .join(', ') || '无'
      );

    console.log('[Echo] requesting dimension:', dimension);

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `最不确定维度：${dimension}` },
      ],
      temperature: 1,
      max_tokens: 60,
    });

    const content = response.choices[0]?.message?.content ?? '';
    console.log('[Echo] raw response:', content);
    const text = content.trim().replace(/^["']|["']$/g, '').split('\n')[0].slice(0, 30);
    if (text && !text.includes('{')) {
      return { dimension, text };
    }
    return fallbackForDimension(dimension, R, profile);
  } catch (err) {
    console.error('Echo generation failed:', err);
    return fallbackForDimension(dimension, R, profile);
  }
}

function fallbackForDimension(
  dimension: string,
  R: ResponseField,
  _profile: FProfile
): { dimension: string; text: string } {
  const list = dimensionQuestions[dimension] ?? dimensionQuestions.confidence;
  // 根据 R 选更贴合的问题
  let text = list[0];
  if (dimension === 'stress' && R.stress > 0.6) {
    text = '是什么让你觉得有压力？';
  } else if (dimension === 'confidence' && R.confidence < 0.4) {
    text = '如果没有正确答案，你还敢选吗？';
  }
  return { dimension, text };
}
