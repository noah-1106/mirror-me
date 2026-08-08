import { Router } from 'express';
import { generateEchoQuestion } from '../agents/echo';

const router = Router();

router.post('/', async (req, res) => {
  const { dimension, R, profile } = req.body;

  try {
    const echo = await generateEchoQuestion(
      String(dimension || 'energy'),
      R ?? {},
      profile ?? { selfReferRate: 0.5, dimensionDistribution: {}, hesitationPattern: { meanPause: 2000, stdPause: 800 }, responseBasins: [] }
    );
    res.json({ echo });
  } catch (err) {
    console.error('/api/question error:', err);
    res.status(500).json({ error: '提问生成失败' });
  }
});

export default router;
