import dotenv from 'dotenv';
import OpenAI from 'openai';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 显式加载 server/.env（无论进程从哪个目录启动）
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
dotenv.config();

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
