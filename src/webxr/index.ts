import * as THREE from 'three';
import { createSceneRig, type SceneRig } from './scene';
import { getViewerHitTestSource, isARSupported, requestImmersiveAR } from './session';
import { isHitHorizontal, makeReticle, setupControllers } from './input';
import { createCubeMesh } from './notes';
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
  placedMeshes: THREE.Mesh[];
  pendingText: string;
  onStatus: NonNullable<StartAROpts['onStatus']>;
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
      placedMeshes: [],
      pendingText: opts.initialText ?? '',
      onStatus,
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

  const controllerHandles = setupControllers(scene, renderer, () => {
    if (!state.hasValidHit) return;
    placeCube(state);
  });

  session.addEventListener('end', () => {
    for (const mesh of state.placedMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    state.placedMeshes.length = 0;
    state.reticle.visible = false;
    state.hasValidHit = false;
    state.hitTestSource?.cancel?.();
    state.hitTestSource = null;
    state.refSpace = null;
    state.session = null;
    controllerHandles.dispose();
    state.onStatus('ended');
  });

  renderer.setAnimationLoop((_time, frame) => {
    if (frame && state.refSpace && state.hitTestSource) {
      updateReticleFromHitTest(state, frame);
    }
    renderer.render(scene, camera);
  });

  onStatus('active');
  return buildHandle(state);
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

function placeCube(state: RuntimeState): void {
  const cube = createCubeMesh(0x4ade80);
  cube.matrixAutoUpdate = false;
  cube.matrix.copy(state.lastHitMatrix);
  // raise cube so its base sits on the hit plane
  const lift = new THREE.Matrix4().makeTranslation(0, 0.05, 0);
  cube.matrix.multiply(lift);
  state.rig.scene.add(cube);
  state.placedMeshes.push(cube);
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
