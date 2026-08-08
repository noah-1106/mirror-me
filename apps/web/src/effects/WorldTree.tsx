import type { BranchNode, TreeTopology } from '@oasis/shared';
import { getDisplayedBranches } from '@oasis/shared';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mulberry32 } from './prng';
import { taperedTube } from './taperedTube';

/** 生长演出的实时状态（ref 传递，避免每帧触发 React 重渲染） */
export interface TreeVisualState {
  /** 每根枝的生长进度 0-1，缺省视为 1（已定型） */
  progress: Record<string, number>;
  /** 每根枝的生长开始时刻 */
  branchStarts: Record<string, number>;
  /** 进行中的光脉冲 */
  pulses: Array<{ branchId: string; start: number }>;
  /** 0-1，有枝在生长时推高（相机推近用） */
  growthStrength: number;
  /** 引擎收敛次数（相机随生长持续后退用） */
  convergeCount: number;
  /** δ 驱动：终局剪影的清晰度（P6 用） */
  clarity: number;
  /** 每根枝的梢端世界坐标（布局生成时写入；终局光团/相机焦点用） */
  tipPositions: Record<string, THREE.Vector3>;
  /** 相机焦点（终局：镜头跟到某团呼吸的光旁；null = 默认导播运镜） */
  focus: THREE.Vector3 | null;
}

export function createTreeVisualState(): TreeVisualState {
  return { progress: {}, branchStarts: {}, pulses: [], growthStrength: 0, convergeCount: 0, clarity: 0.3, tipPositions: {}, focus: null };
}

// ── 结构常数：洛基式故事树——时间线绞成干，递归分叉成冠 ──
// 树干压低，让树冠占画面主角
const TRUNK_TOP = 2.9;
const STRAND_COUNT = 72;
const STRAND_RADIUS = 0.022;
const STRAND_TIP_RADIUS = 0.012;
/** 股线编织：种子光先独自呼吸 2.8s，然后跟随镜头编织，8.6s 编完 */
const BRAID_START = 2.8;
const BRAID_END = 8.6;

/** 叶序螺旋航道：黄金角经度 + 纬度 + 壳半径占比 */
interface Lane {
  theta: number;
  phi: number;
  fill: number;
}

interface SplitLayout {
  curve: THREE.CatmullRomCurve3;
  radius: number;
  tipRadius: number;
  tip: THREE.Vector3;
  /** 叶序航道：这条故事线在树冠螺旋上的位置（子代沿它继续爬升外扩） */
  lane: Lane;
}

interface BranchLayout {
  node: BranchNode;
  /** 一次分叉波：从一个故事线末端分出的若干新故事线 */
  splits: SplitLayout[];
  /** 干生分叉所延续的股线（光脉冲路径用） */
  strandCurve: THREE.CatmullRomCurve3 | null;
  /** 分叉起点颜色（父梢色）→ 末端颜色（自身色），管身渐变 */
  colorStart: THREE.Color;
  colorEnd: THREE.Color;
}

