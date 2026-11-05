// Visualizador 3D genérico de veículos (aba Manutenção do NESC).
// Carrega QUALQUER modelo GLB/GLTF licenciado — não é um carro fixo. A posição dos marcadores de
// manutenção é calculada a partir do próprio modelo (caixa envolvente + rodas detectadas), com
// ajustes opcionais vindos do cadastro do modelo (orientação/escala). three.js r170 do próprio site.
import * as THREE from './vendor/three/three.module.min.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';

// cor → [hex, metalness, roughness]; sólidas pouco metálicas, metálicas com mais brilho
const PAINT = { branco: [0xecece8, 0.25, 0.32], prata: [0xb6bac1, 0.9, 0.3], cinza: [0x484c53, 0.85, 0.3], preto: [0x0b0c0f, 0.55, 0.24],
  vermelho: [0x8f0f15, 0.85, 0.27], azul: [0x173a84, 0.85, 0.28], bege: [0xc5b18d, 0.5, 0.33], verde: [0x22483a, 0.8, 0.28] };
const GLOW = { vencido: 0xff3b2f, conferir: 0xffa12a, proximo: 0xffa12a };
const WHEEL = /wheel|tyre|tire|rim|roda|pneu|disc|brake|freio|caliper/i;
const SKIP_PAINT = /glass|window|vidro|tyre|tire|rubber|pneu|chrome|cromo|light|lamp|farol|lanterna|head|tail|plate|placa|mirror|interior|seat|dash|wheel|rim|disc|brake|grill|grade/i;

// cache de modelos já baixados (por url) — evita baixar o mesmo GLB de novo
const cache = new Map();
function loadGLB(url, onProgress) {
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((ok, err) => new GLTFLoader().load(url, (g) => ok(g),
    (e) => { if (onProgress && e.total) onProgress(Math.min(1, e.loaded / e.total)); }, (e) => { cache.delete(url); err(e); }));
  cache.set(url, p); return p;
}
const radialTex = (stops) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

// orienta o modelo: frente para +X, comprimento no eixo X, apoiado no chão e centrado
function orient(obj, fit) {
  const f = (fit && fit.forward) || 'auto';
  const rot = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[f];
  if (rot !== undefined) obj.rotation.y = rot;
  else { // auto: eixo horizontal mais longo vira o comprimento (X)
    const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new THREE.Vector3());
    if (s.z > s.x) obj.rotation.y = -Math.PI / 2;
  }
  if (fit && fit.flip) obj.rotation.y += Math.PI;
  obj.updateMatrixWorld(true);
}

