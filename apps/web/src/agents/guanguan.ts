import type { Alarm, TurnRecord } from '@oasis/shared';

const EDT_WINDOW = 3;
const EDT_THRESHOLD = 0.4;
const RANK_THRESHOLD = 2;
const PAUSE_Z_THRESHOLD = 1.5;

/** 开口前等待超过此时长视为"离开了电脑"，不计入迟疑统计（墙钟时间会被 AFK 污染） */
export const AWAY_MS = 45_000;

function selfReferentialRate(records: TurnRecord[]): number {
  if (records.length === 0) return 0.5;
  return records.filter((r) => r.selfReferential).length / records.length;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + Math.pow(b - m, 2), 0) / values.length);
}

export function scan(history: TurnRecord[]): Alarm[] {
  const alarms: Alarm[] = [];

  if (history.length < EDT_WINDOW * 2) {
    return alarms;
  }

  // EDT 代理：自引率滑动窗口变化
  const recent = history.slice(-EDT_WINDOW * 2);
  const window1 = recent.slice(0, EDT_WINDOW);
  const window2 = recent.slice(EDT_WINDOW);
  const edt = Math.abs(selfReferentialRate(window1) - selfReferentialRate(window2));
  if (edt > EDT_THRESHOLD) {
    alarms.push({
      type: 'EDT',
      severity: 'orange',
      message: '自引率结构发生显著变形',
    });
  }

  // 秩监控：理由维度活跃数下降
  const dimensions = new Set(history.slice(-5).flatMap((r) => r.dimensions));
  if (dimensions.size < RANK_THRESHOLD) {
    alarms.push({
      type: 'RANK',
      severity: 'yellow',
      dimension: Array.from(dimensions).join(','),
      message: '决策维度数偏低，响应场可能坍缩',
    });
  }

  // 停顿监控：Z-score 超过阈值（AFK 轮次既不当证据也不进样本）
  const lastTurn = history[history.length - 1];
  if (lastTurn.pauseMs <= AWAY_MS) {
    const pauses = history.map((r) => r.pauseMs).filter((p) => p <= AWAY_MS);
    const m = mean(pauses);
    const s = std(pauses);
    const z = s === 0 ? 0 : (lastTurn.pauseMs - m) / s;
    if (z > PAUSE_Z_THRESHOLD) {
      alarms.push({
        type: 'PAUSE',
        severity: 'red',
        message: '这个选择对孩子很重',
      });
    }
  }

  return alarms;
}
