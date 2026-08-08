import { Router } from 'express';
import { deleteSession, loadSession, saveSession } from '../services/memory';

const router = Router();

router.get('/:id', (req, res) => {
  const snapshot = loadSession(req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'session not found' });
  res.json(snapshot);
});

router.post('/:id', (req, res) => {
  const { history, profile, delta, tree, convergeCount } = req.body ?? {};
  saveSession({
    sessionId: req.params.id,
    updatedAt: new Date().toISOString(),
    history: Array.isArray(history) ? history : [],
    profile: profile ?? {},
    delta: typeof delta === 'number' ? delta : 1,
    tree: tree ?? { branches: [], events: [] },
    convergeCount: typeof convergeCount === 'number' ? convergeCount : 0,
  });
  res.json({ ok: true });
});

// 一键清除（数据红线）
router.delete('/:id', (req, res) => {
  deleteSession(req.params.id);
  res.json({ ok: true });
});

// 离开即清除（sendBeacon 只能 POST）：会话 + 声纹素材全清
router.post('/purge', async (req, res) => {
  const session = String(req.query.session ?? '');
  const voice = String(req.query.voice ?? '');
  if (session) deleteSession(session);
  if (voice) {
    try {
      await fetch(
        `${process.env.TTS_SIDECAR_URL ?? 'http://localhost:5100'}/refs/${encodeURIComponent(voice)}`,
        { method: 'DELETE' }
      );
    } catch {
      // sidecar 不在也视为已清
    }
  }
  res.json({ ok: true });
});

export default router;
