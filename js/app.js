// Dashboard: gestión de empleados, resumen del banco de horas y exportación.
// El horario, temporadas, feriados y registro diario viven en sus propias páginas.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  getDocs, onSnapshot, query, orderBy, where, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoHHMM, parseHHMM, formatoDiasHoras, fechaLocalHoy, formatoHora12 } from "./formato.js";
import { exportarExcelBonito } from "./excel-export.js";

let currentUser = null;
let isAdmin = false;
let empleados = [];
let registros = [];
let feriados = [];
let horario = { entrada: "08:00", salida: "17:00", entradaSabado: "08:00", salidaSabado: "12:00" };

const ETIQUETAS_TIPO = {
  normal: "Normal", subsidio: "Subsidio (INSS)", a_cuenta_acumulado: "A cuenta de horas acumuladas",
  falta: "A cuenta de salario", permiso: "Permiso autorizado (clínico, emergencia, familiar u otro)", vacaciones: "Vacaciones"
};

const MESES_LARGOS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function etiquetaFecha(fechaStr) {
  const [, mes, dia] = fechaStr.split("-").map(Number);
  return `${dia}-${MESES_CORTOS[mes - 1]}`;
}

// Color de franja para cada tipo de día especial (igual estilo que el Excel original)
const COLOR_TIPO_ESPECIAL = {
  subsidio: "FF92D050",           // verde claro
  a_cuenta_acumulado: "FF00B0F0", // celeste
  falta: "FFFF0000",               // rojo
  permiso: "FF70AD47",             // verde oscuro
  vacaciones: "FFFFFF00"           // amarillo
};

