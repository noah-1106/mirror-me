// serverless 入口：引用构建期打好的单文件 CJS bundle（见 @oasis/server 的 bundle 脚本）。
// 不直接 import TS 源码——@vercel/node 的逐文件转译对 ESM workspace 包不可靠（踩过三轮坑）。
const app = require('../server/dist/bundle.cjs');

module.exports = app.default ?? app;
module.exports.config = {
  // 原始 body 交给 express 自己解析（/api/asr 需要 express.raw 收音频）
  api: { bodyParser: false },
  // LLM 推理模型调用可能 10-40s，给满 Hobby 上限
  maxDuration: 60,
};
