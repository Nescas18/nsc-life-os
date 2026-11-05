// Visualizador realista do carro (aba Manutenção do NESC).
// Carregado sob demanda só nessa aba; usa o three.js r170 servido pelo próprio site (o globo do Início segue no r128).
// Modelo: models/carro-v1.glb (Car Concept · Khronos · CC BY 4.0 — ver models/LICENSE.md).
import * as THREE from './vendor/three/three.module.min.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';

export const MODEL_URL = '/models/carro-v1.glb';
// cor, metalicidade e rugosidade de cada pintura (sólidas pouco metálicas; metálicas com mais brilho)
const PAINT = { branco: [0xf0f0ec, 0.18, 0.3], prata: [0xb6bac1, 0.9, 0.3], cinza: [0x484c53, 0.85, 0.3], preto: [0x0b0c0f, 0.6, 0.22],
  vermelho: [0x8a0c12, 0.85, 0.26], azul: [0x15357a, 0.85, 0.27], bege: [0xc5b18d, 0.5, 0.32], verde: [0x22483a, 0.8, 0.28] };
const GLOW = { vencido: 0xff3b2f, conferir: 0xffa12a, proximo: 0xffa12a };
// peças do modelo que acendem para cada grupo de manutenção
const PARTS = { motor: [/^BodyHood(Topgrill)?$/], freios: [/^Wheel(Front|Rear)[LR]Brake(Disc|Pad)$/], pneus: [/^Wheel(Front|Rear)[LR]$/], cabine: [/^InteriorDash(Mid|Sides)$/] };

let modelP = null;
const loadModel = (onProgress) => modelP || (modelP = new Promise((ok, err) => new GLTFLoader().load(MODEL_URL, ok,
  (e) => { if (onProgress && e.lengthComputable && e.total) onProgress(e.loaded / e.total); }, (e) => { modelP = null; err(e); })));

const radialTex = (stops) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => g.addColorStop(o, col)); x.fillStyle = g; x.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };

export async function createCarViewer(opt = {}) {
  const low = !!opt.lowPower, R = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  R.setPixelRatio(Math.min(devicePixelRatio || 1, low ? 1.5 : 2)); R.setClearColor(0x000000, 0);
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), pm = new THREE.PMREMGenerator(R);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.035).texture; scene.environmentIntensity = 0.85; pm.dispose();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xfff3df, 0x0d0b08, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2.5, 6.5, 3.5); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 1, far: 16 }); key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc36e, 1.3); rim.position.set(-5, 2.6, -4.5); scene.add(rim);
  const front = new THREE.DirectionalLight(0xdfe8ff, 0.55); front.position.set(0, 1.5, 7); scene.add(front);

  // plataforma: piso com brilho dourado, sombra real e anéis (um tracejado girando devagar)
  const stage = new THREE.Group(); scene.add(stage);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 96), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(84,66,34,.6)'], [0.55, 'rgba(38,30,16,.38)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; stage.add(floor);
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.55 })); shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0.002; shadowPlane.receiveShadow = true; stage.add(shadowPlane);
  const ring = (a, b, o, c) => { const m = new THREE.Mesh(new THREE.RingGeometry(a, b, 160), new THREE.MeshBasicMaterial({ color: c || 0xe2b250, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = 0.004; stage.add(m); return m; };
  ring(3.0, 3.045, 0.9); ring(3.26, 3.275, 0.32); ring(2.62, 2.632, 0.22, 0xfff0c8);
  const dash = new THREE.Group(); for (let i = 0; i < 56; i++) dash.add(new THREE.Mesh(new THREE.RingGeometry(3.11, 3.17, 6, 1, (i / 56) * Math.PI * 2, ((Math.PI * 2) / 56) * 0.55), new THREE.MeshBasicMaterial({ color: 0xf6dc9a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })));
  dash.rotation.x = -Math.PI / 2; dash.position.y = 0.005; stage.add(dash);

  // carro: centralizado, apoiado no chão; pintura principal ("Paint 1") recebe a cor do motorista
  const gltf = await loadModel(opt.onProgress), car = gltf.scene, pivot = new THREE.Group();
  const box = new THREE.Box3().setFromObject(car), ctr = box.getCenter(new THREE.Vector3());
  car.position.set(-ctr.x, -box.min.y, -ctr.z); pivot.add(car); scene.add(pivot);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(box.max.x - box.min.x + 0.7, box.max.z - box.min.z + 0.9), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(0,0,0,.75)'], [0.6, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.006; pivot.add(contact);
  const meshes = [], paints = new Set();
  car.traverse((o) => { if (!o.isMesh) return; meshes.push(o); o.castShadow = true;
    const m = o.material; if (m && /^Paint 1/.test(m.name)) paints.add(m);
    if (m && m.name === 'Glass') { // vidro com película: escuro e reflexivo, deixa entrever o interior (e é leve no celular)
      m.transmission = 0; m.transparent = true; m.opacity = 0.74; m.color.setHex(0x0a0d12); m.metalness = 0.15; m.roughness = 0.03; m.envMapIntensity = 1.7; m.depthWrite = false; } });
  // peças destacáveis: material próprio para poder acender sem afetar o resto
  const zoneMeshes = {};
  Object.entries(PARTS).forEach(([z, pats]) => { const list = (zoneMeshes[z] = []);
    car.traverse((o) => { if (!pats.some((re) => re.test(o.name))) return; o.traverse((m) => { if (!m.isMesh || m.userData.nesc || m.userData.isOv) return; m.material = m.material.clone(); m.userData.nesc = { e: m.material.emissive.clone(), ei: m.material.emissiveIntensity };
      if (/^Paint 1/.test(m.material.name)) paints.add(m.material);
      if (!/Brake|Disc/.test(m.material.name)) { const ov = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); ov.renderOrder = 2; ov.visible = false; ov.userData.isOv = true; ov.castShadow = false; m.add(ov); m.userData.ov = ov; }
      list.push(m); }); }); });

  // âncoras dos marcadores: pontos da superfície real do carro (raycast), com a normal para saber se estão de costas
  scene.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  const hit = (from, dir) => { rc.set(from, dir.normalize()); const h = rc.intersectObjects(meshes, false)[0]; return h ? pivot.worldToLocal(h.point.clone()) : null; };
  const bb = (n) => { const o = car.getObjectByName(n); return o ? new THREE.Box3().setFromObject(o) : null; };
  const hood = bb('BodyHood'), wFR = bb('WheelFrontR'), wRR = bb('WheelRearR'), ws = bb('BodyWindshield'), roof = bb('BodyRoofPanel'), all = new THREE.Box3().setFromObject(car);
  const cz = (b) => (b.min.z + b.max.z) / 2, cy = (b) => (b.min.y + b.max.y) / 2;
  const A = {
    motor: { p: hood && hit(V(0, 4, cz(hood) + 0.05), V(0, -1, 0)), n: V(0, 1, 0.3) },
    bat: { p: hood && hit(V(hood.max.x * 0.45, 4, hood.max.z - 0.42), V(0, -1, 0)), n: V(0.2, 1, 0.2) },
    freios: { p: wFR && hit(V(-4, cy(wFR), cz(wFR)), V(1, 0, 0)), n: V(-1, 0, 0) },
    pneus: { p: wRR && hit(V(-4, wRR.min.y + (wRR.max.y - wRR.min.y) * 0.2, cz(wRR)), V(1, 0, 0)), n: V(-1, 0, 0) },
    susp: { p: wRR && hit(V(-4, wRR.max.y + 0.01, cz(wRR) + 0.05), V(1, 0, 0)), n: V(-1, 0.35, 0) },
    cabine: { p: ws && hit(V(0, 4, cz(ws) + 0.12), V(0, -1, 0)), n: V(0, 1, 0.7) },
    revisao: { p: roof && hit(V(0, 4, cz(roof)), V(0, -1, 0)), n: V(0, 1, 0) },
    tracao: { p: hit(V(-4, 0.24, (all.min.z + all.max.z) / 2), V(1, 0, 0)), n: V(-1, 0, 0) },
  };
  Object.values(A).forEach((a) => { if (!a.p) a.p = V(0, 0.8, 0); a.p.addScaledVector(a.n.clone().normalize(), 0.015); });

  // estado / interação
  let yaw = 0.72, tgt = null, vy = 0, idle = 0, sel = null, raf = 0, last = 0, vis = true, host = null, pinEls = [], zones = [], w = 1, h = 1;
  // qualidade adaptativa: aparelho lento → menos resolução e sem sombra; muito lento → só desenha quando o carro se move
  let lvl = 0, fN = 0, fT = 0, fSkip = 0, lastDraw = 0, prevT = 0, dirty = true;
  const gl = R.getContext(), dri = gl.getExtension('WEBGL_debug_renderer_info'), soft = /SwiftShader|llvmpipe|softpipe|Software/i.test(dri ? gl.getParameter(dri.UNMASKED_RENDERER_WEBGL) : '');
  const setLvl = (n) => { if (n >= 1 && lvl < 1) { R.setPixelRatio(1); key.castShadow = false; R.shadowMap.needsUpdate = true; lvl = n; api.resize(); } lvl = n; };
  const reduce = () => !!(opt.reduceMotion && opt.reduceMotion());
  const cv = R.domElement; cv.style.touchAction = 'pan-y'; let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX }; vy = 0; tgt = null; idle = performance.now(); try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; drag.x = e.clientX; yaw += dx * 0.0085; vy = dx * 0.0085; idle = performance.now(); });
  const up = () => { drag = null; idle = performance.now(); }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const io = new IntersectionObserver((es) => { vis = es[0].isIntersecting; });

  function fit() { const a = w / h, t = Math.tan((cam.fov * Math.PI) / 360), d = Math.max(2.55 / (t * a), 1.55 / t); cam.aspect = a; cam.position.set(0, d * 0.3, d); cam.lookAt(0, 0.42, 0); cam.updateProjectionMatrix(); }
  function glow(now) { const pulse = 0.55 + 0.45 * Math.sin(now / 380);
    Object.entries(zoneMeshes).forEach(([z, list]) => { const st = (zones.find((x) => x.id === z) || {}).st, on = sel === z, c = GLOW[st];
      list.forEach((m) => { const u = m.userData.nesc, ov = u && m.userData.ov, col = on && !c ? 0xe2b250 : c;
        if (ov) { ov.visible = !!(c || on); if (ov.visible) { ov.material.color.setHex(col); const [b0, b1] = on ? [0.34, 0.16] : st === 'vencido' ? [0.16, 0.16] : [0.06, 0.12]; ov.material.opacity = b0 + b1 * pulse; } }
        else if (c || on) { m.material.emissive.setHex(col); m.material.emissiveIntensity = (on ? 1.6 : 0.9) * (0.4 + 0.6 * pulse); }
        else { m.material.emissive.copy(u.e); m.material.emissiveIntensity = u.ei; } }); }); }
  const cp = V(0, 0, 0), wv = V(0, 0, 0), nv = V(0, 0, 0), Y = V(0, 1, 0);
  function pins() { if (!host) return; pinEls.forEach((el) => { const a = A[el.dataset.c3z]; if (!a) return; wv.copy(a.p); pivot.localToWorld(wv); nv.copy(a.n).normalize().applyAxisAngle(Y, yaw);
      const facing = nv.dot(cp.copy(cam.position).sub(wv).normalize()); wv.project(cam); el.style.translate = `${(((wv.x + 1) / 2) * w).toFixed(1)}px ${(((1 - wv.y) / 2) * h).toFixed(1)}px`; el.classList.toggle('back', facing < -0.12); }); }
  function tick(now) { raf = requestAnimationFrame(tick); if (!vis || document.hidden || !host || !host.isConnected) return; const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (tgt != null) { let df = tgt - yaw; df = Math.atan2(Math.sin(df), Math.cos(df)); yaw += df * Math.min(1, dt * 5); if (Math.abs(df) < 0.002) tgt = null; }
    else if (Math.abs(vy) > 0.0004) { yaw += vy; vy *= 0.93; } else if (lvl < 2 && !reduce() && now - idle > 2800) yaw += dt * 0.14;
    const moving = drag || tgt != null || Math.abs(vy) > 0.0004;
    if (lvl === 2 && !moving && !dirty && now - lastDraw < 600) return; // modo econômico: o brilho pulsa devagar e o carro só gira com o dedo
    dirty = false; lastDraw = now; pivot.rotation.y = yaw; dash.rotation.z += dt * 0.07; glow(now);
    R.render(scene, cam); pins();
    // mede o intervalo real entre quadros desenhados (inclui o trabalho da GPU/compositor)
    if (lvl < 2 && !opt.hq) { const iv = prevT ? now - prevT : 0; prevT = now; if (iv > 400 && fSkip >= 1) setLvl(2); else if (fSkip < 2) fSkip++; else if (iv) { fT += iv; if (++fN >= 6) { const avg = fT / fN; fN = 0; fT = 0; if (avg > 110) setLvl(2); else if (avg > 45) setLvl(lvl + 1); } } } }

  const api = {
    canvas: cv,
    attach(el) { host = el; el.querySelector('.c3-canvas').appendChild(cv); pinEls = [...el.querySelectorAll('.c3-pin')]; io.disconnect(); io.observe(el); api.resize(); },
    resize() { dirty = true; if (!host) return; w = host.clientWidth || 1; h = host.clientHeight || 1; R.setSize(w, h, false); cv.style.width = w + 'px'; cv.style.height = h + 'px'; fit(); },
    setColor(k) { dirty = true; const p = PAINT[k] || PAINT.prata; paints.forEach((m) => { m.color.setHex(p[0]); m.metalness = p[1]; m.roughness = p[2]; }); },
    setZones(z) { zones = z || []; },
    select(id) { sel = id || null; dirty = true; const a = A[id]; if (!a) return; const n = a.n.clone().normalize(); tgt = Math.abs(n.x) < 0.5 && Math.abs(n.z) < 0.5 ? 0.72 : Math.atan2(-n.x, n.z); vy = 0; idle = performance.now() + 4000; },
    start() { if (!raf) raf = requestAnimationFrame(tick); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; },
    get yaw() { return yaw; }, set yaw(v) { yaw = v; tgt = null; vy = 0; idle = performance.now() + 1e9; },
    get quality() { return lvl; }, anchors: A, camera: cam, pivot, soft,
  };
  if (soft && !opt.hq) setLvl(2);
  return api;
}