interface TreeLayout {
  trunkCenter: THREE.CatmullRomCurve3;
  strands: THREE.CatmullRomCurve3[];
  branches: BranchLayout[];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 给锥形管几何加顶点色渐变：从散开处开始，由 start 渐变到 end */
function applyTubeGradient(
  geometry: THREE.BufferGeometry,
  tubularSegments: number,
  radialSegments: number,
  start: THREE.Color,
  end: THREE.Color
): void {
  const count = (tubularSegments + 1) * (radialSegments + 1);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  let idx = 0;
  for (let i = 0; i <= tubularSegments; i++) {
    const t = smoothstep(0.2, 1, i / tubularSegments);
    color.copy(start).lerp(end, t);
    for (let j = 0; j <= radialSegments; j++) {
      colors[idx * 3] = color.r;
      colors[idx * 3 + 1] = color.g;
      colors[idx * 3 + 2] = color.b;
      idx++;
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ── 树冠包络：椭球，随树龄放大（幼冠小，越长越大越丰富）──
const CANOPY_CENTER = new THREE.Vector3(0, 3.5, 0);
const CANOPY_RADII = new THREE.Vector3(2.9, 1.6, 2.9);
const GOLDEN_ANGLE = 2.39996; // 137.5° 黄金角——自然界叶序的螺旋秩序

/** 树冠包络随树龄放大：幼冠约为成冠的 3/4，交互生长一路放到 1.2 */
function canopyScale(growthT: number): number {
  return 0.75 + Math.min(0.45, growthT * 0.05);
}

function laneTarget(lane: Lane, scale: number): THREE.Vector3 {
  const sinPhi = Math.sin(lane.phi);
  return new THREE.Vector3(
    CANOPY_CENTER.x + CANOPY_RADII.x * scale * sinPhi * Math.cos(lane.theta) * lane.fill,
    CANOPY_CENTER.y + CANOPY_RADII.y * scale * Math.cos(lane.phi) * lane.fill,
    CANOPY_CENTER.z + CANOPY_RADII.z * scale * sinPhi * Math.sin(lane.theta) * lane.fill
  );
}

/**
 * 去掉切线里的切向（绕轴螺旋）分量，只保留"向上+向外"平面的方向——
 * 螺旋上升的股线梢头切线自带甩劲，分叉不该继承
 */
function unswirl(tangent: THREE.Vector3, point: THREE.Vector3): THREE.Vector3 {
  const radial = new THREE.Vector3(point.x, 0, point.z).normalize();
  const tanAxis = new THREE.Vector3(0, 1, 0).cross(radial);
  return tangent.clone().addScaledVector(tanAxis, -tangent.dot(tanAxis)).normalize();
}

/**
 * 从一个故事线末端分出新故事线。
 * 秩序来自叶序螺旋：子代沿父代的航道按黄金角排开，纬度逐代爬升（向上）、
 * 壳半径逐代外扩（向外）——螺旋着长成椭球树冠，不是乱撒。
 * 曲线先沿父梢切线续接，再弯向航道目标——平滑不断肢。
 */
function splitFrom(
  rand: () => number,
  start: THREE.Vector3,
  tangent: THREE.Vector3,
  radius: number,
  count: number,
  lenBase: number,
  parentLane: Lane,
  fillStep: number,
  scale: number,
  phiStep = -0.1,
  outward = false,
  vigor = -1
): SplitLayout[] {
  const splits: SplitLayout[] = [];
  // 父梢的实际壳距：子代落点必须单调向外，不许掉头回壳内（鸟窝感的根源）
  const rel = start.clone().sub(CANOPY_CENTER);
  const startFill = Math.hypot(
    rel.x / (CANOPY_RADII.x * scale),
    rel.y / (CANOPY_RADII.y * scale),
    rel.z / (CANOPY_RADII.z * scale)
  );
  // 离轴向外方向（outward 模式用）
  const radialOut = new THREE.Vector3(rel.x, 0, rel.z).normalize();
  for (let s = 0; s < count; s++) {
    const lane: Lane = {
      theta: parentLane.theta + GOLDEN_ANGLE * 0.5 * (s + 1) + (rand() - 0.5) * 0.15,
      phi: Math.min(
        Math.max(parentLane.phi + phiStep - rand() * 0.05, 0.12 * Math.PI),
        0.88 * Math.PI
      ),
      fill: Math.min(
        Math.max(parentLane.fill + fillStep * (0.8 + rand() * 0.4), startFill + 0.08),
        1.3
      ),
    };
    let dir: THREE.Vector3;
    let len: number;
    if (outward) {
      // 长势值三重作用：陡枝更少继承母线方向（几乎直指天空，不拐弯）、
      // 径向/竖直配比拉开、长度加成——顶端优势 = 更高更直
      const v = vigor >= 0 ? vigor : rand();
      const desired = tangent
        .clone()
        .multiplyScalar(0.55 - v * 0.25)
        .addScaledVector(radialOut, 0.75 - v * 0.45)
        // 平躺档不再回勾（J 形钩病根）：向上分量只随长势出现
        .add(new THREE.Vector3(0, 0.15 + v * 0.7, 0))
        .normalize()
        .applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          (s - (count - 1) / 2) * 0.35 + (rand() - 0.5) * 0.2
        );
      // 离干角放宽到约 66°：枝从股线上张得更开，树冠展开角度更大
      const outwardAngle = desired.angleTo(tangent);
      const MAX_OUTWARD_BEND = 1.15;
      dir =
        outwardAngle > MAX_OUTWARD_BEND
          ? tangent.clone().lerp(desired, MAX_OUTWARD_BEND / outwardAngle).normalize()
          : desired;
      // 第一代短一些（圆润饱满，不咄咄逼人）；陡枝有长度加成（顶端优势）
      const lenFactor = vigor >= 0 ? 0.6 + rand() * 0.15 : 0.85 + rand() * 0.15;
      len = lenBase * lenFactor * (1 + v * 0.35);
    } else {
      const target = laneTarget(lane, scale);
      const toTarget = target.clone().sub(start);
      // 长度受限：跨树冠的目标点只走一段就到——不许一根长杆贯穿树冠
      len = Math.min(toTarget.length() * (0.45 + rand() * 0.15), lenBase * 1.2);

      // 限转：每代相对父梢最多转约 52°——方向连贯优先于落点精确
      // （真树不按图纸长；不限制时转角全挤在根部，成了直角弯）
      const dirToTarget = toTarget.clone().normalize();
      const angle = dirToTarget.angleTo(tangent);
      const MAX_BEND = 0.9;
      dir =
        angle > MAX_BEND
          ? tangent.clone().lerp(dirToTarget, MAX_BEND / angle).normalize()
          : dirToTarget;
    }

    let curve: THREE.CatmullRomCurve3;
    let tip: THREE.Vector3;
    if (outward) {
      // 渐进转向：方向过渡集中在前半段（blend^0.6），梢头段完全顺目标方向——
      // 末端不拖弧度，枝梢直来直去
      const steps = 4;
      const points = [start.clone()];
      const pos = start.clone();
      for (let i = 1; i <= steps; i++) {
        const d = tangent.clone().lerp(dir, Math.pow(i / steps, 0.6)).normalize();
        pos.addScaledVector(d, len / steps);
        points.push(pos.clone());
      }
      curve = new THREE.CatmullRomCurve3(points);
      tip = points[points.length - 1];
    } else {
      // 向光性生长：准直线 + 微弓
      const end = start.clone().addScaledVector(dir, len);
      const p1 = start.clone().addScaledVector(tangent, Math.min(len * 0.15, 0.12));
      const mid = start
        .clone()
        .lerp(end, 0.55)
        .add(new THREE.Vector3(0, len * 0.04, 0));
      curve = new THREE.CatmullRomCurve3([start, p1, mid, end]);
      tip = end;
    }

    splits.push({ curve, radius, tipRadius: radius * 0.45, tip, lane });
  }
  return splits;
}

/**
 * 拓扑 → 几何布局。完全确定性：同一拓扑必然生成同一棵树。
 * 统一语言：故事线分叉出故事线。
 *  - 树干 = 48 根股线螺旋盘绕（底部宽、中部绞紧、顶部散开）
 *  - 干生分叉（parentId=null）：某根股线顶端分出 4-7 根新故事线
 *  - 枝生分叉：父分叉的某条故事线末端再分出 2-4 根，半径 ×0.55-0.7
 */
function computeLayout(topology: TreeTopology): TreeLayout {
  const trunkCenter = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.1, 0),
    new THREE.Vector3(0.1, 1.2, 0.05),
    new THREE.Vector3(-0.08, 2.6, 0.1),
    new THREE.Vector3(0.06, 3.7, -0.04),
    new THREE.Vector3(0, TRUNK_TOP, 0),
  ]);

