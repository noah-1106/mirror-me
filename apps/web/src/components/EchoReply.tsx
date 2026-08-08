import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useWorldState } from '../engine/useWorld';
import { useWorldStore } from '../store/worldStore';

/**
 * 全息回声：对话期回应的全息浮字（世界不"说"内容，只吟唱，内容以文字呈现）。
 * 浮现 6 秒后消散——全产品唯一的 AI 文本，克制即高级。
 */
export function EchoReply() {
  const { context, phase } = useWorldState();
  const revealedTurn = useWorldStore((s) => s.revealedTurn);
  const [visible, setVisible] = useState(false);
  // replyTurn 标记 reply 所属轮次：phase 流转会带着旧 reply 重复触发 effect，只展示新 reply
  const shownTurn = useRef(-1);
  // 字随声现：VoiceSpeaker 在音频开始播放（或确定无声）时才推进 revealedTurn
  const revealed = context.replyTurn >= 0 && revealedTurn >= context.replyTurn;

  useEffect(() => {
    if (phase === 'dialogue' || !context.reply || !revealed || context.replyTurn === shownTurn.current)
      return;
    shownTurn.current = context.replyTurn;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [context.reply, context.replyTurn, phase, revealed]);

  if (phase === 'genesis' || phase === 'dialogue') return null;

  return (
    <AnimatePresence>
      {visible && context.reply && (
        <motion.div
          key={context.reply}
          initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 1.4 }}
          className="pointer-events-none absolute inset-x-0 bottom-[22%] z-20 flex justify-center"
        >
          <div className="sacred-text max-w-2xl px-10 text-center text-3xl leading-relaxed tracking-[0.08em]">
            {context.reply}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
