import { assign, fromPromise, setup } from 'xstate';
import type { Alarm, FProfile, TreeTopology, TurnRecord } from '@oasis/shared';
import { applyGrowthEvent, createEmptyTree, getTips, RED_DOT_TYPES } from '@oasis/shared';
import { scan } from '../agents/guanguan';
import { converge, shouldConverge } from '../agents/lianlian';
import { growthFromTurn, makeTurnRecord } from './growth';
import { computeCandidates, pickDiverseSelves } from './selves';

export type WorldPhase =
  | 'genesis' // 人生履历凝聚（开场，树已长成）
  | 'idle' // 在听
  | 'observing' // 观观扫描
  | 'converging' // 敛敛收敛 + 生长
  | 'responding' // 回应（S2S）
  | 'finale' // 终局叩门：继续 or 见未来的自己
  | 'dialogue'; // 终局：双自己对话

export interface WorldContext {
  t: number;
  /** 世界树拓扑：genesis 结束时由开场动画移交，之后由引擎生长 */
  tree: TreeTopology;
  history: TurnRecord[];
  profile: FProfile;
  delta: number;
  alarms: Alarm[];
  convergeCount: number;
  mostUncertainDimension?: string;
  lastTurn?: TurnRecord;
  /** 世界引擎的回应文本（由 React 层朗读） */
  reply?: string;
  /** reply 所属的轮次（生成该 reply 时的 t），防重播/重显 */
  replyTurn: number;
  /** 终局对话：当前在说话的"我"（真实枝 id，'' = 未选择） */
  activeSelf: string;
  /** 每个"我"的可能性碎片（branchId → 标本文本） */
  fragments: Record<string, string>;
  /** 每个"我"随机注入的红点特征（branchId → 红点 id，见 shared RED_DOT_TYPES） */
  selfRedDots: Record<string, string>;
  /** 终局模式：reddot = 红点名签+红点人设；free = 暖金/冷银/灰烬自由对话 */
  selfMode: 'reddot' | 'free';
  /** 叩门被拒次数（故事充分度不足），仅用于树引导强度 */
  gateFails: number;
  /** 故事还不够具体：提示树在回应里温柔地邀请讲具体的事 */
  needsStory: boolean;
  phase: WorldPhase;
}

export type WorldEvent =
  | { type: 'GENESIS_DONE'; tree: TreeTopology }
  | { type: 'HYDRATE'; history: TurnRecord[]; profile: FProfile; delta: number; tree: TreeTopology; convergeCount: number }
  | { type: 'VOICE_TURN'; transcript: string; pauseMs: number; durationMs: number }
  | { type: 'CONTINUE' } // 终局叩门时选择继续对话
  | { type: 'FINISH' } // 终局叩门时选择见未来的自己
  | { type: 'SELECT_SELF'; self: string } // 选择树梢上的某个"我"（真实枝 id）
  | { type: 'TOGGLE_SELF_MODE'; mode: 'reddot' | 'free' } // 终局模式切换：红点 / 自由
  | { type: 'EXIT_DIALOGUE' }; // 离开终局对话，回到倾听

const initialProfile: FProfile = {
  selfReferRate: 0.5,
  dimensionDistribution: {},
  hesitationPattern: { meanPause: 2000, stdPause: 800 },
  responseBasins: [
    { id: 'self', label: '自引', probability: 0.33 },
    { id: 'other', label: '他引', probability: 0.33 },
    { id: 'avoid', label: '回避', probability: 0.34 },
  ],
};

export const initialContext: WorldContext = {
  t: 0,
  tree: createEmptyTree(),
  history: [],
  profile: initialProfile,
  delta: 1.0,
  alarms: [],
  convergeCount: 0,
  activeSelf: '',
  fragments: {},
  selfRedDots: {},
  selfMode: 'reddot',
  gateFails: 0,
  needsStory: false,
  replyTurn: -1,
  phase: 'genesis',
};

const FINALE_EVERY_N_CONVERGES = 3; // 每收敛 3 次，终局叩门一次
const FINALE_DELTA = 0.55;

const observeActor = fromPromise(
  async ({ input }: { input: { history: TurnRecord[]; transcript: string } }) => {
    const alarms = scan(input.history);
    // LLM 打标（basin + 心理维度）：离线/失败返回 null，保留正则启发式的值
    if (typeof window === 'undefined') return { alarms, tag: null };
    try {
      const res = await fetch('/api/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: input.transcript }),
      });
      const data = await res.json();
      const tag =
        data?.tag && typeof data.tag.basin === 'string'
          ? (data.tag as { basin: TurnRecord['basin']; dimensions: string[] })
          : null;
      return { alarms, tag };
    } catch {
      return { alarms, tag: null };
    }
  }
);

