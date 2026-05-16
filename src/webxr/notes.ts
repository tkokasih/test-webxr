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

interface NoteMeshUserData {
  textCanvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  text: string;
}

export function createNoteMesh(text: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  drawNoteCanvas(canvas, text);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const geo = new THREE.PlaneGeometry(NOTE_W, NOTE_H);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const userData: NoteMeshUserData = { textCanvas: canvas, texture, text };
  mesh.userData = userData;
  return mesh;
}

export function updateNoteTexture(mesh: THREE.Mesh, text: string): void {
  const ud = mesh.userData as NoteMeshUserData;
  drawNoteCanvas(ud.textCanvas, text);
  ud.texture.needsUpdate = true;
  ud.text = text;
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
