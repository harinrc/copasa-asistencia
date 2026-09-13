// Gestión de feriados puntuales (los domingos ya se detectan solos, ver registro-diario.js).
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, deleteDoc, getDoc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fechaLocalHoy } from "./formato.js";

let isAdmin = false;
let feriados = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  document.getElementById("user-email").textContent = user.email;
  const snap = await getDoc(doc(db, "users", user.uid));
  isAdmin = snap.exists() && snap.data().role === "admin";
  document.getElementById("user-role").textContent = isAdmin ? "Administrador" : "Empleado";
  document.querySelectorAll(".admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");

  onSnapshot(query(collection(db, "feriados"), orderBy("fecha", "desc")), (s) => {
    feriados = s.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

function render() {
  const tbody = document.querySelector("#tabla-feriados tbody");
  tbody.innerHTML = "";
  feriados.forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${f.fecha}</td>
      <td>${escapeHtml(f.nombre || "")}</td>
      <td class="admin-only"><button class="icon-btn delete" data-id="${f.id}">🗑️</button></td>`;
    tbody.appendChild(tr);
  });
  document.querySelectorAll("#tabla-feriados .admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");
}

// ---------------- Modal genérico ----------------
const overlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const btnCancel = document.getElementById("modal-cancel");
const btnConfirm = document.getElementById("modal-confirm");
let onConfirmCallback = null;

function abrirModal(titulo, camposHtml, onConfirm) {
  modalTitle.textContent = titulo;
  modalBody.innerHTML = camposHtml;
  onConfirmCallback = onConfirm;
  overlay.hidden = false;
}
function cerrarModal() { overlay.hidden = true; onConfirmCallback = null; }
btnCancel.addEventListener("click", cerrarModal);
btnConfirm.addEventListener("click", async () => {
  if (!onConfirmCallback) return;
  btnConfirm.disabled = true;
  try {
    await onConfirmCallback();
  } catch (err) {
    alert("No se pudo guardar: " + (err?.message || err));
  } finally {
    btnConfirm.disabled = false;
  }
});
overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarModal(); });

function campo(id, label, tipo = "text", valor = "") {
  return `<div class="modal-body-field">
    <label for="${id}">${label}</label>
    <input type="${tipo}" id="${id}" value="${valor}" />
  </div>`;
}

document.getElementById("btn-nuevo-feriado").addEventListener("click", () => {
  const html = `
    ${campo("f-fecha", "Fecha", "date", fechaLocalHoy())}
    ${campo("f-nombre", "Nombre (ej. Día de la Independencia)", "text", "")}
  `;
  abrirModal("Nuevo feriado", html, async () => {
    const fecha = document.getElementById("f-fecha").value;
    const nombre = document.getElementById("f-nombre").value.trim();
    if (!fecha) return alert("La fecha es obligatoria.");
    if (feriados.some(f => f.fecha === fecha)) return alert("Ya existe un feriado registrado en esa fecha.");
    await addDoc(collection(db, "feriados"), { fecha, nombre });
    cerrarModal();
  });
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  const f = feriados.find(x => x.id === btn.dataset.id);
  if (confirm(`¿Eliminar el feriado "${f?.nombre || f?.fecha}"? Los registros diarios ya guardados no se modifican.`)) {
    await deleteDoc(doc(db, "feriados", btn.dataset.id));
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
