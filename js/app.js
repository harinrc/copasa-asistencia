// Lógica principal del dashboard: autenticación, banco de horas en tiempo real y exportación
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoHHMM, parseHHMM, formatoDiasHoras } from "./formato.js";

let currentUser = null;
let isAdmin = false;
let empleados = [];   // caché local en tiempo real
let registros = [];   // registros diarios (asistencia + banco de horas)
let temporadas = [];  // rangos de fechas en los que las horas extra se pagan en vez de acumularse
let feriados = [];    // fechas puntuales trabajadas que siempre se pagan como extra
let horario = { entrada: "08:00", salida: "17:00", entradaSabado: "08:00", salidaSabado: "12:00" }; // horario estándar configurable

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
    renderRegistroDiario();
    renderBanco();
  });

  onSnapshot(query(collection(db, "registros"), orderBy("fecha", "desc")), (snap) => {
    registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRegistroDiario();
    renderBanco();
    renderDeducidas();
  });

  onSnapshot(query(collection(db, "temporadas"), orderBy("fechaInicio", "desc")), (snap) => {
    temporadas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTemporadas();
    renderTemporadaIndicador();
  });

  onSnapshot(query(collection(db, "feriados"), orderBy("fecha", "desc")), (snap) => {
    feriados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFeriados();
    renderTemporadaIndicador();
  });

  onSnapshot(doc(db, "config", "horario"), (snap) => {
    if (snap.exists()) {
      horario = {
        entrada: snap.data().entrada || "08:00",
        salida: snap.data().salida || "17:00",
        entradaSabado: snap.data().entradaSabado || "08:00",
        salidaSabado: snap.data().salidaSabado || "12:00"
      };
      document.getElementById("cfg-entrada").value = horario.entrada;
      document.getElementById("cfg-salida").value = horario.salida;
      document.getElementById("cfg-entrada-sabado").value = horario.entradaSabado;
      document.getElementById("cfg-salida-sabado").value = horario.salidaSabado;
    }
    renderTemporadaIndicador();
  });
}

// ---------------- Configuración de horario ----------------
document.getElementById("btn-guardar-config").addEventListener("click", async () => {
  const entrada = document.getElementById("cfg-entrada").value;
  const salida = document.getElementById("cfg-salida").value;
  const entradaSabado = document.getElementById("cfg-entrada-sabado").value;
  const salidaSabado = document.getElementById("cfg-salida-sabado").value;
  await setDoc(doc(db, "config", "horario"), { entrada, salida, entradaSabado, salidaSabado });
});

// ---------------- Feriados ----------------
function esFeriado(fecha) {
  return feriados.some(f => f.fecha === fecha);
}

