import * as THREE from 'three';

const TAU = 2 * Math.PI;
const T_REF = 30;  // real seconds for the geometric-mean period
let TIME = 2 * Math.PI / T_REF;  // sim time units per real second, updated in setParams
const wrap = d => d - TAU * Math.round(d / TAU);

// units: l1 = m1 = g = 1; mu = m2/m1, lam = l2/l1
// drawn chart: (θ1, θ2, ω1) on {H=E}; we integrate in 4D, so the ω2 branch needs no logic
export const P = { mu: 1, lam: 1, E: 0, Vmax: 0, wmax: 1, kw: 1, ref: 1 };
export const setParams = (mu, lam, t) => {
  P.mu = mu; P.lam = lam; P.Vmax = 1 + mu + mu * lam;
  P.E = P.Vmax * (t - 1);                  // t = 0: min V, t = 2: max V
  P.wmax = Math.sqrt(2 * (P.E + P.Vmax));  // |ω1| <= wmax on the surface
  P.kw = Math.PI / P.wmax;                 // scale ω1 axis to ±π
  P.ref = 2 * P.wmax;
  TIME = 2 * Math.PI * Math.min(1, Math.sqrt(lam)) / T_REF;  // fastest linearised period is 30 s for lam < 1; T1 = 30 s for lam >= 1
};

const f = ([a, b, w1, w2]) => {
  const { mu, lam } = P, d = a - b, c = Math.cos(d), s = Math.sin(d);
  const R1 = -mu * lam * s * w2 * w2 - (1 + mu) * Math.sin(a);
  const R2 = s * w1 * w1 - Math.sin(b);
  const det = lam * (1 + mu - mu * c * c);
  return [w1, w2, lam * (R1 - mu * c * R2) / det, ((1 + mu) * R2 - c * R1) / det];
};
const rk4 = (y, h) => {
  const add = (y, k, s) => y.map((v, i) => v + s * k[i]);
  const k1 = f(y), k2 = f(add(y, k1, h/2)), k3 = f(add(y, k2, h/2)), k4 = f(add(y, k3, h));
  return y.map((v, i) => v + h/6 * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
};

// Lᵀω = r(cosφ, sinφ), M = LLᵀ
const L = c => {
  const A = Math.sqrt(1 + P.mu), B = P.mu * P.lam * c / A;
  return [A, B, Math.sqrt(P.mu * P.lam * P.lam - B * B)];
};
const V = (a, b) => -(1 + P.mu) * Math.cos(a) - P.mu * P.lam * Math.cos(b);
const T = ([a, b, w1, w2]) => 0.5 * ((1 + P.mu) * w1*w1 + P.mu*P.lam*P.lam * w2*w2 + 2*P.mu*P.lam*Math.cos(a - b) * w1*w2);
const step = (y, h) => {  // RK4, then rescale ω to stay exactly on H = E
  const y2 = rk4(y, h), k = Math.sqrt((P.E - V(y2[0], y2[1])) / T(y2));
  return isFinite(k) ? [y2[0], y2[1], y2[2] * k, y2[3] * k] : y2;
};
const advance = (y, T) => {  // integrate over sim time T in substeps of at most 0.013
  const n = Math.ceil(T / 0.013), h = T / n;
  for (let i = 0; i < n; i++) y = step(y, h);
  return y;
};
const vel = y => { const d = f(y); return new THREE.Vector3(d[0], d[1], P.kw * d[2]); };
const sample = () => {  // Liouville-distributed point on H = E
  for (;;) {
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
  const dx = wrap(s.z[0] - s.y[0]), dy = wrap(s.z[1] - s.y[1]), dz = s.z[2] - s.y[2], dw = s.z[3] - s.y[3];
  const d = Math.hypot(dx, dy, dz, dw), a = Math.exp(-dt / TAU_F);
  if (!(d > 0) || d > 0.1) { s.z = pert(s.y); return; }
  s.acc = s.acc * a + Math.log(d / D0); s.w = s.w * a + dt; s.lam = s.acc / Math.max(s.w, 1);
  const k = D0 / d;
  s.z = project([s.y[0] + dx * k, s.y[1] + dy * k, s.y[2] + dz * k, s.y[3] + dw * k]);
};

// scene
const R = new THREE.WebGLRenderer({ antialias: true }); R.setSize(innerWidth, innerHeight);
document.body.style.margin = 0; document.body.append(R.domElement);
const S = new THREE.Scene();
S.background = new THREE.Color(0);
S.fog = new THREE.Fog(0, 2, 8);
const C = new THREE.PerspectiveCamera(80, innerWidth/innerHeight, 0.01, 10);
addEventListener('resize', () => { R.setSize(innerWidth, innerHeight); C.aspect = innerWidth/innerHeight; C.updateProjectionMatrix(); });

const N = 10000, seeds = [];
const m = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color(), rel = new THREE.Vector3(), sc = new THREE.Vector3(), fwd = new THREE.Vector3(), dq = new THREE.Quaternion();
const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.004, 0.004, 0.018, 5), new THREE.MeshBasicMaterial(), N);
mesh.frustumCulled = false;
S.add(mesh);
for (let i = 0; i < N; i++) {
  seeds.push({ y: [0, 0, 0, 0], z: [0, 0, 0, 0], acc: 0, w: 0, lam: 0, speed: 0, q: new THREE.Quaternion() });
  mesh.setColorAt(i, col.setRGB(1, 1, 1));
}

