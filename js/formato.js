// Utilidades de formato de horas compartidas entre app.js y reportes.js

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

// Decimal (ej. 9.5) -> "1 día y 1 hora" (jornada de 8 horas = 1 día). Admite negativos.
export function formatoDiasHoras(decimalHoras, horasPorDia = 8) {
  const horas = Number(decimalHoras) || 0;
  const negativo = horas < 0;
  const totalHoras = Math.round(Math.abs(horas));
  const dias = Math.floor(totalHoras / horasPorDia);
  const horasRestantes = totalHoras % horasPorDia;
  const signo = negativo ? "-" : "";
  return `${signo}${dias} día${dias === 1 ? "" : "s"} y ${horasRestantes} hora${horasRestantes === 1 ? "" : "s"}`;
}
