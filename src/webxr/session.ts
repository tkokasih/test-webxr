export async function isARSupported(): Promise<boolean> {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

export async function requestImmersiveAR(overlayRoot?: HTMLElement): Promise<XRSession> {
  if (!navigator.xr) throw new Error('WebXR not available');
  const init: XRSessionInit = {
    optionalFeatures: [
      'local-floor',
      'hit-test',
      'anchors',
      'plane-detection',
      'hand-tracking',
      'dom-overlay',
    ],
  };
  if (overlayRoot) {
    init.domOverlay = { root: overlayRoot };
  }
  return navigator.xr.requestSession('immersive-ar', init);
}

export async function getViewerHitTestSource(session: XRSession): Promise<XRHitTestSource | null> {
  if (!session.requestHitTestSource) return null;
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const source = await session.requestHitTestSource({ space: viewerSpace });
  return source ?? null;
}
