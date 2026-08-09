import { Router } from 'express';
import { checkSensitiveContent } from '../agents/gatekeeper';
import { generateMirrorReply } from '../agents/mirror';

const router = Router();

router.post('/', async (req, res) => {
  const { message, history, profile, delta, self, fragment, redDot } = req.body ?? {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  const check = checkSensitiveContent(message);
  if (!check.ok) {
    return res.json({
      fused: true,
      reply: '这个话题我接不住。去找一个你信任的大人聊聊，比跟我说更有用。',
    });
  }

  try {
    const reply = await generateMirrorReply({
      message: message.slice(0, 500),
      history: Array.isArray(history) ? history.map(String).slice(0, 20) : [],
      delta: typeof delta === 'number' ? delta : 0.5,
      selfReferRate: profile?.selfReferRate ?? 0.5,
      self: {
        basin: typeof self?.basin === 'string' ? self.basin : 'self',
        withered: self?.withered === true,
        story: Array.isArray(self?.story) ? self.story.map(String).slice(0, 10) : [],
      },
      fragment: typeof fragment === 'string' ? fragment.slice(0, 200) : undefined,
      redDot:
        redDot && typeof redDot.name === 'string' && typeof redDot.essence === 'string'
          ? { name: redDot.name.slice(0, 10), essence: redDot.essence.slice(0, 60) }
          : undefined,
    });
    res.json({ fused: false, reply });
  } catch (err) {
    console.error('/api/dialogue error:', err);
    res.json({ fused: false, reply: '我记得你说过的每一句话。再说一句，我在听。' });
  }
});

export default router;
