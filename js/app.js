// Dashboard: gestión de empleados, resumen del banco de horas y exportación.
// El horario, temporadas, feriados y registro diario viven en sus propias páginas.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoHHMM, parseHHMM, formatoDiasHoras, fechaLocalHoy } from "./formato.js";

let currentUser = null;
let isAdmin = false;
let empleados = [];
let registros = [];

const ETIQUETAS_TIPO = {
  normal: "Normal", subsidio: "Subsidio (INSS)", a_cuenta_acumulado: "A cuenta de acumulado",
  falta: "Falta", permiso: "Permiso", vacaciones: "Vacaciones"
};

// ---------------- Auth guard ----------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  currentUser = user;
  document.getElementById("user-email").textContent = user.email;
  await ensureUserProfile(user);
  iniciarListeners();
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

async function ensureUserProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // El primer usuario del sistema queda como admin; los siguientes como "empleado"
    const isFirstUser = (await getDoc(doc(db, "meta", "usersCount"))).exists() === false;
    const role = isFirstUser ? "admin" : "empleado";
    await setDoc(ref, { email: user.email, role, creadoEn: serverTimestamp() });
    if (isFirstUser) await setDoc(doc(db, "meta", "usersCount"), { inicializado: true });
    isAdmin = role === "admin";
  } else {
    isAdmin = snap.data().role === "admin";
  }
  const roleBadge = document.getElementById("user-role");
  roleBadge.textContent = isAdmin ? "Administrador" : "Empleado";
  document.querySelectorAll(".admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");
}

// ---------------- Listeners en tiempo real ----------------
function iniciarListeners() {
  onSnapshot(query(collection(db, "empleados"), orderBy("nombre")), (snap) => {
    empleados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEmpleados();
    renderBanco();
  });

  onSnapshot(query(collection(db, "registros"), orderBy("fecha", "desc")), (snap) => {
    registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBanco();
    renderDeducidas();
  });
}

// ---------------- Render: Empleados ----------------
function renderEmpleados() {
  const tbody = document.querySelector("#tabla-empleados tbody");
  tbody.innerHTML = "";
  empleados.forEach(emp => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(emp.nombre)}</td>
      <td>${escapeHtml(emp.cargo || "")}</td>
      <td>${formatoHHMM(emp.saldoInicialHoras || 0)} hrs</td>
      <td>${emp.activo === false ? "Inactivo" : "Activo"}</td>
      <td class="admin-only">
        <button class="icon-btn edit" data-action="edit-empleado" data-id="${emp.id}">✏️</button>
        <button class="icon-btn delete" data-action="delete-empleado" data-id="${emp.id}">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  document.querySelectorAll("#tabla-empleados .admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");
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
  const textoOriginal = btnConfirm.textContent;
  btnConfirm.textContent = "Guardando...";
  try {
    await Promise.race([
      onConfirmCallback(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        "Sin respuesta del servidor en 10s. Revisa tu conexión a internet o si un firewall/antivirus está bloqueando firestore.googleapis.com."
      )), 10000))
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

// ---------------- Empleados: alta/edición/borrado ----------------
document.getElementById("btn-nuevo-empleado").addEventListener("click", () => abrirFormEmpleado());

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "edit-empleado") abrirFormEmpleado(empleados.find(x => x.id === id));
  if (btn.dataset.action === "delete-empleado") {
    const emp = empleados.find(x => x.id === id);
    if (confirm(`¿Eliminar a "${emp?.nombre}"? Esto NO borra sus registros diarios históricos, solo su ficha de empleado (deja de aparecer en el registro diario).`)) {
      await deleteDoc(doc(db, "empleados", id));
    }
  }
});

