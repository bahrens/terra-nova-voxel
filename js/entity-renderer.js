// EntityRenderer (client): gives each sim entity a Three.js mesh and keeps it in
// sync with the entity's state each frame. Owns the item/critter geometries and
// materials. Creates a mesh the first time it sees an entity, disposes it when the
// entity leaves the sim's list, and applies render-only touches (item bob/spin,
// mob leg-swing, light tinting). The Entity sim has none of this.
import * as THREE from "three";
import { ITEMS, isBlockItem } from "./items.js";

// Geometry per item: a small cube for block items, a flat card for materials, with
// the item's tile mapped onto every face. Cached and shared across drops.
const itemGeoCache = new Map();
function itemGeometry(atlas, itemId) {
  let g = itemGeoCache.get(itemId);
  if (g) return g;
  const [u0, v0, u1, v1] = atlas.uv(ITEMS[itemId].tile);
  g = isBlockItem(itemId) ? new THREE.BoxGeometry(0.3, 0.3, 0.3)
                          : new THREE.BoxGeometry(0.32, 0.32, 0.04); // flat card
  const uv = g.attributes.uv; // every face uses unit-square uvs -> remap to the tile
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  itemGeoCache.set(itemId, g);
  return g;
}

// A blocky quadruped "critter": body, head, snout, ears, tail, and four swinging
// legs. Geometries are shared; materials are per-mob so each can be tinted by the
// light where it stands.
let critterGeo = null;
function critterGeometry() {
  if (critterGeo) return critterGeo;
  const leg = new THREE.BoxGeometry(0.16, 0.4, 0.16);
  leg.translate(0, -0.2, 0); // origin at the hip so legs swing from the top
  critterGeo = {
    body: new THREE.BoxGeometry(0.5, 0.5, 0.95),
    head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
    snout: new THREE.BoxGeometry(0.22, 0.18, 0.12),
    ear: new THREE.BoxGeometry(0.1, 0.14, 0.06),
    tail: new THREE.BoxGeometry(0.1, 0.1, 0.22),
    leg,
  };
  return critterGeo;
}
const CRITTER_BODY = 0xb6906a, CRITTER_HEAD = 0xc8a578, CRITTER_DARK = 0x6e5a3c;
function buildCritter() {
  const G = critterGeometry();
  const bodyMat = new THREE.MeshBasicMaterial({ color: CRITTER_BODY });
  const headMat = new THREE.MeshBasicMaterial({ color: CRITTER_HEAD });
  const darkMat = new THREE.MeshBasicMaterial({ color: CRITTER_DARK });
  const group = new THREE.Group();
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };
  add(G.body, bodyMat, 0, 0.6, 0);
  add(G.head, headMat, 0, 0.66, -0.58);
  add(G.snout, darkMat, 0, 0.6, -0.83);
  add(G.ear, headMat, -0.12, 0.9, -0.52);
  add(G.ear, headMat, 0.12, 0.9, -0.52);
  add(G.tail, bodyMat, 0, 0.62, 0.56);
  const legs = [];
  for (const [x, z] of [[-0.16, -0.32], [0.16, -0.32], [-0.16, 0.32], [0.16, 0.32]]) {
    legs.push(add(G.leg, darkMat, x, 0.4, z));
  }
  return { group, legs, mats: [[bodyMat, CRITTER_BODY], [headMat, CRITTER_HEAD], [darkMat, CRITTER_DARK]] };
}

export class EntityRenderer {
  constructor(scene, world, atlas) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.rendered = new Map(); // entity -> { mesh, legs?, mats?, walk? }
    this.time = 0;
    // Unlit cutout material so plant/leaf tiles keep their transparency.
    this.itemMaterial = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.3 });
  }

  // Reconcile meshes with the sim's entity list, then sync each entity's transform.
  sync(list, dt, dayFactor = 1) {
    this.time += dt;
    const live = new Set(list);
    for (const e of list) {
      if (!this.rendered.has(e)) this.addMesh(e);
      this.syncEntity(e, dt, dayFactor);
    }
    for (const [e, r] of this.rendered) {
      if (!live.has(e)) { this.disposeEntity(r); this.rendered.delete(e); }
    }
  }

  addMesh(e) {
    if (e.itemId != null) {
      const mesh = new THREE.Mesh(itemGeometry(this.atlas, e.itemId), this.itemMaterial);
      this.scene.add(mesh);
      this.rendered.set(e, { mesh });
    } else if (e.isMob) {
      const { group, legs, mats } = buildCritter();
      this.scene.add(group);
      this.rendered.set(e, { mesh: group, legs, mats, walk: 0 });
    }
  }

  syncEntity(e, dt, dayFactor) {
    const r = this.rendered.get(e);
    if (!r) return;
    if (e.itemId != null) {
      // Hover slightly, bob, and spin.
      r.mesh.position.set(
        e.position.x,
        e.position.y + 0.18 + Math.sin(this.time * 2 + e.phase) * 0.05,
        e.position.z);
      r.mesh.rotation.y = this.time * 1.5 + e.phase;
    } else if (e.isMob) {
      r.mesh.position.set(e.position.x, e.position.y, e.position.z);
      r.mesh.rotation.y = e.heading;
      if (e.moving && e.onGround) r.walk += dt * 7;
      const s = e.moving ? Math.sin(r.walk) * 0.5 : 0; // diagonal leg gait
      r.legs[0].rotation.x = s; r.legs[3].rotation.x = s;
      r.legs[1].rotation.x = -s; r.legs[2].rotation.x = -s;
      this.applyLight(r.mats, e.position, dayFactor);
    }
  }

  // Tint a mob's model by the light where it stands (same 0.8-per-level curve as
  // the world shader) so critters dim in caves and at night instead of glowing.
  applyLight(mats, pos, dayFactor) {
    const sx = Math.floor(pos.x), sy = Math.floor(pos.y + 0.5), sz = Math.floor(pos.z);
    const sky = this.world.getSkyLight(sx, sy, sz) / 15;
    const blk = this.world.getBlockLight(sx, sy, sz) / 15;
    const lvl = Math.max(blk, sky * dayFactor);
    const b = Math.max(Math.pow(0.8, (1 - lvl) * 15), 0.12);
    for (const [m, c] of mats) m.color.setHex(c).multiplyScalar(b);
  }

  disposeEntity(r) {
    this.scene.remove(r.mesh);
    if (r.mats) for (const [m] of r.mats) m.dispose();
  }
}
