import * as THREE from 'three';

export function makeReticle(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.05, 0.06, 32).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const reticle = new THREE.Mesh(geo, mat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  return reticle;
}

export function makeControllerRay(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -2),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
  });
  return new THREE.Line(geometry, material);
}

export interface ControllerHandles {
  controllers: THREE.XRTargetRaySpace[];
  dispose: () => void;
}

export function setupControllers(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  onSelect: () => void
): ControllerHandles {
  const controllers: THREE.XRTargetRaySpace[] = [];
  const cleanups: Array<() => void> = [];

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    const ray = makeControllerRay();
    controller.add(ray);
    scene.add(controller);
    controllers.push(controller);

    const handler = () => onSelect();
    controller.addEventListener('selectstart', handler);
    cleanups.push(() => controller.removeEventListener('selectstart', handler));
  }

  return {
    controllers,
    dispose: () => cleanups.forEach((fn) => fn()),
  };
}

export function isHitHorizontal(transformMatrix: Float32Array): boolean {
  return transformMatrix[5] > 0.9;
}

/**
 * Returns the right-hand controller index and whether the grip+B combo
 * is currently pressed. Quest 3 right gamepad: buttons[1]=grip, buttons[5]=B.
 */
export function pollRightGripB(session: XRSession): {
  controllerIndex: number;
  pressed: boolean;
} | null {
  const sources = session.inputSources;
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (src.handedness !== 'right' || !src.gamepad) continue;
    const grip = src.gamepad.buttons[1]?.pressed ?? false;
    const b = src.gamepad.buttons[5]?.pressed ?? false;
    return { controllerIndex: i, pressed: grip && b };
  }
  return null;
}

export function raycastFromController(
  controller: THREE.Object3D,
  targets: THREE.Object3D[]
): THREE.Intersection | null {
  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  const hits = raycaster.intersectObjects(targets, false);
  return hits[0] ?? null;
}