const convergeActor = fromPromise(
  async ({
    input,
  }: {
    input: { history: TurnRecord[]; alarms: Alarm[]; profile: FProfile; tree: TreeTopology; turn: TurnRecord };
  }) => {
    const result = converge(input.history, input.alarms, input.profile);
    const redAlarm = input.alarms.some((a) => a.severity === 'red');

    // LLM 析取这句话真正包含的可能性方向（枝数 = 方向数）；离线/失败回落公式
    let possibilities = null;
    if (typeof window !== 'undefined') {
      try {
        const res = await fetch('/api/possibilities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: input.turn.transcript,
            history: input.history.map((h) => h.transcript).slice(-8),
            selfReferRate: result.profile.selfReferRate,
          }),
        });
        const data = await res.json();
        if (Array.isArray(data?.directions) && data.directions.length > 0) {
          possibilities = data.directions;
        }
      } catch {
        // 回落公式造枝
      }
    }

    const growth = growthFromTurn(input.tree, input.turn, result, redAlarm, possibilities);
    return { ...result, growth };
  }
);

const OFFLINE_REPLY = '我听到了。这件事里，你自己的感觉是什么？';
const OFFLINE_MIRROR_REPLY = '我还记得你说过的每一句话。哪一句，是你真正的心里话？';

const mirrorActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      message: string;
      history: string[];
      profile: FProfile;
      delta: number;
      self: { basin: string; withered: boolean; story: string[] };
      fragment?: string;
      redDot?: { name: string; essence: string };
    };
  }) => {
    if (typeof window === 'undefined') return { reply: OFFLINE_MIRROR_REPLY };
    const res = await fetch('/api/dialogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('mirror failed');
    const data = await res.json();
    return { reply: String(data.reply ?? OFFLINE_MIRROR_REPLY) };
  }
);

const respondActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      transcript: string;
      profile: FProfile;
      delta: number;
      mostUncertainDimension: string;
      history: string[];
      treeStats: { t: number; branches: number; tips: number };
      needsStory?: boolean;
    };
  }) => {
    // 测试/SSR 环境不走网络
    if (typeof window === 'undefined') return { reply: OFFLINE_REPLY };
    const res = await fetch('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('respond failed');
    const data = await res.json();
    return { reply: String(data.reply ?? OFFLINE_REPLY) };
  }
);

const readinessActor = fromPromise(
  async ({
    input,
  }: {
    input: { history: string[]; convergeCount: number; delta: number; selfReferRate: number };
  }) => {
    // 离线：引擎统计已达标即视为充分（演示/测试路径）
    if (typeof window === 'undefined') return { ready: true };
    try {
      const res = await fetch('/api/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      // LLM 挂了：回落引擎规则——δ 已经很低就当充分
      if (!data?.result) return { ready: input.delta <= 0.4 };
      return { ready: data.result.ready === true };
    } catch {
      return { ready: input.delta <= 0.4 };
    }
  }
);

const fragmentActor = fromPromise(
  async ({
    input,
  }: {
    input: { selves: { branchId: string; basin: string; withered: boolean; story: string[]; redDot?: { name: string; essence: string } }[] };
  }) => {
    const fragments: Record<string, string> = {};
    if (typeof window === 'undefined') return { fragments };
    await Promise.all(
      input.selves.map(async (s) => {
        try {
          const res = await fetch('/api/fragment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ basin: s.basin, withered: s.withered, story: s.story, redDot: s.redDot }),
          });
          const data = await res.json();
          if (typeof data?.fragment === 'string' && data.fragment) {
            fragments[s.branchId] = data.fragment;
          }
        } catch {
          // 单个碎片失败不阻塞终局
        }
      })
    );
    return { fragments };
  }
);

