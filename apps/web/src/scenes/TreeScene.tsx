import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { VoiceInput } from '../components/VoiceInput';
import { VoiceSpeaker } from '../components/VoiceSpeaker';
import { EchoReply } from '../components/EchoReply';
import { StatsOverlay } from '../components/StatsOverlay';
import { EngineDirector } from '../engine/EngineDirector';
import { SelfLights } from '../components/SelfLights';
import { getProfile, purgeOnLeave, setProfile } from '../engine/session';
import { MirrorGround } from '../effects/MirrorGround';
import { createTreeVisualState } from '../effects/WorldTree';
import type { TreeVisualState } from '../effects/WorldTree';

/** 导播运镜：一条全程连续的上升螺旋——贴根而起、绕干攀升、树冠盘旋、最后拉到全景，无硬切无停顿 */
function CameraRig({ visual }: { visual: React.MutableRefObject<TreeVisualState> }) {
  const targetPos = useRef(new THREE.Vector3());
  const targetLook = useRef(new THREE.Vector3());
  const lookAt = useRef(new THREE.Vector3(0, 0.6, 0));
  const smoothStrength = useRef(0);

  useFrame(({ camera, clock }) => {
    const time = clock.elapsedTime;

    // 终局焦点模式：镜头跟到某团呼吸的光旁（慢推、留距、视线略低于光团——底部留给对话文字）
    const focus = visual.current.focus;
    if (focus) {
      const outward = new THREE.Vector3(focus.x, 0, focus.z);
      if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
      outward.normalize();
      targetPos.current
        .copy(focus)
        .addScaledVector(outward, 1.9)
        .add(new THREE.Vector3(0, 0.5, 0));
      targetLook.current.copy(focus).add(new THREE.Vector3(0, -0.3, 0));
      camera.position.lerp(targetPos.current, 0.02);
      lookAt.current.lerp(targetLook.current, 0.03);
      camera.lookAt(lookAt.current);
      return;
    }

    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const ease = (x: number) => {
      const t = clamp01(x);
      return t * t * (3 - 2 * t);
    };

    // 生长推拉信号低通滤波：事件开始/结束的跳变不直接打到相机上
    smoothStrength.current += (visual.current.growthStrength - smoothStrength.current) * 0.04;
    const strength = smoothStrength.current < 0.02 ? 0 : smoothStrength.current;

    const rise = ease((time - 2.4) / 12); // 攀升段（前 2.4s 留给种子独留）
    const spread = ease((time - 2.4) / 14); // 远离段
    const panorama = ease((time - 14) / 10); // 全景段（与树冠成形同步后退）
    // 交互期：树每收敛一次，镜头再退一点——树在长，镜头跟着退
    const growthZoom = Math.min(visual.current.convergeCount, 8) * 0.22;

    const height = 0.5 + 2.3 * rise - 0.6 * panorama + growthZoom * 0.15 + Math.sin(time * 0.13) * 0.08 * rise;
    const radius = 1.8 + 3.4 * spread + 2.4 * panorama + growthZoom - strength * 0.5;
    const lookY = 0.6 + 2.4 * ease((time - 2.4) / 13) - 0.6 * panorama + growthZoom * 0.2 + strength * 0.1;
    const angle = 0.5 + time * 0.055 + panorama * 0.5;

    targetPos.current.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
    targetLook.current.set(0, lookY, 0);
    camera.position.lerp(targetPos.current, 0.035);
    lookAt.current.lerp(targetLook.current, 0.05);
    camera.lookAt(lookAt.current);
  });

  return null;
}

export function TreeScene() {
  const visual = useRef<TreeVisualState>(createTreeVisualState());
  const [started, setStarted] = useState(false);
  const [profile, setProfileState] = useState(getProfile);
  const [consented, setConsented] = useState(false);

  // 离开即清除（隐私设计）：关闭/刷新页面时清除全部用户数据
  useEffect(() => {
    window.addEventListener('pagehide', purgeOnLeave);
    return () => window.removeEventListener('pagehide', purgeOnLeave);
  }, []);

  // 进入门：浏览器要求音频必须由用户手势解锁——
  // 这一次点击同时启动音乐和动画时钟，两者从同一刻开始，天然同步
  const start = () => {
    const audio = new Audio('/bgm.mp3');
    audio.loop = true;
    audio.volume = 0.3;
    void audio.play().catch(() => {});
    setStarted(true);
  };

  const canEnter = profile.trim().length > 0 && consented;

  if (!started) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-[#030308]">
        <div className="h-3 w-3 animate-pulse rounded-full bg-[#bfe3ff] shadow-[0_0_30px_rgba(191,227,255,0.9)]" />

        {/* 姓名 + 知情同意：对话语音将用于在本地克隆你的声音 */}
        <div className="pointer-events-auto flex w-64 flex-col items-center gap-4">
          <input
            type="text"
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              setProfileState(e.target.value);
            }}
            placeholder="你的名字"
            className="w-full rounded-full border border-white/20 bg-black/40 px-5 py-3 text-center text-sm text-white placeholder-white/40 outline-none backdrop-blur-md focus:border-white/40"
          />
          <label className="flex cursor-pointer items-center gap-2 text-[11px] font-light text-white/40">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
            />
            <span>我已知晓本项目将录制声纹</span>
          </label>
        </div>

        <button
          onClick={() => canEnter && start()}
          disabled={!canEnter}
          className={`text-sm font-light tracking-[0.4em] transition-colors ${
            canEnter ? 'cursor-pointer text-white/60 hover:text-white' : 'cursor-not-allowed text-white/20'
          }`}
        >
          轻触进入
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#030308]">
      <Canvas camera={{ position: [1.2, 0.5, 1.8], fov: 50 }} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={['#030308']} />
        <fog attach="fog" args={['#030308', 8, 20]} />
        <ambientLight intensity={0.15} />
        <Suspense fallback={null}>
          <EngineDirector visual={visual} />
          <MirrorGround />
          <SelfLights visual={visual} />
        </Suspense>
        <CameraRig visual={visual} />
        <EffectComposer>
          <Bloom intensity={1.35} luminanceThreshold={0.1} luminanceSmoothing={0.85} mipmapBlur />
          <DepthOfField target={[0, 3, 0]} focusRange={3.5} bokehScale={2} />
          <Vignette offset={0.25} darkness={0.72} />
        </EffectComposer>
      </Canvas>
      <VoiceInput />
      <VoiceSpeaker />
      <EchoReply />
      <StatsOverlay />
    </div>
  );
}