const COLUMNAS_REGISTRO_DIARIO = [
  "Cargo", "Nombre", "Entrada", "Salida", "Llegada Tarde",
  "HORAS ACUMULADAS ENTRADA", "HORAS ACUMULADAS SALIDAS", "Total", "Observaciones"
];

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

  onSnapshot(query(collection(db, "feriados"), orderBy("fecha", "desc")), (snap) => {
    feriados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

// Horario esperado ese día (null si es domingo/feriado: ahí no se asume nada por defecto)
function horarioEsperado(fecha) {
  const esFeriado = feriados.some(f => f.fecha === fecha);
  const diaSemana = new Date(`${fecha}T00:00:00`).getDay();
  if (esFeriado || diaSemana === 0) return null;
  return diaSemana === 6
    ? { entrada: horario.entradaSabado, salida: horario.salidaSabado }
    : { entrada: horario.entrada, salida: horario.salida };
}

function listarFechas(desde, hasta) {
  const fechas = [];
  let actual = new Date(`${desde}T00:00:00`);
  const fin = new Date(`${hasta}T00:00:00`);
  while (actual <= fin) {
    fechas.push(actual.toISOString().slice(0, 10));
    actual.setDate(actual.getDate() + 1);
  }
  return fechas;
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

async function borrarRegistrosEmpleado(employeeId) {
  const consultas = [
    query(collection(db, "registros"), where("employeeId", "==", employeeId)),
    query(collection(db, "vacaciones"), where("employeeId", "==", employeeId))
  ];
  for (const consulta of consultas) {
    const snap = await getDocs(consulta);
    for (let inicio = 0; inicio < snap.docs.length; inicio += 450) {
      const lote = writeBatch(db);
      snap.docs.slice(inicio, inicio + 450).forEach((registro) => lote.delete(registro.ref));
      await lote.commit();
    }
  }
}

async function limpiarRegistrosHuerfanos() {
  const idsEmpleados = new Set(empleados.map((empleado) => empleado.id));
  const [registrosSnap, vacacionesSnap] = await Promise.all([
    getDocs(collection(db, "registros")),
    getDocs(collection(db, "vacaciones"))
  ]);
  const huerfanos = [
    ...registrosSnap.docs.filter((registro) => !idsEmpleados.has(registro.data().employeeId)),
    ...vacacionesSnap.docs.filter((registro) => !idsEmpleados.has(registro.data().employeeId))
  ];
  if (!huerfanos.length) {
    alert("No se encontraron registros huérfanos.");
    return;
  }
  if (!confirm(`Se encontraron ${huerfanos.length} registros huérfanos. ¿Deseas eliminarlos? Esta acción no se puede deshacer.`)) return;
  for (let inicio = 0; inicio < huerfanos.length; inicio += 450) {
    const lote = writeBatch(db);
    huerfanos.slice(inicio, inicio + 450).forEach((registro) => lote.delete(registro.ref));
    await lote.commit();
  }
  alert(`Se eliminaron ${huerfanos.length} registros huérfanos.`);
}

document.getElementById("btn-limpiar-huerfanos").addEventListener("click", async () => {
  const btn = document.getElementById("btn-limpiar-huerfanos");
  btn.disabled = true;
  try {
    await limpiarRegistrosHuerfanos();
  } catch (error) {
    console.error(error);
    alert("No se pudieron limpiar los registros: " + (error?.message || error));
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "edit-empleado") abrirFormEmpleado(empleados.find(x => x.id === id));
  if (btn.dataset.action === "delete-empleado") {
    const emp = empleados.find(x => x.id === id);
    if (confirm(`¿Eliminar a "${emp?.nombre}"?`)) {
      const borrarHistorial = confirm(
        `¿También deseas borrar todos los registros diarios y vacaciones de "${emp?.nombre}"?\n\n` +
        "Aceptar = borrar ficha e historial.\nCancelar = conservar el historial."
      );
      if (borrarHistorial) await borrarRegistrosEmpleado(id);
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
        <td>${formatoVacaciones(r.horasDeducidasVacaciones || 0)}</td>
        <td>${escapeHtml(r.observaciones || "")}</td>`;
      tbodyVac.appendChild(tr);
    });
}

function formatoVacaciones(horas) {
  return Number(horas) >= 8 ? formatoDiasHoras(horas) : formatoHHMM(horas);
}

// ---------------- Exportar a Excel ----------------
document.getElementById("btn-exportar").addEventListener("click", async () => {
  const btn = document.getElementById("btn-exportar");
  const { desde, hasta } = getRangoFechas();
  if (!desde || !hasta) return alert("Elige la fecha 'Desde' y 'Hasta' del periodo primero.");
  const enPeriodo = registrosFiltrados(desde, hasta);

  // Una pestaña por cada día del periodo (igual que el Excel original: 09-09,
  // 08-09, etc.), con todos los colaboradores activos y el horario aplicado
  // por defecto cuando nadie editó nada ese día.
  const fechasPeriodo = listarFechas(desde, hasta);
  const nombresUsados = new Set();
  const hojasPorDia = fechasPeriodo.map(fecha => {
    const horarioHoy = horarioEsperado(fecha);
    const filas = empleados.filter(e => e.activo !== false).map(emp => {
      const regReal = registros.find(r => r.employeeId === emp.id && r.fecha === fecha);
      const reg = regReal || (horarioHoy ? {
        tipo: "normal", horaEntrada: horarioHoy.entrada, horaSalida: horarioHoy.salida,
        llegadaTardeHoras: 0, salidaTempranoHoras: 0, horasAcumuladasEntrada: 0,
        horasAcumuladasSalidas: 0, horasExtraPagadas: 0, horasDeducidasBanco: 0,
        horasDeducidasSalario: 0, horasDeducidasVacaciones: 0, observaciones: ""
      } : null);

      // Días especiales (Subsidio, A cuenta de acumulado, Falta, Permiso,
      // Vacaciones) se muestran como una franja de color de una sola línea,
      // igual que en el Excel original.
      if (reg && reg.tipo !== "normal" && COLOR_TIPO_ESPECIAL[reg.tipo]) {
        return {
          "Cargo": emp.cargo || "",
          "Nombre": emp.nombre,
          _especial: { texto: ETIQUETAS_TIPO[reg.tipo].toUpperCase(), color: COLOR_TIPO_ESPECIAL[reg.tipo] }
        };
      }

      return {
        "Cargo": emp.cargo || "",
        "Nombre": emp.nombre,
        "Entrada": reg?.horaEntrada ? formatoHora12(reg.horaEntrada) : "—",
        "Salida": reg?.horaSalida ? formatoHora12(reg.horaSalida) : "—",
        "Llegada Tarde": formatoHHMM(reg?.llegadaTardeHoras || 0),
        "HORAS ACUMULADAS ENTRADA": formatoHHMM(reg?.horasAcumuladasEntrada || 0),
        "HORAS ACUMULADAS SALIDAS": formatoHHMM(reg?.horasAcumuladasSalidas || 0),
        "Total": formatoHHMM(gananciaBanco(reg || {}) - (reg?.horasDeducidasBanco || 0)),
        "Observaciones": reg?.observaciones || ""
      };
    });

    // Nombre de pestaña estilo "12-09"; evita duplicados si el periodo cruza años
    const [anio, mes, dia] = fecha.split("-");
    let nombreHoja = `${dia}-${mes}`;
    if (nombresUsados.has(nombreHoja)) nombreHoja = `${dia}-${mes}-${anio}`;
    nombresUsados.add(nombreHoja);

    const titulo = `REPORTE DE ASISTENCIA ${Number(dia)} DE ${MESES_LARGOS[Number(mes) - 1]} DEL ${anio}.`;

    return {
      nombre: nombreHoja,
      titulo,
      tituloColumna: 4,
      anchos: [16.85546875, 43.140625, 20, 19.140625, 19.140625, 21.42578125, 17.5703125, 17.5703125, 26.140625],
      columnas: COLUMNAS_REGISTRO_DIARIO,
      filas
    };
  });

  // Igual que las páginas "Acumuladas"/"Deducidas": una fila por colaborador
  // y una columna por cada día del periodo, mostrando cuánto se ganó o
  // dedujo del control de horas ese día puntual.
  function celdaAcumuladoTexto(reg) {
    if (!reg) return "—";
    switch (reg.tipo) {
      case "subsidio": return "SUB";
      case "falta": return "FALTA";
      case "permiso": return "PERMISO AUTORIZADO";
      case "vacaciones": return "VAC";
      case "a_cuenta_acumulado": return `-${formatoHHMM(reg.horasDeducidasBanco || 0)}`;
      default: {
        const g = gananciaBanco(reg);
        return g > 0 ? formatoHHMM(g) : "00:00";
      }
    }
  }
  function celdaDeducidaTexto(reg) {
    if (!reg || !(reg.horasDeducidasBanco > 0)) return "—";
    return formatoHHMM(reg.horasDeducidasBanco);
  }

  const filasBanco = empleados.map(emp => {
    const propios = enPeriodo.filter(r => r.employeeId === emp.id);
    const ganadoPeriodo = round2(propios.reduce((a, r) => a + gananciaBanco(r), 0));
    const gastadoPeriodo = round2(propios.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0));
    const saldoFinal = calcularBancoEmpleado(emp, hasta);
    const fila = {
      "Empleado": emp.nombre,
      "Cargo": emp.cargo || "",
      "Ganado en periodo": formatoHHMM(ganadoPeriodo),
      "Gastado en periodo": formatoHHMM(gastadoPeriodo),
      "Saldo final": formatoHHMM(saldoFinal),
      "Días disponibles": formatoDiasHoras(saldoFinal),
      "Días gozados en periodo": propios.filter(r => r.tipo === "a_cuenta_acumulado").length || ""
    };
    fechasPeriodo.forEach(f => {
      fila[etiquetaFecha(f)] = celdaAcumuladoTexto(registros.find(r => r.employeeId === emp.id && r.fecha === f));
    });
    return fila;
  });

  const filasDeducidas = empleados.map(emp => {
    const fila = { "Empleado": emp.nombre, "Cargo": emp.cargo || "" };
    fechasPeriodo.forEach(f => {
      fila[etiquetaFecha(f)] = celdaDeducidaTexto(registros.find(r => r.employeeId === emp.id && r.fecha === f));
    });
    return fila;
  });

  const nombreArchivo = `Reporte_Asistencia_${desde || "inicio"}_a_${hasta || "hoy"}.xlsx`;
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generando...";
  try {
    await exportarExcelBonito([
      ...hojasPorDia,
      { nombre: "Reporte de Acumulado", titulo: `REPORTE DE CONTROL DE HORAS DEL ${desde} AL ${hasta}.`, filas: filasBanco, fechas: fechasPeriodo, colorPestana: "FF8F101F" },
      { nombre: "Reporte de horas deducidos", titulo: `REPORTE DE HORAS DEDUCIDAS DEL ${desde} AL ${hasta}.`, filas: filasDeducidas, fechas: fechasPeriodo, colorPestana: "FFB71C1C" }
    ], nombreArchivo);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

// ---------------- Utilidades ----------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
