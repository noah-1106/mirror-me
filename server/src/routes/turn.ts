import { Router } from 'express';
import { checkSensitiveContent } from '../agents/gatekeeper';
import { generateReply } from '../agents/responder';

const router = Router();

router.post('/', async (req, res) => {
  const { transcript, profile, delta, mostUncertainDimension, history, treeStats, needsStory } = req.body ?? {};

  if (typeof transcript !== 'string' || !transcript.trim()) {
    return res.status(400).json({ error: 'transcript required' });
  }

  // 守门员：敏感话题熔断，提示去和信任的大人聊聊
  const check = checkSensitiveContent(transcript);
  if (!check.ok) {
    return res.json({
      fused: true,
      reply: '这个话题我可能接不住。去找一个你信任的大人聊聊，好吗？',
    });
  }

  try {
    const reply = await generateReply({
      transcript: transcript.slice(0, 500),
      delta: typeof delta === 'number' ? delta : 1,
      mostUncertainDimension: String(mostUncertainDimension ?? 'energy'),
      selfReferRate: profile?.selfReferRate ?? 0.5,
      history: Array.isArray(history) ? history.map(String).slice(0, 10) : [],
      needsStory: needsStory === true,
      treeStats: {
        t: typeof treeStats?.t === 'number' ? treeStats.t : 0,
        branches: typeof treeStats?.branches === 'number' ? treeStats.branches : 0,
        tips: typeof treeStats?.tips === 'number' ? treeStats.tips : 0,
      },
    });
    res.json({ fused: false, reply });
  } catch (err) {
    console.error('/api/turn error:', err);
    res.json({ fused: false, reply: '我听到了。这件事里，你自己的感觉是什么？' });
  }
});

export default router;
