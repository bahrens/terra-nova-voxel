// Day/night cycle: a moving sun & moon, a sky/fog colour that shifts through
// the day, world brightness that dims at night, and stars that fade in.
// The world uses unlit materials, so "lighting" is done by scaling each
// material's colour by a time-of-day brightness factor.
import * as THREE from "three";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Sky colour keyframes across the day (t in [0,1): 0 = midnight, 0.5 = noon).
const SKY_KEYS = [
  [0.00, 0x05070f], // midnight
  [0.21, 0x0a0e1c], // pre-dawn
  [0.25, 0xe8825a], // sunrise
  [0.30, 0x8ec5ec], // morning
  [0.50, 0x9ad0f0], // noon
  [0.70, 0x8ec5ec], // afternoon
  [0.75, 0xef7d4e], // sunset
  [0.79, 0x2a2a4a], // dusk
  [0.83, 0x05070f], // night
  [1.00, 0x05070f],
];

function sampleKeys(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, c0] = keys[i], [t1, c1] = keys[i + 1];
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1);
      return new THREE.Color(c0).lerp(new THREE.Color(c1), k);
    }
  }
  return new THREE.Color(keys[keys.length - 1][1]);
}

const DISC = 16; // low-res so sun/moon scale up chunky like the rest of the game

// Build a nearest-filtered (pixelated) texture from a per-pixel painter.
function pixelTexture(paint) {
  const c = document.createElement("canvas");
  c.width = c.height = DISC;
  const ctx = c.getContext("2d");
  paint(ctx, DISC);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const px = (ctx, x, y, r, g, b, a) => {
  ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
  ctx.fillRect(x, y, 1, 1);
};

// Pixel-art sun: bright core, warm mid, faint outer (glows under additive blend).
function drawSun(ctx, s) {
  const R = s / 2, cx = R - 0.5, cy = R - 0.5;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - cx, y - cy) / R;
      if (d > 1) continue;
      if (d < 0.5) px(ctx, x, y, 255, 248, 214, 1);
      else if (d < 0.78) px(ctx, x, y, 255, 211, 84, 1);
      else px(ctx, x, y, 255, 178, 54, 0.55);
    }
  }
}

// Pixel-art moon with a phase shadow (lit part kept, unlit carved transparent).
// phase 0..7: 0 full, 4 new, 1-3 waning, 5-7 waxing.
function drawMoon(ctx, s, phase) {
  const R = s / 2, cx = R - 0.5, cy = R - 0.5;
  const illum = 1 - Math.abs(phase - 4) / 4;     // 0 (new) .. 1 (full)
  const off = 2 * R * illum;
  const ex = cx + (phase > 4 ? -1 : 1) * off;    // eraser centre
  const craters = [[-3, -2], [2, 3], [4, -3]];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (Math.hypot(x - cx, y - cy) > R) continue;       // outside disc
      if (Math.hypot(x - ex, y - cy) <= R) continue;      // in shadow -> transparent
      let r = 224, g = 230, b = 246;
      if (Math.hypot(x - cx, y - cy) < R * 0.45) { r = 242; g = 245; b = 255; }
      for (const [dx, dy] of craters) {
        if (Math.abs(x - cx - dx) < 1 && Math.abs(y - cy - dy) < 1) { r = 184; g = 192; b = 214; }
      }
      px(ctx, x, y, r, g, b, 1);
    }
  }
}

export class Sky {
  constructor(scene, materials, { dayLength = 300, startT = 0.32 } = {}) {
    this.scene = scene;
    this.materials = materials;
    this.dayLength = dayLength;   // seconds for a full day+night
    this.t = startT;
    this.skyColor = new THREE.Color(0x9ad0f0);
    this.brightness = 1;
    this.radius = 160;            // distance of sun/moon/stars from the camera

    const make = (tex, scale, blending) => {
      const m = new THREE.SpriteMaterial({ map: tex, fog: false,
        transparent: true, depthWrite: false, blending });
      const s = new THREE.Sprite(m);
      s.scale.set(scale, scale, 1);
      scene.add(s);
      return s;
    };
    // Pixel-art sun glows (additive); moon is a solid pixel disc that cycles
    // through 8 phases over successive nights.
    this.sun = make(pixelTexture(drawSun), 30, THREE.AdditiveBlending);
    this.moonTextures = Array.from({ length: 8 }, (_, p) =>
      pixelTexture((ctx, s) => drawMoon(ctx, s, p)));
    this.moon = make(this.moonTextures[0], 18, THREE.NormalBlending);
    this.day = 0;
    this._moonPhase = 0;

    this.stars = this.makeStars();
    scene.add(this.stars);
  }

  makeStars() {
    const N = 1100;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // uniform random point on a full sphere (so they rise/set when rotated)
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * r * this.radius;
      pos[i * 3 + 1] = u * this.radius;
      pos[i * 3 + 2] = Math.sin(a) * r * this.radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2.0, sizeAttenuation: false,
      fog: false, transparent: true, opacity: 0, depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  // Sun direction for the current time: rises in the east, peaks at noon.
  sunDirection() {
    const theta = (this.t - 0.25) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0.35).normalize();
  }

  update(dt, camera) {
    if (Number.isNaN(this.dayLength) || !Number.isFinite(this.dayLength)) return;
    const prev = this.t;
    this.t = (this.t + dt / this.dayLength) % 1;
    if (this.t < prev) this.day++; // crossed midnight -> next day

    const phase = this.day % 8;
    if (phase !== this._moonPhase) {
      this._moonPhase = phase;
      this.moon.material.map = this.moonTextures[phase];
      this.moon.material.needsUpdate = true;
    }

    const sunDir = this.sunDirection();
    const sunElev = sunDir.y;
    this.skyColor = sampleKeys(SKY_KEYS, this.t);

    // World brightness: dim at night, full in day, smooth at dawn/dusk.
    this.brightness = 0.26 + 0.74 * smoothstep(-0.05, 0.30, sunElev);
    const b = this.brightness;
    this.materials.opaque.color.setScalar(b);
    this.materials.foliage.color.setScalar(b);
    this.materials.water.color.setScalar(0.4 + 0.6 * b); // water keeps a little colour at night

    // Position sun / moon on the sky dome around the camera.
    const cam = camera.position;
    this.sun.position.copy(cam).addScaledVector(sunDir, this.radius);
    this.sun.visible = sunDir.y > -0.25;
    const moonDir = sunDir.clone().multiplyScalar(-1);
    this.moon.position.copy(cam).addScaledVector(moonDir, this.radius);
    this.moon.visible = moonDir.y > -0.25;

    // Stars fade in after dusk; the field follows the camera and turns on the
    // same axis as the sun/moon arc (about Z) so everything moves together.
    const night = 1 - smoothstep(-0.05, 0.18, sunElev);
    this.stars.material.opacity = night;
    this.stars.visible = night > 0.01;
    this.stars.position.copy(cam);
    this.stars.rotation.z = (this.t - 0.25) * Math.PI * 2;
  }
}
