import { Router } from 'express';

const router = Router();
const SIDECAR_URL = process.env.TTS_SIDECAR_URL ?? 'http://localhost:5100';

/** ASR 代理：浏览器录音 → 本地 FunASR sidecar；副本送克隆素材收集（进入时已知情同意） */
router.post('/', async (req, res) => {
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: 'audio required' });
  }
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/webm' }), 'audio.webm');
    const r = await fetch(`${SIDECAR_URL}/asr`, { method: 'POST', body: form });
    if (!r.ok) return res.status(502).json({ error: 'asr sidecar failed' });

    // 声线素材收集（fire-and-forget）：用户进入时已勾选知情同意
    const persona = String(req.query.voice ?? '');
    if (persona) {
      const collectForm = new FormData();
      collectForm.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/webm' }), 'audio.webm');
      void fetch(`${SIDECAR_URL}/collect?persona=${encodeURIComponent(persona)}`, {
        method: 'POST',
        body: collectForm,
      }).catch(() => {});
    }

    res.json(await r.json());
  } catch {
    res.status(502).json({ error: 'asr sidecar unreachable' });
  }
});

export default router;
