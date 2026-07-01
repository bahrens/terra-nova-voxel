// Keyboard + mouse input source — the desktop counterpart to touch.js. It owns
// the raw DOM listeners and drives the player through its public API (the keys
// set, lookDelta, leftDown, onSelect, placeBlock), plus UI command callbacks for
// keyboard shortcuts. Keeping this out of the Player class makes Player DOM-free
// and lets input be swapped/extended the same way touch schemes will be.
//
// opts: { isReady, onSave, onToggleInventory, onEscape, onToggleMode,
//         onToggleProfiler, onCopyProfiler, onSpawnMob, onToggleLight }
export function setupKeyboardMouse(player, opts = {}) {
  const ready = opts.isReady || (() => true);
  let lastWTap = -1e9;
  let cHeld = false; // dedupe C key-repeat for the crouch toggle

  document.addEventListener("keydown", (e) => {
    // UI command shortcuts — available whenever the game is started (even with the
    // inventory open or otherwise not actively in-world). Distinct from movement
    // keys, so returning after one is safe.
    if (ready()) {
      switch (e.code) {
        case "KeyK": opts.onSave?.(); return;
        case "KeyE": e.preventDefault(); opts.onToggleInventory?.(); return;
        case "Escape": opts.onEscape?.(); return;
        case "KeyG": opts.onToggleMode?.(); return;
        case "KeyP": opts.onToggleProfiler?.(); return;
        case "KeyV": opts.onCopyProfiler?.(); return;
        case "KeyM": opts.onSpawnMob?.(); return;
        case "KeyL": opts.onToggleLight?.(); return;
      }
    }
    // Player control — only while actively in-world.
    if (!player.enabled) return;
    // C toggles crouch on desktop. Kept out of the keys set (deduped against
    // key-repeat) so it stays a toggle, not the touch hold-to-descend behavior.
    if (e.code === "KeyC") { if (!cHeld) { cHeld = true; player.crouchToggle = !player.crouchToggle; } return; }
    const fresh = !player.keys.has(e.code); // ignore key-repeat events
    player.keys.add(e.code);
    if (!fresh) return;
    if (e.code === "KeyF") { player.flying = !player.flying; player.flyFast = false; }
    // Double-tap W toggles fast flight (stays on until toggled off).
    if (e.code === "KeyW" && player.flying) {
      const now = performance.now();
      if (now - lastWTap < 300) player.flyFast = !player.flyFast;
      lastWTap = now;
    }
    if (e.code.startsWith("Digit")) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= 9 && player.onSelect) player.onSelect(n - 1, true);
    }
  });
  document.addEventListener("keyup", (e) => { if (e.code === "KeyC") cHeld = false; player.keys.delete(e.code); });

  document.addEventListener("mousemove", (e) => {
    if (!player.enabled) return;
    player.lookDelta(e.movementX, e.movementY);
  });
  window.addEventListener("wheel", (e) => {
    if (!player.enabled || !player.onSelect) return;
    player.onSelect(Math.sign(e.deltaY), false);
  }, { passive: true });
  document.addEventListener("mousedown", (e) => {
    if (!player.enabled) return;
    if (e.button === 0) player.leftDown = true; // creative break edge-detected in updateMining
    else if (e.button === 2) player.placeBlock();
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button === 0) { player.leftDown = false; player.mining = null; }
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}
