import * as THREE from 'three';

const WATER_COLOR = new THREE.Color('#05050a');

/**
 * 水面：半透明深色平面，盖在镜像树（renderOrder=1）之上，
 * 形成"水下倒影"。未来的自己已不在此处——见终局设计。
 */
export function MirrorGround() {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.01} renderOrder={2}>
      <planeGeometry args={[80, 80]} />
      <meshBasicMaterial color={WATER_COLOR} transparent opacity={0.72} depthWrite={false} />
    </mesh>
  );
}