function abrirFormEmpleado(emp = null) {
  const html = `
    ${campo("f-nombre", "Nombre completo", "text", emp?.nombre || "")}
    ${campo("f-cargo", "Cargo", "text", emp?.cargo || "")}
    ${campo("f-saldo-inicial", "Saldo inicial de control de horas HH:MM (migración del Excel)", "text", formatoHHMM(emp?.saldoInicialHoras ?? 0), 'placeholder="00:00" pattern="-?[0-9]+:[0-9]{2}"')}
    ${campo("f-saldo-fecha", "Fecha del saldo inicial", "date", emp?.saldoInicialFecha || fechaLocalHoy())}
  `;
  abrirModal(emp ? "Editar empleado" : "Nuevo empleado", html, async () => {
    const data = {
      nombre: document.getElementById("f-nombre").value.trim(),
      cargo: document.getElementById("f-cargo").value.trim(),
      saldoInicialHoras: parseHHMM(document.getElementById("f-saldo-inicial").value),
      saldoInicialFecha: document.getElementById("f-saldo-fecha").value,
      activo: true
    };
    if (!data.nombre) return alert("El nombre es obligatorio.");
    if (emp) await updateDoc(doc(db, "empleados", emp.id), data);
    else await addDoc(collection(db, "empleados"), data);
    cerrarModal();
  });
}

// ---------------- Render: Banco de horas ----------------
function registrosFiltrados(desde, hasta) {
  return registros.filter(r => {
    if (desde && r.fecha < desde) return false;
    if (hasta && r.fecha > hasta) return false;
    return true;
  });
}

function getRangoFechas() {
  return {
    desde: document.getElementById("fecha-inicio").value || null,
    hasta: document.getElementById("fecha-fin").value || null
  };
}

document.getElementById("fecha-inicio").addEventListener("change", () => { renderBanco(); renderDeducidas(); });
document.getElementById("fecha-fin").addEventListener("change", () => { renderBanco(); renderDeducidas(); });

function round2(n) { return Math.round(n * 100) / 100; }
function gananciaBanco(r) { return (r.horasAcumuladasEntrada || 0) + (r.horasAcumuladasSalidas || 0); }

function calcularBancoEmpleado(emp, hasta) {
  const desdeMigracion = registros.filter(r =>
    r.employeeId === emp.id &&
    (!emp.saldoInicialFecha || r.fecha >= emp.saldoInicialFecha) &&
    (!hasta || r.fecha <= hasta)
  );
  const ganadoTotal = desdeMigracion.reduce((a, r) => a + gananciaBanco(r), 0);
  const gastadoTotal = desdeMigracion.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0);
  return round2((emp.saldoInicialHoras || 0) + ganadoTotal - gastadoTotal);
}

