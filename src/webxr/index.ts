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
import { billboardYAxis, createNoteMesh, disposeNoteGroup, getNoteText } from './notes';
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

interface DragState {
  entry: AnchoredEntry;
  controller: THREE.XRTargetRaySpace;
  controllerLocalOffset: THREE.Vector3;
}

interface PendingFinalize {
  entry: AnchoredEntry;
  matrix: THREE.Matrix4;
}

interface RuntimeState {
  rig: SceneRig;
  session: XRSession | null;
  refSpace: XRReferenceSpace | null;
  anchors: AnchoredEntry[];
  pendingPlacement: PendingPlacement | null;
  drag: DragState | null;
  pendingFinalize: PendingFinalize | null;
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
      drag: null,
      pendingFinalize: null,
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

  const controllerHandles = setupControllers(
    scene,
    renderer,
    (controller) => {
      handlePinch(state, controller);
    },
    (controller) => {
      handleSelectEnd(state, controller);
    }
  );

  session.addEventListener('end', () => {
    for (const entry of state.anchors) {
      scene.remove(entry.mesh);
      disposeNoteGroup(entry.mesh);
    }
    state.anchors = [];
    if (state.debugFloor) {
      scene.remove(state.debugFloor);
      disposeGroup(state.debugFloor);
      state.debugFloor = null;
    }
    if (state.debugHud) {
      scene.remove(state.debugHud);
      state.debugHud.geometry.dispose();
      (state.debugHud.material as THREE.Material).dispose();
      const hudUd = state.debugHud.userData as { texture?: THREE.Texture };
      hudUd.texture?.dispose();
      state.debugHud = null;
    }
    uninstallConsoleCapture();
    state.pendingPlacement = null;
    state.drag = null;
    state.pendingFinalize = null;
    state.prevDeleteCombo = false;
    state.refSpace = null;
    state.session = null;
    controllerHandles.dispose();
    state.onStatus('ended');
  });

  renderer.setAnimationLoop((_time, frame) => {
    if (frame && state.refSpace) {
      updateAnchorPoses(frame, state.refSpace, state.anchors);
      updateDrag(state);
      billboardNotes(state);
      maybePlace(state, frame);
      maybeFinalizeDrag(state, frame);
      maybeDelete(state, controllerHandles.controllers);
      if (state.debugHud) updateHud(state.debugHud, renderer.xr.getCamera());
    }
    renderer.render(scene, camera);
  });

  onStatus('active');
  return buildHandle(state);
}

function handlePinch(state: RuntimeState, controller: THREE.XRTargetRaySpace): void {
  // Raycast against note groups (recursive so we hit body / handles).
  const noteRoots = state.anchors.map((e) => e.mesh);
  const hit = raycastFromController(controller, noteRoots, true);

  if (hit) {
    const role = (hit.object.userData as { role?: string }).role;
    if (role === 'delete-handle') {
      const entry = findOwningEntry(state, hit.object);
      if (entry) {
        console.log(`delete handle pinched: ${entry.uuid.slice(0, 8)}`);
        deleteEntry(state, entry);
      }
      return;
    }
    if (role === 'move-handle') {
      const entry = findOwningEntry(state, hit.object);
      if (entry) startDrag(state, entry, controller);
      return;
    }
    if (role === 'body') {
      console.log('pinch on body (edit not yet wired)');
      return;
    }
  }

  // No relevant hit — queue a new note placement at the controller position.
  const pos = new THREE.Vector3();
  controller.getWorldPosition(pos);
  const forward = new THREE.Vector3(0, 0, -0.1).applyMatrix4(
    new THREE.Matrix4().extractRotation(controller.matrixWorld)
  );
  pos.add(forward);
  state.pendingPlacement = { position: pos };
}

function handleSelectEnd(state: RuntimeState, controller: THREE.XRTargetRaySpace): void {
  if (!state.drag || state.drag.controller !== controller) return;
  const { entry } = state.drag;
  const finalPos = entry.mesh.position.clone();
  const finalQuat = entry.mesh.quaternion.clone();
  const matrix = new THREE.Matrix4().compose(finalPos, finalQuat, new THREE.Vector3(1, 1, 1));
  state.drag = null;
  entry.recreating = true;
  state.pendingFinalize = { entry, matrix };
  console.log(`drag end: ${entry.uuid.slice(0, 8)}`);
}

function startDrag(
  state: RuntimeState,
  entry: AnchoredEntry,
  controller: THREE.XRTargetRaySpace
): void {
  const inv = new THREE.Matrix4().copy(controller.matrixWorld).invert();
  const local = entry.mesh.position.clone().applyMatrix4(inv);
  state.drag = { entry, controller, controllerLocalOffset: local };
  console.log(`drag start: ${entry.uuid.slice(0, 8)}`);
}

const _dragWorld = new THREE.Vector3();

function updateDrag(state: RuntimeState): void {
  if (!state.drag) return;
  _dragWorld.copy(state.drag.controllerLocalOffset).applyMatrix4(state.drag.controller.matrixWorld);
  state.drag.entry.mesh.position.copy(_dragWorld);
}

function maybeFinalizeDrag(state: RuntimeState, frame: XRFrame): void {
  if (!state.pendingFinalize) return;
  const { entry, matrix } = state.pendingFinalize;
  state.pendingFinalize = null;
  void recreateAnchor(state, entry, frame, matrix);
}

async function recreateAnchor(
  state: RuntimeState,
  entry: AnchoredEntry,
  frame: XRFrame,
  matrix: THREE.Matrix4
): Promise<void> {
  if (!state.session || !state.refSpace || !state.persistentSupported) {
    entry.recreating = false;
    return;
  }
  const oldUuid = entry.uuid;
  const text = getNoteText(entry.mesh);

  const result = await createPersistentAnchor(frame, state.refSpace, matrix);
  if (!result) {
    entry.recreating = false;
    state.onStatus('error', 'Failed to recreate anchor after move');
    return;
  }

  await deletePersistentAnchor(state.session, oldUuid);
  removeStored(oldUuid);

  entry.uuid = result.uuid;
  entry.anchor = result.anchor;
  upsert({ uuid: result.uuid, text });
  entry.recreating = false;
  console.log(`anchor recreated: ${oldUuid.slice(0, 8)} → ${result.uuid.slice(0, 8)}`);
}

function findOwningEntry(state: RuntimeState, hitObj: THREE.Object3D): AnchoredEntry | undefined {
  let cur: THREE.Object3D | null = hitObj;
  while (cur) {
    const entry = state.anchors.find((e) => e.mesh === cur);
    if (entry) return entry;
    cur = cur.parent;
  }
  return undefined;
}

function deleteEntry(state: RuntimeState, entry: AnchoredEntry): void {
  state.rig.scene.remove(entry.mesh);
  disposeNoteGroup(entry.mesh);
  state.anchors = state.anchors.filter((e) => e !== entry);
  removeStored(entry.uuid);
  if (state.session) {
    void deletePersistentAnchor(state.session, entry.uuid);
  }
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
      disposeNoteGroup(mesh);
      state.onStatus('error', 'Failed to create persistent anchor');
      return;
    }
    state.anchors.push({ uuid: result.uuid, anchor: result.anchor, mesh });
    upsert({ uuid: result.uuid, text: noteText });
  });
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

  const noteRoots = state.anchors.map((e) => e.mesh);
  const hit = raycastFromController(controller, noteRoots, true);
  if (!hit) return;

  const entry = findOwningEntry(state, hit.object);
  if (!entry) return;
  deleteEntry(state, entry);
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
