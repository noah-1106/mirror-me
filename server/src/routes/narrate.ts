import { Router } from 'express';
import type { SituationState } from '@oasis/shared';
import { narrateNextSituation } from '../agents/narrator';

const router = Router();

router.post('/', async (req, res) => {
  const { t, previousSituation, lastChoice, lastReason, selfReferRate, delta, R, profile, alarms, history, mostUncertainDimension } = req.body;

  try {
    const situation = await narrateNextSituation({
      t: Number(t) || 0,
      previousSituation,
      lastChoice,
      lastReason,
      selfReferRate: Number(selfReferRate) || 0.5,
      delta: Number(delta) || 1.0,
      R,
      profile,
      alarms,
      history,
      mostUncertainDimension,
    });

    res.json({ situation });
  } catch (err) {
    console.error('/api/narrate error:', err);
    res.status(500).json({ error: '情境生成失败' });
  }
});

export default router;
