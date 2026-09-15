// Reporte de horas acumuladas día por día (pestaña "Reporte de Acumulado" del Excel).
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoHHMM, formatoDiasHoras, ordenarEmpleados } from "./formato.js";
import { exportarExcelBonito } from "./excel-export.js";

let empleados = [];
let registros = [];

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  document.getElementById("user-email").textContent = user.email;
  iniciarListeners();
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

function iniciarListeners() {
  onSnapshot(collection(db, "empleados"), (snap) => {
    empleados = ordenarEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.activo !== false));
    renderGrid();
  });
  onSnapshot(query(collection(db, "registros"), orderBy("fecha", "desc")), (snap) => {
    registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGrid();
  });
}

document.getElementById("fecha-inicio").addEventListener("change", renderGrid);
document.getElementById("fecha-fin").addEventListener("change", renderGrid);

function getRangoFechas() {
  return {
    desde: document.getElementById("fecha-inicio").value || null,
    hasta: document.getElementById("fecha-fin").value || null
  };
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

function etiquetaFecha(fechaStr) {
  const [, mes, dia] = fechaStr.split("-").map(Number);
  return `${dia}-${MESES_CORTOS[mes - 1]}`;
}

function round2(n) { return Math.round(n * 100) / 100; }
function gananciaBanco(r) { return (r.horasAcumuladasEntrada || 0) + (r.horasAcumuladasSalidas || 0); }

function celdaAcumulado(reg) {
  if (!reg) return { texto: "—", clase: "celda-vacia" };
  switch (reg.tipo) {
    case "subsidio": return { texto: "SUB", clase: "celda-especial" };
    case "falta": return { texto: "FALTA", clase: "celda-especial" };
    case "permiso": return { texto: "PERMISO AUTORIZADO", clase: "celda-especial" };
    case "vacaciones": return { texto: "VAC", clase: "celda-especial" };
    case "a_cuenta_acumulado": return { texto: `-${formatoHHMM(reg.horasDeducidasBanco || 0)}`, clase: "celda-deduccion" };
    default: {
      const g = gananciaBanco(reg);
      return g > 0 ? { texto: formatoHHMM(g), clase: "celda-normal" } : { texto: "00:00", clase: "celda-vacia" };
    }
  }
}

function calcularBancoEmpleado(emp, hasta) {
  const relevantes = registros.filter(r =>
    r.employeeId === emp.id &&
    (!emp.saldoInicialFecha || r.fecha >= emp.saldoInicialFecha) &&
    (!hasta || r.fecha <= hasta)
  );
  const ganado = relevantes.reduce((a, r) => a + gananciaBanco(r), 0);
  const gastado = relevantes.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0);
  return round2((emp.saldoInicialHoras || 0) + ganado - gastado);
}

function renderGrid() {
  const { desde, hasta } = getRangoFechas();
  if (!desde || !hasta) return;
  const fechas = listarFechas(desde, hasta);

  const tabla = document.getElementById("grid-acumulado");
  const thead = tabla.querySelector("thead tr");
  const tbody = tabla.querySelector("tbody");
  const columnasResumen = ["Saldo inicial", "Ganado periodo", "Gastado periodo", "Saldo final", "Días disp."];

  thead.innerHTML = `<th>Empleado</th>${columnasResumen.map(c => `<th>${c}</th>`).join("")}${fechas.map(f => `<th>${etiquetaFecha(f)}</th>`).join("")}`;

  tbody.innerHTML = "";
  empleados.forEach(emp => {
    const propios = registros.filter(r => r.employeeId === emp.id);
    const enPeriodo = propios.filter(r => r.fecha >= fechas[0] && r.fecha <= fechas[fechas.length - 1]);
    const ganadoPeriodo = round2(enPeriodo.reduce((a, r) => a + gananciaBanco(r), 0));
    const gastadoPeriodo = round2(enPeriodo.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0));
    const saldoFinal = calcularBancoEmpleado(emp, fechas[fechas.length - 1]);
    const resumenHtml = `
      <td class="resumen">${formatoHHMM(emp.saldoInicialHoras || 0)}</td>
      <td class="resumen">${formatoHHMM(ganadoPeriodo)}</td>
      <td class="resumen">${formatoHHMM(gastadoPeriodo)}</td>
      <td class="resumen">${formatoHHMM(saldoFinal)}</td>
      <td class="resumen">${formatoDiasHoras(saldoFinal)}</td>`;

    const celdas = fechas.map(f => {
      const reg = propios.find(r => r.fecha === f);
      const { texto, clase } = celdaAcumulado(reg);
      return `<td class="${clase}">${texto}</td>`;
    }).join("");

    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(emp.nombre)}</td>${resumenHtml}${celdas}`;
    tbody.appendChild(tr);
  });
}

// ---------------- Exportar a Excel ----------------
document.getElementById("btn-exportar").addEventListener("click", async () => {
  const btn = document.getElementById("btn-exportar");
  const { desde, hasta } = getRangoFechas();
  if (!desde || !hasta) return alert("Elige un rango de fechas primero.");
  const fechas = listarFechas(desde, hasta);

  const filas = empleados.map(emp => {
    const propios = registros.filter(r => r.employeeId === emp.id);
    const enPeriodo = propios.filter(r => r.fecha >= desde && r.fecha <= hasta);
    const saldoFinal = calcularBancoEmpleado(emp, hasta);
    const fila = {
      "Empleado": emp.nombre,
      "Cargo": emp.cargo || "",
      "Saldo inicial": formatoHHMM(emp.saldoInicialHoras || 0),
      "Ganado periodo": formatoHHMM(round2(enPeriodo.reduce((a, r) => a + gananciaBanco(r), 0))),
      "Gastado periodo": formatoHHMM(round2(enPeriodo.reduce((a, r) => a + (r.horasDeducidasBanco || 0), 0))),
      "Saldo final": formatoHHMM(saldoFinal),
      "Días disponibles": formatoDiasHoras(saldoFinal)
    };
    fechas.forEach(f => {
      const reg = propios.find(r => r.fecha === f);
      fila[etiquetaFecha(f)] = celdaAcumulado(reg).texto;
    });
    return fila;
  });

  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generando...";
  try {
    await exportarExcelBonito(
      [{ nombre: "Control de horas - Acumulado", titulo: `REPORTE DE HORAS ACUMULADAS DEL ${desde} AL ${hasta}.`, filas }],
      `Reporte_Control_Horas_Acumulado_${desde}_a_${hasta}.xlsx`
    );
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
