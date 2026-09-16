// Control anual de vacaciones: cada empleado inicia "Pendiente" y el estado
// visible se calcula solo (Aprobado → En vacaciones → Ya estuvo) según las
// fechas registradas. Se reinicia automáticamente cada año (doc por año).
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fechaLocalHoy, ordenarEmpleados, coincideBusqueda } from "./formato.js";

let currentUser = null;
let isAdmin = false;
let empleados = [];
let vacacionesPorAnio = []; // registros de vacaciones del año seleccionado

const ANIO_ACTUAL = new Date().getFullYear();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  currentUser = user;
  document.getElementById("user-email").textContent = user.email;
  const snap = await getDoc(doc(db, "users", user.uid));
  isAdmin = snap.exists() && snap.data().role === "admin";
  document.getElementById("user-role").textContent = isAdmin ? "Administrador" : "Empleado";
  iniciarSelectorAnio();
  iniciarListeners();
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

function iniciarSelectorAnio() {
  const select = document.getElementById("anio");
  const anios = [];
  for (let a = ANIO_ACTUAL - 1; a <= ANIO_ACTUAL + 1; a++) anios.push(a);
  select.innerHTML = anios.map(a => `<option value="${a}" ${a === ANIO_ACTUAL ? "selected" : ""}>${a}</option>`).join("");
  select.addEventListener("change", cargarVacacionesDelAnio);
}

let unsubscribeVacaciones = null;

function iniciarListeners() {
  onSnapshot(collection(db, "empleados"), (snap) => {
    empleados = ordenarEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.activo !== false));
    render();
  });
  cargarVacacionesDelAnio();
}

function cargarVacacionesDelAnio() {
  if (unsubscribeVacaciones) unsubscribeVacaciones();
  const anio = Number(document.getElementById("anio").value) || ANIO_ACTUAL;
  unsubscribeVacaciones = onSnapshot(query(collection(db, "vacaciones"), orderBy("anio")), (snap) => {
    vacacionesPorAnio = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(v => v.anio === anio);
    render();
  });
}

// ---------------- Estado calculado ----------------
function calcularEstado(v) {
  if (!v) return { texto: "Pendiente", clase: "estado-pendiente" };
  if (v.estado === "en_solicitud") return { texto: "En solicitud", clase: "estado-en_solicitud" };
  if (v.estado === "aprobado") {
    const hoy = fechaLocalHoy();
    if (v.hasta && hoy > v.hasta) return { texto: "Ya estuvo de vacaciones", clase: "estado-disfrutada" };
    if (v.desde && hoy >= v.desde && (!v.hasta || hoy <= v.hasta)) return { texto: "En vacaciones", clase: "estado-en_vacaciones" };
    return { texto: "Aprobado", clase: "estado-aprobado" };
  }
  return { texto: "Pendiente", clase: "estado-pendiente" };
}

