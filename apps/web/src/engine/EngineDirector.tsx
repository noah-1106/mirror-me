import { applyGrowthEvent, createEmptyTree } from '@oasis/shared';
import type { TreeTopology } from '@oasis/shared';
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import {
  GROW_DURATION,
  PULSE_DURATION,
  demoEventTimes,
  demoGrowthEvents,
} from './demoTree';
import { WorldTree, type TreeVisualState } from '../effects/WorldTree';
import { useWorldState } from './useWorld';

const GENESIS_END = demoEventTimes[demoEventTimes.length - 1] + GROW_DURATION;

/**
 * 引擎导演：
 * - genesis 阶段：播放人生履历（种子拓扑按时刻表长成），完成后把树移交给状态机
 * - 之后：树由引擎（观观/敛敛）生长，这里只负责把新枝注册成生长动画
 */
export function EngineDirector({ visual }: { visual: React.MutableRefObject<TreeVisualState> }) {
  const { phase, context, send, ready } = useWorldState();
  const [genesisTree, setGenesisTree] = useState<TreeTopology>(createEmptyTree);
  const genesisTreeRef = useRef(genesisTree);
  genesisTreeRef.current = genesisTree;
  const genesisFired = useRef(new Set<number>());
  const genesisSent = useRef(false);
  const knownBranches = useRef(new Set<string>());

  // genesis 完成：把已长成的树移交给引擎
  useEffect(() => {
    if (!ready || genesisSent.current) return;
    const timer = setTimeout(() => {
      if (genesisSent.current) return;
      genesisSent.current = true;
      send({ type: 'GENESIS_DONE', tree: genesisTreeRef.current });
    }, GENESIS_END * 1000);
    return () => clearTimeout(timer);
  }, [ready, send]);

  const tree = phase === 'genesis' ? genesisTree : context.tree;
  visual.current.convergeCount = context.convergeCount;

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const v = visual.current;

    // genesis：人生履历按时刻表长成
    if (phase === 'genesis') {
      demoGrowthEvents.forEach((event, i) => {
        if (time < demoEventTimes[i] || genesisFired.current.has(i)) return;
        genesisFired.current.add(i);
        setGenesisTree((prev) => applyGrowthEvent(prev, event));
      });
    }

    // 新枝注册成生长动画（genesis 和引擎生长走同一条路）
    for (const b of tree.branches) {
      if (knownBranches.current.has(b.id)) continue;
      knownBranches.current.add(b.id);
      v.progress[b.id] = 0;
      v.branchStarts[b.id] = time;
      if (b.displayed) v.pulses.push({ branchId: b.id, start: time });
    }
    for (const id of Object.keys(v.progress)) {
      if (v.progress[id] >= 1) continue;
      v.progress[id] = Math.min(1, (time - v.branchStarts[id]) / GROW_DURATION);
    }
    v.pulses = v.pulses.filter((p) => time - p.start < PULSE_DURATION + 0.5);
  });

  return <WorldTree topology={tree} visual={visual} />;
}
