import * as THREE from 'three';

/* ============================================================
 * 이미지 → 3D 뷰어
 * - 업로드한 이미지를 최대 512px로 축소
 * - 밝기(luminance) 기반 깊이 맵을 Canvas로 생성 (박스 블러 반복)
 * - Three.js 변위 평면(displaced plane)으로 3D 렌더링
 * ============================================================ */

const MAX_SIZE = 512;      // 처리 해상도 상한
const BLUR_RADIUS = 4;     // 깊이 맵 블러 반경
const BLUR_PASSES = 2;     // 블러 반복 횟수 (가우시안 근사)
const MAX_DISPLACEMENT = 1.6; // 깊이 강도 1.0일 때 최대 돌출량 (world units)

// ---------- DOM ----------
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const sampleBtn = document.getElementById('sampleBtn');
const uploadSection = document.getElementById('uploadSection');
const resultSection = document.getElementById('resultSection');
const originalCanvas = document.getElementById('originalCanvas');
const depthCanvas = document.getElementById('depthCanvas');
const threeContainer = document.getElementById('threeContainer');
const depthStrengthInput = document.getElementById('depthStrength');
const depthValueLabel = document.getElementById('depthValue');
const autoRotateInput = document.getElementById('autoRotate');
const wireframeInput = document.getElementById('wireframe');
const newImageBtn = document.getElementById('newImageBtn');
const tabs = document.querySelectorAll('.tab');

// ---------- 상태 ----------
let three = null; // { renderer, scene, camera, group, mesh, vertexDepth, basePositions, rafId, ... }
const mouse = { x: 0, y: 0 };

/* ============================================================
 * 1. 이미지 입력
 * ============================================================ */

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadImageFromBlob(file);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  })
);
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    loadImageFromBlob(file);
  } else {
    alert('이미지 파일만 업로드할 수 있습니다.');
  }
});

sampleBtn.addEventListener('click', () => {
  const canvas = makeSamplePattern();
  processImage(canvas);
});

newImageBtn.addEventListener('click', resetToUpload);

/** 테스트용 패턴 이미지 생성 (파일 없이 체험) */
function makeSamplePattern() {
  const w = 512, h = 384;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // 배경 그라디언트
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#1a1a2e');
  bg.addColorStop(1, '#16213e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 밝은 원들 (앞으로 튀어나옴)
  const circles = [
    [150, 140, 90, '#ffffff'],
    [360, 120, 60, '#ffe08a'],
    [250, 260, 110, '#9adcff'],
    [420, 280, 45, '#ffffff'],
  ];
  for (const [x, y, r, color] of circles) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 밝은 사각형 프레임
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;
  ctx.strokeRect(40, 40, w - 80, h - 80);

  return c;
}

async function loadImageFromBlob(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    processImage(c);
  } catch (err) {
    console.error(err);
    alert('이미지를 불러오지 못했습니다.');
  }
}

/* ============================================================
 * 2. 리사이즈 + 깊이 맵 생성
 * ============================================================ */

/** 최대 512px로 다운스케일 */
function downscale(sourceCanvas) {
  const scale = Math.min(1, MAX_SIZE / Math.max(sourceCanvas.width, sourceCanvas.height));
  const w = Math.max(1, Math.round(sourceCanvas.width * scale));
  const h = Math.max(1, Math.round(sourceCanvas.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  return { canvas: c, width: w, height: h };
}

/** 분리형 박스 블러 1패스 (가로 또는 세로) */
function boxBlurPass(src, dst, w, h, radius, horizontal) {
  const diameter = radius * 2 + 1;
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -radius; x <= radius; x++) acc += src[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        dst[row + x] = acc / diameter;
        acc += src[row + clamp(x + radius + 1, 0, w - 1)] - src[row + clamp(x - radius, 0, w - 1)];
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) acc += src[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc / diameter;
        acc += src[clamp(y + radius + 1, 0, h - 1) * w + x] - src[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
  }
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * 깊이 맵 생성
 * 1) RGB → 밝기(luminance)
 * 2) 박스 블러 반복 (가우시안 근사) → 노이즈 완화
 * 3) min-max 정규화 → 0~1
 */
function computeDepthMap(imageData, w, h) {
  const n = w * h;
  const lum = new Float32Array(n);
  const d = imageData.data;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const tmp = new Float32Array(n);
  let src = lum, dst = tmp;
  for (let p = 0; p < BLUR_PASSES; p++) {
    boxBlurPass(src, dst, w, h, BLUR_RADIUS, true);
    boxBlurPass(dst, src, w, h, BLUR_RADIUS, false);
  }

  // 정규화
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (src[i] < min) min = src[i];
    if (src[i] > max) max = src[i];
  }
  const range = max - min || 1;
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i++) depth[i] = (src[i] - min) / range;

  return depth;
}

