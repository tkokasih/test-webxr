import * as THREE from 'three';
import {
  createPersistentAnchor,
  deletePersistentAnchor,
  MAX_NOTES,
  restoreFromStorage,
  supportsPersistentAnchors,
  updateAnchorPoses,
  type AnchoredEntry,
} from './anchors';
import { createSceneRig, type SceneRig } from './scene';
import { isARSupported, requestImmersiveAR } from './session';
import { pollRightGripB, raycastFromController, setupControllers } from './input';
import { billboardYAxis, createNoteMesh } from './notes';
import {
  createConsolePanel,
  createQuadrantFloor,
  disposeGroup,
  installConsoleCapture,
  uninstallConsoleCapture,
  updateHud,
} from './debug';
import { loadAll, remove as removeStored, saveAll, upsert } from './storage';
import type { ARHandle, StartAROpts } from './types';

export { isARSupported };
export type { ARHandle, ARStatus, StartAROpts } from './types';

interface PendingPlacement {
  position: THREE.Vector3;
}

interface RuntimeState {
  rig: SceneRig;
  session: XRSession | null;
  refSpace: XRReferenceSpace | null;
  anchors: AnchoredEntry[];
  pendingPlacement: PendingPlacement | null;
  prevDeleteCombo: boolean;
  persistentSupported: boolean;
  pendingText: string;
  onStatus: NonNullable<StartAROpts['onStatus']>;
  debugFloor: THREE.Group | null;
  debugHud: THREE.Mesh | null;
}

let active: RuntimeState | null = null;

export async function startAR(container: HTMLElement, opts: StartAROpts = {}): Promise<ARHandle> {
  const onStatus = opts.onStatus ?? (() => {});

  if (!active) {
    const rig = createSceneRig(container);
    active = {
      rig,
      session: null,
      refSpace: null,
      anchors: [],
      pendingPlacement: null,
      prevDeleteCombo: false,
      persistentSupported: false,
      pendingText: opts.initialText ?? '',
      onStatus,
      debugFloor: null,
      debugHud: null,
    };
  } else {
    active.onStatus = onStatus;
    if (opts.initialText !== undefined) active.pendingText = opts.initialText;
  }

  const state = active;

  if (state.session) {
    return buildHandle(state);
  }

  onStatus('requesting');

  const { renderer, scene, camera } = state.rig;
  renderer.xr.setReferenceSpaceType('local-floor');

  let session: XRSession;
  try {
    session = await requestImmersiveAR(opts.overlayRoot);
  } catch (err) {
    onStatus('error', err instanceof Error ? err.message : String(err));
    throw err;
  }

  state.session = session;
  await renderer.xr.setSession(session);

  state.refSpace = await session.requestReferenceSpace('local-floor');
  state.persistentSupported = supportsPersistentAnchors(session);

  if (!state.persistentSupported) {
    onStatus('persistent-unsupported');
  }

  await restoreAnchors(state);

  const debugFloor = createQuadrantFloor();
  scene.add(debugFloor);
  state.debugFloor = debugFloor;

  const debugHud = createConsolePanel();
  scene.add(debugHud);
  state.debugHud = debugHud;
  installConsoleCapture(debugHud);
  console.log('AR session active');
  console.log(`persistent anchors: ${state.persistentSupported ? 'supported' : 'unsupported'}`);
  console.log(`restored anchors: ${state.anchors.length}`);

  const controllerHandles = setupControllers(scene, renderer, (controller) => {
    const pos = new THREE.Vector3();
    controller.getWorldPosition(pos);
    // Offset slightly forward from the hand (controller -Z is forward).
    const forward = new THREE.Vector3(0, 0, -0.1).applyMatrix4(
      new THREE.Matrix4().extractRotation(controller.matrixWorld)
    );
    pos.add(forward);
    state.pendingPlacement = { position: pos };
  });

  session.addEventListener('end', () => {
    for (const entry of state.anchors) {
      scene.remove(entry.mesh);
      if (entry.mesh instanceof THREE.Mesh) disposeNoteMesh(entry.mesh);
    }
    state.anchors = [];
    if (state.debugFloor) {
      scene.remove(state.debugFloor);
      disposeGroup(state.debugFloor);
      state.debugFloor = null;
    }
    if (state.debugHud) {
      scene.remove(state.debugHud);
      disposeNoteMesh(state.debugHud);
      state.debugHud = null;
    }
    uninstallConsoleCapture();
    state.pendingPlacement = null;
    state.prevDeleteCombo = false;
    state.refSpace = null;
    state.session = null;
    controllerHandles.dispose();
    state.onStatus('ended');
  });

  renderer.setAnimationLoop((_time, frame) => {
    if (frame && state.refSpace) {
      updateAnchorPoses(frame, state.refSpace, state.anchors);
      billboardNotes(state);
      maybePlace(state, frame);
      maybeDelete(state, controllerHandles.controllers);
      if (state.debugHud) updateHud(state.debugHud, renderer.xr.getCamera());
    }
    renderer.render(scene, camera);
  });

  onStatus('active');
  return buildHandle(state);
}

