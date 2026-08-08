import { randomUUID } from 'node:crypto';

/**
 * 豆包（火山引擎）TTS，HTTP 一次性合成。
 * 凭据：VOICE_APPID + VOICE_ACCESS_TOKEN（火山引擎控制台 → 语音技术 → 应用管理）。
 * 未配置时返回 null，调用方走降级链。
 */
export async function synthesizeSpeech(opts: {
  text: string;
  speedRatio: number;
  pitchRatio: number;
  voiceType?: string;
}): Promise<Buffer | null> {
  const appid = process.env.VOICE_APPID;
  const token = process.env.VOICE_ACCESS_TOKEN;
  if (!appid || !token) return null;

  const cluster = process.env.VOICE_CLUSTER ?? 'volcano_tts';
  const voiceType = opts.voiceType ?? process.env.VOICE_TYPE ?? 'zh_female_qingxin';

  try {
    const res = await fetch('https://openspeech.bytedance.com/api/v1/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer;${token}`,
      },
      body: JSON.stringify({
        app: { appid, token, cluster },
        user: { uid: 'mirror-me' },
        audio: {
          voice_type: voiceType,
          encoding: 'mp3',
          speed_ratio: Math.min(1.2, Math.max(0.8, opts.speedRatio)),
          pitch_ratio: Math.min(1.2, Math.max(0.8, opts.pitchRatio)),
        },
        request: {
          reqid: randomUUID(),
          text: opts.text,
          text_type: 'plain',
          operation: 'query',
        },
      }),
    });

    const json = (await res.json()) as { code?: number; data?: string; message?: string };
    if (json.code !== 3000 || !json.data) {
      console.warn('[doubao-tts] synthesis failed:', json.code, json.message);
      return null;
    }
    return Buffer.from(json.data, 'base64');
  } catch (err) {
    console.warn('[doubao-tts] request error:', err);
    return null;
  }
}
