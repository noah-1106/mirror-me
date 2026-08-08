import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import narrateRoute from './routes/narrate';
import questionRoute from './routes/question';
import turnRoute from './routes/turn';
import dialogueRoute from './routes/dialogue';
import tagRoute from './routes/tag';
import readinessRoute from './routes/readiness';
import fragmentRoute from './routes/fragment';
import possibilitiesRoute from './routes/possibilities';
import ttsRoute from './routes/tts';
import asrRoute from './routes/asr';
import sessionRoute from './routes/session';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/narrate', narrateRoute);
app.use('/api/question', questionRoute);
app.use('/api/turn', turnRoute);
app.use('/api/dialogue', dialogueRoute);
app.use('/api/tag', tagRoute);
app.use('/api/readiness', readinessRoute);
app.use('/api/fragment', fragmentRoute);
app.use('/api/possibilities', possibilitiesRoute);
app.use('/api/tts', ttsRoute);
// ASR 走原始音频体，不能过 express.json
app.use('/api/asr', express.raw({ type: () => true, limit: '15mb' }), asrRoute);
app.use('/api/session', sessionRoute);

const PORT = process.env.PORT ?? 3001;
// Vercel serverless 下由平台托管请求，不自行监听
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`OASIS server listening on http://localhost:${PORT}`);
  });
}

export default app;
