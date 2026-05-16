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
import {
  billboardYAxis,
  createNoteMesh,
  disposeNoteGroup,
  getNoteText,
  updateNoteTexture,
} from './notes';
import {
  createConsolePanel,
  createDispenser,
  createQuadrantFloor,
  disposeDispenser,
  disposeGroup,
  installConsoleCapture,
  uninstallConsoleCapture,
  updateDispenser,
  updateHud,
} from './debug';
import { loadAll, remove as removeStored, saveAll, upsert } from './storage';
import type { ARHandle, StartAROpts } from './types';

export { isARSupported };
export type { ARHandle, ARStatus, StartAROpts } from './types';

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
  drag: DragState | null;
  pendingFinalize: PendingFinalize | null;
  editingUuid: string | null;
  prevDeleteCombo: boolean;
  persistentSupported: boolean;
  pendingText: string;
  onStatus: NonNullable<StartAROpts['onStatus']>;
  onEditRequest: StartAROpts['onEditRequest'] | null;
  debugFloor: THREE.Group | null;
  debugHud: THREE.Mesh | null;
  dispenser: THREE.Mesh | null;
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
      drag: null,
      pendingFinalize: null,
      editingUuid: null,
      prevDeleteCombo: false,
      persistentSupported: false,
      pendingText: opts.initialText ?? '',
      onStatus,
      onEditRequest: opts.onEditRequest ?? null,
      debugFloor: null,
      debugHud: null,
      dispenser: null,
    };
  } else {
    active.onStatus = onStatus;
    active.onEditRequest = opts.onEditRequest ?? null;
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

  const dispenser = createDispenser();
  scene.add(dispenser);
  state.dispenser = dispenser;

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
    if (state.dispenser) {
      scene.remove(state.dispenser);
      disposeDispenser(state.dispenser);
      state.dispenser = null;
    }
    uninstallConsoleCapture();
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
      maybeFinalizeDrag(state, frame);
      maybeDelete(state, controllerHandles.controllers);
      if (state.debugHud) updateHud(state.debugHud, renderer.xr.getCamera());
      if (state.dispenser) updateDispenser(state.dispenser, renderer.xr.getCamera());
    }
    renderer.render(scene, camera);
  });

  onStatus('active');
  return buildHandle(state);
}

function handlePinch(state: RuntimeState, controller: THREE.XRTargetRaySpace): void {
  const noteRoots = state.anchors.map((e) => e.mesh);
  const targets: THREE.Object3D[] = state.dispenser ? [...noteRoots, state.dispenser] : noteRoots;
  const hit = raycastFromController(controller, targets, true);

  if (!hit) {
    // Empty-space pinch is intentionally a no-op now — use the dispenser to create.
    return;
  }

  const role = (hit.object.userData as { role?: string }).role;

  if (role === 'dispenser') {
    startNewNoteFromDispenser(state, controller);
    return;
  }
  if (role === 'delete-handle') {
    const entry = findOwningEntry(state, hit.object);
    if (entry) {
      console.log(`delete handle pinched: ${entry.uuid.slice(0, 8) || '(new)'}`);
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
    const entry = findOwningEntry(state, hit.object);
    if (entry) void requestEdit(state, entry);
    return;
  }
}

function startNewNoteFromDispenser(state: RuntimeState, controller: THREE.XRTargetRaySpace): void {
  if (state.anchors.length >= MAX_NOTES) {
    state.onStatus('limit');
    console.warn('cannot create: 8-note limit reached');
    return;
  }

  const pos = new THREE.Vector3();
  controller.getWorldPosition(pos);
  // Offset slightly forward so the new note appears in front of the pinching hand.
  const forward = new THREE.Vector3(0, 0, -0.1).applyMatrix4(
    new THREE.Matrix4().extractRotation(controller.matrixWorld)
  );
  pos.add(forward);

  const mesh = createNoteMesh('');
  mesh.position.copy(pos);
  state.rig.scene.add(mesh);

  const entry: AnchoredEntry = {
    uuid: '',
    anchor: null,
    mesh,
    recreating: true,
  };
  state.anchors.push(entry);

  const inv = new THREE.Matrix4().copy(controller.matrixWorld).invert();
  const local = pos.clone().applyMatrix4(inv);
  state.drag = { entry, controller, controllerLocalOffset: local };
  console.log('new note from dispenser');
}

async function requestEdit(state: RuntimeState, entry: AnchoredEntry): Promise<void> {
  if (!state.onEditRequest) {
    console.log('edit requested but no editor wired');
    return;
  }
  if (state.editingUuid) {
    console.log('edit already in progress');
    return;
  }
  if (entry.recreating || !entry.uuid) {
    console.log('cannot edit: note still being placed');
    return;
  }
  state.editingUuid = entry.uuid;
  const current = getNoteText(entry.mesh);
  console.log(`edit start: ${entry.uuid.slice(0, 8)}`);
  let newText: string | null;
  try {
    newText = await state.onEditRequest(entry.uuid, current);
  } catch (err) {
    console.warn(`edit failed: ${err instanceof Error ? err.message : String(err)}`);
    state.editingUuid = null;
    return;
  }
  state.editingUuid = null;
  if (newText === null || newText === current) {
    console.log('edit cancelled or no-op');
    return;
  }
  updateNoteTexture(entry.mesh, newText);
  upsert({ uuid: entry.uuid, text: newText });
  console.log(`edit saved: ${entry.uuid.slice(0, 8)}`);
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
  console.log(`drag end: ${entry.uuid.slice(0, 8) || '(new)'}`);
}

function startDrag(
  state: RuntimeState,
  entry: AnchoredEntry,
  controller: THREE.XRTargetRaySpace
): void {
  if (entry.recreating) return;
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
    state.onStatus('error', 'Failed to anchor note');
    if (!oldUuid) {
      // Brand-new note that failed to anchor — drop the orphan mesh.
      state.rig.scene.remove(entry.mesh);
      disposeNoteGroup(entry.mesh);
      state.anchors = state.anchors.filter((e) => e !== entry);
      console.warn('new note dropped: anchor creation failed');
    }
    return;
  }

  if (oldUuid) {
    await deletePersistentAnchor(state.session, oldUuid);
    removeStored(oldUuid);
  }

  entry.uuid = result.uuid;
  entry.anchor = result.anchor;
  upsert({ uuid: result.uuid, text });
  entry.recreating = false;
  if (oldUuid) {
    console.log(`anchor recreated: ${oldUuid.slice(0, 8)} → ${result.uuid.slice(0, 8)}`);
  } else {
    console.log(`note anchored: ${result.uuid.slice(0, 8)}`);
  }
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
  if (entry.recreating) {
    console.log('cannot delete: note still being placed');
    return;
  }
  state.rig.scene.remove(entry.mesh);
  disposeNoteGroup(entry.mesh);
  state.anchors = state.anchors.filter((e) => e !== entry);
  if (entry.uuid) {
    removeStored(entry.uuid);
    if (state.session) {
      void deletePersistentAnchor(state.session, entry.uuid);
    }
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
