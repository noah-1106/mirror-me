import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { useWorldStore } from '../store/worldStore';

export function FutureSelfSilhouette() {
  const meshRef = useRef<THREE.Mesh>(null);
  const delta = useWorldStore((s) => s.delta);

  useFrame((state) => {
    if (!meshRef.current) return;
    const clarity = 1 - delta; // delta 越小越清晰
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    material.opacity = 0.05 + clarity * 0.25;

    // 呼吸动画
    const t = state.clock.elapsedTime;
    meshRef.current.scale.setScalar(1 + Math.sin(t * 0.5) * 0.02 * clarity);
    meshRef.current.rotation.y = Math.sin(t * 0.2) * 0.05;
  });

  return (
    <mesh ref={meshRef} position={[0, 0.2, -3]} rotation={[0, 0, 0]}>
      <capsuleGeometry args={[0.3, 1.2, 4, 16]} />
      <meshBasicMaterial color={0x88aaff} transparent opacity={0.1} side={THREE.DoubleSide} />
    </mesh>
  );
}
