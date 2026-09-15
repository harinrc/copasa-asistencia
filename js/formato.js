// Utilidades de formato de horas compartidas entre app.js y reportes.js

// Fecha de HOY en zona horaria LOCAL como "YYYY-MM-DD".
// OJO: nunca usar new Date().toISOString().slice(0,10) para "hoy": eso usa
// UTC y en zonas horarias negativas (ej. Nicaragua UTC-6) muestra el día
// siguiente después de cierta hora de la tarde.
export function fechaLocalHoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Decimal (ej. 1.33) -> "HH:MM" (ej. "01:20"). Admite negativos ("-01:20").
export function formatoHHMM(decimalHoras) {
  const horas = Number(decimalHoras) || 0;
  const negativo = horas < 0;
  const totalMin = Math.round(Math.abs(horas) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${negativo ? "-" : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "HH:MM" (ej. "01:20") -> decimal (ej. 1.33). Admite negativos ("-01:20").
export function parseHHMM(texto) {
  if (!texto) return 0;
  const negativo = texto.trim().startsWith("-");
  const limpio = texto.replace("-", "").trim();
  const [h, m] = limpio.split(":").map(Number);
  const decimal = (h || 0) + (m || 0) / 60;
  return negativo ? -decimal : decimal;
}

// "HH:MM" 24h (ej. "17:00") -> "hh:mm AM/PM" (ej. "05:00 PM"). Para mostrar
// horas de entrada/salida de forma más legible (ej. en el Excel exportado).
export function formatoHora12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const periodo = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${periodo}`;
}

// Decimal (ej. 9.5) -> "1 día y 1 hora" (jornada de 8 horas = 1 día). Admite negativos.
export function formatoDiasHoras(decimalHoras, horasPorDia = 8) {
  const horas = Number(decimalHoras) || 0;
  const negativo = horas < 0;
  const totalHoras = Math.floor(Math.abs(horas));
  const dias = Math.floor(totalHoras / horasPorDia);
  const horasRestantes = totalHoras % horasPorDia;
  const signo = negativo ? "-" : "";
  return `${signo}${dias} día${dias === 1 ? "" : "s"} y ${horasRestantes} hora${horasRestantes === 1 ? "" : "s"}`;
}

export function ordenarEmpleados(empleados) {
  const categoria = (cargo) => {
    const texto = String(cargo || "").toLowerCase();
    if (texto.includes("supervisor")) return 0;
    if (texto.includes("admin") && texto.includes("bodega")) return 1;
    if (texto.includes("conductor")) return 2;
    if (texto.includes("ayudante")) return 3;
    return 4;
  };
  const antiguedad = (empleado) => {
    const creado = empleado.creadoEn;
    if (creado?.toMillis) return creado.toMillis();
    if (creado instanceof Date) return creado.getTime();
    return Number.MAX_SAFE_INTEGER;
  };
  return [...empleados].sort((a, b) =>
    categoria(a.cargo) - categoria(b.cargo) ||
    antiguedad(a) - antiguedad(b) ||
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
  );
}
