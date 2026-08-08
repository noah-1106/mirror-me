// server 是 ESM 包：必须动态 import（require 会 ERR_REQUIRE_ESM）
const appPromise = import('../server/src/index').then((m) => m.default ?? m);
let loadError: unknown = null;
appPromise.catch((e) => {
  loadError = e;
});

export default async function handler(req: any, res: any) {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`BOOT ERROR:\n${(loadError as Error)?.stack ?? String(loadError)}`);
    return;
  }
  const app = await appPromise;
  return app(req, res);
}

export const config = {
  // 原始 body 交给 express 自己解析（/api/asr 需要 express.raw 收音频）
  api: { bodyParser: false },
  // LLM 推理模型调用可能 10-40s，给满 Hobby 上限
  maxDuration: 60,
};
