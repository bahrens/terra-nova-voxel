// WorldRenderer (client): turns the headless World's chunk data into Three.js
// meshes. Owns the block materials (with the day/night + light shader) and the
// per-chunk meshes; meshes the world's dirty chunks each frame within a time
// budget and disposes chunks the sim unloads. The World has none of this.
import * as THREE from "three";
import { meshChunk } from "./mesher.js";
import { CHUNK_SIZE } from "./chunk.js";

const floorDiv = (a, b) => Math.floor(a / b);
const now = (typeof performance !== "undefined") ? () => performance.now() : () => Date.now();

export class WorldRenderer {
  constructor(world, scene, atlas) {
    this.world = world;
    this.scene = scene;
    this.atlas = atlas;
    this.materials = buildMaterials(atlas);
    // Dispose a chunk's meshes when the sim unloads it.
    world.onChunkUnload = (chunk) => this.disposeChunk(chunk);
  }

  // Drain the world's mesh queue nearest-first, within `meshMs`.
  update(playerPos, meshMs = 6) {
    const world = this.world;
    const pcx = floorDiv(playerPos.x, CHUNK_SIZE), pcz = floorDiv(playerPos.z, CHUNK_SIZE);
    world.meshQueue.sort((a, b) => {
      const da = (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2;
      const db = (b.cx - pcx) ** 2 + (b.cz - pcz) ** 2;
      return da - db;
    });
    const t = now();
    while (world.meshQueue.length) {
      const chunk = world.meshQueue.shift();
      if (!world.getChunk(chunk.cx, chunk.cz)) continue; // unloaded meanwhile
      this.buildChunkMesh(chunk);
      if (now() - t >= meshMs) break; // always meshes at least one
    }
    world.timings.mesh = now() - t;
  }

  buildChunkMesh(chunk) {
    const geom = meshChunk(chunk, this.world, this.atlas);
    if (chunk.meshes) {
      for (const k of ["opaque", "foliage", "water"]) {
        const m = chunk.meshes[k];
        if (m) { this.scene.remove(m); m.geometry.dispose(); }
      }
    }
    const meshes = {};
    const add = (k, mat) => {
      const g = geom[k];
      if (!g) { meshes[k] = null; return; }
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      meshes[k] = mesh;
    };
    add("opaque", this.materials.opaque);
    add("foliage", this.materials.foliage);
    add("water", this.materials.water);
    chunk.meshes = meshes;
    chunk.dirty = false;
  }

  disposeChunk(chunk) {
    if (!chunk.meshes) return;
    for (const k of ["opaque", "foliage", "water"]) {
      const m = chunk.meshes[k];
      if (m) { this.scene.remove(m); m.geometry.dispose(); }
    }
    chunk.meshes = null;
  }
}

function buildMaterials(atlas) {
  const map = atlas.texture;
  // Shared day/night uniform driven by Sky. Vertex colours carry
  // r = AO×face shading, g = skylight, b = block light; the patched shader
  // computes  tex × r × max(b, g × uSky)  so day/night is a uniform update
  // (no re-meshing) and block light stays constant through the night. A small
  // ambient floor keeps unlit areas from being pure black before torches exist.
  const skyUniform = { value: 1 };
  const debugUniform = { value: 0 }; // 1 = raw light view (toggle with L)
  const patchLight = (mat) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSky = skyUniform;
      shader.uniforms.uDebugLight = debugUniform;
      shader.fragmentShader = "uniform float uSky;\nuniform float uDebugLight;\n" +
        shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#ifdef USE_COLOR
           if (uDebugLight > 0.5) {
             // Debug view: R = block light, G = skylight (raw 0-1), ignoring
             // texture/AO/day-night so the light data is directly visible.
             diffuseColor.rgb = vec3(vColor.b, vColor.g, 0.0);
           } else {
             // Light curve: each level is ~0.8x the previous for a natural falloff
             // (vs a flat linear ramp). Applied per channel in level-space; sky is
             // dimmed by day/night AFTER the curve so night brightness is unchanged.
             // r = AO x face shading. 0.06 = ambient floor (no pure-black).
             float skyC = pow(0.8, (1.0 - vColor.g) * 15.0) * uSky;
             float blockC = pow(0.8, (1.0 - vColor.b) * 15.0);
             diffuseColor.rgb *= max(vColor.r * max(skyC, blockC), 0.06);
           }
         #endif`
      );
    };
  };

  const opaque = new THREE.MeshBasicMaterial({ map, vertexColors: true });
  patchLight(opaque);
  const foliage = new THREE.MeshBasicMaterial({
    map, vertexColors: true, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide,
  });
  patchLight(foliage);
  // depthWrite:true so overlapping water faces from different chunk meshes don't
  // cumulatively blend (darker seams at chunk borders). Water keeps flat vertex
  // brightness + material-colour day/night for now.
  const water = new THREE.MeshBasicMaterial({
    map, vertexColors: true, transparent: true, opacity: 0.78,
    depthWrite: true, side: THREE.DoubleSide,
  });
  return { opaque, foliage, water, skyUniform, debugUniform };
}
