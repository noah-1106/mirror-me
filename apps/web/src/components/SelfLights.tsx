import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { computeCandidates, pickDiverseSelves } from '../engine/selves';
import { useWorldState } from '../engine/useWorld';
import { useWorldStore } from '../store/worldStore';
import type { TreeVisualState } from '../effects/WorldTree';

/** 盆地 → 光色：自己拿主意 = 暖金；为别人期待 = 冷银；灰烬枯枝 = 灰蓝 */
const BASIN_COLOR: Record<string, string> = {
  self: '#ffd9a0',
  other: '#bfe3ff',
  avoid: '#9fb4c8',
};
const WITHERED_COLOR = '#5a6b7d';

function makeOrbTexture(innerStops: [number, string][]): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [pos, color] of innerStops) g.addColorStop(pos, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** 外晕：大而柔的氛围光 */
const HALO_STOPS: [number, string][] = [
  [0, 'rgba(255,255,255,0.9)'],
  [0.25, 'rgba(255,255,255,0.45)'],
  [1, 'rgba(255,255,255,0)'],
];
/** 亮核：小而集中的白热中心（软渐变，无几何硬边） */
const CORE_STOPS: [number, string][] = [
  [0, 'rgba(255,255,255,1)'],
  [0.4, 'rgba(255,255,255,0.85)'],
  [0.7, 'rgba(255,255,255,0.25)'],
  [1, 'rgba(255,255,255,0)'],
];

/**
 * 终局：树上三团呼吸的光——三个真实的"我"（从真实枝提取，零模拟）。
 * 点击光团 = 选择那个自己，镜头跟进；回全景后可切换。
 */
export function SelfLights({ visual }: { visual: React.MutableRefObject<TreeVisualState> }) {
  const { phase, state, context, send } = useWorldState();
  const focusedSelf = useWorldStore((s) => s.focusedSelf);
  const setFocusedSelf = useWorldStore((s) => s.setFocusedSelf);
  const haloTexture = useMemo(() => makeOrbTexture(HALO_STOPS), []);
  const coreTexture = useMemo(() => makeOrbTexture(CORE_STOPS), []);
  const spriteRefs = useRef<Record<string, THREE.Sprite | null>>({});
  const coreRefs = useRef<Record<string, THREE.Sprite | null>>({});
  const groupRefs = useRef<Record<string, THREE.Group | null>>({});

  const selves = useMemo(
    () =>
      phase === 'dialogue'
        ? pickDiverseSelves(computeCandidates(context.tree, context.history))
        : [],
    [phase, context.tree, context.history]
  );

  // 镜头焦点：聚焦的光团位置（布局坐标可能晚到，逐帧对齐）
  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const focusPos = focusedSelf ? visual.current.tipPositions[focusedSelf] : undefined;
    visual.current.focus = focusPos ?? null;

    // 精灵式呼吸：亮度起伏 + 双正弦叠出的有机漂浮（不死死钉在枝头）
    for (const s of selves) {
      const sprite = spriteRefs.current[s.branchId];
      const core = coreRefs.current[s.branchId];
      const group = groupRefs.current[s.branchId];
      if (!sprite || !core || !group) continue;
      const focused = s.branchId === focusedSelf;
      const p = s.growthT * 1.7; // 各光团错相
      const breath = 1 + Math.sin(time * (focused ? 1.6 : 0.9) + p) * (focused ? 0.25 : 0.12);
      const base = focused ? 0.85 : 0.55;
      sprite.scale.setScalar(base * breath);
      sprite.material.opacity = focused ? 1 : 0.85 + Math.sin(time * 0.9 + p) * 0.15;
      // 亮核呼吸幅度小、始终接近全亮——保证任何背景下可读
      core.scale.setScalar(base * 0.32 * (1 + (breath - 1) * 0.4));
      core.material.opacity = 0.95;
      // 漂浮：上下慢 bob + 水平微游走（两组非整数倍频率叠加，不死板）
      const basePos = visual.current.tipPositions[s.branchId];
      if (basePos) {
        group.position.set(
          basePos.x + Math.sin(time * 0.43 + p) * 0.05 + Math.sin(time * 0.11 + p * 2) * 0.03,
          basePos.y + Math.sin(time * 0.6 + p) * 0.07 + Math.sin(time * 0.17 + p) * 0.04,
          basePos.z + Math.cos(time * 0.37 + p) * 0.05 + Math.cos(time * 0.13 + p * 2) * 0.03
        );
      }
    }
  });

  // 离开终局时清焦点
  useEffect(() => {
    if (phase !== 'dialogue') setFocusedSelf(null);
  }, [phase, setFocusedSelf]);

  if (phase !== 'dialogue' || state === 'summoning') return null;

  return (
    <>
      {selves.map((s) => {
        const pos = visual.current.tipPositions[s.branchId];
        if (!pos) return null;
        const color = s.withered ? WITHERED_COLOR : (BASIN_COLOR[s.basin] ?? '#bfe3ff');
        const select = (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          send({ type: 'SELECT_SELF', self: s.branchId });
          setFocusedSelf(s.branchId);
        };
        return (
          <group
            key={s.branchId}
            position={pos}
            ref={(el) => {
              groupRefs.current[s.branchId] = el;
            }}
          >
            {/* 亮核：小而集中的白热软渐变（无几何硬边，亮树前也可读） */}
            <sprite
              ref={(el) => {
                coreRefs.current[s.branchId] = el;
              }}
              onPointerDown={select}
            >
              <spriteMaterial
                map={coreTexture}
                color="#ffffff"
                transparent
                depthWrite={false}
                toneMapped={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>
            {/* 外晕：盆地色的氛围光 */}
            <sprite
              ref={(el) => {
                spriteRefs.current[s.branchId] = el;
              }}
              onPointerDown={select}
            >
              <spriteMaterial
                map={haloTexture}
                color={color}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>
            {/* 隐形热区：光晕本身很小，放大点击判定 */}
            <mesh onPointerDown={select} visible={false}>
              <sphereGeometry args={[0.32, 8, 8]} />
              <meshBasicMaterial />
            </mesh>
          </group>
        );
      })}
    </>
  );
}
