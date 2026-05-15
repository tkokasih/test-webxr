import * as THREE from 'three';

export function makeReticle(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.05, 0.06, 32).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const reticle = new THREE.Mesh(geo, mat);
  reticle.visible = false;
  return reticle;
}
