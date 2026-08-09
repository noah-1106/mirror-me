/**
 * 线上叩门模拟：真实 worldMachine + 生产 API，观察几轮能进 finale。
 * 运行：cd apps/web && npx tsx simulate-finale.mts
 */
import { createActor, waitFor } from 'xstate';
import { applyGrowthEvent, createEmptyTree } from '@oasis/shared';
import { demoGrowthEvents } from './src/engine/demoTree';
import { worldMachine } from './src/engine/worldMachine';

const BASE = 'https://mirrorme.agentmkt.agency';
(globalThis as any).window = {}; // 让状态机走网络路径
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: any, opts: any) =>
  realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, opts)) as any;

const tree = demoGrowthEvents.slice(0, 2).reduce(applyGrowthEvent, createEmptyTree());
const actor = createActor(worldMachine);
actor.start();

actor.subscribe((s) => {
  if (String(s.value) === 'gating') console.log('   → 叩门判定中…');
});

actor.send({ type: 'GENESIS_DONE', tree });

// 一个真实小孩可能会说的话（有具体事件、有自我暴露、有多个生活面）
const stories = [
  '还行吧',
  '不知道',
  '嗯',
  '就那样',
  '没什么',
  '随便',
  '可以的',
  '再说吧',
  '不知道怎么说',
  '嗯嗯',
  '没有吧',
  '还行',
];

for (let i = 0; i < stories.length; i++) {
  const t0 = Date.now();
  actor.send({ type: 'VOICE_TURN', transcript: stories[i], pauseMs: 2000, durationMs: 1200 });
  try {
    await waitFor(actor, (s) => ['idle', 'finale'].includes(s.context.phase), { timeout: 240000 });
  } catch {
    console.log(`turn ${i + 1}: 超时！当前状态=${String(actor.getSnapshot().value)}`);
    break;
  }
  const c = actor.getSnapshot().context;
  console.log(
    `turn ${i + 1}: phase=${c.phase} converge=${c.convergeCount} delta=${c.delta.toFixed(2)} branches=${c.tree.branches.length} 用时=${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  if (c.phase === 'finale') {
    console.log(`\n✅ 第 ${i + 1} 轮叩门成功`);
    break;
  }
}
const final = actor.getSnapshot().context;
if (final.phase !== 'finale') console.log(`\n❌ ${stories.length} 轮后仍未叩门（phase=${final.phase}）`);
process.exit(0);
