import * as THREE from 'three';

export const MAX_NOTES = 8;

export interface AnchoredEntry {
  uuid: string;
  anchor: XRAnchor;
  mesh: THREE.Object3D;
}

export function supportsPersistentAnchors(session: XRSession): boolean {
  return typeof session.restorePersistentAnchor === 'function';
}

export async function createPersistentAnchor(
  frame: XRFrame,
  refSpace: XRReferenceSpace,
  matrix: THREE.Matrix4
): Promise<{ uuid: string; anchor: XRAnchor } | null> {
  if (!frame.createAnchor) return null;

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  matrix.decompose(pos, quat, scl);

  const transform = new XRRigidTransform(
    { x: pos.x, y: pos.y, z: pos.z },
    { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
  );

  const anchor = await frame.createAnchor(transform, refSpace);
  if (!anchor) return null;

  if (!anchor.requestPersistentHandle) {
    anchor.delete?.();
    return null;
  }

  try {
    const uuid = await anchor.requestPersistentHandle();
    return { uuid, anchor };
  } catch {
    anchor.delete?.();
    return null;
  }
}

export async function restoreFromStorage(
  session: XRSession,
  storedUuids: string[]
): Promise<Map<string, XRAnchor>> {
  const out = new Map<string, XRAnchor>();
  if (!session.restorePersistentAnchor) return out;
  for (const uuid of storedUuids) {
    try {
      const anchor = await session.restorePersistentAnchor(uuid);
      out.set(uuid, anchor);
    } catch {
      // anchor lost or invalid — caller will drop from storage
    }
  }
  return out;
}

export async function deletePersistentAnchor(session: XRSession, uuid: string): Promise<void> {
  if (!session.deletePersistentAnchor) return;
  try {
    await session.deletePersistentAnchor(uuid);
  } catch {
    // best-effort
  }
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
    entry.mesh.matrix.fromArray(pose.transform.matrix);
  }
}