async function restoreAnchors(state: RuntimeState): Promise<void> {
  if (!state.session || !state.persistentSupported) return;
  const stored = loadAll();
  if (stored.length === 0) return;

  const restored = await restoreFromStorage(
    state.session,
    stored.map((r) => r.uuid)
  );

  const valid = stored.filter((r) => restored.has(r.uuid));
  if (valid.length !== stored.length) {
    saveAll(valid);
  }

  for (const record of valid) {
    const anchor = restored.get(record.uuid);
    if (!anchor) continue;
    const mesh = createNoteMesh(record.text);
    state.rig.scene.add(mesh);
    state.anchors.push({ uuid: record.uuid, anchor, mesh });
  }
}

const _cameraWorld = new THREE.Vector3();

function billboardNotes(state: RuntimeState): void {
  state.rig.camera.getWorldPosition(_cameraWorld);
  for (const entry of state.anchors) {
    if (!entry.mesh.visible) continue;
    billboardYAxis(entry.mesh, _cameraWorld);
  }
}

function maybePlace(state: RuntimeState, frame: XRFrame): void {
  if (!state.pendingPlacement) return;
  const { position } = state.pendingPlacement;
  state.pendingPlacement = null;

  if (state.anchors.length >= MAX_NOTES) {
    state.onStatus('limit');
    return;
  }

  // Billboard the placement matrix to face the camera (Y-axis locked).
  const camPos = new THREE.Vector3();
  state.rig.camera.getWorldPosition(camPos);
  const lookTarget = new THREE.Vector3(camPos.x, position.y, camPos.z);
  const orienter = new THREE.Object3D();
  orienter.position.copy(position);
  orienter.lookAt(lookTarget);
  const placementMatrix = new THREE.Matrix4().compose(
    position,
    orienter.quaternion,
    new THREE.Vector3(1, 1, 1)
  );

  const noteText = '';
  const mesh = createNoteMesh(noteText);
  mesh.position.copy(position);
  state.rig.scene.add(mesh);

  if (!state.persistentSupported || !state.session || !state.refSpace) {
    return;
  }

  createPersistentAnchor(frame, state.refSpace, placementMatrix).then((result) => {
    if (!result) {
      state.rig.scene.remove(mesh);
      disposeNoteMesh(mesh);
      state.onStatus('error', 'Failed to create persistent anchor');
      return;
    }
    state.anchors.push({ uuid: result.uuid, anchor: result.anchor, mesh });
    upsert({ uuid: result.uuid, text: noteText });
  });
}

function disposeNoteMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const m = mesh.material;
  if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
  else m.dispose();
  const ud = mesh.userData as { texture?: THREE.Texture };
  ud.texture?.dispose();
}

function maybeDelete(state: RuntimeState, controllers: THREE.Object3D[]): void {
  if (!state.session) return;
  const poll = pollRightGripB(state.session);
  if (!poll) {
    state.prevDeleteCombo = false;
    return;
  }
  const justPressed = poll.pressed && !state.prevDeleteCombo;
  state.prevDeleteCombo = poll.pressed;
  if (!justPressed) return;

  const controller = controllers[poll.controllerIndex];
  if (!controller) return;

  const meshes = state.anchors.map((e) => e.mesh);
  const hit = raycastFromController(controller, meshes);
  if (!hit) return;

  const entry = state.anchors.find((e) => e.mesh === hit.object);
  if (!entry) return;

  state.rig.scene.remove(entry.mesh);
  if (entry.mesh instanceof THREE.Mesh) disposeNoteMesh(entry.mesh);
  state.anchors = state.anchors.filter((e) => e !== entry);
  removeStored(entry.uuid);
  if (state.session) {
    void deletePersistentAnchor(state.session, entry.uuid);
  }
}

function buildHandle(state: RuntimeState): ARHandle {
  return {
    end: () => {
      state.session?.end().catch(() => {});
    },
    setPendingText: (text: string) => {
      state.pendingText = text;
    },
  };
}
