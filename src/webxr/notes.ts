import * as THREE from 'three';

const CANVAS_W = 512;
const CANVAS_H = 256;
const NOTE_W = 0.4;
const NOTE_H = 0.2;
const PADDING = 24;
const FONT_SIZE = 28;
const LINE_HEIGHT = 36;
const BG_FILL = 'rgba(15, 23, 42, 0.78)';
const TEXT_FILL = '#ffffff';
const CORNER_RADIUS = 24;

const HANDLE_RADIUS = 0.025;
const HANDLE_OFFSET_Y = NOTE_H / 2 + 0.04;
const MOVE_COLOR = 0x06b6d4;
const DELETE_COLOR = 0xef4444;

export type NoteRole = 'body' | 'move-handle' | 'delete-handle';

export interface NoteBodyUserData {
  role: 'body';
  textCanvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  text: string;
}

export function createNoteMesh(text: string): THREE.Group {
  const group = new THREE.Group();

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  drawNoteCanvas(canvas, text);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const bodyGeo = new THREE.PlaneGeometry(NOTE_W, NOTE_H);
  const bodyMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  const bodyUserData: NoteBodyUserData = { role: 'body', textCanvas: canvas, texture, text };
  body.userData = bodyUserData;
  group.add(body);

  const handleGeo = new THREE.SphereGeometry(HANDLE_RADIUS, 16, 12);

  const moveHandle = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: MOVE_COLOR }));
  moveHandle.position.set(0, HANDLE_OFFSET_Y, 0);
  moveHandle.userData = { role: 'move-handle' };
  group.add(moveHandle);

  const deleteHandle = new THREE.Mesh(
    handleGeo,
    new THREE.MeshBasicMaterial({ color: DELETE_COLOR })
  );
  deleteHandle.position.set(NOTE_W / 2 - HANDLE_RADIUS, HANDLE_OFFSET_Y, 0);
  deleteHandle.userData = { role: 'delete-handle' };
  group.add(deleteHandle);

  return group;
}

function findBody(group: THREE.Object3D): THREE.Mesh | null {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh && (child.userData as { role?: string }).role === 'body') {
      return child;
    }
  }
  return null;
}

export function updateNoteTexture(group: THREE.Object3D, text: string): void {
  const body = findBody(group);
  if (!body) return;
  const ud = body.userData as NoteBodyUserData;
  drawNoteCanvas(ud.textCanvas, text);
  ud.texture.needsUpdate = true;
  ud.text = text;
}

export function getNoteText(group: THREE.Object3D): string {
  const body = findBody(group);
  if (!body) return '';
  return (body.userData as NoteBodyUserData).text;
}

export function disposeNoteGroup(group: THREE.Object3D): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const m = child.material;
      if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
      else m.dispose();
    }
  });
  const body = findBody(group);
  if (body) (body.userData as NoteBodyUserData).texture.dispose();
}

function drawNoteCanvas(canvas: HTMLCanvasElement, text: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = BG_FILL;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, CORNER_RADIUS);
  ctx.fill();

  ctx.fillStyle = TEXT_FILL;
  ctx.font = `${FONT_SIZE}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'top';

  const maxWidth = W - 2 * PADDING;
  const lines = wrapText(ctx, text.trim() || '(empty note)', maxWidth);
  let y = PADDING;
  for (const line of lines) {
    if (y + LINE_HEIGHT > H - PADDING) break;
    ctx.fillText(line, PADDING, y);
    y += LINE_HEIGHT;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

const _target = new THREE.Vector3();

export function billboardYAxis(mesh: THREE.Object3D, cameraWorldPos: THREE.Vector3): void {
  _target.set(cameraWorldPos.x, mesh.position.y, cameraWorldPos.z);
  mesh.lookAt(_target);
}
