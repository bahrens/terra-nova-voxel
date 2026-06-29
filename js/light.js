// Incremental light updates: when one block changes, re-light only the cells
// whose light actually changes, instead of recomputing a whole chunk. Uses the
// standard two-phase flood: a removal pass that clears light descended from the
// edit (queuing independently-lit boundary cells), then an addition pass that
// re-spreads from those boundary cells plus any new source at the edit.
//
// Pure + accessor-driven so it can be unit-tested on a plain grid and reused in
// world space (crossing chunk borders) without change. The accessor provides:
//   H                         world height (y in [0, H))
//   opaqueAt(x,y,z) -> bool    blocks light (also true for unloaded/out-of-range)
//   emissionAt(x,y,z) -> int   block-light emission of the block there (0-15)
//   getSky / getBlockL (x,y,z) -> int        current light (0-15)
//   setSky / setBlockL (x,y,z,v) -> bool     write; false if cell isn't writable

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

// ---- Block light (isotropic, decays 1 per step) ----
export function updateBlockLight(acc, x, y, z) {
  const H = acc.H;
  const old = acc.getBlockL(x, y, z);
  acc.setBlockL(x, y, z, 0);

  const remQ = [[x, y, z, old]];
  const addQ = [];
  for (let h = 0; h < remQ.length; h++) {
    const [cx, cy, cz, lvl] = remQ[h];
    for (const [dx, dy, dz] of DIRS) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (ny < 0 || ny >= H) continue;
      const nl = acc.getBlockL(nx, ny, nz);
      if (nl === 0) continue;
      if (nl < lvl) {                                  // this cell was lit by us
        if (acc.setBlockL(nx, ny, nz, 0)) remQ.push([nx, ny, nz, nl]);
      } else {                                         // independently lit: re-source
        addQ.push([nx, ny, nz]);
      }
    }
  }

  // A new emitter at the edit seeds the addition.
  const emit = acc.emissionAt(x, y, z);
  if (emit > 0 && !acc.opaqueAt(x, y, z) && acc.setBlockL(x, y, z, emit)) addQ.push([x, y, z]);

  spreadBlock(acc, addQ, H);
}

function spreadBlock(acc, q, H) {
  for (let h = 0; h < q.length; h++) {
    const [cx, cy, cz] = q[h];
    const L = acc.getBlockL(cx, cy, cz);
    if (L <= 1) continue;
    for (const [dx, dy, dz] of DIRS) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (ny < 0 || ny >= H || acc.opaqueAt(nx, ny, nz)) continue;
      if (acc.getBlockL(nx, ny, nz) < L - 1 && acc.setBlockL(nx, ny, nz, L - 1)) q.push([nx, ny, nz]);
    }
  }
}

// ---- Skylight (as block light, but sunlight falls straight down at full level) ----
export function updateSkyLight(acc, x, y, z) {
  const H = acc.H;
  const old = acc.getSky(x, y, z);
  acc.setSky(x, y, z, 0);

  const remQ = [[x, y, z, old]];
  const addQ = [];
  for (let h = 0; h < remQ.length; h++) {
    const [cx, cy, cz, lvl] = remQ[h];
    for (const [dx, dy, dz] of DIRS) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (ny < 0 || ny >= H) continue;
      const nl = acc.getSky(nx, ny, nz);
      if (nl === 0) continue;
      // Straight down at full level doesn't decay, so a 15 below us descended from us.
      const descended = (dy === -1 && lvl === 15) ? (nl === 15) : (nl < lvl);
      if (descended) {
        if (acc.setSky(nx, ny, nz, 0)) remQ.push([nx, ny, nz, nl]);
      } else {
        addQ.push([nx, ny, nz]);
      }
    }
  }

  spreadSky(acc, addQ, H);
}

function spreadSky(acc, q, H) {
  for (let h = 0; h < q.length; h++) {
    const [cx, cy, cz] = q[h];
    const L = acc.getSky(cx, cy, cz);
    if (L <= 1) continue;
    for (const [dx, dy, dz] of DIRS) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (ny < 0 || ny >= H || acc.opaqueAt(nx, ny, nz)) continue;
      const expected = (dy === -1 && L === 15) ? 15 : L - 1; // sunlight column
      if (acc.getSky(nx, ny, nz) < expected && acc.setSky(nx, ny, nz, expected)) q.push([nx, ny, nz]);
    }
  }
}
