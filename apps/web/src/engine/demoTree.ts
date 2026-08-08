import type { BranchNode, GrowthEvent } from '@oasis/shared';

/**
 * P1 演示数据：三幕生长（对应设计文档演示路径）。
 * 第二幕含一根 displayed=false 的枝（只存在于推演，不渲染）。
 * 第三幕 converged=false：δ⁺≥B，枯枝。
 * P2 引擎接线后由敛敛的真实输出替代。
 */

function branch(partial: Partial<BranchNode> & { id: string }): BranchNode {
  return {
    parentId: null,
    growthT: 1,
    trajectoryLabel: 'traj',
    basin: 'self',
    vitality: 0.7,
    clarity: 0.5,
    length: 0.8,
    warmth: 0.8,
    withered: false,
    displayed: true,
    seed: 1,
    ...partial,
  };
}

export const demoGrowthEvents: GrowthEvent[] = [
  {
    t: 1,
    converged: true,
    delta: 0.6,
    newBranches: [
      branch({ id: 'b1', seed: 11, vitality: 0.85, clarity: 0.4, warmth: 0.9, length: 1.0 }),
      branch({ id: 'b2', seed: 12, vitality: 0.6, clarity: 0.4, warmth: 0.3, length: 0.8, basin: 'other' }),
      // 隐藏枝：推演出来但不展示
      branch({ id: 'b3', seed: 13, basin: 'avoid', vitality: 0.3, clarity: 0.35, warmth: 0.1, displayed: false }),
    ],
  },
  {
    t: 2,
    converged: true,
    delta: 0.4,
    newBranches: [
      branch({ id: 'b4', parentId: 'b1', growthT: 2, seed: 24, vitality: 0.75, clarity: 0.6, warmth: 0.85, length: 0.75 }),
      branch({ id: 'b5', parentId: 'b2', growthT: 2, seed: 25, vitality: 0.55, clarity: 0.55, warmth: 0.2, length: 0.65, basin: 'other' }),
      branch({ id: 'b6', growthT: 2, seed: 26, vitality: 0.5, clarity: 0.55, warmth: 0.5, length: 0.6 }),
    ],
  },
  {
    t: 3,
    converged: false,
    delta: 0.95,
    newBranches: [
      branch({ id: 'b7', parentId: 'b1', growthT: 3, seed: 37, basin: 'avoid', vitality: 0.2, clarity: 0.2, warmth: 0, length: 0.5, withered: true }),
      branch({ id: 'b8', parentId: 'b2', growthT: 3, seed: 38, vitality: 0.45, clarity: 0.5, warmth: 0.4, length: 0.55 }),
      branch({ id: 'b9', parentId: 'b6', growthT: 3, seed: 39, vitality: 0.5, clarity: 0.5, warmth: 0.6, length: 0.55 }),
    ],
  },
];

/** 各幕的开演时刻（秒）：种子独留 2.8s，编织 2.8-8.6s，分叉波交叠衔接 */
export const demoEventTimes = [7.9, 10.4, 12.9];

/** 生长演出时长 / 光脉冲时长（秒）：生长放缓，幕与幕交叠 */
export const GROW_DURATION = 6;
export const PULSE_DURATION = 1.5;
