"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { prefersReducedMotion } from "@/lib/motion";

// Builds the animated 3D container yard into `host`. Returns a cleanup, or null if WebGL is unavailable.
function buildYard(host: HTMLDivElement): (() => void) | null {
  const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9fb0c8, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(26, 46, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const mat = (c: THREE.Color | string | number, o: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0.05 }, o));

  function corrugated(hex: string, label?: string | null) {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 256;
    const g = cv.getContext("2d")!;
    g.fillStyle = hex;
    g.fillRect(0, 0, 512, 256);
    for (let x = 0; x < 512; x += 12) {
      g.fillStyle = "rgba(0,0,0,.10)";
      g.fillRect(x, 0, 4, 256);
      g.fillStyle = "rgba(255,255,255,.10)";
      g.fillRect(x + 5, 0, 2, 256);
    }
    g.fillStyle = "rgba(0,0,0,.18)";
    g.fillRect(0, 0, 512, 10);
    g.fillRect(0, 246, 512, 10);
    g.fillRect(0, 0, 10, 256);
    g.fillRect(502, 0, 10, 256);
    if (label) {
      const light = hex.toLowerCase() === "#e6ecf4";
      g.font = "800 70px Geist, Arial, sans-serif";
      g.fillStyle = light ? "#0B6E77" : "rgba(255,255,255,.95)";
      g.textBaseline = "middle";
      g.fillText(label, 40, 124);
      g.fillStyle = "#EE6A1F";
      g.fillRect(40, 168, 130, 12);
    }
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  const texCache: Record<string, THREE.Material[]> = {};
  function boxMats(hex: string, label?: string | null) {
    const k = hex + (label || "");
    if (!texCache[k]) {
      const tex = corrugated(hex, label);
      const side = mat(0xffffff, { map: tex });
      texCache[k] = [side, side, mat(hex, { roughness: 0.6 }), mat(hex), side, side];
    }
    return texCache[k];
  }
  const CW = 6, CH = 2.6, CD = 2.4, boxG = new THREE.BoxGeometry(CW, CH, CD);
  function container(hex: string, x: number, y: number, z: number, label?: string | null) {
    const m = new THREE.Mesh(boxG, boxMats(hex, label));
    m.position.set(x, y + CH / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), mat(0xdce4ef, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(40, 26), mat(0xe9eef5, { roughness: 1 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(-12, 0.01, -3);
  pad.receiveShadow = true;
  scene.add(pad);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(260, 9), mat(0xb9c5d6, { roughness: 1 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 14);
  road.receiveShadow = true;
  scene.add(road);
  const markM = mat(0xffffff, { roughness: 1 });
  for (let i = -26; i < 26; i++) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.35), markM);
    d.rotation.x = -Math.PI / 2;
    d.position.set(i * 5, 0.03, 14);
    scene.add(d);
  }

  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const palette = ["#0B6E77", "#0F2A44", "#EE6A1F", "#E6ECF4", "#1C9C93", "#0B6E77", "#C8452F", "#0B6E77", "#E6ECF4", "#0F2A44"];
  const rows = [-11, -8, -5, -2, 1, 4], cols = [-28, -21.5, -15, -8.5, -2];
  rows.forEach((z, ri) =>
    cols.forEach((x, ci) => {
      if (ci === 2 && (ri === 2 || ri === 3)) return; // crane lane
      const h = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < h; k++) {
        const col = palette[Math.floor(rnd() * palette.length)];
        container(col, x, k * CH, z, ri === 5 && k === 0 && ci === 3 ? "HALCYON" : null);
      }
    }),
  );

  const craneM = mat(0xf2a62b, { roughness: 0.5 });
  const legG = new THREE.BoxGeometry(0.7, 14, 0.7);
  [[-31, -13], [-31, 7], [1, -13], [1, 7]].forEach(([x, z]) => {
    const l = new THREE.Mesh(legG, craneM);
    l.position.set(x, 7, z);
    l.castShadow = true;
    scene.add(l);
  });
  const beamG = new THREE.BoxGeometry(32.7, 0.9, 0.9);
  const b1 = new THREE.Mesh(beamG, craneM);
  b1.position.set(-15, 14, -13);
  b1.castShadow = true;
  scene.add(b1);
  const b2 = new THREE.Mesh(beamG, craneM);
  b2.position.set(-15, 14, 7);
  b2.castShadow = true;
  scene.add(b2);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 21), craneM);
  bridge.position.set(-15, 14.4, -3);
  bridge.castShadow = true;
  scene.add(bridge);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.2), mat(0x0f2a44));
  trolley.castShadow = true;
  scene.add(trolley);
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), mat(0x333a44));
  scene.add(cable);
  const hung = container("#EE6A1F", -15, 0, -3);

  const wh = new THREE.Group();
  wh.position.set(20, 0, -3);
  scene.add(wh);
  const wallM = mat(0xf4f7fb, { roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 18), wallM);
  body.position.y = 3.5;
  body.castShadow = true;
  body.receiveShadow = true;
  wh.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(16.6, 0.6, 18.6), mat(0x9fb0c8));
  roof.position.y = 7.3;
  roof.castShadow = true;
  wh.add(roof);
  for (let i = 0; i < 3; i++) {
    [-3, 3].forEach((z) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 1.6), mat(0x5fd0d7, { roughness: 0.3 }));
      s.position.set(-4 + i * 4, 7.7, z);
      wh.add(s);
    });
  }
  const doorM = mat(0x2b3a52, { roughness: 0.6 }), slatM = mat(0x415575);
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4, 0.2), doorM);
    d.position.set(-5 + i * 5, 2, 9.05);
    wh.add(d);
    for (let s = 0; s < 6; s++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.22), slatM);
      sl.position.set(-5 + i * 5, 0.5 + s * 0.62, 9.08);
      wh.add(sl);
    }
  }
  const sign = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 0.2), mat(0x0b6e77, { roughness: 0.4 }));
  sign.position.set(0, 6, 9.12);
  wh.add(sign);
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1 + rnd() * 0.8, 1.4), mat(0xc79a5b, { roughness: 0.9 }));
    p.position.set(14 + i * 1.8, 0.6, 8.2 + (i % 2) * 1.6);
    p.castShadow = true;
    scene.add(p);
  }

  function truck(trailerHex: string, cabHex: THREE.Color | string | number, label: string | null) {
    const g = new THREE.Group();
    const trailer = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 2.6), boxMats(trailerHex, label));
    trailer.position.set(-1.6, 2.3, 0);
    g.add(trailer);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(11, 0.5, 2.2), mat(0x2a3140));
    chassis.position.set(0, 0.85, 0);
    g.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 2.5), mat(cabHex, { roughness: 0.45 }));
    cab.position.set(4.2, 2.2, 0);
    g.add(cab);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 2.1), mat(0x223047, { roughness: 0.2, metalness: 0.3 }));
    glass.position.set(5.52, 2.8, 0);
    g.add(glass);
    const wg = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 18), wm = mat(0x1b1f27, { roughness: 0.9 });
    [[-4.4, 1.2], [-3.2, 1.2], [2.2, 1.2], [4.4, 1.2], [-4.4, -1.2], [-3.2, -1.2], [2.2, -1.2], [4.4, -1.2]].forEach(([x, z]) => {
      const w = new THREE.Mesh(wg, wm);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.55, z);
      g.add(w);
    });
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    scene.add(g);
    return g;
  }
  const t1 = truck("#E6ECF4", "#0B6E77", "HALCYON");
  t1.position.set(-30, 0, 12.2);
  const t2 = truck("#EE6A1F", "#0F2A44", null);
  t2.position.set(26, 0, 15.8);
  t2.rotation.y = Math.PI;

  function applyTheme() {
    const col = (s: string) => new THREE.Color(css(s) || "#ffffff");
    ground.material.color = col("--g-ground");
    road.material.color = col("--g-road");
    markM.color = col("--g-mark");
    pad.material.color = col("--g-ground").lerp(new THREE.Color("#ffffff"), 0.22);
    wallM.color = col("--g-wall");
    const th = document.documentElement.dataset.theme;
    const dark = th === "dark" || (th !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    hemi.intensity = dark ? 0.6 : 0.95;
    sun.intensity = dark ? 0.7 : 0.9;
  }
  applyTheme();

  const target = new THREE.Vector3(-4, 2, 1);
  let angle = Math.PI / 4;
  function size() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const view = w < 560 ? 66 : 54, a = w / h;
    cam.left = (-view * a) / 2;
    cam.right = (view * a) / 2;
    cam.top = view / 2;
    cam.bottom = -view / 2;
    cam.updateProjectionMatrix();
  }
  function draw() {
    cam.position.set(target.x + Math.cos(angle) * 70, 48, target.z + Math.sin(angle) * 70);
    cam.lookAt(target);
    renderer.render(scene, cam);
  }
  // crane state
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  function crane(t: number) {
    const cyc = (t % 12) / 12;
    let x, lift;
    if (cyc < 0.2) { x = -27; lift = ease(cyc / 0.2); }
    else if (cyc < 0.5) { x = -27 + ease((cyc - 0.2) / 0.3) * 24; lift = 1; }
    else if (cyc < 0.7) { x = -3; lift = 1 - ease((cyc - 0.5) / 0.2); }
    else { x = -3 - ease((cyc - 0.7) / 0.3) * 24; lift = 0; }
    const y = 3 * CH + 0.4 + lift * 1.6; // clears the tallest stacks (3 high)
    trolley.position.set(x, 13.4, -3);
    hung.position.set(x, y + CH / 2, -3);
    const top = 12.8, bot = y + CH;
    cable.scale.y = Math.max(0.1, top - bot);
    cable.position.set(x, (top + bot) / 2, -3);
  }
  crane(2.5);

  const onTheme = () => { applyTheme(); draw(); };
  const darkMq = matchMedia("(prefers-color-scheme: dark)");
  darkMq.addEventListener("change", onTheme);
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const ro = new ResizeObserver(() => { size(); draw(); });
  ro.observe(host);
  size();
  draw();

  let raf = 0;
  let io: IntersectionObserver | null = null;
  if (!prefersReducedMotion()) {
    let visible = true, last = performance.now(), time = 2.5;
    const loop = (now: number) => {
      if (!visible) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      angle = Math.PI / 4 + Math.sin(time * 0.08) * 0.3;
      t1.position.x += dt * 7.5;
      if (t1.position.x > 50) t1.position.x = -50;
      t2.position.x -= dt * 6;
      if (t2.position.x < -50) t2.position.x = 50;
      crane(time);
      draw();
      raf = requestAnimationFrame(loop);
    };
    io = new IntersectionObserver((es) => {
      const v = es[0].isIntersecting;
      if (v && !visible) {
        last = performance.now();
        visible = true;
        raf = requestAnimationFrame(loop);
      }
      visible = v;
    });
    io.observe(host);
    raf = requestAnimationFrame(loop);
  }

  return () => {
    cancelAnimationFrame(raf);
    io?.disconnect();
    ro.disconnect();
    mo.disconnect();
    darkMq.removeEventListener("change", onTheme);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => {
        (x as THREE.MeshStandardMaterial).map?.dispose();
        x.dispose();
      });
    });
    renderer.dispose();
    renderer.domElement.remove();
  };
}

export default function Yard() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [no3d, setNo3d] = useState(false);

  useEffect(() => {
    const cleanup = buildYard(hostRef.current!);
    if (!cleanup) setNo3d(true);
    return cleanup ?? undefined;
  }, []);

  return (
    <div
      className={"yard" + (no3d ? " no3d" : "")}
      ref={hostRef}
      role="img"
      aria-label="Animated 3D container yard with trucks, a gantry crane and a warehouse"
    >
      <div className="float f1">
        <div className="t">Review queue · today</div>
        <div className="row"><span className="mono">PO-857347</span><span className="pill hold">ZIP missing</span></div>
        <div className="row"><span className="mono">ORD-S00289</span><span className="pill warn">After 08:00</span></div>
        <div className="row"><span className="mono">ORD-S00509</span><span className="pill info">Stock at W4</span></div>
      </div>
      <div className="float f3"><span className="pill ok">Carrier B chosen · F excluded SE</span></div>
      <div className="float f2">
        <div className="t">On-time, modelled</div>
        <div className="big">93.1%<span>from 71.0%</span></div>
        <div className="mini-bar"><i></i><i className="base"></i></div>
      </div>
    </div>
  );
}
