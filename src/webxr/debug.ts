import * as THREE from 'three';

const GRID_SIZE = 8;
const GRID_SPACING = 0.5;
const AXIS_LENGTH = 1;
const ORIGIN_RADIUS = 0.04;
const GRID_OPACITY = 0.55;

// Quadrant colors (matching the previous flood-fill scheme so origin orientation
// is still recognizable). +X-Z front-right, -X-Z front-left, +X+Z back-right,
// -X+Z back-left.
const Q_FRONT_RIGHT: [number, number, number] = [0.94, 0.27, 0.27]; // red
const Q_FRONT_LEFT: [number, number, number] = [0.13, 0.77, 0.37]; // green
const Q_BACK_RIGHT: [number, number, number] = [0.92, 0.7, 0.03]; // yellow
const Q_BACK_LEFT: [number, number, number] = [0.23, 0.51, 0.96]; // blue

function quadrantColor(x: number, z: number): [number, number, number] {
  if (x >= 0 && z < 0) return Q_FRONT_RIGHT;
  if (x < 0 && z < 0) return Q_FRONT_LEFT;
  if (x >= 0 && z >= 0) return Q_BACK_RIGHT;
  return Q_BACK_LEFT;
}

function pushSegment(
  positions: number[],
  colors: number[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  midX: number,
  midZ: number
): void {
  const [r, g, b] = quadrantColor(midX, midZ);
  positions.push(ax, 0.001, az, bx, 0.001, bz);
  colors.push(r, g, b, r, g, b);
}

export function createQuadrantFloor(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'debug-floor';

  const half = GRID_SIZE / 2;
  const positions: number[] = [];
  const colors: number[] = [];

  // Lines parallel to X (vary x, constant z). Skip the line at z=0 because the
  // colored axis lines cover that. Split each line at x=0 so the segment color
  // matches its quadrant.
  for (let i = 0; i <= GRID_SIZE / GRID_SPACING; i++) {
    const z = -half + i * GRID_SPACING;
    if (z === 0) continue;
    pushSegment(positions, colors, -half, z, 0, z, -half / 2, z);
    pushSegment(positions, colors, 0, z, half, z, half / 2, z);
  }

  // Lines parallel to Z (vary z, constant x). Skip x=0; split at z=0.
  for (let i = 0; i <= GRID_SIZE / GRID_SPACING; i++) {
    const x = -half + i * GRID_SPACING;
    if (x === 0) continue;
    pushSegment(positions, colors, x, -half, x, 0, x, -half / 2);
    pushSegment(positions, colors, x, 0, x, half, x, half / 2);
  }

  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const gridMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: GRID_OPACITY,
    depthWrite: false,
  });
  const grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.name = 'debug-grid';
  group.add(grid);

  // Axis lines from origin: +X red, +Y green, +Z blue.
  group.add(makeAxisLine(new THREE.Vector3(AXIS_LENGTH, 0, 0), 0xff0000));
  group.add(makeAxisLine(new THREE.Vector3(0, AXIS_LENGTH, 0), 0x00ff00));
  group.add(makeAxisLine(new THREE.Vector3(0, 0, AXIS_LENGTH), 0x0000ff));

  // Origin marker
  const originMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const origin = new THREE.Mesh(new THREE.SphereGeometry(ORIGIN_RADIUS, 16, 12), originMat);
  origin.position.set(0, ORIGIN_RADIUS, 0);
  group.add(origin);

  return group;
}

function makeAxisLine(end: THREE.Vector3, color: number): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.002, 0), end]);
  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geo, mat);
}

export function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
      else m.dispose();
    } else if (obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
}

// --- HUD console panel ---

const HUD_CANVAS_W = 640;
const HUD_CANVAS_H = 384;
const HUD_PLANE_W = 0.32;
const HUD_PLANE_H = 0.192;
const HUD_LINE_HEIGHT = 22;
const HUD_FONT_SIZE = 16;
const HUD_PADDING = 12;
const HUD_MAX_LINES = 14;

interface ConsolePanelUserData {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  lines: Array<{ level: 'log' | 'warn' | 'error'; text: string }>;
  dirty: boolean;
}

export function createConsolePanel(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = HUD_CANVAS_W;
  canvas.height = HUD_CANVAS_H;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const geo = new THREE.PlaneGeometry(HUD_PLANE_W, HUD_PLANE_H);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 999;
  mesh.matrixAutoUpdate = false;
  const ud: ConsolePanelUserData = { canvas, texture, lines: [], dirty: true };
  mesh.userData = ud;
  drawConsole(ud);
  return mesh;
}

function drawConsole(ud: ConsolePanelUserData): void {
  const ctx = ud.canvas.getContext('2d');
  if (!ctx) return;
  const W = ud.canvas.width;
  const H = ud.canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  ctx.font = `${HUD_FONT_SIZE}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';

  let y = HUD_PADDING;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('console', HUD_PADDING, y);
  y += HUD_LINE_HEIGHT;

  const start = Math.max(0, ud.lines.length - HUD_MAX_LINES);
  for (let i = start; i < ud.lines.length; i++) {
    const entry = ud.lines[i];
    ctx.fillStyle =
      entry.level === 'error' ? '#fca5a5' : entry.level === 'warn' ? '#fde68a' : '#e2e8f0';
    const truncated = entry.text.length > 72 ? `${entry.text.slice(0, 71)}…` : entry.text;
    ctx.fillText(truncated, HUD_PADDING, y);
    y += HUD_LINE_HEIGHT;
  }

  ud.texture.needsUpdate = true;
}

let installedPanel: THREE.Mesh | null = null;
let originalLog: typeof console.log | null = null;
let originalWarn: typeof console.warn | null = null;
let originalError: typeof console.error | null = null;

function pushLine(level: 'log' | 'warn' | 'error', args: unknown[]): void {
  if (!installedPanel) return;
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  const ud = installedPanel.userData as ConsolePanelUserData;
  ud.lines.push({ level, text });
  while (ud.lines.length > HUD_MAX_LINES * 2) ud.lines.shift();
  drawConsole(ud);
}

export function installConsoleCapture(panel: THREE.Mesh): void {
  if (installedPanel) return;
  installedPanel = panel;
  originalLog = console.log;
  originalWarn = console.warn;
  originalError = console.error;
  console.log = (...args: unknown[]) => {
    originalLog?.(...args);
    pushLine('log', args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn?.(...args);
    pushLine('warn', args);
  };
  console.error = (...args: unknown[]) => {
    originalError?.(...args);
    pushLine('error', args);
  };
}

export function uninstallConsoleCapture(): void {
  if (originalLog) console.log = originalLog;
  if (originalWarn) console.warn = originalWarn;
  if (originalError) console.error = originalError;
  originalLog = originalWarn = originalError = null;
  installedPanel = null;
}

const HUD_OFFSET = new THREE.Matrix4().compose(
  new THREE.Vector3(0.22, -0.18, -0.55),
  new THREE.Quaternion(),
  new THREE.Vector3(1, 1, 1)
);

const _tmp = new THREE.Matrix4();

export function updateHud(hud: THREE.Object3D, camera: THREE.Camera): void {
  _tmp.multiplyMatrices(camera.matrixWorld, HUD_OFFSET);
  hud.matrix.copy(_tmp);
}
