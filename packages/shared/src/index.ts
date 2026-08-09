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

/** 九种人生红点（Truman 课程框架）：终局取舍象限 = 追求结果/过程 × 现实/理想 */
export interface RedDotType {
  id: string;
  name: string;
  /** 一句话本质（mirror 人设/碎片生成用） */
  essence: string;
}

export const RED_DOT_TYPES: RedDotType[] = [
  { id: 'money', name: '赚钱型', essence: '终局是财富本身——有钱，且越来越有钱' },
  { id: 'fame', name: '出名型', essence: '终局是被看见——名气、影响力、说话有人听' },
  { id: 'vision', name: '愿景型', essence: '终局是改变世界——让某件事因为自己而不同' },
  { id: 'work', name: '作品型', essence: '终局是作品——很多年后还有人因它受益' },
  { id: 'life', name: '生活型', essence: '终局是生活本身——安稳、幸福、有质量的日子' },
  { id: 'experience', name: '体验型', essence: '终局是体验的丰富度——看过、玩过、活过' },
  { id: 'process', name: '过程型', essence: '终局是在路上的意义感——攀登本身就是答案' },
  { id: 'inner', name: '内心型', essence: '终局是内心的丰盈与平静——自洽、精神富足' },
  { id: 'master', name: '高手型', essence: '终局是把一门手艺练到极致——领域里绕不开的人' },
];
