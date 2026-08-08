import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 会话记忆 store（JSON 文件，每会话一份）。
 * 红线切法（方案 A）：转写文本匿名化、按会话 ID 隔离、可一键清除；原始音频永不留存。
 */

export interface SessionSnapshot {
  sessionId: string;
  updatedAt: string;
  history: unknown[];
  profile: unknown;
  delta: number;
  tree: unknown;
  convergeCount: number;
}

// serverless（Vercel）只有 /tmp 可写且随时清空；本地开发用项目目录持久化
const dataDir = join(process.env.VERCEL ? '/tmp' : process.cwd(), 'data', 'sessions');
try {
  mkdirSync(dataDir, { recursive: true });
} catch {
  // 只读文件系统：会话功能静默降级为不持久化
}

const fileFor = (sessionId: string) =>
  join(dataDir, `${sessionId.replace(/[^a-zA-Z0-9-]/g, '')}.json`);

export function saveSession(snapshot: SessionSnapshot): void {
  try {
    writeFileSync(fileFor(snapshot.sessionId), JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch {
    // 只读文件系统：忽略
  }
}

export function loadSession(sessionId: string): SessionSnapshot | null {
  try {
    return JSON.parse(readFileSync(fileFor(sessionId), 'utf-8')) as SessionSnapshot;
  } catch {
    return null;
  }
}

export function deleteSession(sessionId: string): void {
  try {
    rmSync(fileFor(sessionId));
  } catch {
    // 不存在即已清除
  }
}
