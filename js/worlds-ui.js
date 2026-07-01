// Worlds panel: list existing worlds (load / delete) and create a new one with an
// optional name + seed. Opened from the main menu. All the actual persistence and
// world switching lives in SaveManager; this is just the screen.
export function setupWorldsUI(save) {
  const $ = (id) => document.getElementById(id);
  const overlay = $("worlds");
  if (!overlay) return;
  const listEl = $("worldList");
  const openBtn = $("worldsBtn"), closeBtn = $("worldsCloseX");
  const nameInput = $("worldName"), seedInput = $("worldSeed"), createBtn = $("worldCreate");
  const createBox = $("worldCreateBox"), newToggle = $("worldNewToggle"), newCancel = $("worldNewCancel");

  const collapseCreate = () => { if (createBox) createBox.classList.remove("open"); };
  const open = () => { render(); collapseCreate(); overlay.classList.add("active"); };
  const close = () => overlay.classList.remove("active");

  const fmtAgo = (t) => {
    if (!t) return "never";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  function render() {
    listEl.innerHTML = "";
    for (const w of save.listWorlds()) {
      const current = w.id === save.currentId;
      const row = document.createElement("div");
      row.className = "world-row" + (current ? " current" : "");

      const info = document.createElement("div");
      info.className = "world-info";
      const name = document.createElement("div");
      name.className = "world-name";
      name.textContent = w.name;
      if (current) {
        const badge = document.createElement("span");
        badge.className = "world-badge"; badge.textContent = "current";
        name.appendChild(badge);
      }
      const meta = document.createElement("div");
      meta.className = "world-meta";
      meta.textContent = `seed ${w.seed} · ${fmtAgo(w.lastPlayed)}`;
      info.appendChild(name); info.appendChild(meta);

      const load = document.createElement("button");
      load.className = "secondary world-load";
      load.textContent = current ? "Resume" : "Load";
      load.addEventListener("click", () => current ? close() : save.switchTo(w.id));

      const del = document.createElement("button");
      del.className = "secondary world-del";
      del.textContent = "Delete";
      del.title = `Delete ${w.name}`;
      del.addEventListener("click", () => {
        if (confirm(`Delete "${w.name}"? This can't be undone.`)) {
          if (!save.deleteWorld(w.id)) render(); // false = stayed; refresh the list
        }
      });

      row.appendChild(info); row.appendChild(load); row.appendChild(del);
      listEl.appendChild(row);
    }
  }

  if (openBtn) openBtn.addEventListener("click", open);
  if (closeBtn) closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  if (newToggle) newToggle.addEventListener("click", () => {
    createBox.classList.add("open");
    if (nameInput) nameInput.focus();
  });
  if (newCancel) newCancel.addEventListener("click", collapseCreate);
  if (createBtn) createBtn.addEventListener("click", () => {
    save.createWorld({ name: nameInput?.value, seed: seedInput?.value });
  });
}
