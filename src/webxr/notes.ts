import * as THREE from 'three';

export function createCubeMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
  return new THREE.Mesh(geo, mat);
}