// State
export let dirty = true;
export let tracers = true;
export let camOn = true;
export const setTracers = (v) => { tracers = v; };
export const setCamOn = (v) => { camOn = v; };
export const triggerReset = () => { dirty = true; };

// pendulum view
const pc = document.createElement('canvas'); pc.width = pc.height = 180;
pc.style.cssText = 'position:fixed;right:12px;top:12px;background:#000a;border-radius:6px';
document.body.append(pc);
const px = pc.getContext('2d');
const drawPendulum = ([a, b]) => {  // lengths to scale (l1 = 1, l2 = lam); θ = 0 hangs down
  const s = 80 / (1 + P.lam), x0 = 90, y0 = 90;
  const x1 = x0 + s * Math.sin(a), y1 = y0 + s * Math.cos(a);
  const x2 = x1 + s * P.lam * Math.sin(b), y2 = y1 + s * P.lam * Math.cos(b);
  px.clearRect(0, 0, 180, 180);
  px.strokeStyle = px.fillStyle = '#ddd'; px.lineWidth = 1.5;
  px.beginPath(); px.moveTo(x0, y0); px.lineTo(x1, y1); px.lineTo(x2, y2); px.stroke();
  [[x1, y1, 1], [x2, y2, P.mu]].forEach(([x, y, m]) => { px.beginPath(); px.arc(x, y, 2 + 3 * Math.cbrt(m), 0, TAU); px.fill(); });
};

let cam = [0, 0, 0, 0], dir = new THREE.Vector3(0, 0, 1), last = performance.now();
(function loop() {
  const now = performance.now(), sdt = Math.min((now - last) / 1000, 0.05) * TIME; last = now;

  if (dirty) { seeds.forEach(s => { s.y = project(s.y); s.z = pert(s.y); s.acc = s.w = s.lam = 0; }); cam = project(cam); dirty = false; }
  const cv = vel(cam);
  if (camOn) cam = advance(cam, sdt);
  dir.copy(cv.normalize());

  if (tracers) {
    seeds.forEach((s, i) => {
      s.y = advance(s.y, sdt); s.z = advance(s.z, sdt); ftle(s, sdt);
      const v = vel(s.y), speed = v.length();
      s.speed = speed;
      s.q.setFromUnitVectors(up, v.divideScalar(speed));
      mesh.setColorAt(i, col.setHSL(0.7 - Math.min(Math.max(s.lam, 0) / LREF, 1) * 0.7, 1, 0.55));
    });
    mesh.instanceColor.needsUpdate = true;
  }
  seeds.forEach((s, i) => {
    rel.set(wrap(s.y[0] - cam[0]), wrap(s.y[1] - cam[1]), P.kw * (s.y[2] - cam[2]));
    const k = Math.max(0, Math.min(1, (Math.PI - Math.max(Math.abs(rel.x), Math.abs(rel.y))) / 0.6));
    const len = Math.min(Math.max(s.speed / P.ref, 0.05), 4);  // rod length ∝ speed, in units of the base 0.08
    m.compose(rel, s.q, sc.set(k, k * len, k)); mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;

  fwd.set(0, 0, -1).applyQuaternion(C.quaternion);
  C.quaternion.premultiply(dq.setFromUnitVectors(fwd, dir));
  C.quaternion.normalize();
  drawPendulum(cam);
  R.render(S, C); requestAnimationFrame(loop);
})();
