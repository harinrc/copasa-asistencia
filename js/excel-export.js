// Generador de Excel con estilo (título centrado, encabezado rojo COPASA,
// bordes, filas alternas, columnas ajustadas, y franjas de color completo
// para días especiales como "SUBSIDIO" o "A CUENTA DE HORAS ACUMULADAS",
// igual que el formato del Excel original). Usa ExcelJS (cargado por CDN en
// cada página) en vez de la librería XLSX simple, que no permite estilos en
// su versión gratuita.

const COLOR_ENCABEZADO = "FFD62839"; // rojo COPASA
const COLOR_FRANJA = "FFF6F6F6";     // gris muy claro para filas pares
const COLOR_BORDE = "FFDDDDDD";
const COLOR_TITULO = "FF8F101F";

function bordeCompleto() {
  const estilo = { style: "thin", color: { argb: COLOR_BORDE } };
  return { top: estilo, left: estilo, bottom: estilo, right: estilo };
}

// hojas: [{
//   nombre: "12-09",                 // nombre de la pestaña
//   titulo: "REPORTE DE ... 2026.",  // opcional: título centrado arriba (fusiona todas las columnas)
//   columnas: ["Cargo", "Nombre"...] // opcional: orden fijo de columnas (si no, se infiere de la primera fila normal)
//   especialDesde: 2,                // opcional: desde qué columna (0-based) se fusiona la franja especial
//   filas: [
//     { "Cargo": "...", "Nombre": "...", ... },                                   // fila normal
//     { "Cargo": "...", "Nombre": "...", _especial: { texto: "SUBSIDIO", color: "FF8BC34A" } } // fila especial
//   ]
// }, ...]
export async function exportarExcelBonito(hojas, nombreArchivo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "COPASA";
  wb.created = new Date();

  hojas.forEach((hoja) => {
    const { nombre, titulo } = hoja;
    const filas = hoja.filas && hoja.filas.length ? hoja.filas : [{ "Sin datos": "Sin registros en este periodo" }];
    const filaModelo = filas.find((f) => !f._especial) || filas[0];
    const columnas = hoja.columnas || Object.keys(filaModelo).filter((k) => k !== "_especial");
    const especialDesde = hoja.especialDesde ?? 2;

    const ws = wb.addWorksheet(nombre.slice(0, 31), {
      views: [{ state: "frozen", ySplit: titulo ? 2 : 1 }]
    });

    ws.columns = columnas.map((c) => ({
      key: c,
      width: Math.min(Math.max(c.length, ...filas.map((f) => String(f[c] ?? "").length)) + 3, 42)
    }));

    let filaActual = 1;

    if (titulo) {
      ws.mergeCells(1, 1, 1, columnas.length);
      const celdaTitulo = ws.getCell(1, 1);
      celdaTitulo.value = titulo;
      celdaTitulo.font = { bold: true, size: 13, color: { argb: COLOR_TITULO } };
      celdaTitulo.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 26;
      filaActual = 2;
    }

    // Encabezado
    const filaEncabezado = ws.getRow(filaActual);
    columnas.forEach((c, i) => {
      const cell = filaEncabezado.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_ENCABEZADO } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = bordeCompleto();
    });
    filaEncabezado.height = 24;
    filaActual++;

    filas.forEach((fila, indiceDatos) => {
      const filaExcel = ws.getRow(filaActual);

      if (fila._especial) {
        columnas.forEach((c, i) => {
          const cell = filaExcel.getCell(i + 1);
          cell.value = i < especialDesde ? (fila[c] ?? "") : "";
          cell.border = bordeCompleto();
          cell.alignment = { vertical: "middle", horizontal: "center" };
        });
        if (columnas.length > especialDesde) {
          ws.mergeCells(filaActual, especialDesde + 1, filaActual, columnas.length);
          const celdaEspecial = filaExcel.getCell(especialDesde + 1);
          celdaEspecial.value = fila._especial.texto;
          celdaEspecial.font = { bold: true, color: { argb: "FFFFFFFF" } };
          celdaEspecial.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fila._especial.color } };
          celdaEspecial.alignment = { vertical: "middle", horizontal: "center" };
          celdaEspecial.border = bordeCompleto();
        }
      } else {
        columnas.forEach((c, i) => {
          const cell = filaExcel.getCell(i + 1);
          cell.value = fila[c] ?? "";
          cell.border = bordeCompleto();
          cell.alignment = { vertical: "middle", horizontal: "center" };
          if (indiceDatos % 2 === 1) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_FRANJA } };
          }
        });
      }
      filaActual++;
    });
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
