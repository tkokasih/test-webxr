import * as THREE from 'three';

export const MAX_NOTES = 8;

export interface AnchoredEntry {
  uuid: string;
  anchor: XRAnchor;
  mesh: THREE.Object3D;
}

export function updateAnchorPoses(
  frame: XRFrame,
  refSpace: XRReferenceSpace,
  entries: Iterable<AnchoredEntry>
): void {
  for (const entry of entries) {
    const pose = frame.getPose(entry.anchor.anchorSpace, refSpace);
    if (!pose) {
      entry.mesh.visible = false;
      continue;
    }
    entry.mesh.visible = true;
    const m = pose.transform.matrix;
    entry.mesh.matrix.fromArray(m);
    entry.mesh.matrix.decompose(entry.mesh.position, entry.mesh.quaternion, entry.mesh.scale);
  }
}
