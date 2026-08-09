import { useEffect, useRef } from 'react';
import { speak } from '../engine/speech';
import { useWorldState } from '../engine/useWorld';
import { useWorldStore } from '../store/worldStore';

/**
 * 世界引擎的嗓子（双声部）：
 * - 对话期：风声和弦（ambient），无语言，内容以全息文字呈现
 * - 终局（dialogue）：未来的自己说人话（仅本人克隆声纹，未复刻则静默）
 * 文字揭开时机由这里驱动：音频开始播放（或确定无声）→ setRevealedTurn，字随声现
 */
export function VoiceSpeaker() {
  const { context } = useWorldState();
  const setRevealedTurn = useWorldStore((s) => s.setRevealedTurn);
  // replyTurn 标记 reply 所属轮次：同一 reply 在 phase/t 流转期间重复触发 effect，只朗读一次
  const spokenTurn = useRef(-1);

  useEffect(() => {
    if (!context.reply || context.replyTurn === spokenTurn.current) return;
    spokenTurn.current = context.replyTurn;
    const turn = context.replyTurn;
    // 字随声现，但封顶 6 秒：本地复刻合成可能 30s+，不能让文字被声音扣为人质
    const fallback = setTimeout(() => setRevealedTurn(turn), 6000);
    speak(context.reply, {
      vocalise: context.phase !== 'dialogue',
      onReady: () => {
        clearTimeout(fallback);
        setRevealedTurn(turn);
      },
    });
  }, [context.reply, context.replyTurn, context.phase, setRevealedTurn]);

  return null;
}
