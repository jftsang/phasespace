import * as THREE from 'three';
import CameraControls from 'camera-controls';
import {rk4} from './helpers.js';

CameraControls.install({THREE: THREE});

const TAU = 2 * Math.PI;
const T_REF = 30;  // real seconds for the geometric-mean period
let TIME = 2 * Math.PI / T_REF;  // sim time units per real second, updated in setParams
const wrap = d => d - TAU * Math.round(d / TAU);

// units: l1 = m1 = g = 1; mu = m2/m1, lam = l2/l1
// drawn chart: (θ1, θ2, ω1) on {H=E}; we integrate in 4D, so the ω2 branch needs no logic
export const P = {mu: 1, lam: 1, E: 0, Vmax: 0, wmax: 1, kw: 1, ref: 1};
export const setParams = (mu, lam, t) => {
  P.mu = mu;
  P.lam = lam;
  P.Vmax = 1 + mu + mu * lam;
  P.E = P.Vmax * (t - 1);                  // t = 0: min V, t = 2: max V
  P.wmax = Math.sqrt(2 * (P.E + P.Vmax));
  P.pmax = Math.sqrt(2 * (P.E + P.Vmax) * (1 + mu));  // |p1| <= pmax on the surface
  P.kw = Math.PI / P.pmax;                            // scale p1 axis to ±π

  P.ref = 2 * P.wmax;
  TIME = 2 * Math.PI * Math.min(1, Math.sqrt(lam)) / T_REF;  // fastest linearised period is 30 s for lam < 1; T1 = 30 s for lam >= 1
};
export let dirty = true;

const f = ([a, b, w1, w2]) => {
  const {mu, lam} = P, d = a - b, c = Math.cos(d), s = Math.sin(d);
  const R1 = -mu * lam * s * w2 * w2 - (1 + mu) * Math.sin(a);
  const R2 = s * w1 * w1 - Math.sin(b);
  const det = lam * (1 + mu - mu * c * c);
  return [w1, w2, lam * (R1 - mu * c * R2) / det, ((1 + mu) * R2 - c * R1) / det];
};

// Lᵀω = r(cosφ, sinφ), M = LLᵀ
const L = c => {
  const A = Math.sqrt(1 + P.mu), B = P.mu * P.lam * c / A;
  return [A, B, Math.sqrt(P.mu * P.lam * P.lam - B * B)];
};
const V = (a, b) => -(1 + P.mu) * Math.cos(a) - P.mu * P.lam * Math.cos(b);
const T = ([a, b, w1, w2]) => 0.5 * ((1 + P.mu) * w1 * w1 + P.mu * P.lam * P.lam * w2 * w2 + 2 * P.mu * P.lam * Math.cos(a - b) * w1 * w2);
const p1 = ([a, b, w1, w2]) => (1 + P.mu) * w1 + P.mu * P.lam * Math.cos(a - b) * w2;  // ∂T/∂ω1

const step = (y, h) => {  // RK4, then rescale ω to stay exactly on H = E
  const y2 = rk4(f, y, h);
  const k = Math.sqrt((P.E - V(y2[0], y2[1])) / T(y2));
  return isFinite(k) ? [y2[0], y2[1], y2[2] * k, y2[3] * k] : y2;
};
const advance = (y, T) => {  // integrate over sim time T in substeps of at most 0.013
  const n = Math.ceil(T / 0.013), h = T / n;
  for (let i = 0; i < n; i++) y = step(y, h);
  return y;
};
const vel = y => {
  const d = f(y), df = y[0] - y[1];
  const dp1 = -P.mu * P.lam * Math.sin(df) * y[2] * y[3] - (1 + P.mu) * Math.sin(y[0]);  // ṗ1 = ∂L/∂θ1
  return new THREE.Vector3(d[0], d[1], P.kw * dp1);
};
const sample = () => {  // Liouville-distributed point on H = E
  for (; ;) {
    const a = Math.random() * TAU, b = Math.random() * TAU, c = Math.cos(a - b), K = P.E - V(a, b);
    if (K < 0 || Math.random() > 1 / Math.sqrt(1 + P.mu - P.mu * c * c)) continue;
    const [A, B, e] = L(c), r = Math.sqrt(2 * K), p = Math.random() * TAU, w2 = r * Math.sin(p) / e;
    return [a, b, (r * Math.cos(p) - B * w2) / A, w2];
  }
};
const project = y => {  // keep (θ, ω direction), rescale |ω| to the new energy; resample if outside the Hill region
  const k = Math.sqrt((P.E - V(y[0], y[1])) / T(y));
  return isFinite(k) ? [y[0], y[1], y[2] * k, y[3] * k] : sample();
};