  const strands: THREE.CatmullRomCurve3[] = [];
  for (let i = 0; i < STRAND_COUNT; i++) {
    const rand = mulberry32(5000 + i * 131);
    const theta0 = (i / STRAND_COUNT) * Math.PI * 2;
    // 圈数少 = 螺旋宽松；t^0.82 让顶部圈距进一步拉稀（快分叉时松开）
    const turns = 1.1 + rand() * 0.5;
    const wobble = rand() * Math.PI * 2;
    // 股线分陡/中/平三档：陡的末端卷起冲天、平的末端甩向水平——
    // 方向分配下沉到股线，分叉顺母线直延续，不用中途折
    const strandVigor = (i % 3) / 2;
    const splay = (0.5 + rand() * 0.7) * (1.35 - strandVigor * 0.7);
    const splayDir = theta0 + rand() * 1.2;
    const points: THREE.Vector3[] = [];
    const SEG = 28;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      // 辫半径：底部宽厚 → 中部收拢 → 中上段放松 → 顶部散开
      let rad = 0.64 + (0.27 - 0.64) * smoothstep(0, 0.55, t);
      rad += smoothstep(0.5, 0.75, t) * 0.1;
      rad += Math.pow(smoothstep(0.7, 1, t), 1.6) * splay;
      const angle = theta0 + Math.pow(t, 0.82) * turns * Math.PI * 2;
      const wob = Math.sin(t * 6 + wobble) * 0.025;
      // 外甩在 88% 处完成；最后 15% 向上卷起（陡档卷得高、平档几乎不卷）
      const s = Math.pow(smoothstep(0.72, 0.88, t), 1.6);
      const x = Math.cos(angle) * (rad + wob) + Math.cos(splayDir) * s * 0.8;
      const z = Math.sin(angle) * (rad + wob) + Math.sin(splayDir) * s * 0.8;
      const y =
        -0.1 +
        // 股线也服从顶端优势：陡股线冲得更高（1.1×）、平股线矮一截（0.85×）
        t * (TRUNK_TOP * (0.85 + strandVigor * 0.25) + 0.1) +
        // 平股线末端几乎不卷（防 J 形回勾），陡股线卷得高
        Math.pow(smoothstep(0.85, 1, t), 2) * 0.55 * (0.15 + strandVigor * 1.05);
      points.push(new THREE.Vector3(x, y, z));
    }
    strands.push(new THREE.CatmullRomCurve3(points));
  }

  const displayed = new Set(getDisplayedBranches(topology).map((b) => b.id));
  const layouts = new Map<string, BranchLayout>();
  const out: BranchLayout[] = [];

  // 干生分叉波按序均分全部股线：第 i 波负责 i ≡ index (mod 波数) 的股线——48 根全覆盖
  const parentlessWaves = topology.branches.filter(
    (b) => displayed.has(b.id) && b.parentId === null && !b.withered
  ).length;
  let waveIndex = 0;

  for (const node of topology.branches) {
    if (!displayed.has(node.id)) continue;
    const rand = mulberry32(node.seed);
    const parent = node.parentId ? layouts.get(node.parentId) : undefined;

    const splits: SplitLayout[] = [];
    let strandCurve: THREE.CatmullRomCurve3 | null = null;

    if (parent) {
      const scale = canopyScale(node.growthT);
      // 宿主抽样：父波故事线多时只挑 3 条——密度可控，不全挤在一起
      const hosts =
        parent.splits.length > 8
          ? Array.from(
              { length: 3 },
              (_, k) => parent.splits[(node.seed + k * 7) % parent.splits.length]
            )
          : parent.splits;
      if (node.withered) {
        // 枯枝：只延续，不分侧枝，且航道几乎不外扩
        for (const host of hosts.slice(0, 2)) {
          const tangent = host.curve.getTangentAt(1);
          splits.push(
            ...splitFrom(rand, host.tip, tangent, host.tipRadius * (0.9 + rand() * 0.3), 1, 0.4, host.lane, 0.08, scale, -0.04, true)
          );
        }
      } else {
        // 单轴生长：母枝延续（梢头、方向粗细几乎不变，爬升加快填顶部）+ 一条侧枝（放长，不绕中间）
        for (const host of hosts) {
          const tipTangent = host.curve.getTangentAt(1);
          splits.push(
            ...splitFrom(rand, host.tip, tipTangent, host.tipRadius * (0.9 + rand() * 0.2), 1, 0.5, host.lane, 0.2, scale, -0.14, true)
          );
          const attachT = 0.7;
          const start = host.curve.getPointAt(attachT);
          const tangent = host.curve.getTangentAt(attachT);
          const hostRadius = host.radius + (host.tipRadius - host.radius) * attachT;
          // 侧枝明显短于延续枝（顶端优势：侧枝从属）
          splits.push(
            ...splitFrom(rand, start, tangent, hostRadius * 0.55, 1, 0.32, host.lane, 0.12, scale, 0.14, true)
          );
        }
      }
    } else {
      // 分叉波：第 myIndex 波负责股线 i ≡ myIndex (mod 波数)，保证全覆盖无死角
      // 每根股线领到一条叶序航道的起点（黄金角经度、中纬度、幼冠内层）
      strandCurve = strands[node.seed % STRAND_COUNT];
      const scale = canopyScale(node.growthT);
      const myIndex = waveIndex++;
      const strandIndices: number[] = [];
      if (node.withered) {
        for (let k = 0; k < 3; k++) strandIndices.push((node.seed + k * 16) % STRAND_COUNT);
      } else {
        for (let i = myIndex; i < STRAND_COUNT; i += parentlessWaves) strandIndices.push(i);
      }
      for (const idx of strandIndices) {
        const strand = strands[idx];
        const start = strand.getPointAt(1);
        // 延续枝也去掉螺旋甩劲（外围股线甩劲最大，是"往里弯折"的病根），留 15% 向光修正
        const tangent = unswirl(strand.getTangentAt(1), start)
          .lerp(new THREE.Vector3(0, 1, 0), 0.15)
          .normalize();
        const initialLane: Lane = {
          // 航道经度 = 股线梢头自己所在的方位——从自己这侧向外长，不横跨树冠
          // 纬度上移拉宽（0.28π-0.67π）：中下饱满，顶部也有人占领，不秃头
          theta: Math.atan2(start.z, start.x) + (rand() - 0.5) * 0.5,
          phi: Math.PI * (0.28 + (idx % 8) * 0.055),
          fill: 0.6,
        };
        const lenBase = 0.6 + node.length * 0.5;
        // 单轴生长 + 方向系统性分配：延续枝与侧枝按股线轮值陡/中/平三档——
        // 陡的登顶、平的展翼，长度基本一致
        splits.push(
          ...splitFrom(
            rand,
            start,
            tangent,
            STRAND_TIP_RADIUS * (0.9 + rand() * 0.2),
            1,
            lenBase,
            initialLane,
            0.18,
            scale,
            -0.1,
            true,
            (idx % 3) / 2
          )
        );
        const lateralAt = [0.82, 0.92];
        for (let k = 0; k < lateralAt.length; k++) {
          const attachT = lateralAt[k];
          const latStart = strand.getPointAt(attachT);
          const latTangent = unswirl(strand.getTangentAt(attachT), latStart)
            .lerp(new THREE.Vector3(0, 1, 0), 0.15)
            .normalize();
          const strandRadius =
            STRAND_RADIUS + (STRAND_TIP_RADIUS - STRAND_RADIUS) * attachT;
          const latLane: Lane = {
            theta: Math.atan2(latStart.z, latStart.x) + GOLDEN_ANGLE * 0.5 * (k + 1),
            phi: initialLane.phi + 0.1,
            fill: initialLane.fill,
          };
          splits.push(
            ...splitFrom(
              rand,
              latStart,
              latTangent,
              strandRadius * 0.6,
              1,
              lenBase * 0.5,
              latLane,
              0.15,
              scale,
              0.12,
              true,
              // 侧枝长势贴着母股线走（±0.25），不为难它拐弯
              Math.min(1, Math.max(0, (idx % 3) / 2 + (k === 0 ? -0.25 : 0.25)))
            )
          );
        }
      }
    }

    const layout: BranchLayout = {
      node,
      splits,
      strandCurve,
      colorStart: parent ? parent.colorEnd : STRAND_COLOR.clone(),
      colorEnd: branchBaseColor(node),
    };
    layouts.set(node.id, layout);
    out.push(layout);
  }

  return { trunkCenter, strands, branches: out };
}