// ---------------- Render ----------------
function render() {
  const tbody = document.querySelector("#tabla-vacaciones tbody");
  tbody.innerHTML = "";
  const busqueda = document.getElementById("buscar-vacaciones")?.value || "";
  empleados
    .filter(emp => coincideBusqueda(emp.nombre, busqueda) || coincideBusqueda(emp.cargo, busqueda))
    .forEach((emp, indice) => {
    const v = vacacionesPorAnio.find(x => x.employeeId === emp.id);
    const estado = calcularEstado(v);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${indice + 1}</td>
      <td>${escapeHtml(emp.nombre)}</td>
      <td>${escapeHtml(emp.cargo || "")}</td>
      <td><span class="estado-badge ${estado.clase}">${estado.texto}</span></td>
      <td>${v?.fechaAprobacion || "—"}</td>
      <td>${v?.diasVacaciones ?? "—"}</td>
      <td>${v?.desde || "—"}</td>
      <td>${v?.hasta || "—"}</td>
      <td>${escapeHtml(v?.observaciones || "")}</td>
      <td class="admin-only">
        <button class="icon-btn edit" data-action="editar-vacacion" data-id="${emp.id}">✏️</button>
        ${v ? `<button class="icon-btn delete" data-action="quitar-vacacion" data-id="${emp.id}">🗑️</button>` : ""}
      </td>`;
    tbody.appendChild(tr);
  });
  document.querySelectorAll("#tabla-vacaciones .admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");
}
document.getElementById("buscar-vacaciones").addEventListener("input", render);

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
  const textoOriginal = btnConfirm.textContent;
  btnConfirm.textContent = "Guardando...";
  try {
    await Promise.race([
      onConfirmCallback(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Sin respuesta del servidor en 10s.")), 10000))
    ]);
  } catch (err) {
    console.error(err);
    alert("No se pudo guardar: " + (err?.message || err));
  } finally {
    btnConfirm.disabled = false;
    btnConfirm.textContent = textoOriginal;
  }
});
overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarModal(); });

function campo(id, label, tipo = "text", valor = "", extra = "") {
  return `<div class="modal-body-field">
    <label for="${id}">${label}</label>
    <input type="${tipo}" id="${id}" value="${valor}" ${extra} />
  </div>`;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const emp = empleados.find(x => x.id === btn.dataset.id);
  if (!emp) return;

  if (btn.dataset.action === "editar-vacacion") {
    const anio = Number(document.getElementById("anio").value) || ANIO_ACTUAL;
    const v = vacacionesPorAnio.find(x => x.employeeId === emp.id);
    abrirFormVacacion(emp, anio, v);
  }
  if (btn.dataset.action === "quitar-vacacion") {
    const anio = Number(document.getElementById("anio").value) || ANIO_ACTUAL;
    if (confirm(`¿Volver a marcar a ${emp.nombre} como Pendiente en ${anio}?`)) {
      await deleteDoc(doc(db, "vacaciones", `${emp.id}_${anio}`));
    }
  }
});

function abrirFormVacacion(emp, anio, v) {
  const html = `
    <p class="auth-hint" style="text-align:left;margin:0 0 0.5rem;"><strong>${escapeHtml(emp.nombre)}</strong> · ${anio}</p>
    <div class="modal-body-field">
      <label for="f-estado">Estado</label>
      <select id="f-estado">
        <option value="en_solicitud" ${v?.estado === "en_solicitud" ? "selected" : ""}>En solicitud</option>
        <option value="aprobado" ${!v || v.estado === "aprobado" ? "selected" : ""}>Aprobado</option>
      </select>
    </div>
    ${campo("f-fecha-aprobacion", "Fecha de aprobación", "date", v?.fechaAprobacion || "")}
    ${campo("f-dias", "Días de vacaciones", "number", v?.diasVacaciones ?? 15, 'step="1" min="0"')}
    ${campo("f-desde", "Desde", "date", v?.desde || "")}
    ${campo("f-hasta", "Hasta", "date", v?.hasta || "")}
    <div class="modal-body-field">
      <label for="f-obs">Observaciones</label>
      <textarea id="f-obs" rows="2">${escapeHtml(v?.observaciones || "")}</textarea>
    </div>
  `;

  abrirModal(v ? "Editar vacaciones" : "Registrar vacaciones", html, async () => {
    const data = {
      employeeId: emp.id,
      employeeNombre: emp.nombre,
      anio,
      estado: document.getElementById("f-estado").value,
      fechaAprobacion: document.getElementById("f-fecha-aprobacion").value,
      diasVacaciones: parseInt(document.getElementById("f-dias").value, 10) || 0,
      desde: document.getElementById("f-desde").value,
      hasta: document.getElementById("f-hasta").value,
      observaciones: document.getElementById("f-obs").value.trim(),
      actualizadoPor: currentUser.email,
      actualizadoEn: serverTimestamp()
    };
    await setDoc(doc(db, "vacaciones", `${emp.id}_${anio}`), data);
    cerrarModal();
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
