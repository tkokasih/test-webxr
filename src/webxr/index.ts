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
import { getViewerHitTestSource, isARSupported, requestImmersiveAR } from './session';
import {
  isHitHorizontal,
  makeReticle,
  pollRightGripB,
  raycastFromController,
  setupControllers,
} from './input';
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

interface RuntimeState {
  rig: SceneRig;
  session: XRSession | null;
  refSpace: XRReferenceSpace | null;
  hitTestSource: XRHitTestSource | null;
  reticle: THREE.Mesh;
  hasValidHit: boolean;
  lastHitMatrix: THREE.Matrix4;
  anchors: AnchoredEntry[];
  pendingPlacement: boolean;
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
    const reticle = makeReticle();
    rig.scene.add(reticle);
    active = {
      rig,
      session: null,
      refSpace: null,
      hitTestSource: null,
      reticle,
      hasValidHit: false,
      lastHitMatrix: new THREE.Matrix4(),
      anchors: [],
      pendingPlacement: false,
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
    session = await requestImmersiveAR();
  } catch (err) {
    onStatus('error', err instanceof Error ? err.message : String(err));
    throw err;
  }

  state.session = session;
  await renderer.xr.setSession(session);

  state.refSpace = await session.requestReferenceSpace('local-floor');
  state.hitTestSource = await getViewerHitTestSource(session);
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

  const controllerHandles = setupControllers(scene, renderer, () => {
    state.pendingPlacement = true;
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
    state.reticle.visible = false;
    state.hasValidHit = false;
    state.pendingPlacement = false;
    state.prevDeleteCombo = false;
    state.hitTestSource?.cancel?.();
    state.hitTestSource = null;
    state.refSpace = null;
    state.session = null;
    controllerHandles.dispose();
    state.onStatus('ended');
  });

  renderer.setAnimationLoop((_time, frame) => {
    if (frame && state.refSpace) {
      if (state.hitTestSource) updateReticleFromHitTest(state, frame);
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

function updateReticleFromHitTest(state: RuntimeState, frame: XRFrame): void {
  const hits = frame.getHitTestResults(state.hitTestSource!);
  if (hits.length === 0) {
    state.reticle.visible = false;
    state.hasValidHit = false;
    return;
  }
  const pose = hits[0].getPose(state.refSpace!);
  if (!pose) {
    state.reticle.visible = false;
    state.hasValidHit = false;
    return;
  }
  const m = pose.transform.matrix;
  if (!isHitHorizontal(m)) {
    state.reticle.visible = false;
    state.hasValidHit = false;
    return;
  }
  state.reticle.matrix.fromArray(m);
  state.reticle.visible = true;
  state.lastHitMatrix.fromArray(m);
  state.hasValidHit = true;
}

function maybePlace(state: RuntimeState, frame: XRFrame): void {
  if (!state.pendingPlacement) return;
  state.pendingPlacement = false;

  if (!state.hasValidHit) return;

  if (state.anchors.length >= MAX_NOTES) {
    state.onStatus('limit');
    return;
  }

  const placementMatrix = state.lastHitMatrix
    .clone()
    .multiply(new THREE.Matrix4().makeTranslation(0, 0.15, 0));

  const noteText = state.pendingText;
  const mesh = createNoteMesh(noteText);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  placementMatrix.decompose(pos, quat, scl);
  mesh.position.copy(pos);
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