export async function createCarViewer(opt = {}) {
  const low = !!opt.lowPower, R = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  R.setPixelRatio(Math.min(devicePixelRatio || 1, low ? 1.5 : 2)); R.setClearColor(0x000000, 0);
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05; R.outputColorSpace = THREE.SRGBColorSpace;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), pm = new THREE.PMREMGenerator(R);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.035).texture; scene.environmentIntensity = 0.85; pm.dispose();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xfff3df, 0x0d0b08, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2.5, 6.5, 3.5); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 1, far: 16 });
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc36e, 1.3); rim.position.set(-5, 2.6, -4.5); scene.add(rim);
  const front = new THREE.DirectionalLight(0xdfe8ff, 0.55); front.position.set(0, 1.5, 7); scene.add(front);

  // plataforma dourada
  const stage = new THREE.Group(); scene.add(stage);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 96), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(84,66,34,.6)'], [0.55, 'rgba(38,30,16,.38)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; stage.add(floor);
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.5 })); shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0.002; shadowPlane.receiveShadow = true; stage.add(shadowPlane);
  const ring = (a, b, o, c) => { const m = new THREE.Mesh(new THREE.RingGeometry(a, b, 160), new THREE.MeshBasicMaterial({ color: c || 0xe2b250, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = 0.004; stage.add(m); };
  ring(3.0, 3.045, 0.9); ring(3.26, 3.275, 0.32); ring(2.62, 2.632, 0.22, 0xfff0c8);
  const dash = new THREE.Group(); for (let i = 0; i < 56; i++) dash.add(new THREE.Mesh(new THREE.RingGeometry(3.11, 3.17, 6, 1, (i / 56) * Math.PI * 2, ((Math.PI * 2) / 56) * 0.55), new THREE.MeshBasicMaterial({ color: 0xf6dc9a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
  dash.rotation.x = -Math.PI / 2; dash.position.y = 0.005; stage.add(dash);

  // ---- modelo ----
  const gltf = await loadGLB(opt.url, opt.onProgress), car = gltf.scene.clone(true), pivot = new THREE.Group();
  orient(car, opt.fit);
  let box = new THREE.Box3().setFromObject(car), ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const targetLen = 4.2, scl = targetLen / Math.max(size.x, 0.01); car.scale.setScalar(scl);
  car.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(car); ctr = box.getCenter(new THREE.Vector3()); size = box.getSize(new THREE.Vector3());
  car.position.set(-ctr.x, -box.min.y, -ctr.z); pivot.add(car); scene.add(pivot);
  pivot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(car), hx = (bounds.max.x - bounds.min.x) / 2, hy = bounds.max.y, hz = (bounds.max.z - bounds.min.z) / 2;
  const contact = new THREE.Mesh(new THREE.PlaneGeometry((bounds.max.x - bounds.min.x) + 0.7, (bounds.max.z - bounds.min.z) + 0.9), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(0,0,0,.72)'], [0.6, 'rgba(0,0,0,.32)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.006; pivot.add(contact);

  // materiais: lista de peças e materiais de pintura (para trocar a cor)
  const meshes = [], wheels = [], paintMats = new Set();
  const paintRe = opt.paint ? new RegExp(opt.paint, 'i') : null; let bestArea = 0, bestMat = null;
  car.traverse((o) => { if (!o.isMesh) return; meshes.push(o); o.castShadow = true;
    if (WHEEL.test(o.name) || (o.parent && WHEEL.test(o.parent.name))) wheels.push(o);
    const m = o.material; if (!m) return;
    (Array.isArray(m) ? m : [m]).forEach((mat) => {
      if (/glass|window|vidro/i.test(mat.name)) { mat.transmission = 0; mat.transparent = true; mat.opacity = 0.78; mat.color && mat.color.setHex(0x0a0d12); mat.metalness = 0.2; mat.roughness = 0.04; mat.envMapIntensity = 1.6; mat.depthWrite = false; return; }
      if (paintRe && paintRe.test(mat.name)) { paintMats.add(mat); return; }
      if (!paintRe && !SKIP_PAINT.test(mat.name) && mat.color && !mat.transparent) {
        const b2 = new THREE.Box3().setFromObject(o), s2 = b2.getSize(new THREE.Vector3()), area = s2.x * s2.y + s2.y * s2.z + s2.x * s2.z;
        if (area > bestArea) { bestArea = area; bestMat = mat; }
      }
    });
  });
  if (!paintMats.size && bestMat) paintMats.add(bestMat);

  // eixos pela posição das rodas; se não achar, usa proporções padrão
  let axF = hx * 0.64, axR = -hx * 0.64, wy = Math.min(hy * 0.3, 0.42), wz = hz - 0.05;
  if (wheels.length >= 2) { const xs = [], ys = [];
    wheels.forEach((o) => { const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); pivot.worldToLocal(c); xs.push(c.x); ys.push(c.y); });
    const fx = xs.filter((x) => x > 0), rx = xs.filter((x) => x <= 0);
    if (fx.length) axF = fx.reduce((a, b) => a + b, 0) / fx.length; if (rx.length) axR = rx.reduce((a, b) => a + b, 0) / rx.length;
    wy = ys.reduce((a, b) => a + b, 0) / ys.length;
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z), ev = !!opt.ev;
  // âncoras dos marcadores no referencial local do carro (frente = +x, lado direito = +z)
  const A = {
    motor: { p: V(hx * 0.72, hy * 0.82, hz * 0.2), n: V(0.2, 1, 0.2) },
    bat: { p: V(hx * 0.78, hy * 0.78, -hz * 0.55), n: V(0.3, 0.9, -0.4) },
    freios: { p: V(axF, wy, wz), n: V(0, 0, 1) },
    pneus: { p: V(axR, wy * 0.7, wz), n: V(0, 0, 1) },
    susp: { p: V(axR, wy * 1.9, wz * 0.9), n: V(-0.2, 0.6, 1) },
    cabine: { p: V(hx * 0.1, hy * 0.92, 0), n: V(0.2, 1, 0.3) },
    revisao: { p: V(-hx * 0.2, hy + 0.02, 0), n: V(0, 1, 0) },
    tracao: { p: V(0, wy * 0.6, wz), n: V(0, -0.2, 1) },
  };

  // estado / interação
  let yaw = 0.72, zoom = 1, tgt = null, vy = 0, idle = 0, sel = null, raf = 0, last = 0, vis = true, host = null, pinEls = [], zones = [], w = 1, h = 1;
  let lvl = 0, fN = 0, fT = 0, fSkip = 0, lastDraw = 0, prevT = 0, dirty = true, baseDist = 6;
  const gl = R.getContext(), dri = gl.getExtension('WEBGL_debug_renderer_info'), soft = /SwiftShader|llvmpipe|softpipe|Software/i.test(dri ? gl.getParameter(dri.UNMASKED_RENDERER_WEBGL) : '');
  const setLvl = (n) => { if (n >= 1 && lvl < 1) { R.setPixelRatio(1); key.castShadow = false; R.shadowMap.needsUpdate = true; } lvl = n; api.resize(); };
  const reduce = () => !!(opt.reduceMotion && opt.reduceMotion());
  const cv = R.domElement; cv.style.touchAction = 'pan-y'; let drag = null, pinch = 0;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, id: e.pointerId }; vy = 0; tgt = null; idle = performance.now(); try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
  cv.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x; drag.x = e.clientX; yaw += dx * 0.0085; vy = dx * 0.0085; idle = performance.now(); });
  const up = (e) => { if (drag && e.pointerId === drag.id) drag = null; idle = performance.now(); }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const setZoom = (z) => { zoom = Math.max(0.65, Math.min(2.2, z)); dirty = true; api.resize(); };
  cv.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY > 0 ? 0.92 : 1.08)); idle = performance.now(); }, { passive: false });
  // pinça para zoom no celular
  const pts = new Map();
  cv.addEventListener('pointerdown', (e) => pts.set(e.pointerId, e));
  cv.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) setZoom(zoom * (d / pinch)); pinch = d; drag = null; } });
  const clr = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; }; cv.addEventListener('pointerup', clr); cv.addEventListener('pointercancel', clr);
  const io = new IntersectionObserver((es) => { vis = es[0].isIntersecting; });

  function fit2() { const a = w / h, t = Math.tan((cam.fov * Math.PI) / 360); baseDist = Math.max(2.5 / (t * a), 1.55 / t); const d = baseDist / zoom; cam.aspect = a; cam.position.set(0, d * 0.3, d); cam.lookAt(0, 0.42, 0); cam.updateProjectionMatrix(); }
  function glow(now) { const pulse = 0.55 + 0.45 * Math.sin(now / 380);
    overlays.forEach((o) => { const z = o.z, st = (zones.find((x) => x.id === z) || {}).st, on = sel === z, c = GLOW[st], col = on && !c ? 0xe2b250 : c;
      o.ov.visible = !!(c || on); if (o.ov.visible) { o.ov.material.color.setHex(col); const [b0, b1] = on ? [0.34, 0.16] : st === 'vencido' ? [0.16, 0.16] : [0.06, 0.12]; o.ov.material.opacity = b0 + b1 * pulse; } }); }
  const cp = V(0, 0, 0), wv = V(0, 0, 0), nv = V(0, 0, 0), Y = V(0, 1, 0);
  function pins() { if (!host) return; pinEls.forEach((el) => { const a = A[el.dataset.c3z]; if (!a) { el.style.display = 'none'; return; } wv.copy(a.p); pivot.localToWorld(wv); nv.copy(a.n).normalize().applyAxisAngle(Y, yaw);
      const facing = nv.dot(cp.copy(cam.position).sub(wv).normalize()); wv.project(cam); el.style.translate = `${(((wv.x + 1) / 2) * w).toFixed(1)}px ${(((1 - wv.y) / 2) * h).toFixed(1)}px`; el.classList.toggle('back', facing < -0.12); }); }
  function tick(now) { raf = requestAnimationFrame(tick); if (!vis || document.hidden || !host || !host.isConnected) return; const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (tgt != null) { let df = tgt - yaw; df = Math.atan2(Math.sin(df), Math.cos(df)); yaw += df * Math.min(1, dt * 5); if (Math.abs(df) < 0.002) tgt = null; }
    else if (Math.abs(vy) > 0.0004) { yaw += vy; vy *= 0.93; } else if (lvl < 2 && !reduce() && now - idle > 2800) yaw += dt * 0.14;
    const moving = drag || tgt != null || Math.abs(vy) > 0.0004;
    if (lvl === 2 && !moving && !dirty && now - lastDraw < 600) return;
    dirty = false; lastDraw = now; pivot.rotation.y = yaw; dash.rotation.z += dt * 0.07; glow(now);
    R.render(scene, cam); pins();
    if (lvl < 2 && !opt.hq) { const iv = prevT ? now - prevT : 0; prevT = now; if (iv > 400 && fSkip >= 1) setLvl(2); else if (fSkip < 2) fSkip++; else if (iv) { fT += iv; if (++fN >= 6) { const avg = fT / fN; fN = 0; fT = 0; if (avg > 110) setLvl(2); else if (avg > 45) setLvl(lvl + 1); } } } }

  // camadas de destaque: um clone translúcido do mesh que acende sobre a peça ao selecionar/alertar
  const overlays = [];
  const addOverlay = (zoneId, re) => { car.traverse((o) => { if (!o.isMesh || !re.test(o.name)) return; const ov = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); ov.renderOrder = 3; ov.visible = false; o.add(ov); overlays.push({ z: zoneId, ov }); }); };
  addOverlay('freios', /brake|disc|caliper|freio|rotor/i); addOverlay('pneus', WHEEL); addOverlay('motor', /hood|bonnet|capo|engine|motor/i);

  const api = {
    canvas: cv,
    attach(el) { host = el; el.querySelector('.c3-canvas').appendChild(cv); pinEls = [...el.querySelectorAll('.c3-pin')]; io.disconnect(); io.observe(el); api.resize(); },
    resize() { dirty = true; if (!host) return; w = host.clientWidth || 1; h = host.clientHeight || 1; R.setSize(w, h, false); cv.style.width = w + 'px'; cv.style.height = h + 'px'; fit2(); },
    setColor(k) { dirty = true; const p = PAINT[k] || PAINT.prata; paintMats.forEach((m) => { m.color.setHex(p[0]); if ('metalness' in m) m.metalness = p[1]; if ('roughness' in m) m.roughness = p[2]; }); },
    setZones(z) { zones = z || []; dirty = true; },
    select(id) { sel = id || null; dirty = true; const a = A[id]; if (!a) return; const n = a.n.clone().normalize(); tgt = Math.abs(n.x) < 0.5 && Math.abs(n.z) < 0.5 ? 0.72 : Math.atan2(-n.x, n.z); vy = 0; idle = performance.now() + 4000; },
    zoomBy(f) { setZoom(zoom * f); idle = performance.now(); },
    start() { if (!raf) raf = requestAnimationFrame(tick); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; },
    get yaw() { return yaw; }, set yaw(v) { yaw = v; tgt = null; vy = 0; idle = performance.now() + 1e9; },
    get quality() { return lvl; }, anchors: A, camera: cam, pivot, soft,
  };
  if (soft && !opt.hq) setLvl(2);
  return api;
}
