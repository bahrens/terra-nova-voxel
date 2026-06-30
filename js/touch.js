// Touch controls: a left virtual joystick (move), a full-screen look pad (drag
// to look), and on-screen action buttons. Wires into the same player inputs the
// keyboard/mouse use (analog move, lookDelta, the keys set, leftDown, placeBlock)
// so the rest of the game is input-agnostic. Pointer Events give us multi-touch
// (joystick + look + a button at once), each control tracking its own pointerId.
export function setupTouch(player, opts = {}) {
  const $ = (id) => document.getElementById(id);
  const joy = $("joystick"), knob = $("joyKnob"), look = $("lookpad");
  const JOY_R = 52, LOOK_SENS = 3.0;

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

  // --- Look pad (drag to look) ---
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener("pointerdown", (e) => {
    e.preventDefault(); lookId = e.pointerId; look.setPointerCapture(lookId); lx = e.clientX; ly = e.clientY;
  });
  look.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookId) return;
    player.lookDelta((e.clientX - lx) * LOOK_SENS, (e.clientY - ly) * LOOK_SENS);
    lx = e.clientX; ly = e.clientY;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  look.addEventListener("pointerup", lookEnd);
  look.addEventListener("pointercancel", lookEnd);

  // --- Action buttons ---
  const btn = (id, down, up) => {
    const el = $(id); if (!el) return;
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); down(); });
    if (up) { el.addEventListener("pointerup", (e) => { e.preventDefault(); up(); }); el.addEventListener("pointercancel", up); }
  };
  btn("btnJump", () => player.keys.add("Space"), () => player.keys.delete("Space")); // jump / fly up
  btn("btnDown", () => player.keys.add("KeyC"), () => player.keys.delete("KeyC")); // descend while flying
  btn("btnBreak", () => { player.leftDown = true; }, () => { player.leftDown = false; player.mining = null; });
  btn("btnPlace", () => player.placeBlock());
  btn("btnFly", () => { player.flying = !player.flying; player.flyFast = false; });
  btn("btnInv", () => opts.onInventory && opts.onInventory());
  btn("btnPause", () => opts.onPause && opts.onPause());
}