function renderBanco() {
  const tbody = document.querySelector("#tabla-banco tbody");
  tbody.innerHTML = "";
  const { desde, hasta } = getRangoFechas();
  const enPeriodo = registrosFiltrados(desde, hasta);

  empleados.forEach(emp => {
    const propios = enPeriodo.filter(r => r.employeeId === emp.id);
    const ganadoPeriodo = round2(propios.reduce((a, r) => a + gananciaBanco(r), 0));
    const gastadoPeriodo = round2(propios.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0));
    const saldoFinal = calcularBancoEmpleado(emp, hasta);
    const diasGozados = propios.filter(r => r.tipo === "a_cuenta_acumulado").length;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(emp.nombre)}</td>
      <td>${formatoHHMM(emp.saldoInicialHoras || 0)}</td>
      <td>${formatoHHMM(ganadoPeriodo)}</td>
      <td>${formatoHHMM(gastadoPeriodo)}</td>
      <td>${formatoHHMM(saldoFinal)}</td>
      <td>${formatoDiasHoras(saldoFinal)}</td>
      <td>${diasGozados}</td>`;
    tbody.appendChild(tr);
  });
}

// ---------------- Render: Horas deducidas ----------------
function renderDeducidas() {
  const tbody = document.querySelector("#tabla-deducidas tbody");
  tbody.innerHTML = "";
  const { desde, hasta } = getRangoFechas();
  registrosFiltrados(desde, hasta)
    .filter(r => (r.horasDeducidasBanco || 0) > 0)
    .forEach(r => {
      const emp = empleados.find(e => e.id === r.employeeId);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(emp ? emp.nombre : r.employeeNombre || "")}</td>
        <td>${r.fecha}</td>
        <td>${formatoHHMM(r.horasDeducidasBanco || 0)}</td>
        <td>${escapeHtml(r.observaciones || "")}</td>`;
      tbody.appendChild(tr);
    });

  const tbodyVac = document.querySelector("#tabla-vacaciones-horas tbody");
  tbodyVac.innerHTML = "";
  registrosFiltrados(desde, hasta)
    .filter(r => (r.horasDeducidasVacaciones || 0) > 0)
    .forEach(r => {
      const emp = empleados.find(e => e.id === r.employeeId);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(emp ? emp.nombre : r.employeeNombre || "")}</td>
        <td>${r.fecha}</td>
        <td>${formatoHHMM(r.horasDeducidasVacaciones || 0)}</td>
        <td>${escapeHtml(r.observaciones || "")}</td>`;
      tbodyVac.appendChild(tr);
    });
}

// ---------------- Exportar a Excel ----------------
document.getElementById("btn-exportar").addEventListener("click", () => {
  const { desde, hasta } = getRangoFechas();
  const enPeriodo = registrosFiltrados(desde, hasta);

  const filasDetalle = enPeriodo.map(r => {
    const emp = empleados.find(e => e.id === r.employeeId);
    return {
      "Fecha": r.fecha,
      "Cargo": emp?.cargo || "",
      "Nombre": emp ? emp.nombre : r.employeeNombre || "",
      "Tipo de día": ETIQUETAS_TIPO[r.tipo] || "Normal",
      "Entrada": r.horaEntrada || "",
      "Salida": r.horaSalida || "",
      "Llegada tarde": formatoHHMM(r.llegadaTardeHoras || 0),
      "Salida temprano": formatoHHMM(r.salidaTempranoHoras || 0),
      "Hrs. acumuladas entrada": formatoHHMM(r.horasAcumuladasEntrada || 0),
      "Hrs. acumuladas salida": formatoHHMM(r.horasAcumuladasSalidas || 0),
      "Hrs. extra pagadas": formatoHHMM(r.horasExtraPagadas || 0),
      "Hrs. deducidas de control de horas": formatoHHMM(r.horasDeducidasBanco || 0),
      "Hrs. deducidas del salario": formatoHHMM(r.horasDeducidasSalario || 0),
      "Hrs. deducidas de vacaciones": formatoHHMM(r.horasDeducidasVacaciones || 0),
      "Total control de horas del día": formatoHHMM(gananciaBanco(r) - (r.horasDeducidasBanco || 0)),
      "Observaciones": r.observaciones || ""
    };
  });

  const filasBanco = empleados.map(emp => {
    const propios = enPeriodo.filter(r => r.employeeId === emp.id);
    const ganadoPeriodo = round2(propios.reduce((a, r) => a + gananciaBanco(r), 0));
    const gastadoPeriodo = round2(propios.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0));
    const saldoFinal = calcularBancoEmpleado(emp, hasta);
    return {
      "Empleado": emp.nombre,
      "Cargo": emp.cargo || "",
      "Saldo inicial": formatoHHMM(emp.saldoInicialHoras || 0),
      "Ganado en periodo": formatoHHMM(ganadoPeriodo),
      "Gastado en periodo": formatoHHMM(gastadoPeriodo),
      "Saldo final": formatoHHMM(saldoFinal),
      "Días disponibles": formatoDiasHoras(saldoFinal),
      "Días gozados en periodo": propios.filter(r => r.tipo === "a_cuenta_acumulado").length
    };
  });

  const filasDeducidas = enPeriodo
    .filter(r => (r.horasDeducidasBanco || 0) > 0)
    .map(r => {
      const emp = empleados.find(e => e.id === r.employeeId);
      return {
        "Empleado": emp ? emp.nombre : r.employeeNombre || "",
        "Fecha": r.fecha,
        "Horas deducidas": formatoHHMM(r.horasDeducidasBanco || 0),
        "Observaciones": r.observaciones || ""
      };
    });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasDetalle), "Detalle");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasBanco), "Control de horas");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasDeducidas), "Horas deducidas");

  const nombreArchivo = `Reporte_Asistencia_${desde || "inicio"}_a_${hasta || "hoy"}.xlsx`;
  XLSX.writeFile(wb, nombreArchivo);
});

// ---------------- Utilidades ----------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