export const worldMachine = setup({
  types: {
    context: {} as WorldContext,
    events: {} as WorldEvent,
  },
  actors: {
    observe: observeActor,
    converge: convergeActor,
    respond: respondActor,
    mirror: mirrorActor,
    readiness: readinessActor,
    fragment: fragmentActor,
  },
}).createMachine({
  id: 'worldEngine',
  initial: 'genesis',
  context: initialContext,
  states: {
    genesis: {
      on: {
        GENESIS_DONE: {
          target: 'idle',
          actions: assign({
            tree: ({ event }) => event.tree,
            // genesis 占用的生长轮次（已活过的时光）：t 从移交树的最大 growthT 续起，
            // 保证交互轮次不与履历轮次撞号（selves lineage 依赖此约定）
            t: ({ event }) => Math.max(0, ...event.tree.branches.map((b) => b.growthT)),
            phase: 'idle',
          }),
        },
        // 会话恢复：跳过开场动画，直接带着记忆回到树下
        HYDRATE: {
          target: 'idle',
          actions: assign({
            tree: ({ event }) => event.tree,
            history: ({ event }) => event.history,
            profile: ({ event }) => event.profile,
            delta: ({ event }) => event.delta,
            convergeCount: ({ event }) => event.convergeCount,
            t: ({ event }) => event.history.length,
            phase: 'idle',
          }),
        },
      },
    },
    idle: {
      on: {
        VOICE_TURN: {
          target: 'observing',
          actions: assign({
            t: ({ context }) => context.t + 1,
            lastTurn: ({ context, event }) =>
              makeTurnRecord(context.t + 1, event.transcript, event.pauseMs, event.durationMs),
            history: ({ context, event }) => [
              ...context.history,
              makeTurnRecord(context.t + 1, event.transcript, event.pauseMs, event.durationMs),
            ],
            phase: 'observing',
          }),
        },
      },
    },
    observing: {
      invoke: {
        src: 'observe',
        input: ({ context }) => ({
          history: context.history,
          transcript: context.lastTurn?.transcript ?? '',
        }),
        onDone: [
          {
            // 触发器：分岔报警 / 高价值时刻 / 最大间隔兜底（不为更精确而观测）
            guard: ({ context, event }) =>
              shouldConverge(context.history.length, event.output.alarms, false),
            target: 'converging',
            actions: assign({
              alarms: ({ event }) => event.output.alarms,
              // LLM 打标成功则精修当轮记录（basin 影响收敛后的生长方向）
              lastTurn: ({ context, event }) =>
                event.output.tag && context.lastTurn
                  ? {
                      ...context.lastTurn,
                      basin: event.output.tag.basin,
                      dimensions: event.output.tag.dimensions,
                      selfReferential: event.output.tag.basin === 'self',
                    }
                  : context.lastTurn,
              history: ({ context, event }) =>
                event.output.tag
                  ? context.history.map((h) =>
                      h.t === context.t
                        ? {
                            ...h,
                            basin: event.output.tag!.basin,
                            dimensions: event.output.tag!.dimensions,
                            selfReferential: event.output.tag!.basin === 'self',
                          }
                        : h
                    )
                  : context.history,
              phase: 'converging',
            }),
          },
          {
            target: 'responding',
            actions: assign({
              alarms: ({ event }) => event.output.alarms,
              lastTurn: ({ context, event }) =>
                event.output.tag && context.lastTurn
                  ? {
                      ...context.lastTurn,
                      basin: event.output.tag.basin,
                      dimensions: event.output.tag.dimensions,
                      selfReferential: event.output.tag.basin === 'self',
                    }
                  : context.lastTurn,
              history: ({ context, event }) =>
                event.output.tag
                  ? context.history.map((h) =>
                      h.t === context.t
                        ? {
                            ...h,
                            basin: event.output.tag!.basin,
                            dimensions: event.output.tag!.dimensions,
                            selfReferential: event.output.tag!.basin === 'self',
                          }
                        : h
                    )
                  : context.history,
              phase: 'responding',
            }),
          },
        ],
      },
    },
    converging: {
      invoke: {
        src: 'converge',
        input: ({ context }) => ({
          history: context.history,
          alarms: context.alarms,
          profile: context.profile,
          tree: context.tree,
          turn: context.lastTurn!,
        }),
        onDone: [
          {
            guard: ({ context, event }) =>
              (context.convergeCount + 1) % FINALE_EVERY_N_CONVERGES === 0 &&
              event.output.delta <= FINALE_DELTA,
            target: 'gating',
            actions: assign({
              profile: ({ event }) => event.output.profile,
              delta: ({ event }) => event.output.delta,
              mostUncertainDimension: ({ event }) => event.output.mostUncertainDimension,
              tree: ({ context, event }) => applyGrowthEvent(context.tree, event.output.growth),
              convergeCount: ({ context }) => context.convergeCount + 1,
              phase: 'converging',
            }),
          },
          {
            target: 'responding',
            actions: assign({
              profile: ({ event }) => event.output.profile,
              delta: ({ event }) => event.output.delta,
              mostUncertainDimension: ({ event }) => event.output.mostUncertainDimension,
              tree: ({ context, event }) => applyGrowthEvent(context.tree, event.output.growth),
              convergeCount: ({ context }) => context.convergeCount + 1,
              phase: 'responding',
            }),
          },
        ],
      },
    },
    responding: {
      // S2S 回应：/api/turn 生成回应文本，React 层朗读（speechSynthesis）
      invoke: {
        src: 'respond',
        input: ({ context }) => ({
          transcript: context.lastTurn?.transcript ?? '',
          profile: context.profile,
          delta: context.delta,
          mostUncertainDimension: context.mostUncertainDimension ?? 'energy',
          history: context.history.map((h) => h.transcript).slice(-10),
          treeStats: {
            t: context.t,
            branches: context.tree.branches.filter((b) => b.displayed).length,
            tips: getTips(context.tree).filter((b) => b.displayed).length,
          },
          needsStory: context.needsStory,
        }),
        onDone: {
          target: 'idle',
          actions: assign({
            reply: ({ event }) => event.output.reply,
            replyTurn: ({ context }) => context.t,
            phase: 'idle',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            reply: () => OFFLINE_REPLY,
            replyTurn: ({ context }) => context.t,
            phase: 'idle',
          }),
        },
      },
    },
    gating: {
      // 故事充分度闸门：LLM + 引擎统计共同判定收集的故事够不够撑起终局对话
      invoke: {
        src: 'readiness',
        input: ({ context }) => ({
          history: context.history.map((h) => h.transcript),
          convergeCount: context.convergeCount,
          delta: context.delta,
          selfReferRate: context.profile.selfReferRate,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.ready,
            target: 'finale',
            actions: assign({ phase: 'finale', gateFails: 0, needsStory: false }),
          },
          {
            // 故事还不够：回到倾听，树会温柔地邀请他讲具体的事。
            // 没有怜悯放行——没有故事的终局是空壳，门要自己挣，树负责指路。
            target: 'responding',
            actions: assign({
              phase: 'responding',
              gateFails: ({ context }) => context.gateFails + 1,
              needsStory: true,
            }),
          },
        ],
      },
    },
    finale: {
      on: {
        CONTINUE: { target: 'idle', actions: assign({ phase: 'idle' }) },
        FINISH: {
          target: 'summoning',
          actions: assign({
            phase: 'dialogue',
            // 进入终局时自动选中最多 3 个故事迥异的"我"里的第一个
            activeSelf: ({ context }) =>
              pickDiverseSelves(computeCandidates(context.tree, context.history))[0]?.branchId ??
              '',
            // 每个"我"随机注入一个互不重复的红点特征（可能性风味，非诊断）
            selfRedDots: ({ context }) => {
              const selves = pickDiverseSelves(computeCandidates(context.tree, context.history));
              const pool = [...RED_DOT_TYPES].sort(() => Math.random() - 0.5);
              const map: Record<string, string> = {};
              selves.forEach((s, i) => {
                map[s.branchId] = pool[i % pool.length].id;
              });
              return map;
            },
          }),
        },
      },
    },
    summoning: {
      // 为每个候选的"我"取可能性碎片（未来的自己的血肉）
      invoke: {
        src: 'fragment',
        input: ({ context }) => ({
          selves: pickDiverseSelves(computeCandidates(context.tree, context.history)).map((s) => ({
            branchId: s.branchId,
            basin: s.basin,
            withered: s.withered,
            story: s.story,
            redDot: RED_DOT_TYPES.find((r) => r.id === context.selfRedDots[s.branchId]),
          })),
        }),
        onDone: {
          target: 'dialogue',
          actions: assign({
            fragments: ({ event }) => event.output.fragments,
          }),
        },
        onError: { target: 'dialogue' },
      },
    },
    dialogue: {
      on: {
        EXIT_DIALOGUE: { target: 'idle', actions: assign({ phase: 'idle' }) },
        SELECT_SELF: {
          actions: assign({ activeSelf: ({ event }) => event.self }),
        },
        TOGGLE_SELF_MODE: {
          actions: assign({ selfMode: ({ event }) => event.mode }),
        },
        VOICE_TURN: {
          target: 'dialogueTurn',
          actions: assign({
            t: ({ context }) => context.t + 1,
            lastTurn: ({ context, event }) =>
              makeTurnRecord(context.t + 1, event.transcript, event.pauseMs, event.durationMs),
            history: ({ context, event }) => [
              ...context.history,
              makeTurnRecord(context.t + 1, event.transcript, event.pauseMs, event.durationMs),
            ],
          }),
        },
      },
    },
    dialogueTurn: {
      invoke: {
        src: 'mirror',
        input: ({ context }) => {
          const self = computeCandidates(context.tree, context.history).find(
            (c) => c.branchId === context.activeSelf
          );
          return {
            message: context.lastTurn?.transcript ?? '',
            history: context.history.map((h) => h.transcript),
            profile: context.profile,
            delta: context.delta,
            self: self
              ? { basin: self.basin, withered: self.withered, story: self.story }
              : { basin: 'self' as const, withered: false, story: [] },
            fragment: context.fragments[context.activeSelf],
            redDot:
              context.selfMode === 'reddot'
                ? RED_DOT_TYPES.find((r) => r.id === context.selfRedDots[context.activeSelf])
                : undefined,
          };
        },
        onDone: {
          target: 'dialogue',
          actions: assign({
            reply: ({ event }) => event.output.reply,
            replyTurn: ({ context }) => context.t,
          }),
        },
        onError: {
          target: 'dialogue',
          actions: assign({
            reply: () => OFFLINE_MIRROR_REPLY,
            replyTurn: ({ context }) => context.t,
          }),
        },
      },
    },
  },
});
