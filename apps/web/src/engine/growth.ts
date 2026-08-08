import type { BranchNode, GrowthEvent, TreeTopology, TurnRecord } from '@oasis/shared';
import { getTips } from '@oasis/shared';
import type { ConvergeResult } from '../agents/lianlian';

const BASIN_WARMTH: Record<TurnRecord['basin'], number> = {
  self: 0.85,
  other: 0.2,
  avoid: 0.05,
};

/**
 * 把一轮对话归一成观测单元（P3 后由守门员 + LLM 打标替代启发式）。
 * 盆地启发式：有"我"→自引；提到他人→他引；否则回避。
 */
export function makeTurnRecord(
  t: number,
  transcript: string,
  pauseMs: number,
  durationMs: number
): TurnRecord {
  const selfHit = transcript.includes('我');
  const otherHit = /别人|大家|同学|老师|爸妈|朋友|他们/.test(transcript);
  const basin: TurnRecord['basin'] = selfHit ? 'self' : otherHit ? 'other' : 'avoid';
  return {
    t,
    transcript,
    pauseMs,
    durationMs,
    dimensions: [basin],
    basin,
    selfReferential: selfHit,
  };
}

/** LLM 析取的可能性方向（/api/possibilities） */
export interface Possibility {
  label: string;
  basin: TurnRecord['basin'];
  strength: number;
}

/**
 * 敛敛收敛结果 → 生长事件：从现在的人生（树冠最新梢头）向未来长。
 * 一次收敛 = 一次轨迹束采样：LLM 析取这句话真正包含的可能性方向，有几个方向长几根枝。
 * - 方向数 = 枝数（1-4，单薄的话只长 1-2 根；LLM 不可用时回落公式 3-6 根）
 * - 每根枝的盆地/活力各自独立（同一句话可以既有"自己争取"又有"为别人妥协"）
 * - 父枝 = 当前树最年轻的若干展示枝梢（未来的可能性长在最新的自己身上）
 * - 清晰度 = 1-δ⁺；暖度 = 该枝盆地
 * - 枯枝 = 红色报警（分岔邻近 = 撞三道硬墙，"这个选择太重，推演撞墙了"）
 */
export function growthFromTurn(
  tree: TreeTopology,
  turn: TurnRecord,
  result: ConvergeResult,
  redAlarm: boolean,
  possibilities?: Possibility[] | null
): GrowthEvent {
  const tips = getTips(tree)
    .filter((b) => b.displayed && !b.withered)
    .sort((a, b) => b.growthT - a.growthT);

  const withered = redAlarm;

  // 每根枝的 (label, basin, vitality)：LLM 析取优先，公式兜底
  let specs: { label: string; basin: TurnRecord['basin']; vitality: number }[];
  if (possibilities && possibilities.length > 0) {
    specs = possibilities.map((p) => ({ label: p.label, basin: p.basin, vitality: p.strength }));
  } else {
    const selfRate = result.profile.selfReferRate;
    const vitality = Math.min(
      1,
      Math.max(0.1, turn.basin === 'self' ? selfRate : turn.basin === 'other' ? 1 - selfRate : 0.2)
    );
    const count = 3 + Math.floor(vitality * 3);
    specs = Array.from({ length: count }, () => ({
      label: `turn-${turn.t}`,
      basin: turn.basin,
      vitality,
    }));
  }

  const newBranches: BranchNode[] = specs.map((spec, k) => {
    const parent = tips.length > 0 ? tips[k % tips.length] : null;
    return {
      id: `t${turn.t}-${k}`,
      parentId: parent?.id ?? null,
      growthT: turn.t,
      trajectoryLabel: spec.label,
      basin: spec.basin,
      vitality: spec.vitality,
      clarity: Math.max(0.1, 1 - result.delta),
      length: 0.4 + (1 - result.delta) * 0.6,
      warmth: BASIN_WARMTH[spec.basin],
      withered,
      displayed: true,
      seed: turn.t * 7919 + 13 + k * 101,
    };
  });

  return { t: turn.t, converged: !withered, delta: result.delta, newBranches };
}
