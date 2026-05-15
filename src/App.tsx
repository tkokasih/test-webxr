import { useEffect, useRef, useState } from 'react';
import { isARSupported, startAR, type ARHandle, type ARStatus } from './webxr';

function BranchBanner() {
  const branch = import.meta.env.VITE_BUILD_BRANCH;
  const sha = import.meta.env.VITE_BUILD_SHA;

  if (!branch || branch === 'main') return null;

  return (
    <div className="branch-banner">
      Preview — branch: <strong>{branch}</strong>
      {sha && <span> · {sha}</span>}
    </div>
  );
}

function statusMessage(status: ARStatus, detail?: string): string {
  switch (status) {
    case 'idle':
      return '';
    case 'requesting':
      return 'Requesting AR session…';
    case 'active':
      return 'AR session active. Put on your headset.';
    case 'ended':
      return 'AR session ended.';
    case 'unsupported':
      return 'WebXR immersive-ar is not supported on this device/browser.';
    case 'persistent-unsupported':
      return 'Persistent anchors are not supported. Notes will not survive reloads.';
    case 'limit':
      return 'Note limit reached (8 max).';
    case 'error':
      return `Error: ${detail ?? 'unknown'}`;
  }
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ARHandle | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ARStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [draftText, setDraftText] = useState('');
  const [activeText, setActiveText] = useState('');

  useEffect(() => {
    isARSupported().then((ok) => setSupported(ok));
  }, []);

  useEffect(() => {
    return () => {
      handleRef.current?.end();
    };
  }, []);

  function commitText() {
    setActiveText(draftText);
    handleRef.current?.setPendingText(draftText);
  }

  async function onEnterAR() {
    if (!containerRef.current) return;
    try {
      const handle = await startAR(containerRef.current, {
        initialText: activeText,
        onStatus: (s, d) => {
          setStatus(s);
          setStatusDetail(d);
        },
      });
      handleRef.current = handle;
    } catch {
      // status already set via onStatus callback
    }
  }

  return (
    <>
      <BranchBanner />
      <main className="pre-ar">
        <h1>WebXR Spatial Notes</h1>
        <p>
          Place persistent text notes anchored to real-world surfaces, viewed through Meta Quest 3
          passthrough.
        </p>

        <label className="note-label" htmlFor="note-text">
          Note text (used for the next placement):
        </label>
        <textarea
          id="note-text"
          className="note-textarea"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          rows={3}
          placeholder="e.g. buy milk"
        />
        <div className="note-actions">
          <button
            type="button"
            className="set-text-btn"
            onClick={commitText}
            disabled={draftText === activeText}
          >
            Set
          </button>
          <span className="active-text">
            Active: <strong>{activeText || '(empty)'}</strong>
          </span>
        </div>

        {supported === null && <p className="ar-status">Checking WebXR support…</p>}
        {supported === false && (
          <p className="ar-status ar-status--error">
            {statusMessage('unsupported')} On Quest, use Quest Browser ≥ v24.4.
          </p>
        )}
        {supported === true && (
          <button className="enter-ar-btn" onClick={onEnterAR} disabled={status === 'requesting'}>
            Enter AR
          </button>
        )}

        {status !== 'idle' && supported !== false && (
          <p className="ar-status">{statusMessage(status, statusDetail)}</p>
        )}

        <p className="ar-hint">
          Phase 4: trigger places a translucent note card showing the active text, anchored to the
          surface and billboarded toward you. Grip + B deletes. Notes survive page reload.
        </p>
      </main>
      <div ref={containerRef} className="ar-canvas-container" aria-hidden="true" />
    </>
  );
}
