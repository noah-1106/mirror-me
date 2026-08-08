import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Alarm, ChoiceRecord, FProfile, ResponseField, SituationState } from '@oasis/shared';
import { getLLMClient, model } from '../services/kimi';
import { checkSensitiveContent, checkSituationWhitelist } from './gatekeeper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(
  join(__dirname, '../prompts/narrate.system.txt'),
  'utf-8'
);

const fallbackSituations: SituationState[] = [
  {
    id: 'class-election',
    title: '班干部选举',
    description: '班会上要选举班长。你心里很想试试，但担心同学说你不自量力。',
    choices: [
      { id: 'run', text: '我想挑战自己，报名参加。' },
      { id: 'support', text: '我支持我朋友去选。' },
      { id: 'watch', text: '我先看看大家怎么选。' },
    ],
  },
  {
    id: 'homework-help',
    title: '同学抄作业',
    description: '同桌想抄你的数学作业，他说不抄就要被妈妈骂。',
    choices: [
      { id: 'refuse', text: '我不想让他抄，但愿意教他。' },
      { id: 'give', text: '好吧，给他抄一次。' },
      { id: 'tell', text: '我告诉他去问老师。' },
    ],
  },
  {
    id: 'weekend-plan',
    title: '周末安排',
    description: '周六上午有钢琴课，但你更想和同学去公园骑行。',
    choices: [
      { id: 'bike', text: '我想去骑行。' },
      { id: 'piano', text: '我还是去上钢琴课吧。' },
      { id: 'negotiate', text: '我想和爸妈商量能不能调时间。' },
    ],
  },
];

export async function narrateNextSituation(input: {
  t: number;
  previousSituation?: string;
  lastChoice?: string;
  lastReason?: string;
  selfReferRate: number;
  delta: number;
  R?: ResponseField;
  profile?: FProfile;
  alarms?: Alarm[];
  history?: ChoiceRecord[];
  mostUncertainDimension?: string;
}): Promise<SituationState> {
  if (input.lastReason) {
    const reasonCheck = checkSensitiveContent(input.lastReason);
    if (!reasonCheck.ok) {
      return {
        id: 'guardian-trigger',
        title: '先和信任的大人聊聊',
        description: reasonCheck.reason ?? '这个话题需要大人陪你一起面对。',
        choices: [{ id: 'ok', text: '好的' }],
      };
    }
  }

  const client = getLLMClient();
  if (!client) {
    return contextualFallback(input);
  }

  try {
    const historySummary =
      input.history
        ?.slice(-3)
        .map((h) => `[${h.choiceText}] 理由：${h.reasonText} 自引：${h.selfReferential}`)
        .join('\n') ?? '无';

    const prompt = systemPrompt
      .replace('{t}', String(input.t))
      .replace('{previousSituation}', input.previousSituation ?? '无')
      .replace('{lastChoice}', input.lastChoice ?? '无')
      .replace('{lastReason}', input.lastReason ?? '无')
      .replace('{selfReferRate}', input.selfReferRate.toFixed(2))
      .replace('{delta}', input.delta.toFixed(2))
      .replace('{mostUncertainDimension}', input.mostUncertainDimension ?? 'confidence')
      .replace('{alarms}', input.alarms?.map((a) => `${a.type}(${a.severity})`).join(', ') || '无')
      .replace('{historySummary}', historySummary)
      .replace('{energy}', (input.R?.energy ?? 0.5).toFixed(2))
      .replace('{relation}', (input.R?.relation ?? 0.5).toFixed(2))
      .replace('{confidence}', (input.R?.confidence ?? 0.5).toFixed(2))
      .replace('{stress}', (input.R?.stress ?? 0.5).toFixed(2))
      .replace('{curiosity}', (input.R?.curiosity ?? 0.5).toFixed(2));

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: '请生成下一个情境。' },
      ],
      temperature: 1,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const situation: SituationState = {
        id: parsed.id ?? `situation-${input.t}`,
        title: parsed.title ?? '下一个情境',
        description: parsed.description ?? '',
        choices: parsed.choices ?? fallbackSituations[0].choices,
      };
      const whitelist = checkSituationWhitelist(situation);
      if (!whitelist.ok) {
        console.warn('Situation whitelist rejected:', whitelist.reason);
        return contextualFallback(input);
      }
      return situation;
    }

    return contextualFallback(input);
  } catch (err) {
    console.error('Narrate generation failed:', err);
    return contextualFallback(input);
  }
}

function contextualFallback(input: {
  t: number;
  R?: ResponseField;
  mostUncertainDimension?: string;
}): SituationState {
  const stress = input.R?.stress ?? 0.3;
  const confidence = input.R?.confidence ?? 0.5;
  const relation = input.R?.relation ?? 0.5;

  // 根据 R(t) 选最贴合的兜底情境
  if (stress > 0.6) return fallbackSituations[1];
  if (relation < 0.4) return fallbackSituations[0];
  if (confidence > 0.6) return fallbackSituations[2];

  return fallbackSituations[input.t % fallbackSituations.length];
}