const D0 = 1e-6, TAU_F = 8, LREF = 0.5;  // FTLE: separation, averaging window (sim time), colour scale
const pert = y => project([y[0] + D0, y[1], y[2], y[3]]);
const ftle = (s, dt) => {  // Benettin: track log-growth of a nearby shadow orbit, renormalise
  const [dx, dy, dz, dw] = [
    wrap(s.z[0] - s.y[0]), wrap(s.z[1] - s.y[1]), s.z[2] - s.y[2], s.z[3] - s.y[3]
  ];
  const d = Math.hypot(dx, dy, dz, dw);
  const a = Math.exp(-dt / TAU_F);
  if (!(d > 0) || d > 0.1) {
    s.z = pert(s.y);
    return;
  }
  s.acc = s.acc * a + Math.log(d / D0);
  s.w = s.w * a + dt;
  s.lam = s.acc / Math.max(s.w, 1);
  const k = D0 / d;
  s.z = project([s.y[0] + dx * k, s.y[1] + dy * k, s.y[2] + dz * k, s.y[3] + dw * k]);
};

// scene
const R = new THREE.WebGLRenderer({antialias: true});
R.setSize(innerWidth, innerHeight);
document.body.style.margin = 0;
document.body.append(R.domElement);
const S = new THREE.Scene();
S.background = new THREE.Color(0);
S.fog = new THREE.Fog(0, 2, 8);
const C = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.01, 10);
const controls = new CameraControls(C, R.domElement);
controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
controls.mouseButtons.right = CameraControls.ACTION.TRUCK;
controls.mouseButtons.middle = CameraControls.ACTION.DOLLY;
controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
controls.touches.three = CameraControls.ACTION.TOUCH_TRUCK;
controls.minDistance = 0.01;
controls.maxDistance = 1000;
controls.enabled = false;
controls.dragToOffset = false;

const keyState = {};
let mouseDown = false;
let lastMouseX = 0, lastMouseY = 0;
addEventListener('keydown', e => {
  keyState[e.code] = true;
});
addEventListener('keyup', e => {
  keyState[e.code] = false;
});
addEventListener('mousedown', e => {
  if (!camMoves) {
    mouseDown = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
});
addEventListener('mouseup', e => {
  mouseDown = false;
});
addEventListener('mousemove', e => {
  if (!camMoves && mouseDown) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    const rotSpeed = 0.005;
    C.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * rotSpeed));
    C.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * rotSpeed));
    C.quaternion.normalize();
  }
});
addEventListener('wheel', e => {
  if (!camMoves) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1.1 : 0.9;
    C.fov = Math.max(5, Math.min(200, C.fov * delta));
    C.updateProjectionMatrix();
  }
}, {passive: false});
addEventListener('resize', () => {
  R.setSize(innerWidth, innerHeight);
  C.aspect = innerWidth / innerHeight;
  C.updateProjectionMatrix();
});

const N = 5000, NS = 1, W = 2 * NS + 1, M = W * W;  // M periodic copies per tracer
const seeds = [];
const m = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();
const rel = new THREE.Vector3();
const sc = new THREE.Vector3();

const geo = new THREE.CylinderGeometry(0.006, 0.0005, 0.18, 5, 1, true).translate(0, -0.09, 0);  // head (+Y) at the tracer position
geo.setAttribute('color', new THREE.BufferAttribute(
  Float32Array.from({length: geo.attributes.position.count * 3}, (_, i) => geo.attributes.position.getY(i / 3 | 0) > -0.01 ? 1 : 0), 3
));  // white at head, black at tail
const mesh = new THREE.InstancedMesh(
  geo, new THREE.MeshBasicMaterial({vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false}), N * M
);

