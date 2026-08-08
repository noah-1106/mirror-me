export interface ResponseField {
  energy: number;
  relation: number;
  confidence: number;
  stress: number;
  curiosity: number;
}

export interface SituationState {
  id: string;
  title: string;
  description: string;
  choices: ChoiceOption[];
  isCritical?: boolean;
}

export interface ChoiceOption {
  id: string;
  text: string;
}

export interface ChoiceRecord {
  t: number;
  situationId: string;
  choiceId: string;
  choiceText: string;
  reasonText: string;
  pauseMs: number;
  dimensions: string[];
  selfReferential: boolean;
}

export interface Basin {
  id: string;
  label: string;
  probability: number;
}

export interface FProfile {
  selfReferRate: number;
  dimensionDistribution: Record<string, number>;
  hesitationPattern: {
    meanPause: number;
    stdPause: number;
  };
  responseBasins: Basin[];
}

export interface Alarm {
  type: 'EDT' | 'RANK' | 'PAUSE';
  severity: 'yellow' | 'orange' | 'red';
  dimension?: string;
  message: string;
}

export interface EchoQuestion {
  dimension: string;
  text: string;
}

export type WorldPhase = 'field' | 'choice' | 'divergence' | 'observe' | 'converge' | 'echo' | 'constellation';

export interface WorldContext {
  t: number;
  sceneId: string;
  R: ResponseField;
  W: SituationState;
  history: ChoiceRecord[];
  profile: FProfile;
  delta: number;
  alarms: Alarm[];
  echo?: EchoQuestion;
  phase: WorldPhase;
}

export interface WorldSnapshot {
  context: WorldContext;
  phase: WorldPhase;
}

// ────────────────────────────────────────────────
// v2: 世界树 × S2S × 双自己对话
// 见《设计方案v2_世界树与声音趋同.md》
// ────────────────────────────────────────────────

export type BasinId = 'self' | 'other' | 'avoid';

/** 一轮语音输入（v2 替代 ChoiceRecord 的观测单元） */
export interface TurnRecord {
  t: number;
  transcript: string;
  pauseMs: number;
  durationMs: number;
  dimensions: string[];
  basin: BasinId;
  selfReferential: boolean;
}

/** 端侧提取的语音统计特征（非录音，即取即弃后的统计轨迹） */
export interface VoiceFeatures {
  pitchHz: number;
  speechRate: number;
  pauseRatio: number;
}

/** 世界树的一根枝 */
export interface BranchNode {
  id: string;
  /** null = 直接长在树干上 */
  parentId: string | null;
  /** 第几轮生长事件长出 */
  growthT: number;
  /** 轨迹标签（池化文本的 key） */
  trajectoryLabel: string;
  basin: BasinId;
  /** 繁茂度 0-1：敛敛输出的 basin 概率 */
  vitality: number;
  /** 叶清晰度 0-1：δ⁺ 驱动，越低越雾 */
  clarity: number;
  /** 枝长：T_k 有效视界 */
  length: number;
  /** 0=冷色 1=暖金（自引驱动） */
  warmth: number;
  /** δ⁺ ≥ B：枯枝 */
  withered: boolean;
  /** 有的枝展示有的不展示（按概率与叙事价值筛选） */
  displayed: boolean;
  /** 渲染几何的确定性种子 */
  seed: number;
}

/** 一次生长事件（敛敛收敛触发；converged=false 表示 δ⁺≥B 收敛失败） */
export interface GrowthEvent {
  t: number;
  converged: boolean;
  /** 收敛后误差 δ⁺ */
  delta: number;
  newBranches: BranchNode[];
}

export interface TreeTopology {
  branches: BranchNode[];
  events: GrowthEvent[];
}

export * from './tree';
