// 临时调试版：启动失败时把真实错误写进响应（定位后恢复直连导出）
let app: any;
let loadError: unknown = null;
try {
  // @vercel/node 输出 CJS，require 可用
  app = require('../server/src/index').default;
} catch (e) {
  loadError = e;
}

export default function handler(req: any, res: any) {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`BOOT ERROR:\n${(loadError as Error)?.stack ?? String(loadError)}`);
    return;
  }
  return app(req, res);
}

export const config = {
  // 原始 body 交给 express 自己解析（/api/asr 需要 express.raw 收音频）
  api: { bodyParser: false },
  // LLM 推理模型调用可能 10-40s，给满 Hobby 上限
  maxDuration: 60,
};
