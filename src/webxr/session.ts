export async function isARSupported(): Promise<boolean> {
  if (!navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

export async function requestImmersiveAR(): Promise<XRSession> {
  if (!navigator.xr) throw new Error('WebXR not available');
  return navigator.xr.requestSession('immersive-ar', {
    optionalFeatures: ['local-floor', 'hit-test', 'anchors', 'plane-detection'],
  });
}

export async function getViewerHitTestSource(session: XRSession): Promise<XRHitTestSource | null> {
  if (!session.requestHitTestSource) return null;
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const source = await session.requestHitTestSource({ space: viewerSpace });
  return source ?? null;
}
