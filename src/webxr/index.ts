import * as THREE from 'three';
import { createSceneRig, type SceneRig } from './scene';
import { isARSupported, requestImmersiveAR } from './session';
import { createCubeMesh } from './notes';
import type { ARHandle, StartAROpts } from './types';

export { isARSupported };
export type { ARHandle, ARStatus, StartAROpts } from './types';

interface RuntimeState {
  rig: SceneRig;
  session: XRSession | null;
  helloCube: THREE.Mesh | null;
  pendingText: string;
  onStatus: NonNullable<StartAROpts['onStatus']>;
}

let active: RuntimeState | null = null;

export async function startAR(container: HTMLElement, opts: StartAROpts = {}): Promise<ARHandle> {
  const onStatus = opts.onStatus ?? (() => {});

  if (!active) {
    const rig = createSceneRig(container);
    active = {
      rig,
      session: null,
      helloCube: null,
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

  const cube = createCubeMesh();
  cube.position.set(0, 1, -1);
  scene.add(cube);
  state.helloCube = cube;

  session.addEventListener('end', () => {
    if (state.helloCube) {
      scene.remove(state.helloCube);
      state.helloCube.geometry.dispose();
      (state.helloCube.material as THREE.Material).dispose();
      state.helloCube = null;
    }
    state.session = null;
    state.onStatus('ended');
  });

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });

  onStatus('active');
  return buildHandle(state);
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
