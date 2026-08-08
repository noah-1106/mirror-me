import { Router } from 'express';
import { synthesizeSpeech } from '../services/doubaoTts';

const router = Router();
const SIDECAR_URL = process.env.TTS_SIDECAR_URL ?? 'http://localhost:5100';

/** 本地 sidecar：POST /tts → wav（mode 透传：ambient 风声和弦 / 默认人声） */
async function synthesizeViaSidecar(
  text: string,
  voice?: string,
  mode?: string
): Promise<Buffer | null> {
  try {
    const res = await fetch(`${SIDECAR_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voice ?? 'a', speed: 1, mode }),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null; // sidecar 没起就走下一级降级
  }
}

router.post('/', async (req, res) => {
  const { text, speedRatio, pitchRatio, voice, mode } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text required' });
  }
  const trimmed = text.slice(0, 300);

  // 世界引擎之声（ambient 风声和弦）只走 sidecar 生成
  if (mode === 'ambient') {
    const ambient = await synthesizeViaSidecar(trimmed, undefined, 'ambient');
    if (ambient) {
      res.set({ 'Content-Type': 'audio/wav', 'Content-Length': ambient.length });
      return res.send(ambient);
    }
    return res.status(204).end();
  }

  // 人设 → 复刻声线（豆包声音复刻的 voice id，控制台录制获得）
  const persona = typeof voice === 'string' ? voice : 'a';
  const clonedVoice =
    persona === 'b' ? process.env.VOICE_TYPE_B : process.env.VOICE_TYPE_A;

  // 降级链：豆包 TTS（复刻声线优先）→ 本地 Kokoro sidecar → 204（前端浏览器 TTS）
  const doubao = await synthesizeSpeech({
    text: trimmed,
    speedRatio: typeof speedRatio === 'number' ? speedRatio : 1,
    pitchRatio: typeof pitchRatio === 'number' ? pitchRatio : 1,
    voiceType: clonedVoice || undefined,
  });
  if (doubao) {
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': doubao.length });
    return res.send(doubao);
  }

  const local = await synthesizeViaSidecar(trimmed, persona);
  if (local) {
    res.set({ 'Content-Type': 'audio/wav', 'Content-Length': local.length });
    return res.send(local);
  }

  return res.status(204).end();
});

export default router;
