import type { Alarm, FProfile, TurnRecord } from '@oasis/shared';
import { AWAY_MS } from './guanguan';

export interface ConvergeResult {
  profile: FProfile;
  delta: number;
  mostUncertainDimension: string;
}

const DIMENSIONS = ['energy', 'relation', 'confidence', 'stress', 'curiosity'];

export function converge(
  history: TurnRecord[],
  alarms: Alarm[],
  previousProfile: FProfile
): ConvergeResult {
  const distribution: Record<string, number> = {};
  const dimensions = history.flatMap((h) => h.dimensions);

  dimensions.forEach((d) => {
    distribution[d] = (distribution[d] ?? 0) + 1;
  });

  const total = dimensions.length || 1;
  const normalized: Record<string, number> = {};
  DIMENSIONS.forEach((d) => {
    normalized[d] = (distribution[d] ?? 0) / total;
  });

  // 自引率
  const selfReferRate = history.length
    ? history.filter((h) => h.selfReferential).length / history.length
    : previousProfile.selfReferRate;

  // 停顿模式（AFK 轮次不计入：墙钟等待不是迟疑）
  const pauses = history.map((h) => h.pauseMs).filter((p) => p <= AWAY_MS);
  const meanPause = pauses.reduce((a, b) => a + b, 0) / (pauses.length || 1);
  const variance =
    pauses.reduce((a, b) => a + Math.pow(b - meanPause, 2), 0) / (pauses.length || 1);
  const stdPause = Math.sqrt(variance);

  // 最不确定维度：分布熵最大或最近没出现的维度
  const leastSeen = DIMENSIONS.reduce((a, b) =>
    (normalized[a] ?? 0) < (normalized[b] ?? 0) ? a : b
  );

  // delta 随选择次数对数下降，alarm 会额外收紧
  const redAlarmCount = alarms.filter((a) => a.severity === 'red').length;
  const baseDelta = Math.max(0.15, 1.0 - Math.log(history.length + 1) * 0.25);
  const delta = Math.max(0.05, baseDelta - redAlarmCount * 0.15);

  const profile: FProfile = {
    selfReferRate,
    dimensionDistribution: normalized,
    hesitationPattern: { meanPause, stdPause },
    responseBasins: [
      { id: 'self', label: '自引', probability: selfReferRate },
      { id: 'other', label: '他引', probability: 1 - selfReferRate },
    ],
  };

  return { profile, delta, mostUncertainDimension: leastSeen };
}

export function shouldConverge(
  historyLength: number,
  alarms: Alarm[],
  situationIsCritical: boolean
): boolean {
  if (alarms.some((a) => a.severity === 'red')) return true;
  if (situationIsCritical) return true;
  // 每轮必收敛（演示版决策：对话轮次 = 推演轮次，每次收敛都有可见生长）
  return historyLength > 0;
}
