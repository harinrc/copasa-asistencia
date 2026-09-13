// Generador de Excel con estilo (encabezado rojo COPASA, bordes, filas
// alternas y columnas ajustadas al contenido). Usa ExcelJS (cargado por CDN
// en cada página) en vez de la librería XLSX simple, que no permite estilos
// en su versión gratuita.

const COLOR_ENCABEZADO = "FFD62839"; // rojo COPASA
const COLOR_FRANJA = "FFF6F6F6";     // gris muy claro para filas pares
const COLOR_BORDE = "FFDDDDDD";

function bordeCompleto() {
  const estilo = { style: "thin", color: { argb: COLOR_BORDE } };
  return { top: estilo, left: estilo, bottom: estilo, right: estilo };
}

// hojas: [{ nombre: "Detalle", filas: [{ "Columna A": valor, ... }, ...] }, ...]
export async function exportarExcelBonito(hojas, nombreArchivo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "COPASA";
  wb.created = new Date();

  hojas.forEach(({ nombre, filas }) => {
    const datos = filas && filas.length ? filas : [{ "Sin datos": "No hay registros en este periodo" }];
    const columnas = Object.keys(datos[0]);
    const ws = wb.addWorksheet(nombre.slice(0, 31), {
      views: [{ state: "frozen", ySplit: 1 }]
    });

    ws.columns = columnas.map((c) => ({
      header: c,
      key: c,
      width: Math.min(Math.max(c.length, ...datos.map((f) => String(f[c] ?? "").length)) + 3, 42)
    }));

    datos.forEach((fila) => ws.addRow(fila));

    // Encabezado: fondo rojo, texto blanco, centrado
    ws.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_ENCABEZADO } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = bordeCompleto();
    });
    ws.getRow(1).height = 22;

    // Filas de datos: bordes + franjas alternas
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = bordeCompleto();
        cell.alignment = { vertical: "middle" };
        if (i % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_FRANJA } };
        }
      });
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
