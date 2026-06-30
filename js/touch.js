// Touch controls: a left virtual joystick (move) and a full-screen world area
// where DRAG looks, a quick TAP places, and TAP-AND-HOLD breaks/mines — the
// Minecraft-Pocket model, so break/place need no buttons and the look area stays
// clear. A small top cluster (inventory / fly / menu) and a right-edge jump (plus
// a fly-down button shown only while flying) are the only buttons. Wired to the
// same player inputs as keyboard/mouse, via Pointer Events for multi-touch.
export function setupTouch(player, opts = {}) {
  const $ = (id) => document.getElementById(id);
  const joy = $("joystick"), knob = $("joyKnob"), look = $("lookpad");
  const JOY_R = 52, LOOK_SENS = 4.3, MOVE_THRESH = 12, HOLD_MS = 200;

  // --- Joystick (analog move) ---
  let joyId = null, cx = 0, cy = 0;
  const joyMove = (e) => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
    player.moveX = dx / JOY_R;
    player.moveZ = -dy / JOY_R; // up = forward
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const joyEnd = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null; player.moveX = 0; player.moveZ = 0;
    knob.style.transform = "translate(-50%, -50%)";
  };
  joy.addEventListener("pointerdown", (e) => {
    e.preventDefault(); joyId = e.pointerId; joy.setPointerCapture(joyId);
    const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    joyMove(e);
  });
  joy.addEventListener("pointermove", (e) => { if (e.pointerId === joyId) joyMove(e); });
  joy.addEventListener("pointerup", joyEnd);
  joy.addEventListener("pointercancel", joyEnd);

  // --- World gestures: drag = look, hold = break, tap = place ---
  let lookId = null, lx = 0, ly = 0, sx = 0, sy = 0, moved = false, breaking = false, holdT = 0;
  const endBreak = () => { if (breaking) { player.leftDown = false; player.mining = null; breaking = false; } };
  look.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    lookId = e.pointerId; look.setPointerCapture(lookId);
    lx = sx = e.clientX; ly = sy = e.clientY; moved = false; breaking = false;
    holdT = setTimeout(() => { if (lookId !== null && !moved) { breaking = true; player.leftDown = true; } }, HOLD_MS);
  });
  look.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > MOVE_THRESH) { moved = true; clearTimeout(holdT); }
    if (moved) player.lookDelta((e.clientX - lx) * LOOK_SENS, (e.clientY - ly) * LOOK_SENS);
    lx = e.clientX; ly = e.clientY;
  });
  const lookEnd = (e) => {
    if (e.pointerId !== lookId) return;
    clearTimeout(holdT);
    if (breaking) endBreak();
    else if (!moved) player.placeBlock(); // quick tap with no drag = place
    lookId = null; moved = false;
  };
  look.addEventListener("pointerup", lookEnd);
  look.addEventListener("pointercancel", lookEnd);

  // --- Buttons ---
  const btn = (id, down, up) => {
    const el = $(id); if (!el) return;
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); down(); });
    if (up) { el.addEventListener("pointerup", (e) => { e.preventDefault(); up(); }); el.addEventListener("pointercancel", up); }
  };
  const btnDown = $("btnDown");
  if (btnDown) btnDown.style.display = "none"; // only relevant while flying
  btn("btnJump", () => player.keys.add("Space"), () => player.keys.delete("Space")); // jump / fly up
  btn("btnDown", () => player.keys.add("KeyC"), () => player.keys.delete("KeyC")); // descend while flying
  btn("btnFly", () => {
    player.flying = !player.flying; player.flyFast = false;
    if (btnDown) btnDown.style.display = player.flying ? "" : "none";
  });
  btn("btnInv", () => opts.onInventory && opts.onInventory());
  btn("btnPause", () => opts.onPause && opts.onPause());
}
