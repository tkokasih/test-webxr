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

interface EditingNote {
  uuid: string;
  initialText: string;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleRef = useRef<ARHandle | null>(null);
  const editResolveRef = useRef<((text: string | null) => void) | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ARStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [editingNote, setEditingNote] = useState<EditingNote | null>(null);
  const [editDraft, setEditDraft] = useState('');

  useEffect(() => {
    isARSupported().then((ok) => setSupported(ok));
  }, []);

  useEffect(() => {
    return () => {
      editResolveRef.current?.(null);
      editResolveRef.current = null;
      handleRef.current?.end();
    };
  }, []);

  useEffect(() => {
    if (editingNote && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingNote]);

  function handleEditRequest(_uuid: string, currentText: string): Promise<string | null> {
    return new Promise((resolve) => {
      // Resolve any prior pending edit defensively.
      editResolveRef.current?.(null);
      editResolveRef.current = resolve;
      setEditDraft(currentText);
      setEditingNote({ uuid: _uuid, initialText: currentText });
    });
  }

  function commitEdit() {
    editResolveRef.current?.(editDraft);
    editResolveRef.current = null;
    setEditingNote(null);
  }

  function cancelEdit() {
    editResolveRef.current?.(null);
    editResolveRef.current = null;
    setEditingNote(null);
  }

  async function onEnterAR() {
    if (!containerRef.current) return;
    try {
      const handle = await startAR(containerRef.current, {
        overlayRoot: overlayRef.current ?? undefined,
        onStatus: (s, d) => {
          setStatus(s);
          setStatusDetail(d);
        },
        onEditRequest: handleEditRequest,
      });
      handleRef.current = handle;
    } catch {
      // status already set via onStatus callback
    }
  }

  const overlayActive = editingNote !== null;

  return (
    <>
      <BranchBanner />
      <main className="pre-ar">
        <h1>WebXR Spatial Notes</h1>
        <p>
          Place persistent text notes anchored in mid-air, viewed through Meta Quest 3 passthrough.
          Hand tracking and controllers both work — pinch / pull trigger does everything.
        </p>

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

        <ul className="ar-hint ar-hint--list">
          <li>
            <strong>Create</strong>: pinch in empty space to spawn an empty sticky note at your
            hand.
          </li>
          <li>
            <strong>Edit</strong>: pinch the card body → a textarea opens on top of the AR view with
            the Quest system keyboard.
          </li>
          <li>
            <strong>Move</strong>: pinch the cyan sphere on the top edge and drag.
          </li>
          <li>
            <strong>Delete</strong>: pinch the red sphere on the top-right of the card. Controllers
            can also use grip + B as a fallback.
          </li>
        </ul>
        <p className="ar-hint">
          Debug aids: a quadrant-colored floor marks the local-floor origin (white sphere) with axis
          lines (red +X, green +Y, blue +Z). A head-locked console panel in the lower-right captures{' '}
          <code>console.log/warn/error</code>.
        </p>
      </main>
      <div ref={containerRef} className="ar-canvas-container" aria-hidden="true" />
      <div
        ref={overlayRef}
        id="xr-overlay"
        className="xr-overlay"
        data-active={overlayActive ? 'true' : 'false'}
      >
        {editingNote && (
          <div className="xr-edit-card">
            <label className="xr-edit-label" htmlFor="xr-edit-textarea">
              Edit note text
            </label>
            <textarea
              ref={textareaRef}
              id="xr-edit-textarea"
              className="xr-edit-textarea"
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              rows={4}
              placeholder="Type here…"
            />
            <div className="xr-edit-actions">
              <button type="button" className="xr-edit-btn xr-edit-btn--ghost" onClick={cancelEdit}>
                Cancel
              </button>
              <button
                type="button"
                className="xr-edit-btn xr-edit-btn--primary"
                onClick={commitEdit}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
