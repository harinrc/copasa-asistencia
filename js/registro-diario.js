// Registro diario: entrada/salida por empleado, cálculo del banco de horas.
// Esta página solo LEE temporadas/feriados/horario (se configuran en sus
// propias páginas) y ESCRIBE únicamente en la colección "registros".
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoHHMM, parseHHMM, fechaLocalHoy } from "./formato.js";

let currentUser = null;
let isAdmin = false;
let empleados = [];
let registros = [];
let temporadas = [];
let feriados = [];
let horario = { entrada: "08:00", salida: "17:00", entradaSabado: "08:00", salidaSabado: "12:00" };

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
  const snap = await getDoc(doc(db, "users", user.uid));
  isAdmin = snap.exists() && snap.data().role === "admin";
  document.getElementById("user-role").textContent = isAdmin ? "Administrador" : "Empleado";
  iniciarListeners();
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

// ---------------- Listeners en tiempo real ----------------
function iniciarListeners() {
  onSnapshot(query(collection(db, "empleados"), orderBy("nombre")), (snap) => {
    empleados = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.activo !== false);
    renderRegistroDiario();
  });

  onSnapshot(query(collection(db, "registros"), orderBy("fecha", "desc")), (snap) => {
    registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRegistroDiario();
  });

  onSnapshot(query(collection(db, "temporadas"), orderBy("fechaInicio", "desc")), (snap) => {
    temporadas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTemporadaIndicador();
  });

  onSnapshot(query(collection(db, "feriados"), orderBy("fecha", "desc")), (snap) => {
    feriados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    }
  });
}

// ---------------- Helpers de reglas (solo lectura) ----------------
function esFeriado(fecha) {
  return feriados.some(f => f.fecha === fecha);
}
function esTemporada(fecha) {
  return temporadas.some(t => t.activa && fecha >= t.fechaInicio && fecha <= t.fechaFin);
}
function esDiaEspecial(fecha) {
  return esFeriado(fecha) || new Date(`${fecha}T00:00:00`).getDay() === 0;
}

// Horario esperado ese día como {entrada, salida} en "HH:MM", o null si es
// domingo/feriado (ahí no se asume nada por defecto).
function horarioEsperado(fecha) {
  if (esDiaEspecial(fecha)) return null;
  const esSabado = new Date(`${fecha}T00:00:00`).getDay() === 6;
  return esSabado
    ? { entrada: horario.entradaSabado, salida: horario.salidaSabado }
    : { entrada: horario.entrada, salida: horario.salida };
}

// Duración de la jornada esperada ese día en horas (0 si domingo/feriado).
function horasJornadaEsperada(fecha) {
  const h = horarioEsperado(fecha);
  if (!h) return 0;
  return round2(Math.max(0, toMinutos(h.salida) - toMinutos(h.entrada)) / 60);
}

// ---------------- Saldo del banco de horas (para avisar deudas) ----------------
function gananciaBanco(r) { return (r.horasAcumuladasEntrada || 0) + (r.horasAcumuladasSalidas || 0); }

// Saldo del banco de un empleado justo ANTES de una fecha (no incluye ese día),
// para poder avisar si ya debe horas antes de deducirle más.
function saldoBancoAntesDe(empId, fecha) {
  const emp = empleados.find(e => e.id === empId);
  if (!emp) return 0;
  const relevantes = registros.filter(r =>
    r.employeeId === empId &&
    (!emp.saldoInicialFecha || r.fecha >= emp.saldoInicialFecha) &&
    r.fecha < fecha
  );
  const ganado = relevantes.reduce((a, r) => a + gananciaBanco(r), 0);
  const gastado = relevantes.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0);
  return round2((emp.saldoInicialHoras || 0) + ganado - gastado);
}

function mensajeSaldo(saldo) {
  if (saldo < 0) return `⚠️ Este colaborador ya DEBE ${formatoHHMM(Math.abs(saldo))} de horas acumuladas. Si continúas, la deuda aumentará.`;
  return `💰 Control de horas disponible antes de este día: ${formatoHHMM(saldo)}.`;
}

function renderTemporadaIndicador() {
  const fecha = document.getElementById("registro-fecha").value;
  const el = document.getElementById("temporada-indicador");
  if (!fecha || !el) return;
  if (esFeriado(fecha)) {
    el.textContent = "📅 Este día está marcado como feriado.";
  } else if (new Date(`${fecha}T00:00:00`).getDay() === 0) {
    el.textContent = "📅 Este día es domingo.";
  } else if (esTemporada(fecha)) {
    el.textContent = "⚠️ Esta fecha está en temporada: las horas después del horario se pagan como extra (no se acumulan al control de horas).";
  } else {
    el.textContent = "Fuera de temporada: las horas después del horario se acumulan al control de horas.";
  }
}

