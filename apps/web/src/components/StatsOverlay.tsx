import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useWorldState } from '../engine/useWorld';

const DIMENSIONS = ['energy', 'relation', 'confidence', 'stress', 'curiosity'];

/** 交互生长枝的命名规则（growthFromTurn）：t{轮次}-{序号}；genesis 履历枝不在此列 */
const INTERACTIVE_ID = /^t\d+-\d+$/;

/**
 * 引擎实况面板（右下角）。
 * 铁律：每个数字都必须从引擎状态真实算出，一条都不编。
 * - 你亲手点亮的可能 = 你对话长出的全部枝数（剔除 genesis 履历；
 *   每轮增量 = LLM 析取的可能性方向数。注意不能用梢头数：新枝顶替父枝后梢头会原地不动）
 * - 由自己点亮的选择 = 自引率（LLM 逐轮打标 basin=self 的占比）
 * - 被照亮的生活面 = LLM 打标覆盖过的心理维度数（ readiness"多样性"判据的可视化）
 * - 推演不动的路口 = 枯枝数（红色报警 = 重到引擎不敢推演的选择）
 * （迟疑秒数已移除：pauseMs 是墙钟等待时间，用户离开电脑会污染数据）
 */
export function StatsOverlay() {
  const { context, phase } = useWorldState();
  const lit = context.tree.branches.filter(
    (b) => b.displayed && INTERACTIVE_ID.test(b.id)
  ).length;
  const witheredCount = context.tree.branches.filter(
    (b) => b.withered && b.displayed
  ).length;
  const coveredDimensions = new Set(
    context.history.flatMap((h) => h.dimensions).filter((d) => DIMENSIONS.includes(d))
  ).size;

  const [flash, setFlash] = useState<{ amount: number; key: number } | null>(null);
  const prevLit = useRef(lit);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // 只随 lit 变化触发；定时器不做 cleanup（phase 流转会误杀它，导致 +N 永不消失）
  useEffect(() => {
    const diff = lit - prevLit.current;
    prevLit.current = lit;
    if (phaseRef.current !== 'genesis' && diff > 0) {
      setFlash({ amount: diff, key: Date.now() });
      setTimeout(() => setFlash(null), 3000);
    }
  }, [lit]);

  if (phase === 'genesis') return null;

  return (
    <div className="pointer-events-none absolute bottom-6 right-6 z-20 space-y-2 text-right font-extralight text-white/60 portrait:hidden">
      <div className="text-sm">
        你亲手点亮的可能{' '}
        <span className="text-xl text-white">{lit}</span> 条
        <AnimatePresence>
          {flash && (
            <motion.span
              key={flash.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="ml-2 text-[#bfe3ff]"
            >
              +{flash.amount}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="text-sm">
        由自己点亮的选择{' '}
        <span className="text-xl text-white">
          {Math.round(context.profile.selfReferRate * 100)}
        </span>
        %
      </div>
      <div className="text-sm">
        被照亮的生活面{' '}
        <span className="text-xl text-white">{coveredDimensions}</span>
        <span className="text-white/40">/{DIMENSIONS.length}</span>
      </div>
      <div className="text-sm">
        推演不动的路口{' '}
        <span className="text-xl text-white">{witheredCount}</span> 个
      </div>
      <div className="pt-2 text-[10px] tracking-wider text-white/30">
        以上数字由观观/敛敛引擎实时计算 · 非预设动画
      </div>
    </div>
  );
}
