import * as THREE from 'three';

/**
 * 沿曲线生成锥形管（半径从 rStart 线性收细到 rEnd）。
 * 返回 indexed BufferGeometry，配合 setDrawRange 可做"挤出"生长动画。
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments: number,
  radialSegments: number,
  rStart: number,
  rEnd: number
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const vertex = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, point);
    const radius = rStart + (rEnd - rStart) * t;
    const N = frames.normals[Math.min(i, tubularSegments)];
    const B = frames.binormals[Math.min(i, tubularSegments)];

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      normal
        .set(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z)
        .normalize();
      vertex.copy(point).addScaledVector(normal, radius);
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
    }
  }

  for (let i = 1; i <= tubularSegments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = (radialSegments + 1) * (i - 1) + (j - 1);
      const b = (radialSegments + 1) * i + (j - 1);
      const c = (radialSegments + 1) * i + j;
      const d = (radialSegments + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.userData.indexCount = indices.length;
  return geometry;
}
