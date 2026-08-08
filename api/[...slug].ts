import app from '../server/src/index';

export default app;

export const config = {
  // 原始 body 交给 express 自己解析（/api/asr 需要 express.raw 收音频）
  api: { bodyParser: false },
  // LLM 推理模型调用可能 10-40s，给满 Hobby 上限
  maxDuration: 60,
};