mesh.frustumCulled = false;
S.add(mesh);
for (let i = 0; i < N; i++) {
  seeds.push({y: [0, 0, 0, 0], z: [0, 0, 0, 0], acc: 0, w: 0, lam: 0, speed: 0, q: new THREE.Quaternion()});
  for (let j = 0; j < M; j++)
    mesh.setColorAt(i * M + j, col.setRGB(1, 1, 1));
}

// State
export let tracersMove = true;
export let camMoves = true;
export const setTracers = (v) => {
  tracersMove = v;
};
export const setCamOn = (v) => {
  camMoves = v;
};
export const triggerReset = () => {
  dirty = true;
};

// Manual camera state
let needRecenter = false;
let recenterTarget = null;
// pendulum view
const pc = document.createElement('canvas');
pc.width = pc.height = 180;
pc.style.cssText = 'position:fixed;right:12px;top:12px;background:#000a;border-radius:6px';
document.body.append(pc);
const px = pc.getContext('2d');
const drawPendulum = ([a, b]) => {  // lengths to scale (l1 = 1, l2 = lam); θ = 0 hangs down
  const s = 80 / (1 + P.lam), x0 = 90, y0 = 90;
  const x1 = x0 + s * Math.sin(a), y1 = y0 + s * Math.cos(a);
  const x2 = x1 + s * P.lam * Math.sin(b), y2 = y1 + s * P.lam * Math.cos(b);
  px.clearRect(0, 0, 180, 180);
  px.strokeStyle = px.fillStyle = '#ddd';
  px.lineWidth = 1.5;
  px.beginPath();
  px.moveTo(x0, y0);
  px.lineTo(x1, y1);
  px.lineTo(x2, y2);
  px.stroke();
  [[x1, y1, 1], [x2, y2, P.mu]].forEach(([x, y, m]) => {
    px.beginPath();
    px.arc(x, y, 2 + 3 * Math.cbrt(m), 0, TAU);
    px.fill();
  });
};

const camUp = new THREE.Vector3(0, 1, 0);
let cam = [0, 0, 0, 0];
let dir = new THREE.Vector3(0, 0, 1);
let last = performance.now();
let camWasOn = true;
const shiftP = dp => { cam[2] = (p1(cam) + dp - P.mu * P.lam * Math.cos(cam[0] - cam[1]) * cam[3]) / (1 + P.mu); };

