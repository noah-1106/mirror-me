import assert from 'node:assert/strict';
import { createActor, waitFor } from 'xstate';
import { applyGrowthEvent, createEmptyTree } from '@oasis/shared';
import { demoGrowthEvents } from './demoTree';
import { worldMachine } from './worldMachine';

/** 人生履历：genesis 移交的树（只取演示数据的前两幕） */
function genesisTree() {
  return demoGrowthEvents.slice(0, 2).reduce(applyGrowthEvent, createEmptyTree());
}

function makeActor() {
  const actor = createActor(worldMachine);
  actor.start();
  return actor;
}

async function sendTurn(
  actor: ReturnType<typeof makeActor>,
  transcript: string,
  pauseMs = 2000
) {
  actor.send({ type: 'VOICE_TURN', transcript, pauseMs, durationMs: 800 });
  // 等机器回到 idle（或进 finale）
  await waitFor(actor, (s) => s.context.phase === 'idle' || s.context.phase === 'finale', {
    timeout: 5000,
  });
}

// ── 场景 A：触发器节奏 + 终局解锁 ──
{
  const actor = makeActor();
  assert.equal(actor.getSnapshot().context.phase, 'genesis');

  actor.send({ type: 'GENESIS_DONE', tree: genesisTree() });
  assert.equal(actor.getSnapshot().context.phase, 'idle');
  const genesisBranchCount = actor.getSnapshot().context.tree.branches.length;

  // 每轮必收敛（演示版决策）：第 1、2 轮也长树
  await sendTurn(actor, '我最近有点迷茫');
  let snap = actor.getSnapshot();
  assert.equal(snap.context.convergeCount, 1, '每轮必收敛');
  const afterTurn1 = snap.context.tree.branches.length;
  assert.ok(afterTurn1 > genesisBranchCount, '第 1 轮就长树');

  await sendTurn(actor, '我想试试参加选拔');
  snap = actor.getSnapshot();
  assert.equal(snap.context.convergeCount, 2);
  assert.ok(snap.context.tree.branches.length > afterTurn1, '第 2 轮继续长');

  // 第 3 轮：继续收敛，轨迹束 3-6 枝，全部挂在已有梢头
  await sendTurn(actor, '我觉得自己可以拼一下');
  snap = actor.getSnapshot();
  assert.equal(snap.context.convergeCount, 3);
  const grownBranches = snap.context.tree.branches.slice(genesisBranchCount);
  assert.ok(
    grownBranches.every((b) => b.withered === false),
    '无报警不应枯枝'
  );
  assert.equal(grownBranches[0].basin, 'self');
  assert.ok(
    grownBranches.every((b) => b.parentId !== null),
    '交互生长必须挂在已有梢头（向未来长）'
  );

  // 第 4-6 轮：第 6 次收敛（3 的倍数）δ≈0.51 ≤ 0.55 → 进终局
  await sendTurn(actor, '同学们都说我不行');
  await sendTurn(actor, '但我还是想试');
  await sendTurn(actor, '我想证明给自己看');
  snap = actor.getSnapshot();
  assert.equal(snap.context.convergeCount, 6);
  assert.equal(snap.context.phase, 'finale', '第 6 次收敛 δ 低于阈值应进终局');
  assert.equal(snap.context.history.length, 6);

  // 终局可以继续：回到 idle 继续对话
  actor.send({ type: 'CONTINUE' });
  assert.equal(actor.getSnapshot().context.phase, 'idle');
  await sendTurn(actor, '我还想继续聊聊');
  assert.equal(actor.getSnapshot().context.history.length, 7);
  console.log('scenario A (trigger rhythm + finale + continue): passed');
}

// ── 场景 B：红色报警 → 枯枝 ──
{
  const actor = makeActor();
  actor.send({ type: 'GENESIS_DONE', tree: genesisTree() });

  // 前 5 轮平稳停顿，第 6 轮停顿骤增 → Z-score 超阈 → 红报警 → 枯枝
  for (let i = 0; i < 5; i++) await sendTurn(actor, `第${i + 1}轮`, 2000 + i * 100);
  await sendTurn(actor, '这个问题……我不知道该怎么回答', 9000);

  const snap = actor.getSnapshot();
  assert.ok(snap.context.alarms.some((a) => a.severity === 'red'), '停顿骤增应触发红报警');
  const last = snap.context.tree.branches[snap.context.tree.branches.length - 1];
  assert.equal(last.withered, true, '红报警的收敛应长枯枝');
  console.log('scenario B (red alarm → withered branch): passed');
}

console.log('worldEngine.test: all scenarios passed');
