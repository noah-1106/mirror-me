import type { Alarm, EchoQuestion, FProfile, ResponseField, SituationState, WorldPhase } from '@oasis/shared';
import { create } from 'zustand';
import type { Actor } from 'xstate';
import type { worldMachine } from '../engine/worldMachine';

type WorldActor = Actor<typeof worldMachine>;

export interface VisualState {
  phase: WorldPhase;
  R: ResponseField;
  delta: number;
  alarms: Alarm[];
  situation: SituationState | null;
  echo: EchoQuestion | null;
  profile: FProfile | null;
  divergenceMoment: {
    active: boolean;
    origin: [number, number, number] | null;
    timestamp: number;
  };
  actor: WorldActor | null;
  /** 终局对话：镜头/对话聚焦在哪个"我"（branchId），null = 全景 */
  focusedSelf: string | null;
  /** 已揭开文字的 reply 轮次：音频开始播放（或确定无声）时才揭开，字随声现 */
  revealedTurn: number;
  /** 本轮会话是否用过语音输入（没用过则人声通道整体跳过，文字不等声音） */
  usedVoice: boolean;
}

export interface WorldStore extends VisualState {
  setPhase: (phase: WorldPhase) => void;
  setR: (R: ResponseField) => void;
  setDelta: (delta: number) => void;
  setAlarms: (alarms: Alarm[]) => void;
  setSituation: (situation: SituationState | null) => void;
  setEcho: (echo: EchoQuestion | null) => void;
  setProfile: (profile: FProfile | null) => void;
  triggerDivergence: (origin: [number, number, number]) => void;
  clearDivergence: () => void;
  initActor: () => void;
  setActor: (actor: WorldActor) => void;
  setFocusedSelf: (branchId: string | null) => void;
  setRevealedTurn: (t: number) => void;
  setUsedVoice: () => void;
}

// 模块级防重入：动态 import 窗口期内 actor 仍是 null，同步 guard 挡不住重复初始化
let actorInitStarted = false;

export const useWorldStore = create<WorldStore>((set, get) => ({
  phase: 'field',
  R: {
    energy: 0.5,
    relation: 0.5,
    confidence: 0.5,
    stress: 0.5,
    curiosity: 0.5,
  },
  delta: 1.0,
  alarms: [],
  situation: null,
  echo: null,
  profile: null,
  divergenceMoment: {
    active: false,
    origin: null,
    timestamp: 0,
  },
  actor: null,
  focusedSelf: null,
  revealedTurn: -1,
  usedVoice: false,
  setPhase: (phase) => set({ phase }),
  setR: (R) => set({ R }),
  setDelta: (delta) => set({ delta }),
  setAlarms: (alarms) => set({ alarms }),
  setSituation: (situation) => set({ situation }),
  setEcho: (echo) => set({ echo }),
  setProfile: (profile) => set({ profile }),
  triggerDivergence: (origin) =>
    set({
      divergenceMoment: { active: true, origin, timestamp: Date.now() },
    }),
  clearDivergence: () =>
    set({
      divergenceMoment: { active: false, origin: null, timestamp: 0 },
    }),
  initActor: () => {
    if (actorInitStarted || get().actor) return;
    actorInitStarted = true;
    import('../engine/worldMachine').then(({ worldMachine: machine }) => {
      import('xstate').then(({ createActor }) => {
        const actor = createActor(machine);
        actor.start();
        set({ actor });
      });
    });
  },
  setActor: (actor) => set({ actor }),
  setFocusedSelf: (focusedSelf) => set({ focusedSelf }),
  setRevealedTurn: (revealedTurn) => set({ revealedTurn }),
  setUsedVoice: () => set({ usedVoice: true }),
}));