(function loop() {
  const now = performance.now(), sdt = Math.min((now - last) / 1000, 0.05) * TIME;
  last = now;

  if (dirty) {
    seeds.forEach(s => {
      s.y = project(s.y);
      s.z = pert(s.y);
      s.acc = s.w = s.lam = 0;
    });
    cam = project(cam);
    dirty = false;
  }

  // Detect transition from camOn -> camOff or camOff -> camOn
  if (camWasOn !== camMoves) {
    if (!camMoves) {
      // Just paused - enable manual navigation
      controls.enabled = true;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(C.quaternion);
      controls.setTarget(C.position.x + forward.x * 0.5, C.position.y + forward.y * 0.5, C.position.z + forward.z * 0.5, false);
      controls.saveState();
    } else {
      // Just reactivated - check if cam position is valid
      controls.enabled = false;
      const K = P.E - V(cam[0], cam[1]);
      const Tval = T(cam);
      const k = K / Tval;
      if (!isFinite(k) || k < 0) {
        needRecenter = true;
        recenterTarget = fromChart(0, 0, 0, 1) || sample();
      }
    }
    camWasOn = camMoves;
  }

  if (camMoves) {
    if (needRecenter) {
      // Smoothly move camera back to origin and rotate to flow direction
      cam = project(cam.map(
        (c, i) => c + (i < 2 ? wrap(recenterTarget[i] - c) : recenterTarget[i] - c) * 0.1
      ));
      if (cam.every(
        (c, i) => Math.abs(i < 2 ? wrap(recenterTarget[i] - c) : recenterTarget[i] - c) < 1e-3)
      ) needRecenter = false;
    } else {
      cam = advance(cam, sdt);
    }
    const cv = vel(cam);

    dir.copy(cv.normalize());
    const forward = dir.clone();
    camUp.addScaledVector(forward, -camUp.dot(forward));
    if (camUp.lengthSq() < 1e-6) camUp.set(1, 0, 0).addScaledVector(forward, -forward.x);
    camUp.normalize();
    const up2 = camUp;
    const right = new THREE.Vector3().crossVectors(up2, forward).normalize();
    const mat = new THREE.Matrix4().makeBasis(right.clone().negate(), up2, forward.clone().negate());  // three.js cameras look down -Z
    C.quaternion.setFromRotationMatrix(mat);
  } else {
    controls.enabled = false;
    camUp.set(0, 1, 0).applyQuaternion(C.quaternion);
    // Manual controls as originally specified
    const moveSpeed = 0.02;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(C.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(C.quaternion);
    const upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(C.quaternion);

    if (keyState['KeyW'] || keyState['ArrowUp']) {
      cam[0] = wrap(cam[0] + upDir.x * moveSpeed);
      cam[1] = wrap(cam[1] + upDir.y * moveSpeed);
      shiftP(upDir.z * moveSpeed / P.kw);
    }
    if (keyState['KeyS'] || keyState['ArrowDown']) {
      cam[0] = wrap(cam[0] - upDir.x * moveSpeed);
      cam[1] = wrap(cam[1] - upDir.y * moveSpeed);
      shiftP(-upDir.z * moveSpeed / P.kw);
    }
    if (keyState['KeyA'] || keyState['ArrowLeft']) {
      cam[0] = wrap(cam[0] - right.x * moveSpeed);
      cam[1] = wrap(cam[1] - right.y * moveSpeed);
      shiftP(-right.z * moveSpeed / P.kw);
    }
    if (keyState['KeyD'] || keyState['ArrowRight']) {
      cam[0] = wrap(cam[0] + right.x * moveSpeed);
      cam[1] = wrap(cam[1] + right.y * moveSpeed);
      shiftP(right.z * moveSpeed / P.kw);
    }

    cam = project(cam);
    if (keyState['KeyQ']) {
      C.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(forward, 0.02));
    }
    if (keyState['KeyE']) {
      C.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(forward, -0.02));
    }
    if (keyState['KeyZ']) {
      C.fov = Math.max(5, C.fov - 1);
      C.updateProjectionMatrix();
    }
    if (keyState['KeyX']) {
      C.fov = Math.min(200, C.fov + 1);
      C.updateProjectionMatrix();
    }
  }

  if (tracersMove) {
    seeds.forEach((s, i) => {
      s.y = advance(s.y, sdt);
      s.z = advance(s.z, sdt);
      ftle(s, sdt);
      const v = vel(s.y), speed = v.length();
      s.speed = speed;
      s.q.setFromUnitVectors(up, v.divideScalar(speed));
      col.setHSL(0.7 - Math.min(Math.max(s.lam, 0) / LREF, 1) * 0.7, 1, 0.55);
      for (let j = 0; j < M; j++) mesh.setColorAt(i * M + j, col);
    });
    mesh.instanceColor.needsUpdate = true;
  }
  seeds.forEach((s, i) => {
    const len = Math.min(Math.max(s.speed / P.ref, 0.05), 4);  // rod length ∝ speed, in units of the base 0.08
    const x = wrap(s.y[0] - cam[0]), y = wrap(s.y[1] - cam[1]), z = P.kw * (p1(s.y) - p1(cam));
    sc.set(1, len, 1);
    for (let j = 0; j < M; j++) {
      rel.set(x + TAU * ((j % W) - NS), y + TAU * (Math.floor(j / W) - NS), z);
      m.compose(rel, s.q, sc);
      mesh.setMatrixAt(i * M + j, m);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;

  drawPendulum(cam);
  R.render(S, C);
  requestAnimationFrame(loop);
})();
