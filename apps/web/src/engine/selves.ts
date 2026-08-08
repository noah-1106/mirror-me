import type { TreeTopology, TurnRecord } from '@oasis/shared';
import { getBranch } from '@oasis/shared';

/** 一个"我"：树上一根真实的枝，及其完整 lineage（长成它的那几轮对话） */
export interface SelfCandidate {
  branchId: string;
  basin: 'self' | 'other' | 'avoid';
  warmth: number;
  withered: boolean;
  growthT: number;
  /** 从根到这根枝的轮次链（真实生长路径） */
  lineageTurns: number[];
  /** lineage 对应的对话原文 */
  story: string[];
}

/**
 * 从拓扑真实枝提取"我"的候选——全部来自引擎数据，零模拟。
 * lineage：沿 parentId 上溯到根，收集途经枝的生长轮次与对话原文。
 */
export function computeCandidates(tree: TreeTopology, history: TurnRecord[]): SelfCandidate[] {
  const transcriptOf = (t: number) => history.find((h) => h.t === t)?.transcript;

  const lineageOf = (branchId: string): number[] => {
    const turns: number[] = [];
    let cur = getBranch(tree, branchId);
    while (cur) {
      turns.unshift(cur.growthT);
      cur = cur.parentId ? getBranch(tree, cur.parentId) : undefined;
    }
    // genesis 的轮次（t=1,2,3）映射到履历对话；交互轮次 t>=4 直接对应 history
    return [...new Set(turns)];
  };

  return tree.branches
    .filter((b) => b.displayed)
    .map((b) => {
      const lineageTurns = lineageOf(b.id);
      const story = lineageTurns
        .map((t) => transcriptOf(t))
        .filter((s): s is string => typeof s === 'string');
      return {
        branchId: b.id,
        basin: b.basin,
        warmth: b.warmth,
        withered: b.withered,
        growthT: b.growthT,
        lineageTurns,
        story,
      };
    })
    .filter((c) => c.story.length > 0);
}

/**
 * 挑选最多 3 个可对话的"我"：故事必须显著不同。
 * 策略：优先各盆地一个（self/other），再要一个枯枝；其次按轮次分散。
 */
export function pickDiverseSelves(candidates: SelfCandidate[], max = 3): SelfCandidate[] {
  const picked: SelfCandidate[] = [];
  const usedBasins = new Set<string>();

  // 第一优先：每个 basin 各来一个
  for (const basin of ['self', 'other', 'avoid'] as const) {
    const hit = candidates.find((c) => c.basin === basin && !c.withered);
    if (hit && picked.length < max) {
      picked.push(hit);
      usedBasins.add(basin);
    }
  }
  // 第二优先：枯枝（灰烬的我）
  const withered = candidates.find((c) => c.withered);
  if (withered && picked.length < max && !picked.includes(withered)) {
    picked.push(withered);
  }
  // 兜底：按轮次分散补齐
  const byGrowthT = [...candidates].sort((a, b) => a.growthT - b.growthT);
  for (const c of byGrowthT) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.slice(0, max);
}
