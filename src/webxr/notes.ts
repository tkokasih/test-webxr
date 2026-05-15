import * as THREE from 'three';

export function createCubeMesh(color = 0x4ade80): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
  return new THREE.Mesh(geo, mat);
}