/** 깊이 맵을 그레이스케일 캔버스로 렌더링 */
function renderDepthCanvas(depth, w, h) {
  depthCanvas.width = w;
  depthCanvas.height = h;
  const ctx = depthCanvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(depth[i] * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ============================================================
 * 3. 전체 처리 파이프라인
 * ============================================================ */

function processImage(sourceCanvas) {
  const { canvas, width, height } = downscale(sourceCanvas);

  // 원본 표시
  originalCanvas.width = width;
  originalCanvas.height = height;
  originalCanvas.getContext('2d').drawImage(canvas, 0, 0);

  // 깊이 맵
  const imageData = canvas.getContext('2d').getImageData(0, 0, width, height);
  const depth = computeDepthMap(imageData, width, height);
  renderDepthCanvas(depth, width, height);

  // 3D 씬 구축
  buildScene(canvas, depth, width, height);

  // 화면 전환
  uploadSection.classList.add('hidden');
  resultSection.classList.remove('hidden');
  switchTab('original');
}

function resetToUpload() {
  disposeScene();
  resultSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
}

/* ============================================================
 * 4. Three.js 3D 씬
 * ============================================================ */

function buildScene(imageCanvas, depth, w, h) {
  disposeScene();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  threeContainer.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  // 은은한 배경 별(파티클)
  scene.add(makeStars());

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  // 조명
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 4, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x58a6ff, 0.6);
  rim.position.set(-4, -2, -3);
  scene.add(rim);

  // 평면 크기: 긴 변 = 4 world units
  const aspect = w / h;
  const planeW = aspect >= 1 ? 4 : 4 * aspect;
  const planeH = aspect >= 1 ? 4 / aspect : 4;

  // 세그먼트: 정점 수가 너무 커지지 않게 제한
  const maxSeg = 220;
  const segX = Math.min(maxSeg, Math.max(64, Math.round((maxSeg * w) / MAX_SIZE)));
  const segY = Math.min(maxSeg, Math.max(64, Math.round((maxSeg * h) / MAX_SIZE)));

  const geometry = new THREE.PlaneGeometry(planeW, planeH, segX, segY);

  // 정점별 깊이 저장 (슬라이더로 강도 조절용)
  const posAttr = geometry.attributes.position;
  const vertexDepth = new Float32Array(posAttr.count);
  for (let iy = 0; iy <= segY; iy++) {
    for (let ix = 0; ix <= segX; ix++) {
      // 정점 (ix, iy) ↔ 픽셀 (px, py): plane의 row 0이 위쪽(y+)이므로 canvas row와 직접 대응
      const px = Math.round((ix / segX) * (w - 1));
      const py = Math.round((iy / segY) * (h - 1));
      vertexDepth[iy * (segX + 1) + ix] = depth[py * w + px];
    }
  }
  geometry.computeVertexNormals();

  const texture = new THREE.CanvasTexture(imageCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);

  // 카메라 거리: 평면이 화면에 꽉 차도록
  const fitDist = (Math.max(planeW, planeH) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, 0, fitDist * 1.35);
  camera.lookAt(0, 0, 0);

  three = {
    renderer, scene, camera, group, mesh, geometry,
    vertexDepth, segX, segY,
    strength: parseFloat(depthStrengthInput.value),
    autoRotate: autoRotateInput.checked,
    targetRX: 0, targetRY: 0,
    curRX: 0, curRY: 0,
    spin: 0,
    rafId: 0,
    clock: new THREE.Clock(),
  };

  applyDisplacement();
  onResize();
  animate();
}

function applyDisplacement() {
  if (!three) return;
  const { geometry, vertexDepth, strength } = three;
  const posAttr = geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    posAttr.setZ(i, vertexDepth[i] * strength * MAX_DISPLACEMENT);
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** 배경 별 파티클 */
function makeStars() {
  const count = 400;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 18 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const m = new THREE.PointsMaterial({ color: 0x8b9bb4, size: 0.06, transparent: true, opacity: 0.7 });
  return new THREE.Points(g, m);
}

function animate() {
  if (!three) return;
  const t = three;
  t.rafId = requestAnimationFrame(animate);

  const dt = Math.min(t.clock.getDelta(), 0.05);

  // 자동 회전: 누적 회전각
  if (t.autoRotate) {
    t.spin += dt * 0.35;
  }

  // 마우스 패럴랙스 (부드럽게 보간)
  t.curRX += (t.targetRX - t.curRX) * 0.06;
  t.curRY += (t.targetRY - t.curRY) * 0.06;
  t.group.rotation.x = t.curRX;
  t.group.rotation.y = t.spin + t.curRY;

  t.renderer.render(t.scene, t.camera);
}

function onResize() {
  if (!three) return;
  const w = threeContainer.clientWidth;
  const h = threeContainer.clientHeight;
  if (w === 0 || h === 0) return;
  three.camera.aspect = w / h;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(w, h);
}

function disposeScene() {
  if (!three) return;
  cancelAnimationFrame(three.rafId);
  three.scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
  three.renderer.dispose();
  if (three.renderer.domElement.parentNode === threeContainer) {
    threeContainer.removeChild(three.renderer.domElement);
  }
  three = null;
}

// 마우스 패럴랙스 입력
window.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  if (three) {
    three.targetRY = mouse.x * 0.35;
    three.targetRX = -mouse.y * 0.25;
  }
});

window.addEventListener('resize', onResize);

/* ============================================================
 * 5. UI 컨트롤
 * ============================================================ */

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add('active');
  // 3D 탭이 다시 보일 때 렌더러 크기 재계산 (숨겨진 동안 0이 될 수 있음)
  if (name === 'view3d') requestAnimationFrame(onResize);
}

depthStrengthInput.addEventListener('input', () => {
  const v = parseFloat(depthStrengthInput.value);
  depthValueLabel.textContent = v.toFixed(1);
  if (three) {
    three.strength = v;
    applyDisplacement();
  }
});

autoRotateInput.addEventListener('change', () => {
  if (three) three.autoRotate = autoRotateInput.checked;
});

wireframeInput.addEventListener('change', () => {
  if (three) three.mesh.material.wireframe = wireframeInput.checked;
});
