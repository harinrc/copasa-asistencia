// Registra el service worker y maneja el botón "Instalar app" (Windows/Android;
// en iPhone no existe este flujo del navegador, por eso ahí simplemente no aparece).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

let promptDiferido = null;

function yaInstalada() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function crearBotonInstalar() {
  let btn = document.getElementById("btn-instalar-app");
  if (btn) return btn;

  btn = document.createElement("button");
  btn.id = "btn-instalar-app";
  btn.type = "button";
  btn.textContent = "⬇️ Instalar app";
  btn.hidden = true;

  const contenedor = document.querySelector(".topbar-user");
  if (contenedor) contenedor.insertBefore(btn, contenedor.firstChild);
  else document.body.appendChild(btn);

  btn.addEventListener("click", async () => {
    if (!promptDiferido) return;
    btn.disabled = true;
    promptDiferido.prompt();
    const { outcome } = await promptDiferido.userChoice;
    if (outcome === "accepted") btn.hidden = true;
    promptDiferido = null;
    btn.disabled = false;
  });

  return btn;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  promptDiferido = e;
  if (!yaInstalada()) crearBotonInstalar().hidden = false;
});

window.addEventListener("appinstalled", () => {
  const btn = document.getElementById("btn-instalar-app");
  if (btn) btn.hidden = true;
  promptDiferido = null;
});

// Si ya está instalada (abierta como app), nunca mostrar el botón
if (yaInstalada()) {
  const btn = document.getElementById("btn-instalar-app");
  if (btn) btn.hidden = true;
}

// Resaltar interactivamente la fila al hacer clic/tocar en cualquier tabla de la app
document.addEventListener("click", (e) => {
  if (e.target.closest("button, input, select, textarea, a, .icon-btn, .badge")) return;
  const tr = e.target.closest("tbody tr");
  if (!tr) return;
  const tabla = tr.closest(".data-table, .grid-table");
  if (!tabla) return;

  const yaActiva = tr.classList.contains("fila-activa");
  tabla.querySelectorAll("tbody tr.fila-activa").forEach(fila => fila.classList.remove("fila-activa"));
  if (!yaActiva) {
    tr.classList.add("fila-activa");
  }
});
