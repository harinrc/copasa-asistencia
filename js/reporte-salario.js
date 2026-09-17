// Reporte "Deducido a cuenta de salario": llegadas tarde/salidas tempranas sin
// constancia médica, y faltas injustificadas. NO afecta el banco de horas.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { formatoHHMM, ordenarEmpleados, coincideBusqueda } from "./formato.js";
import { exportarExcelBonito } from "./excel-export.js";

let empleados = [];
let registros = [];

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
    empleados = ordenarEmpleados(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    render();
  });
  onSnapshot(query(collection(db, "registros"), orderBy("fecha", "desc")), (snap) => {
    registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
}

document.getElementById("fecha-inicio").addEventListener("change", render);
document.getElementById("fecha-fin").addEventListener("change", render);

function getRangoFechas() {
  return {
    desde: document.getElementById("fecha-inicio").value || null,
    hasta: document.getElementById("fecha-fin").value || null
  };
}

function motivo(r) {
  if (r.tipo === "falta") return "Falta injustificada";
  const partes = [];
  if (r.llegadaTardeHoras > 0) partes.push("Llegada tarde");
  if (r.salidaTempranoHoras > 0) partes.push("Salida temprano");
  return partes.join(" + ") || "—";
}

function filasPeriodo() {
  const { desde, hasta } = getRangoFechas();
  return registros
    .filter(r => (r.horasDeducidasSalario || 0) > 0)
    .filter(r => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta));
}

function render() {
  const tbody = document.querySelector("#tabla-salario tbody");
  tbody.innerHTML = "";
  const busqueda = document.getElementById("buscar-salario")?.value || "";
  filasPeriodo().forEach((r, indice) => {
    const emp = empleados.find(e => e.id === r.employeeId);
    const nombre = emp ? emp.nombre : r.employeeNombre || "";
    const cargo = emp?.cargo || "";
    if (!coincideBusqueda(nombre, busqueda) && !coincideBusqueda(cargo, busqueda)) return;
    const textoDeduccion = r.tipo === "falta" ? "1 día" : formatoHHMM(r.horasDeducidasSalario || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${indice + 1}</td>
      <td>${escapeHtml(nombre)}</td>
      <td>${escapeHtml(cargo)}</td>
      <td>${r.fecha}</td>
      <td>${motivo(r)}</td>
      <td>${textoDeduccion}</td>
      <td>${escapeHtml(r.observaciones || "")}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById("buscar-salario").addEventListener("input", render);

document.getElementById("btn-exportar").addEventListener("click", async () => {
  const btn = document.getElementById("btn-exportar");
  const { desde, hasta } = getRangoFechas();
  const filas = filasPeriodo().map((r, indice) => {
    const emp = empleados.find(e => e.id === r.employeeId);
    return {
      "N°": indice + 1,
      "Empleado": emp ? emp.nombre : r.employeeNombre || "",
      "Cargo": emp?.cargo || "",
      "Fecha": r.fecha,
      "Motivo": motivo(r),
      "Horas deducidas": r.tipo === "falta" ? "1 día" : formatoHHMM(r.horasDeducidasSalario || 0),
      "Observaciones": r.observaciones || ""
    };
  });
  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generando...";
  try {
    await exportarExcelBonito(
      [{ nombre: "Deducido a salario", titulo: `DEDUCIDO A CUENTA DE SALARIO DEL ${desde || "inicio"} AL ${hasta || "hoy"}.`, filas }],
      `Deducido_Salario_${desde || "inicio"}_a_${hasta || "hoy"}.xlsx`
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
