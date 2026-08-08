import assert from 'node:assert/strict';
import type { BranchNode, GrowthEvent } from '../src/index';
import {
  applyGrowthEvent,
  createEmptyTree,
  getChildren,
  getDisplayedBranches,
  getTips,
} from '../src/tree';

function branch(partial: Partial<BranchNode> & { id: string }): BranchNode {
  return {
    parentId: null,
    growthT: 1,
    trajectoryLabel: 'traj',
    basin: 'self',
    vitality: 0.8,
    clarity: 0.6,
    length: 1,
    warmth: 1,
    withered: false,
    displayed: true,
    seed: 42,
    ...partial,
  };
}

// 1. 空树
const t0 = createEmptyTree();
assert.deepEqual(t0, { branches: [], events: [] });

// 2. 三次生长事件（含一次枯枝），模拟演示路径
const e1: GrowthEvent = {
  t: 1,
  converged: true,
  delta: 0.6,
  newBranches: [
    branch({ id: 'b1' }),
    branch({ id: 'b2', basin: 'other', warmth: 0, vitality: 0.3, displayed: false }),
  ],
};
const t1 = applyGrowthEvent(t0, e1);
assert.equal(t1.branches.length, 2);
assert.equal(t0.branches.length, 0, '原树不可变');

const e2: GrowthEvent = {
  t: 2,
  converged: true,
  delta: 0.4,
  newBranches: [branch({ id: 'b3', parentId: 'b1', growthT: 2 })],
};
const t2 = applyGrowthEvent(t1, e2);

const e3: GrowthEvent = {
  t: 3,
  converged: false,
  delta: 0.95,
  newBranches: [branch({ id: 'b4', parentId: 'b1', growthT: 3, withered: true })],
};
const t3 = applyGrowthEvent(t2, e3);
assert.equal(t3.branches.length, 4);
assert.equal(t3.events.length, 3);

// 3. 确定性：同样输入序列 → 完全相同的拓扑
const replay = [e1, e2, e3].reduce(applyGrowthEvent, createEmptyTree());
assert.deepEqual(replay, t3, '重放必须确定性一致');

// 4. 结构查询
assert.deepEqual(
  getChildren(t3, 'b1').map((b) => b.id),
  ['b3', 'b4']
);
assert.deepEqual(
  getTips(t3).map((b) => b.id),
  ['b2', 'b3', 'b4']
);
assert.deepEqual(
  getDisplayedBranches(t3).map((b) => b.id),
  ['b1', 'b3', 'b4'],
  'displayed=false 的枝不渲染'
);

// 5. 非法事件被拒绝
assert.throws(() =>
  applyGrowthEvent(t3, {
    t: 4,
    converged: true,
    delta: 0.5,
    newBranches: [branch({ id: 'b5', parentId: 'ghost' })],
  })
);
assert.throws(() => applyGrowthEvent(t3, { ...e1, newBranches: [branch({ id: 'b1' })] }));

console.log('tree.test: all assertions passed');
