// Generador de Excel con estilo (título centrado, encabezado rojo COPASA,
// bordes, filas alternas, columnas ajustadas, y franjas de color completo
// para días especiales como "SUBSIDIO" o "A CUENTA DE HORAS ACUMULADAS",
// igual que el formato del Excel original). Usa ExcelJS (cargado por CDN en
// cada página) en vez de la librería XLSX simple, que no permite estilos en
// su versión gratuita.

const COLOR_ENCABEZADO = "FFC00000"; // rojo del formato original
const COLOR_FRANJA = "FFF6F6F6";     // gris muy claro para filas pares
const COLOR_BORDE = "FFDDDDDD";
const COLOR_TITULO = "FF8F101F";
const NOMBRE_PLANTILLA = "REPORTE DE ASISTENCIA DEL 27 DE AGOSTO AL 08 DE SEPTIEMBRE 2026.xlsx";

function bordeCompleto() {
  const estilo = { style: "thin", color: { argb: COLOR_BORDE } };
  return { top: estilo, left: estilo, bottom: estilo, right: estilo };
}

function copiarEstiloFila(origen, destino) {
  destino.height = origen.height;
  origen.eachCell({ includeEmpty: true }, (celda, numero) => {
    const nueva = destino.getCell(numero);
    nueva.style = { ...celda.style };
  });
}

function limpiarFila(fila) {
  fila.eachCell({ includeEmpty: true }, (celda) => {
    celda.value = null;
  });
}

function normalizarCuerpoDiario(ws, filaInicial) {
  for (let numero = filaInicial; numero <= ws.rowCount; numero++) {
    const fila = ws.getRow(numero);
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    });
  }
}

function quitarColoresDelCuerpo(ws, filaInicial) {
  if (!ws) return;
  for (let numero = filaInicial; numero <= ws.rowCount; numero++) {
    const fila = ws.getRow(numero);
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    });
  }
}

function clonarHojaPlantilla(wb, origen, nombre) {
  const existente = wb.getWorksheet(nombre);
  if (existente) return existente;
  const ws = wb.addWorksheet(nombre);
  ws.properties = { ...origen.properties, tabColor: origen.properties.tabColor };
  ws.pageSetup = { ...origen.pageSetup };
  ws.pageMargins = { ...origen.pageMargins };
  ws.views = origen.views.map((vista) => ({ ...vista }));
  origen.columns.forEach((columna, indice) => {
    const nueva = ws.getColumn(indice + 1);
    nueva.width = columna.width;
    nueva.hidden = columna.hidden;
    nueva.outlineLevel = columna.outlineLevel;
  });
  origen.eachRow({ includeEmpty: true }, (fila, numero) => {
    const nueva = ws.getRow(numero);
    nueva.height = fila.height;
    fila.eachCell({ includeEmpty: true }, (celda, columna) => {
      const destino = nueva.getCell(columna);
      destino.value = celda.value;
      destino.style = { ...celda.style };
    });
  });
  origen.model.merges.forEach((rango) => ws.mergeCells(rango));
  return ws;
}

function escribirFilaDiaria(ws, datos, numero, plantillaFila) {
  const filaExcel = ws.getRow(numero);
  if (numero > plantillaFila) copiarEstiloFila(ws.getRow(plantillaFila), filaExcel);
  const rangoFusionado = `C${numero}:I${numero}`;
  try { ws.unMergeCells(rangoFusionado); } catch (_) { /* no estaba fusionada */ }
  limpiarFila(filaExcel);
  const valores = [
    datos.Cargo,
    datos.Nombre,
    datos.Entrada,
    datos.Salida,
    datos._especial ? datos._especial.texto : datos["Llegada Tarde"],
    datos._especial ? "" : datos["HORAS ACUMULADAS ENTRADA"],
    datos._especial ? "" : datos["HORAS ACUMULADAS SALIDAS"],
    datos._especial ? "" : datos.Total,
    datos._especial ? datos._especial.texto : datos.Observaciones
  ];
  valores.forEach((valor, columna) => {
    filaExcel.getCell(columna + 1).value = valor ?? "";
  });
  const borde = { style: "thin", color: { argb: "FF000000" } };
  const rellenoNormal = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
  for (let columna = 1; columna <= 9; columna++) {
    const celda = filaExcel.getCell(columna);
    celda.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
    celda.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    celda.border = { top: borde, left: borde, bottom: borde, right: borde };
    celda.fill = rellenoNormal;
  }
  if (datos._especial) {
    ws.mergeCells(rangoFusionado);
    const especial = filaExcel.getCell(3);
    especial.value = datos._especial.texto;
    especial.fill = { type: "pattern", pattern: "solid", fgColor: { argb: datos._especial.color } };
    especial.font = { name: "Arial", size: 10, bold: false, color: { argb: "FF000000" } };
  }
}