// ---------------- Navegación de fecha ----------------
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
  input.value = fechaLocalHoy();
  renderRegistroDiario();
  renderTemporadaIndicador();
});

function getFechaRegistro() {
  const input = document.getElementById("registro-fecha");
  if (!input.value) input.value = fechaLocalHoy();
  return input.value;
}

// ---------------- Render ----------------
function renderRegistroDiario() {
  const fecha = getFechaRegistro();
  const tbody = document.querySelector("#tabla-registro-diario tbody");
  tbody.innerHTML = "";
  const horarioHoy = horarioEsperado(fecha);
  empleados.forEach(emp => {
    const regReal = registros.find(r => r.employeeId === emp.id && r.fecha === fecha);
    // Si nadie editó nada y es un día laboral normal, se asume "Normal" con el
    // horario configurado aplicado automáticamente (0 horas de más/de menos).
    const reg = regReal || (horarioHoy ? {
      tipo: "normal", horaEntrada: horarioHoy.entrada, horaSalida: horarioHoy.salida,
      llegadaTardeHoras: 0, salidaTempranoHoras: 0, horasAcumuladasEntrada: 0,
      horasAcumuladasSalidas: 0, horasExtraPagadas: 0, horasDeducidasBanco: 0,
      horasDeducidasSalario: 0, horasDeducidasVacaciones: 0, observaciones: ""
    } : null);
    const esAplicadoPorDefecto = !regReal && !!reg;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(emp.cargo || "")}</td>
      <td>${escapeHtml(emp.nombre)}</td>
      <td>${ETIQUETAS_TIPO[reg?.tipo] || "—"}${esAplicadoPorDefecto ? ` <span class="badge" style="background:#94a3b8;color:#fff;">por defecto</span>` : ""}${reg?.modoDiaEspecial ? ` <span class="badge" style="background:${reg.modoDiaEspecial === "banco" ? "#0ea5e9" : "#f59e0b"};color:#fff;">${reg.modoDiaEspecial === "banco" ? "control" : "salario"}</span>` : ""}${reg?.coberturaTardanza === "vacaciones" ? ` <span class="badge" style="background:#a855f7;color:#fff;">a cta. vacaciones</span>` : ""}${reg?.constanciaMedica ? ` <span class="badge" style="background:var(--primary-dark);color:#fff;">constancia médica</span>` : ""}</td>
      <td>${reg?.horaEntrada || "—"}</td>
      <td>${reg?.horaSalida || "—"}</td>
      <td>${formatoHHMM(reg?.llegadaTardeHoras || 0)}</td>
      <td>${formatoHHMM(reg?.salidaTempranoHoras || 0)}</td>
      <td>${formatoHHMM(reg?.horasAcumuladasEntrada || 0)}</td>
      <td>${formatoHHMM(reg?.horasAcumuladasSalidas || 0)}</td>
      <td>${formatoHHMM(reg?.horasExtraPagadas || 0)}</td>
      <td>${formatoHHMM(reg?.horasDeducidasSalario || 0)}</td>
      <td>${formatoHHMM(reg?.horasDeducidasVacaciones || 0)}</td>
      <td>${formatoHHMM((reg?.horasAcumuladasEntrada || 0) + (reg?.horasAcumuladasSalidas || 0) - (reg?.horasDeducidasBanco || 0))}</td>
      <td>${escapeHtml(reg?.observaciones || "")}</td>
      <td class="admin-only">
        <button class="icon-btn edit" data-action="editar-registro" data-emp="${emp.id}" data-fecha="${fecha}">✏️</button>
        ${regReal ? `<button class="icon-btn delete" data-action="eliminar-registro" data-id="${regReal.id}">🗑️</button>` : ""}
      </td>`;
    tbody.appendChild(tr);
  });
  document.querySelectorAll("#tabla-registro-diario .admin-only").forEach(el => el.style.display = isAdmin ? "" : "none");
  renderTemporadaIndicador();
}

// ---------------- Cálculo del día (banco de horas) ----------------
function toMinutos(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function calcularDia({ horaEntrada, horaSalida, fecha, modoDiaEspecial }) {
  const entrada = toMinutos(horaEntrada);
  const salida = toMinutos(horaSalida);
  if (entrada == null || salida == null) {
    return { llegadaTardeHoras: 0, salidaTempranoHoras: 0, horasAcumuladasEntrada: 0, horasAcumuladasSalidas: 0, horasExtraPagadas: 0 };
  }

  const esDomingo = new Date(`${fecha}T00:00:00`).getDay() === 0;

  // Feriado o domingo trabajado: no hay horario "estándar" ese día. Administración
  // decide si esas horas se pagan como salario (por defecto) o se acumulan al banco.
  if (esFeriado(fecha) || esDomingo) {
    const horasTrabajadas = round2(Math.max(0, salida - entrada) / 60);
    if (modoDiaEspecial === "banco") {
      return { llegadaTardeHoras: 0, salidaTempranoHoras: 0, horasAcumuladasEntrada: 0, horasAcumuladasSalidas: horasTrabajadas, horasExtraPagadas: 0 };
    }
    return { llegadaTardeHoras: 0, salidaTempranoHoras: 0, horasAcumuladasEntrada: 0, horasAcumuladasSalidas: 0, horasExtraPagadas: horasTrabajadas };
  }

  const esSabado = new Date(`${fecha}T00:00:00`).getDay() === 6;
  const entradaEst = toMinutos(esSabado ? horario.entradaSabado : horario.entrada);
  const salidaEst = toMinutos(esSabado ? horario.salidaSabado : horario.salida);

  const llegadaTardeHoras = round2(Math.max(0, entrada - entradaEst) / 60);
  const salidaTempranoHoras = round2(Math.max(0, salidaEst - salida) / 60);
  const horasAcumuladasEntrada = round2(Math.max(0, entradaEst - entrada) / 60);
  const extraSalida = round2(Math.max(0, salida - salidaEst) / 60);
  const enTemporada = esTemporada(fecha);
  return {
    llegadaTardeHoras,
    salidaTempranoHoras,
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

// ---------------- Acciones de la tabla ----------------
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  if (btn.dataset.action === "editar-registro") {
    const emp = empleados.find(x => x.id === btn.dataset.emp);
    const fecha = btn.dataset.fecha;
    const reg = registros.find(r => r.employeeId === emp.id && r.fecha === fecha);
    abrirFormRegistro(emp, fecha, reg);
  }
  if (btn.dataset.action === "eliminar-registro") {
    if (confirm("¿Eliminar este registro del día? Esto NO borra al empleado ni ningún otro dato, solo este día puntual. El control de horas se recalculará al instante.")) {
      await deleteDoc(doc(db, "registros", btn.dataset.id));
    }
  }
});

function abrirFormRegistro(emp, fecha, reg = null) {
  const tipoActual = reg?.tipo || "normal";
  const horarioHoy = horarioEsperado(fecha);
  const entradaPrellenada = reg?.horaEntrada || (!reg && tipoActual === "normal" ? horarioHoy?.entrada || "" : "");
  const salidaPrellenada = reg?.horaSalida || (!reg && tipoActual === "normal" ? horarioHoy?.salida || "" : "");
  const html = `
    <p class="auth-hint" style="text-align:left;margin:0 0 0.5rem;"><strong>${escapeHtml(emp.nombre)}</strong> · ${fecha}</p>
    <div class="modal-body-field">
      <label for="f-tipo">Tipo de día</label>
      <select id="f-tipo">
        <option value="normal" ${tipoActual === "normal" ? "selected" : ""}>Normal (marca entrada/salida)</option>
        <option value="subsidio" ${tipoActual === "subsidio" ? "selected" : ""}>Subsidio (INSS, no descuenta nada)</option>
        <option value="a_cuenta_acumulado" ${tipoActual === "a_cuenta_acumulado" ? "selected" : ""}>A cuenta de acumulado / permiso autorizado</option>
        <option value="falta" ${tipoActual === "falta" ? "selected" : ""}>Falta (sin aviso ni constancia)</option>
        <option value="permiso" ${tipoActual === "permiso" ? "selected" : ""}>Permiso</option>
        <option value="vacaciones" ${tipoActual === "vacaciones" ? "selected" : ""}>Vacaciones</option>
      </select>
    </div>
    <div id="campos-normal" ${(tipoActual !== "normal" && tipoActual !== "subsidio") ? "hidden" : ""}>
      ${campo("f-entrada", "Hora de entrada" , "time", entradaPrellenada)}
      ${campo("f-salida", "Hora de salida (informativo si es subsidio)", "time", salidaPrellenada)}
      ${esDiaEspecial(fecha) ? `
      <div class="modal-body-field">
        <label for="f-modo-especial">Este día es domingo/feriado. ¿Cómo se paga lo trabajado?</label>
        <select id="f-modo-especial">
          <option value="pago" ${(!reg || reg.modoDiaEspecial !== "banco") ? "selected" : ""}>Pago de horas extra (salario)</option>
          <option value="banco" ${reg?.modoDiaEspecial === "banco" ? "selected" : ""}>Horas acumuladas (control de horas)</option>
        </select>
      </div>` : `
      <div class="modal-body-field">
        <label for="f-cobertura">Si llegó tarde o salió temprano, ¿cómo se cubre?</label>
        <select id="f-cobertura">
          <option value="salario" ${(!reg || reg.coberturaTardanza === "salario" || !reg.coberturaTardanza) ? "selected" : ""}>Se descuenta del salario</option>
          <option value="vacaciones" ${reg?.coberturaTardanza === "vacaciones" ? "selected" : ""}>Se descuenta de sus vacaciones</option>
          <option value="constancia" ${reg?.coberturaTardanza === "constancia" ? "selected" : ""}>Constancia médica/clínica (no se descuenta nada)</option>
        </select>
        <p class="auth-hint" style="text-align:left;margin:0.35rem 0 0;">Solo aplica si la hora de entrada/salida quedó fuera del horario. Si coincide con el horario normal, no se descuenta nada de todas formas.</p>
      </div>`}
    </div>
    <div id="campos-acuenta" ${tipoActual !== "a_cuenta_acumulado" ? "hidden" : ""}>
      ${campo("f-horas-deducidas", "Horas a descontar del control de horas HH:MM (día completo = 08:00)", "text", formatoHHMM(reg?.horasDeducidasBanco ?? 8), 'placeholder="08:00" pattern="-?[0-9]+:[0-9]{2}"')}
      <p class="auth-hint" style="text-align:left;margin:0.35rem 0 0;">${mensajeSaldo(saldoBancoAntesDe(emp.id, fecha))}</p>
    </div>
    <div id="campos-falta" ${tipoActual !== "falta" ? "hidden" : ""}>
      ${campo("f-horas-salario", "Horas a deducir del salario HH:MM (día completo por defecto)", "text", formatoHHMM(reg?.horasDeducidasSalario ?? horasJornadaEsperada(fecha)), 'placeholder="08:00" pattern="-?[0-9]+:[0-9]{2}"')}
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
    const coberturaTardanza = document.getElementById("f-cobertura")?.value || "salario";

    let calculo = { llegadaTardeHoras: 0, salidaTempranoHoras: 0, horasAcumuladasEntrada: 0, horasAcumuladasSalidas: 0, horasExtraPagadas: 0 };
    const modoDiaEspecial = document.getElementById("f-modo-especial")?.value || "pago";
    if (tipo === "normal") {
      if (!horaEntrada || !horaSalida) return alert("Debes indicar hora de entrada y salida.");
      calculo = calcularDia({ horaEntrada, horaSalida, fecha, modoDiaEspecial });
    }

    // La llegada tarde/salida temprano se cubre de una sola forma: salario
    // (por defecto), vacaciones, o se exonera con constancia médica.
    const horasTardanza = round2((calculo.llegadaTardeHoras || 0) + (calculo.salidaTempranoHoras || 0));
    let horasDeducidasSalario = 0;
    let horasDeducidasVacaciones = 0;
    if (tipo === "vacaciones") {
      horasDeducidasVacaciones = horasJornadaEsperada(fecha) || 8;
    }
    if (tipo === "normal" && !esDiaEspecial(fecha) && horasTardanza > 0) {
      if (coberturaTardanza === "vacaciones") horasDeducidasVacaciones = horasTardanza;
      else if (coberturaTardanza === "salario") horasDeducidasSalario = horasTardanza;
      // "constancia": ambas quedan en 0, no se descuenta nada
    }
    if (tipo === "falta") {
      horasDeducidasSalario = parseHHMM(document.getElementById("f-horas-salario").value);
    }

    const seGuardaHorario = tipo === "normal" || tipo === "subsidio";
    const data = {
      employeeId: emp.id,
      employeeNombre: emp.nombre,
      fecha,
      tipo,
      horaEntrada: seGuardaHorario ? horaEntrada : "",
      horaSalida: seGuardaHorario ? horaSalida : "",
      modoDiaEspecial: tipo === "normal" && esDiaEspecial(fecha) ? modoDiaEspecial : "",
      coberturaTardanza: tipo === "normal" && !esDiaEspecial(fecha) ? coberturaTardanza : "",
      constanciaMedica: tipo === "normal" && coberturaTardanza === "constancia",
      horasDeducidasBanco,
      horasDeducidasSalario,
      horasDeducidasVacaciones,
      ...calculo,
      observaciones: document.getElementById("f-notas").value.trim(),
      actualizadoEn: serverTimestamp(),
      actualizadoPor: currentUser.email
    };

    // ID determinístico: un solo registro por empleado y fecha (evita duplicados)
    await setDoc(doc(db, "registros", `${emp.id}_${fecha}`), data);
    cerrarModal();
  });

  document.getElementById("f-tipo").addEventListener("change", (e) => {
    const tipo = e.target.value;
    document.getElementById("campos-normal").hidden = tipo !== "normal" && tipo !== "subsidio";
    document.getElementById("campos-acuenta").hidden = tipo !== "a_cuenta_acumulado";
    document.getElementById("campos-falta").hidden = tipo !== "falta";
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
