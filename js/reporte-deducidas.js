// Reporte de horas deducidas día por día (pestaña "Reporte de horas deducidos" del Excel).
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoHHMM } from "./formato.js";
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
  onSnapshot(query(collection(db, "empleados"), orderBy("nombre")), (snap) => {
    empleados = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.activo !== false);
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

function celdaDeducida(reg) {
  if (!reg || !(reg.horasDeducidasBanco > 0)) return { texto: "—", clase: "celda-vacia" };
  return { texto: formatoHHMM(reg.horasDeducidasBanco), clase: "celda-deduccion" };
}

function renderGrid() {
  const { desde, hasta } = getRangoFechas();
  if (!desde || !hasta) return;
  const fechas = listarFechas(desde, hasta);

  const tabla = document.getElementById("grid-deducidas");
  const thead = tabla.querySelector("thead tr");
  const tbody = tabla.querySelector("tbody");

  thead.innerHTML = `<th>Empleado</th>${fechas.map(f => `<th>${etiquetaFecha(f)}</th>`).join("")}`;

  tbody.innerHTML = "";
  empleados.forEach(emp => {
    const propios = registros.filter(r => r.employeeId === emp.id);
    const celdas = fechas.map(f => {
      const reg = propios.find(r => r.fecha === f);
      const { texto, clase } = celdaDeducida(reg);
      const titulo = reg?.observaciones ? ` title="${escapeHtml(reg.observaciones)}"` : "";
      return `<td class="${clase}"${titulo}>${texto}</td>`;
    }).join("");

    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(emp.nombre)}</td>${celdas}`;
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
    const fila = { "Empleado": emp.nombre, "Cargo": emp.cargo || "" };
    fechas.forEach(f => {
      const reg = propios.find(r => r.fecha === f);
      fila[etiquetaFecha(f)] = celdaDeducida(reg).texto;
    });
    return fila;
  });

  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generando...";
  try {
    await exportarExcelBonito(
      [{ nombre: "Control de horas - Deducido", filas }],
      `Reporte_Control_Horas_Deducido_${desde}_a_${hasta}.xlsx`
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
