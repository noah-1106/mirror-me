import dotenv from 'dotenv';
import OpenAI from 'openai';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 加载 .env（本地开发；serverless 平台直接注入环境变量，找不到文件无碍）
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'server/.env')]) {
  if (existsSync(p)) dotenv.config({ path: p });
}

const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.KIMI_API_KEY;
const baseURL = process.env.DEEPSEEK_BASE_URL ?? process.env.KIMI_BASE_URL ?? 'https://api.deepseek.com/v1';
export const model = process.env.DEEPSEEK_MODEL ?? process.env.KIMI_MODEL ?? 'deepseek-chat';

let client: OpenAI | null = null;

export function getLLMClient(): OpenAI | null {
  if (!apiKey) return null;
  if (!client) {
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}