const COOL = new THREE.Color('#bfe3ff');
const WARM = new THREE.Color('#ffe9c9');
const WITHERED_MULT = new THREE.Color('#5a6b7d');
const STRAND_COLOR = new THREE.Color('#9fd8ff').multiplyScalar(1.6);
const SAP_COLOR = new THREE.Color('#eaf6ff').multiplyScalar(2.5);
const PULSE_COLOR = new THREE.Color('#ffffff').multiplyScalar(3);

function branchBaseColor(node: BranchNode): THREE.Color {
  // 银白为主，暖意只淡淡晕染（不直接变黄）
  return COOL.clone().lerp(WARM, node.warmth * 0.45).multiplyScalar(1.5 + node.vitality);
}

function makeGlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(200,230,255,0.85)');
  gradient.addColorStop(0.4, 'rgba(160,210,255,0.3)');
  gradient.addColorStop(1, 'rgba(160,210,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** 光叶纹理：柔软的椭圆发光花瓣 */
function makeLeafTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(32, 32);
  ctx.scale(1, 0.55);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(-32, -32, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

interface SplitMesh {
  geometry: THREE.BufferGeometry;
  indexCount: number;
  mirror: THREE.Mesh;
}

interface BranchMeshes {
  splits: SplitMesh[];
  tubes: THREE.Mesh[];
  tip: THREE.Mesh;
  leaves: THREE.Points;
  leafMat: THREE.PointsMaterial;
  tubeMat: THREE.MeshBasicMaterial;
  mirrorMat: THREE.MeshBasicMaterial;
  mirrorLeafMat: THREE.PointsMaterial;
  mirrorLeaves: THREE.Points;
}

export function WorldTree({
  topology,
  visual,
}: {
  topology: TreeTopology;
  visual: React.MutableRefObject<TreeVisualState>;
}) {
  const layout = useMemo(() => computeLayout(topology), [topology]);

  // 把每根枝的梢端坐标（各分叉波末端质心）暴露给光团/相机
  useMemo(() => {
    const tips: Record<string, THREE.Vector3> = {};
    for (const b of layout.branches) {
      if (b.splits.length === 0) continue;
      const centroid = new THREE.Vector3();
      for (const s of b.splits) centroid.add(s.tip);
      centroid.divideScalar(b.splits.length);
      tips[b.node.id] = centroid;
    }
    visual.current.tipPositions = tips;
  }, [layout, visual]);

  const strandMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: STRAND_COLOR.clone(),
      }),
    []
  );
  const mirrorStrandMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#9fd8ff').multiplyScalar(0.55),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );

  const strandGeometries = useMemo(
    () => layout.strands.map((curve) => taperedTube(curve, 48, 5, STRAND_RADIUS, STRAND_TIP_RADIUS)),
    [layout]
  );

  const glowTexture = useMemo(makeGlowTexture, []);
  const leafTexture = useMemo(makeLeafTexture, []);

  // 每次分叉波的网格与材质（含水下镜像）
  const branchMeshes = useMemo(() => {
    const map = new Map<string, BranchMeshes>();
    for (const b of layout.branches) {
      // 管身顶点色渐变：父梢色 → 自身色；material.color 只作乘算调光（枯枝衰减用）
      const tubeMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
      });
      const mirrorMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.3,
        color: branchBaseColor(b.node).multiplyScalar(0.4),
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const splits: SplitMesh[] = [];
      const tubes: THREE.Mesh[] = [];
      for (const split of b.splits) {
        const geometry = taperedTube(split.curve, 16, 5, split.radius, split.tipRadius);
        applyTubeGradient(geometry, 16, 5, b.colorStart, b.colorEnd);
        const tube = new THREE.Mesh(geometry, tubeMat);
        const mirror = new THREE.Mesh(geometry, mirrorMat);
        mirror.renderOrder = 1;
        splits.push({ geometry, indexCount: geometry.userData.indexCount as number, mirror });
        tubes.push(tube);
      }

      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 12, 12),
        new THREE.MeshBasicMaterial({ color: PULSE_COLOR.clone(), transparent: true })
      );
      tip.visible = false;

      // 光叶：花瓣簇拥在每条故事线的外段——梢头一团 + 外 30% 沿途散点，树冠边缘不光秃
      const leafRand = mulberry32(b.node.seed + 999);
      const perSplit = b.node.withered ? 2 : 6 + Math.floor(b.node.vitality * 3);
      const leafCount = Math.max(b.splits.length * perSplit, 1);
      const leafPositions = new Float32Array(leafCount * 3);
      let li = 0;
      for (const split of b.splits) {
        for (let k = 0; k < perSplit && li < leafCount; k++, li++) {
          if (k < 3) {
            // 梢头花团
            leafPositions[li * 3] = split.tip.x + (leafRand() - 0.5) * 0.3;
            leafPositions[li * 3 + 1] = split.tip.y + (leafRand() - 0.5) * 0.3;
            leafPositions[li * 3 + 2] = split.tip.z + (leafRand() - 0.5) * 0.3;
          } else {
            // 外 30% 沿途散点
            const p = split.curve.getPointAt(0.7 + leafRand() * 0.3);
            leafPositions[li * 3] = p.x + (leafRand() - 0.5) * 0.22;
            leafPositions[li * 3 + 1] = p.y + (leafRand() - 0.5) * 0.22;
            leafPositions[li * 3 + 2] = p.z + (leafRand() - 0.5) * 0.22;
          }
        }
      }
      const leafGeometry = new THREE.BufferGeometry();
      leafGeometry.setAttribute('position', new THREE.BufferAttribute(leafPositions, 3));
      const leafSize = 0.1 + b.node.clarity * 0.08;
      const leafMat = new THREE.PointsMaterial({
        map: leafTexture,
        color: branchBaseColor(b.node),
        size: leafSize,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const leaves = new THREE.Points(leafGeometry, leafMat);
      const mirrorLeafMat = new THREE.PointsMaterial({
        map: leafTexture,
        color: branchBaseColor(b.node).multiplyScalar(0.4),
        size: leafSize,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mirrorLeaves = new THREE.Points(leafGeometry, mirrorLeafMat);
      mirrorLeaves.renderOrder = 1;

      map.set(b.node.id, {
        splits,
        tubes,
        tip,
        leaves,
        leafMat,
        tubeMat,
        mirrorMat,
        mirrorLeafMat,
        mirrorLeaves,
      });
    }
    return map;
  }, [layout, leafTexture]);

  // 光脉冲路径：沿股线爬升，再沿分叉链到目标故事线
  const pulsePaths = useMemo(() => {
    const map = new Map<string, THREE.Vector3[]>();
    const layoutById = new Map(layout.branches.map((b) => [b.node.id, b]));
    for (const b of layout.branches) {
      const chain: BranchLayout[] = [];
      let cur: BranchLayout | undefined = b;
      while (cur) {
        chain.unshift(cur);
        cur = cur.node.parentId ? layoutById.get(cur.node.parentId) : undefined;
      }
      const points: THREE.Vector3[] = [];
      const strand = chain[0].strandCurve ?? layout.trunkCenter;
      for (let i = 0; i <= 12; i++) points.push(strand.getPointAt(i / 12));
      for (const c of chain) {
        const first = c.splits[0].curve;
        for (let i = 1; i <= 12; i++) points.push(first.getPointAt(i / 12));
      }
      map.set(b.node.id, points);
    }
    return map;
  }, [layout]);

  // 光尘：树冠周匝缓慢漂移的发光微粒
  const motes = useMemo(() => {
    const count = 300;
    const positions = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const rand = mulberry32(777);
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 3.4;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = 1.5 + rand() * 2.9;
      base.set([x, y, z], i * 3);
      phase[i] = rand() * Math.PI * 2;
    }
    positions.set(base);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return { geometry, base, phase, count };
  }, []);
  const motesRef = useRef<THREE.Points>(null);

  // 白雾：环绕树冠的柔光雾团（故事之树的"场外雾"）
  const mist = useMemo(() => {
    const rand = mulberry32(4242);
    return Array.from({ length: 9 }, (_, i) => {
      const angle = (i / 9) * Math.PI * 2 + rand() * 0.7;
      const r = 2.2 + rand() * 1.6;
      return {
        position: new THREE.Vector3(Math.cos(angle) * r, 2.6 + rand() * 1.2, Math.sin(angle) * r),
        scale: 3 + rand() * 2.5,
        phase: rand() * Math.PI * 2,
      };
    });
  }, []);
  const mistRefs = useRef<Array<THREE.Sprite | null>>([]);

  const sapRefs = useRef<Array<THREE.Mesh | null>>([]);
  const pulseRef = useRef<THREE.Mesh>(null);
  const pulseLightRef = useRef<THREE.PointLight>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const mirrorGlowRef = useRef<THREE.Sprite>(null);
  const seedRef = useRef<THREE.Mesh>(null);
  const seedMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const tmpColor = useRef(new THREE.Color());

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const v = visual.current;

    // 股线编织：跟随开场镜头从底向上边编边长（每根股线带交错延迟）
    const braidGlobal = smoothstep(BRAID_START, BRAID_END, time);
    for (let i = 0; i < layout.strands.length; i++) {
      const stagger = (i % 8) * 0.05;
      const p = Math.min(1, Math.max(0, braidGlobal * 1.4 - stagger));
      const geometry = strandGeometries[i];
      geometry.setDrawRange(0, Math.floor((geometry.userData.indexCount as number) * p));
    }

    // 种子：股线开始编织后淡出
    const seed = seedRef.current;
    if (seed && seedMatRef.current) {
      const gone = braidGlobal > 0.15;
      seed.visible = !gone;
      if (!gone) {
        const s = 1 + Math.sin(time * 2.2) * 0.25;
        seed.scale.setScalar(s);
        seed.position.y = 0.35 + Math.sin(time * 0.9) * 0.08;
        seedMatRef.current.opacity = 0.95 * (1 - braidGlobal / 0.15);
      }
    }

    // 树冠光晕：缓慢呼吸（镜像同步）
    if (glowRef.current) {
      const s = 5.5 + Math.sin(time * 0.5) * 0.5;
      glowRef.current.scale.set(s, s, 1);
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.35 + Math.sin(time * 0.5) * 0.08 + v.growthStrength * 0.25;
      if (mirrorGlowRef.current) {
        mirrorGlowRef.current.scale.set(s, s, 1);
        (mirrorGlowRef.current.material as THREE.SpriteMaterial).opacity =
          (0.35 + Math.sin(time * 0.5) * 0.08) * 0.4;
      }
    }

    // 白雾：环绕树冠缓慢呼吸漂移
    for (let i = 0; i < mist.length; i++) {
      const sprite = mistRefs.current[i];
      if (!sprite) continue;
      const m = mist[i];
      const s = m.scale * (1 + 0.12 * Math.sin(time * 0.3 + m.phase));
      sprite.scale.set(s, s, 1);
      (sprite.material as THREE.SpriteMaterial).opacity =
        0.08 + 0.04 * Math.sin(time * 0.23 + m.phase * 2) + v.growthStrength * 0.06;
      sprite.position.x = m.position.x + Math.sin(time * 0.05 + m.phase) * 0.3;
      sprite.position.y = m.position.y + Math.sin(time * 0.07 + m.phase * 1.3) * 0.15;
    }

    // 光尘漂移
    if (motesRef.current) {
      const attr = motesRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < motes.count; i++) {
        const bi = i * 3;
        attr.array[bi] = motes.base[bi] + Math.sin(time * 0.11 + motes.phase[i] * 2) * 0.25;
        attr.array[bi + 1] = 2 + ((motes.base[bi + 1] - 2 + time * 0.07 + motes.phase[i]) % 3.8);
        attr.array[bi + 2] = motes.base[bi + 2] + Math.cos(time * 0.09 + motes.phase[i]) * 0.25;
      }
      attr.needsUpdate = true;
    }

    // 光脉：五粒光沿不同股线循环爬升（编织完成后才出现）
    for (let i = 0; i < 5; i++) {
      const mesh = sapRefs.current[i];
      if (!mesh) continue;
      mesh.visible = braidGlobal > 0.9;
      if (!mesh.visible) continue;
      const strand = layout.strands[(i * 7) % layout.strands.length];
      const t = (time * 0.08 + i / 5) % 1;
      mesh.position.copy(strand.getPointAt(t));
      const s = 0.03 + 0.015 * Math.sin(time * 3 + i * 2);
      mesh.scale.setScalar(Math.max(s, 0.01));
    }

    // 分叉波：故事线逐条挤出 / 枯枝变色 / 光叶淡入 / 镜像同步
    let growing = 0;
    for (const b of layout.branches) {
      const meshes = branchMeshes.get(b.node.id);
      if (!meshes) continue;
      const p = v.progress[b.node.id] ?? 1;
      if (p < 1) growing = Math.max(growing, 1 - p);

      const cap = b.node.withered ? 0.4 : 1;
      for (let s = 0; s < meshes.splits.length; s++) {
        // 同一波里的故事线交错挤出
        const sp = Math.min(1, Math.max(0, (p * (meshes.splits.length + 1) - s * 0.8) / 2));
        meshes.splits[s].geometry.setDrawRange(
          0,
          Math.floor(meshes.splits[s].indexCount * sp * cap)
        );
      }

      const firstSplit = b.splits[0];
      const firstP = Math.min(1, p / 0.5) * cap;
      meshes.tip.visible = p < 1;
      if (p < 1) meshes.tip.position.copy(firstSplit.curve.getPointAt(Math.max(firstP, 0.001)));

      // 枯枝：脉冲走到一半后颜色沉成灰蓝（顶点色不动，用 material.color 乘算衰减）
      if (b.node.withered) {
        const fade = smoothstep(0.45, 0.9, p);
        meshes.tubeMat.color.copy(tmpColor.current.set('#ffffff').lerp(WITHERED_MULT, fade));
        meshes.leafMat.color.copy(tmpColor.current.copy(b.colorEnd).lerp(WITHERED_MULT, fade));
        meshes.leafMat.opacity = 0.15 * smoothstep(0.6, 1, p);
      } else {
        meshes.leafMat.opacity = (0.35 + b.node.clarity * 0.65) * smoothstep(0.55, 1, p);
      }

      // 镜像材质同步（几何共享，动画已自动一致）
      meshes.mirrorMat.color.copy(meshes.tubeMat.color).multiplyScalar(0.4);
      meshes.mirrorLeafMat.color.copy(meshes.leafMat.color).multiplyScalar(0.4);
      meshes.mirrorLeafMat.opacity = meshes.leafMat.opacity * 0.45;
    }
    v.growthStrength = growing;

    // 光脉冲：股线底端 → 目标故事线的行进亮点
    const activePulse = v.pulses[0];
    const pulseMesh = pulseRef.current;
    const pulseLight = pulseLightRef.current;
    if (activePulse && pulseMesh && pulseLight) {
      const path = pulsePaths.get(activePulse.branchId);
      if (path) {
        const raw = Math.min(1, (time - activePulse.start) / 1.5);
        const node = layout.branches.find((b) => b.node.id === activePulse.branchId)?.node;
        const reach = node?.withered ? 0.5 : 1;
        const pp = raw * reach;
        const idx = pp * (path.length - 1);
        const i0 = Math.floor(idx);
        const i1 = Math.min(path.length - 1, i0 + 1);
        pulseMesh.position.lerpVectors(path[i0], path[i1], idx - i0);
        pulseLight.position.copy(pulseMesh.position);
        const fade = node?.withered ? 1 - smoothstep(0.35, 0.5, raw) : 1 - smoothstep(0.85, 1, raw);
        pulseMesh.visible = fade > 0.01;
        pulseLight.visible = fade > 0.01;
        (pulseMesh.material as THREE.MeshBasicMaterial).opacity = fade;
        pulseLight.intensity = 6 * fade;
      }
    } else {
      if (pulseMesh) pulseMesh.visible = false;
      if (pulseLight) pulseLight.visible = false;
    }
  });

  return (
    <group>
      {/* 48 根时间线股线绞成的树干（随开场镜头编织而上） */}
      {strandGeometries.map((geometry, i) => (
        <mesh key={`strand-${i}`} geometry={geometry} material={strandMaterial} />
      ))}

      {/* 种子：编织开始前的一粒呼吸的光 */}
      <mesh ref={seedRef} position={[0, 0.35, 0]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial ref={seedMatRef} color={PULSE_COLOR} transparent opacity={0.95} />
      </mesh>

      {[0, 1, 2, 3, 4].map((i) => (
        <mesh
          key={`sap-${i}`}
          ref={(el) => {
            sapRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color={SAP_COLOR} transparent opacity={0.9} />
        </mesh>
      ))}

      {layout.branches.map((b) => {
        const meshes = branchMeshes.get(b.node.id)!;
        return (
          <group key={b.node.id}>
            {meshes.tubes.map((tube, i) => (
              <primitive key={`split-${i}`} object={tube} />
            ))}
            <primitive object={meshes.tip} />
            <primitive object={meshes.leaves} />
          </group>
        );
      })}

      {/* 树冠光晕 */}
      <sprite ref={glowRef} position={[0, 3.6, -0.5]}>
        <spriteMaterial
          map={glowTexture}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          transparent
          opacity={0.35}
        />
      </sprite>

      {/* 白雾：环绕树冠的柔光雾团 */}
      {mist.map((m, i) => (
        <sprite
          key={`mist-${i}`}
          ref={(el) => {
            mistRefs.current[i] = el;
          }}
          position={m.position}
        >
          <spriteMaterial
            map={glowTexture}
            color="#dfeefc"
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            transparent
            opacity={0.08}
          />
        </sprite>
      ))}

      {/* 光尘 */}
      <points ref={motesRef} geometry={motes.geometry}>
        <pointsMaterial
          color={new THREE.Color('#cfe8ff').multiplyScalar(1.6)}
          size={0.045}
          sizeAttenuation
          transparent
          opacity={0.65}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* 树冠下的光池（照亮水面） */}
      <pointLight position={[0, 2.4, 0]} color="#9fd8ff" intensity={2.2} distance={9} decay={2} />

      <mesh ref={pulseRef} visible={false}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshBasicMaterial color={PULSE_COLOR} transparent opacity={1} />
      </mesh>
      <pointLight ref={pulseLightRef} visible={false} color="#bfe3ff" intensity={0} distance={5} decay={2} />

      {/* ── 水下镜像：整树翻转渲染，水面（MirrorGround）盖在其上 ── */}
      <group scale={[1, -1, 1]}>
        {strandGeometries.map((geometry, i) => (
          <mesh key={`mstrand-${i}`} geometry={geometry} material={mirrorStrandMaterial} renderOrder={1} />
        ))}
        {layout.branches.map((b) => {
          const meshes = branchMeshes.get(b.node.id)!;
          return (
            <group key={`m-${b.node.id}`}>
              {meshes.splits.map((split, i) => (
                <primitive key={`msplit-${i}`} object={split.mirror} />
              ))}
              <primitive object={meshes.mirrorLeaves} />
            </group>
          );
        })}
        <sprite ref={mirrorGlowRef} position={[0, 3.6, -0.5]} renderOrder={1}>
          <spriteMaterial
            map={glowTexture}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            transparent
            opacity={0.15}
          />
        </sprite>
      </group>
    </group>
  );
}
