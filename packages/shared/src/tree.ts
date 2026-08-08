import type { BranchNode, GrowthEvent, TreeTopology } from './index';

export function createEmptyTree(): TreeTopology {
  return { branches: [], events: [] };
}

/**
 * 把一次生长事件挂到树上。纯函数：不改原树，返回新拓扑。
 * 校验：新枝的 parentId 必须已存在（或为 null）。
 */
export function applyGrowthEvent(tree: TreeTopology, event: GrowthEvent): TreeTopology {
  const ids = new Set(tree.branches.map((b) => b.id));
  const newIds = new Set<string>();
  for (const b of event.newBranches) {
    if (newIds.has(b.id) || ids.has(b.id)) {
      throw new Error(`duplicate branch id: ${b.id}`);
    }
    newIds.add(b.id);
  }
  for (const b of event.newBranches) {
    if (b.parentId !== null && !ids.has(b.parentId) && !newIds.has(b.parentId)) {
      throw new Error(`parent not found: ${b.parentId} (branch ${b.id})`);
    }
  }
  return {
    branches: [...tree.branches, ...event.newBranches],
    events: [...tree.events, event],
  };
}

export function getChildren(tree: TreeTopology, id: string | null): BranchNode[] {
  return tree.branches.filter((b) => b.parentId === id);
}

/** 枝梢（没有子枝的枝）——生长事件的候选挂点 */
export function getTips(tree: TreeTopology): BranchNode[] {
  const parents = new Set(tree.branches.map((b) => b.parentId).filter((x) => x !== null));
  return tree.branches.filter((b) => !parents.has(b.id));
}

/** 实际渲染的枝（有的枝只存在于推演，不展示） */
export function getDisplayedBranches(tree: TreeTopology): BranchNode[] {
  return tree.branches.filter((b) => b.displayed);
}

export function getBranch(tree: TreeTopology, id: string): BranchNode | undefined {
  return tree.branches.find((b) => b.id === id);
}
