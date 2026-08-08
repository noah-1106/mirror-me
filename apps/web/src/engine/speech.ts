/**
 * 语音合成：只走本地 sidecar。
 * （声音渐变特性已取消：不能复刻声线，且定制音色生成周期长——设计决策 2026-08-09）
 */
import { getProfile } from './session';

const VOICE = { rate: 1.0, pitch: 1.0 };

let currentAudio: HTMLAudioElement | null = null;

async function speakViaServer(text: string, vocalise: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        speedRatio: VOICE.rate,
        pitchRatio: VOICE.pitch,
        voice: getProfile(),
        mode: vocalise ? 'ambient' : undefined,
      }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.size === 0) return false;
    currentAudio?.pause();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    currentAudio = audio;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

/**
 * 双声部：
 * - vocalise=true：世界引擎之声——风声和弦，无语言（sidecar 不可用时静默）
 * - vocalise=false：未来的自己——只用自己的克隆声纹；未复刻则静默（文字呈现），
 *   绝不用替身声线（恐怖谷红线 2026-08-09）
 */
export function speak(
  text: string,
  opts?: { vocalise?: boolean; onReady?: () => void }
): void {
  if (typeof window === 'undefined') return;
  const vocalise = opts?.vocalise ?? false;
  // onReady：音频开始播放，或确定无声（未复刻/合成失败）——无论哪种都揭开文字，字随声现
  void speakViaServer(text, vocalise).then(() => opts?.onReady?.());
}