async function exportarConPlantilla(hojas, nombreArchivo) {
  const respuesta = await fetch(encodeURI(NOMBRE_PLANTILLA));
  if (!respuesta.ok) throw new Error("No se pudo cargar la plantilla de Excel original.");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await respuesta.arrayBuffer());

  const hojasDiarias = hojas.filter((hoja) => /^\d{2}-\d{2}$/.test(hoja.nombre));
  const machote = wb.getWorksheet("MACHOTE");
  const nombresPermitidos = new Set(["MACHOTE", "Reporte de Ausencias", ...hojas.map((hoja) => hoja.nombre)]);
  wb.worksheets.slice().forEach((ws) => {
    if (!nombresPermitidos.has(ws.name)) wb.removeWorksheet(ws.id);
  });

  hojasDiarias.forEach((hoja) => {
    const ws = wb.getWorksheet(hoja.nombre) || clonarHojaPlantilla(wb, machote, hoja.nombre);
    if (!ws) return;
    const titulo = ws.getCell("D1");
    titulo.value = hoja.titulo || titulo.value;
    const filasExistentes = Math.max(ws.rowCount, 3);
    for (let numero = 3; numero <= filasExistentes; numero++) limpiarFila(ws.getRow(numero));
    normalizarCuerpoDiario(ws, 3);
    hoja.filas.forEach((fila, indice) => escribirFilaDiaria(ws, fila, indice + 3, 3));
    ws.views = [{ state: "frozen", ySplit: 2 }];
  });

  const resumenAcumulado = hojas.find((hoja) => hoja.nombre === "Reporte de Acumulado");
  const resumenDeducido = hojas.find((hoja) => hoja.nombre === "Reporte de horas deducidos");
  escribirResumenPlantilla(wb.getWorksheet("Reporte de Ausencias"), [], 3);
  escribirResumenPlantilla(wb.getWorksheet("Reporte de Acumulado"), resumenAcumulado?.filas || [], 15, "acumulado");
  escribirResumenPlantilla(wb.getWorksheet("Reporte de horas deducidos"), resumenDeducido?.filas || [], 5, "deducido");
  quitarColoresDelCuerpo(wb.getWorksheet("Reporte de Acumulado"), 15);
  quitarColoresDelCuerpo(wb.getWorksheet("Reporte de horas deducidos"), 5);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escribirResumenPlantilla(ws, filas, filaInicial, tipo) {
  if (!ws) return;
  const filaModelo = ws.getRow(filaInicial);
  for (let numero = filaInicial; numero <= ws.rowCount; numero++) limpiarFila(ws.getRow(numero));
  filas.forEach((datos, indice) => {
    const fila = ws.getRow(filaInicial + indice);
    if (indice > 0) copiarEstiloFila(filaModelo, fila);
    let valores;
    if (tipo === "acumulado") {
      const fechas = Object.keys(datos).filter((clave) => /^\d{1,2}-[a-z]{3}$/i.test(clave));
      valores = [
        indice + 1,
        datos.Empleado,
        datos.Cargo,
        datos["Días disponibles"],
        "",
        "",
        datos["Saldo final"] || datos["Ganado en periodo"] || "",
        ...fechas.map((fecha) => datos[fecha])
      ];
    } else {
      const fechas = Object.keys(datos).filter((clave) => /^\d{1,2}-[a-z]{3}$/i.test(clave));
      valores = [indice + 1, datos.Empleado, datos.Cargo, ...fechas.map((fecha) => datos[fecha])];
    }
    valores.forEach((valor, columna) => {
      fila.getCell(columna + 1).value = valor ?? "";
    });
  });
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
  if (hojas.some((hoja) => hoja.usarPlantilla)) {
    await exportarConPlantilla(hojas, nombreArchivo);
    return;
  }

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
    ws.properties.tabColor = { argb: hoja.colorPestana || COLOR_ENCABEZADO };

    ws.columns = columnas.map((c, indice) => ({
      key: c,
      width: hoja.anchos?.[indice] ?? Math.min(Math.max(c.length, ...filas.map((f) => String(f[c] ?? "").length)) + 2, 42)
    }));

    let filaActual = 1;

    if (titulo) {
      const columnaTitulo = hoja.tituloColumna || 1;
      if (!hoja.tituloColumna) ws.mergeCells(1, 1, 1, columnas.length);
      const celdaTitulo = ws.getCell(1, columnaTitulo);
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