function renderFeriados() {
  const tbody = document.querySelector("#tabla-feriados tbody");
  tbody.innerHTML = "";
  feriados.forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${f.fecha}</td>
      <td>${escapeHtml(f.nombre || "")}</td>
      <td><button class="icon-btn delete" data-action="delete-feriado" data-id="${f.id}">🗑️</button></td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("btn-nuevo-feriado").addEventListener("click", () => {
  const html = `
    ${campo("f-fecha-feriado", "Fecha", "date", new Date().toISOString().slice(0, 10))}
    ${campo("f-nombre-feriado", "Nombre (ej. Día de la Independencia)", "text", "")}
  `;
  abrirModal("Nuevo feriado", html, async () => {
    const fecha = document.getElementById("f-fecha-feriado").value;
    const nombre = document.getElementById("f-nombre-feriado").value.trim();
    if (!fecha) return alert("La fecha es obligatoria.");
    await addDoc(collection(db, "feriados"), { fecha, nombre });
    cerrarModal();
  });
});

// ---------------- Temporadas ----------------
function esTemporada(fecha) {
  return temporadas.some(t => t.activa && fecha >= t.fechaInicio && fecha <= t.fechaFin);
}

function renderTemporadas() {
  const tbody = document.querySelector("#tabla-temporadas tbody");
  tbody.innerHTML = "";
  temporadas.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(t.nombre)}</td>
      <td>${t.fechaInicio}</td>
      <td>${t.fechaFin}</td>
      <td>${t.activa ? "Sí" : "No"}</td>
      <td>
        <button class="icon-btn edit" data-action="edit-temporada" data-id="${t.id}">✏️</button>
        <button class="icon-btn delete" data-action="delete-temporada" data-id="${t.id}">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderTemporadaIndicador() {
  const fecha = document.getElementById("registro-fecha").value;
  const el = document.getElementById("temporada-indicador");
  if (!fecha || !el) return;
  el.textContent = esTemporada(fecha)
    ? "⚠️ Esta fecha está en temporada: las horas después del horario se pagan como extra (no se acumulan al banco)."
    : "Fuera de temporada: las horas después del horario se acumulan al banco de horas.";
}

document.getElementById("btn-nueva-temporada").addEventListener("click", () => abrirFormTemporada());

function abrirFormTemporada(t = null) {
  const html = `
    ${campo("f-nombre-temp", "Nombre", "text", t?.nombre || "")}
    ${campo("f-inicio-temp", "Desde", "date", t?.fechaInicio || "")}
    ${campo("f-fin-temp", "Hasta", "date", t?.fechaFin || "")}
    <div class="modal-body-field">
      <label><input type="checkbox" id="f-activa-temp" ${!t || t.activa ? "checked" : ""} /> Activa</label>
    </div>
  `;
  abrirModal(t ? "Editar temporada" : "Nueva temporada", html, async () => {
    const data = {
      nombre: document.getElementById("f-nombre-temp").value.trim(),
      fechaInicio: document.getElementById("f-inicio-temp").value,
      fechaFin: document.getElementById("f-fin-temp").value,
      activa: document.getElementById("f-activa-temp").checked
    };
    if (!data.nombre || !data.fechaInicio || !data.fechaFin) return alert("Nombre y fechas son obligatorios.");
    if (t) await updateDoc(doc(db, "temporadas", t.id), data);
    else await addDoc(collection(db, "temporadas"), data);
    cerrarModal();
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

// ---------------- Render: Registro diario ----------------
document.getElementById("registro-fecha").addEventListener("change", () => {
  renderRegistroDiario();
  renderTemporadaIndicador();
});

function sumarDias(fechaStr, dias) {
  const fecha = new Date(`${fechaStr}T00:00:00`);
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

document.getElementById("btn-dia-anterior").addEventListener("click", () => {
  const input = document.getElementById("registro-fecha");
  input.value = sumarDias(getFechaRegistro(), -1);
  renderRegistroDiario();
  renderTemporadaIndicador();
});
document.getElementById("btn-dia-siguiente").addEventListener("click", () => {
  const input = document.getElementById("registro-fecha");
  input.value = sumarDias(getFechaRegistro(), 1);
  renderRegistroDiario();
  renderTemporadaIndicador();
});
document.getElementById("btn-dia-hoy").addEventListener("click", () => {
  const input = document.getElementById("registro-fecha");
  input.value = new Date().toISOString().slice(0, 10);
  renderRegistroDiario();
  renderTemporadaIndicador();
});

function getFechaRegistro() {
  const input = document.getElementById("registro-fecha");
  if (!input.value) input.value = new Date().toISOString().slice(0, 10);
  return input.value;
}

function renderRegistroDiario() {
  const fecha = getFechaRegistro();
  const tbody = document.querySelector("#tabla-registro-diario tbody");
  tbody.innerHTML = "";
  empleados.filter(e => e.activo !== false).forEach(emp => {
    const reg = registros.find(r => r.employeeId === emp.id && r.fecha === fecha);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(emp.cargo || "")}</td>
      <td>${escapeHtml(emp.nombre)}</td>
      <td>${ETIQUETAS_TIPO[reg?.tipo] || "—"}</td>
      <td>${reg?.horaEntrada || "—"}</td>
      <td>${reg?.horaSalida || "—"}</td>
      <td>${formatoHHMM(reg?.llegadaTardeHoras || 0)}</td>
      <td>${formatoHHMM(reg?.horasAcumuladasEntrada || 0)}</td>
      <td>${formatoHHMM(reg?.horasAcumuladasSalidas || 0)}</td>
      <td>${formatoHHMM(reg?.horasExtraPagadas || 0)}</td>
      <td>${formatoHHMM((reg?.horasAcumuladasEntrada || 0) + (reg?.horasAcumuladasSalidas || 0) - (reg?.horasDeducidasBanco || 0))}</td>
      <td>${escapeHtml(reg?.observaciones || "")}</td>
      <td>
        <button class="icon-btn edit" data-action="editar-registro" data-emp="${emp.id}" data-fecha="${fecha}">✏️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  renderTemporadaIndicador();
}

// ---------------- Cálculo del día (banco de horas) ----------------
function toMinutos(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function calcularDia({ horaEntrada, horaSalida, fecha }) {
  const entrada = toMinutos(horaEntrada);
  const salida = toMinutos(horaSalida);
  if (entrada == null || salida == null) {
    return { llegadaTardeHoras: 0, horasAcumuladasEntrada: 0, horasAcumuladasSalidas: 0, horasExtraPagadas: 0 };
  }

  // Feriado trabajado: todas las horas del día se pagan como extra, no hay horario "estándar" ese día
  if (esFeriado(fecha)) {
    const horasTrabajadas = round2(Math.max(0, salida - entrada) / 60);
    return { llegadaTardeHoras: 0, horasAcumuladasEntrada: 0, horasAcumuladasSalidas: 0, horasExtraPagadas: horasTrabajadas };
  }

  const esSabado = new Date(`${fecha}T00:00:00`).getDay() === 6;
  const entradaEst = toMinutos(esSabado ? horario.entradaSabado : horario.entrada);
  const salidaEst = toMinutos(esSabado ? horario.salidaSabado : horario.salida);

  const llegadaTardeHoras = round2(Math.max(0, entrada - entradaEst) / 60);
  const horasAcumuladasEntrada = round2(Math.max(0, entradaEst - entrada) / 60);
  const extraSalida = round2(Math.max(0, salida - salidaEst) / 60);
  const enTemporada = esTemporada(fecha);
  return {
    llegadaTardeHoras,
    horasAcumuladasEntrada,
    horasAcumuladasSalidas: enTemporada ? 0 : extraSalida,
    horasExtraPagadas: enTemporada ? extraSalida : 0
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

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
  const timeoutMs = 10000;
  try {
    await Promise.race([
      onConfirmCallback(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        "Sin respuesta del servidor en 10s. Revisa tu conexión a internet o si un firewall/antivirus está bloqueando firestore.googleapis.com."
      )), timeoutMs))
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
    if (confirm("¿Eliminar este empleado? Esto no borra sus registros históricos.")) {
      await deleteDoc(doc(db, "empleados", id));
    }
  }
  if (btn.dataset.action === "edit-temporada") abrirFormTemporada(temporadas.find(x => x.id === id));
  if (btn.dataset.action === "delete-temporada") {
    if (confirm("¿Eliminar esta temporada?")) await deleteDoc(doc(db, "temporadas", id));
  }
  if (btn.dataset.action === "delete-feriado") {
    if (confirm("¿Eliminar este feriado?")) await deleteDoc(doc(db, "feriados", id));
  }
  if (btn.dataset.action === "editar-registro") {
    const emp = empleados.find(x => x.id === btn.dataset.emp);
    const fecha = btn.dataset.fecha;
    const reg = registros.find(r => r.employeeId === emp.id && r.fecha === fecha);
    abrirFormRegistro(emp, fecha, reg);
  }
});

function abrirFormEmpleado(emp = null) {
  const html = `
    ${campo("f-nombre", "Nombre completo", "text", emp?.nombre || "")}
    ${campo("f-cargo", "Cargo", "text", emp?.cargo || "")}
    ${campo("f-saldo-inicial", "Saldo inicial banco de horas HH:MM (migración del Excel)", "text", formatoHHMM(emp?.saldoInicialHoras ?? 0), 'placeholder="00:00" pattern="-?[0-9]+:[0-9]{2}"')}
    ${campo("f-saldo-fecha", "Fecha del saldo inicial", "date", emp?.saldoInicialFecha || new Date().toISOString().slice(0, 10))}
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

// ---------------- Registro diario: alta/edición ----------------
function abrirFormRegistro(emp, fecha, reg = null) {
  const tipoActual = reg?.tipo || "normal";
  const html = `
    <p class="auth-hint" style="text-align:left;margin:0 0 0.5rem;"><strong>${escapeHtml(emp.nombre)}</strong> · ${fecha}</p>
    <div class="modal-body-field">
      <label for="f-tipo">Tipo de día</label>
      <select id="f-tipo">
        <option value="normal" ${tipoActual === "normal" ? "selected" : ""}>Normal (marca entrada/salida)</option>
        <option value="subsidio" ${tipoActual === "subsidio" ? "selected" : ""}>Subsidio (INSS, no descuenta nada)</option>
        <option value="a_cuenta_acumulado" ${tipoActual === "a_cuenta_acumulado" ? "selected" : ""}>A cuenta de acumulado / permiso autorizado</option>
        <option value="falta" ${tipoActual === "falta" ? "selected" : ""}>Falta</option>
        <option value="permiso" ${tipoActual === "permiso" ? "selected" : ""}>Permiso</option>
        <option value="vacaciones" ${tipoActual === "vacaciones" ? "selected" : ""}>Vacaciones</option>
      </select>
    </div>
    <div id="campos-normal" ${(tipoActual !== "normal" && tipoActual !== "subsidio") ? "hidden" : ""}>
      ${campo("f-entrada", "Hora de entrada" , "time", reg?.horaEntrada || "")}
      ${campo("f-salida", "Hora de salida (informativo si es subsidio)", "time", reg?.horaSalida || "")}
    </div>
    <div id="campos-acuenta" ${tipoActual !== "a_cuenta_acumulado" ? "hidden" : ""}>
      ${campo("f-horas-deducidas", "Horas a descontar del banco HH:MM (día completo = 08:00)", "text", formatoHHMM(reg?.horasDeducidasBanco ?? 8), 'placeholder="08:00" pattern="-?[0-9]+:[0-9]{2}"')}
    </div>
    <div class="modal-body-field">
      <label for="f-notas">Observaciones</label>
      <textarea id="f-notas" rows="2">${escapeHtml(reg?.observaciones || "")}</textarea>
    </div>
  `;

  abrirModal(reg ? "Editar registro diario" : "Nuevo registro diario", html, async () => {
    const tipo = document.getElementById("f-tipo").value;
    const horaEntrada = document.getElementById("f-entrada")?.value || "";
    const horaSalida = document.getElementById("f-salida")?.value || "";
    const horasDeducidasBanco = tipo === "a_cuenta_acumulado"
      ? parseHHMM(document.getElementById("f-horas-deducidas").value)
      : 0;

    let calculo = { llegadaTardeHoras: 0, horasAcumuladasEntrada: 0, horasAcumuladasSalidas: 0, horasExtraPagadas: 0 };
    if (tipo === "normal") {
      if (!horaEntrada || !horaSalida) return alert("Debes indicar hora de entrada y salida.");
      calculo = calcularDia({ horaEntrada, horaSalida, fecha });
    }

    const seGuardaHorario = tipo === "normal" || tipo === "subsidio";
    const data = {
      employeeId: emp.id,
      employeeNombre: emp.nombre,
      fecha,
      tipo,
      horaEntrada: seGuardaHorario ? horaEntrada : "",
      horaSalida: seGuardaHorario ? horaSalida : "",
      horasDeducidasBanco,
      ...calculo,
      observaciones: document.getElementById("f-notas").value.trim(),
      actualizadoEn: serverTimestamp(),
      actualizadoPor: currentUser.email
    };

    // ID determinístico: un solo registro por empleado y fecha
    await setDoc(doc(db, "registros", `${emp.id}_${fecha}`), data);
    cerrarModal();
  });

  // Alternar campos visibles según el tipo de día elegido
  document.getElementById("f-tipo").addEventListener("change", (e) => {
    const tipo = e.target.value;
    document.getElementById("campos-normal").hidden = tipo !== "normal" && tipo !== "subsidio";
    document.getElementById("campos-acuenta").hidden = tipo !== "a_cuenta_acumulado";
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

function gananciaBanco(r) { return (r.horasAcumuladasEntrada || 0) + (r.horasAcumuladasSalidas || 0); }

function calcularBancoEmpleado(emp, hasta) {
  // Saldo acumulado desde la migración (saldoInicialFecha) hasta la fecha "hasta"
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
      "Hrs. acumuladas entrada": formatoHHMM(r.horasAcumuladasEntrada || 0),
      "Hrs. acumuladas salida": formatoHHMM(r.horasAcumuladasSalidas || 0),
      "Hrs. extra pagadas": formatoHHMM(r.horasExtraPagadas || 0),
      "Hrs. deducidas del banco": formatoHHMM(r.horasDeducidasBanco || 0),
      "Total banco del día": formatoHHMM(gananciaBanco(r) - (r.horasDeducidasBanco || 0)),
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
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasBanco), "Banco de horas");
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
