// Gestión de temporadas (rangos de fechas donde las horas extra se pagan en vez de acumularse).
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let isAdmin = false;
let temporadas = [];

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

  onSnapshot(query(collection(db, "temporadas"), orderBy("fechaInicio", "desc")), (s) => {
    temporadas = s.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

function render() {
  const tbody = document.querySelector("#tabla-temporadas tbody");
  tbody.innerHTML = "";
  temporadas.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(t.nombre)}</td>
      <td>${t.fechaInicio}</td>
      <td>${t.fechaFin}</td>
      <td>${t.activa ? "Sí" : "No"}</td>
      <td class="admin-only">
        <button class="icon-btn edit" data-action="edit" data-id="${t.id}">✏️</button>
        <button class="icon-btn delete" data-action="delete" data-id="${t.id}">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  document.querySelectorAll("#tabla-temporadas .admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");
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

document.getElementById("btn-nueva-temporada").addEventListener("click", () => abrirFormTemporada());

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const t = temporadas.find(x => x.id === btn.dataset.id);
  if (btn.dataset.action === "edit") abrirFormTemporada(t);
  if (btn.dataset.action === "delete") {
    if (confirm(`¿Eliminar la temporada "${t.nombre}"? Los registros diarios ya guardados no se modifican.`)) {
      await deleteDoc(doc(db, "temporadas", t.id));
    }
  }
});

function abrirFormTemporada(t = null) {
  const html = `
    ${campo("f-nombre", "Nombre", "text", t?.nombre || "")}
    ${campo("f-inicio", "Desde", "date", t?.fechaInicio || "")}
    ${campo("f-fin", "Hasta", "date", t?.fechaFin || "")}
    <div class="modal-body-field">
      <label><input type="checkbox" id="f-activa" ${!t || t.activa ? "checked" : ""} /> Activa</label>
    </div>
  `;
  abrirModal(t ? "Editar temporada" : "Nueva temporada", html, async () => {
    const data = {
      nombre: document.getElementById("f-nombre").value.trim(),
      fechaInicio: document.getElementById("f-inicio").value,
      fechaFin: document.getElementById("f-fin").value,
      activa: document.getElementById("f-activa").checked
    };
    if (!data.nombre || !data.fechaInicio || !data.fechaFin) return alert("Nombre y fechas son obligatorios.");
    if (t) await updateDoc(doc(db, "temporadas", t.id), data);
    else await addDoc(collection(db, "temporadas"), data);
    cerrarModal();
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
