/**
 * Contrato del lector de boletas (US-C3). Toda la validación del JSON que
 * devuelve el modelo multimodal se hace aquí, antes de escribir en Supabase.
 */

export type ItemOCR = {
  nombre: string;
  precio: number;
  cantidad: number | null;
};

export type BoletaOCR = {
  comercio: string | null;
  fecha: string | null;
  items: ItemOCR[];
};

export type ValidacionOCR =
  | { ok: true; datos: BoletaOCR }
  | { ok: false; error: string };

export const PROMPT_OCR = [
  "Extrae los datos de esta boleta de compra chilena.",
  "Responde únicamente con JSON válido, sin texto adicional ni bloques de código.",
  'Usa la forma {"comercio": string|null, "fecha": "YYYY-MM-DD"|null,',
  '"items": [{"nombre": string, "precio": number, "cantidad": number|null}]}.',
  "Recorre la boleta línea por línea de arriba abajo y no omitas ningún artículo legible:",
  "la cantidad de items debe acercarse al número de artículos que declara la boleta.",
  "La cantidad es el número que abre la línea, antes de la descripción.",
  "Si el nombre del producto contiene números, no los confundas con la cantidad.",
  "El precio es el monto final de cada línea en pesos chilenos, sin puntos ni coma.",
  "La fecha impresa viene como DD/MM/AAAA. Conviértela a AAAA-MM-DD sin intercambiar",
  "el día y el mes: si dice 20/06/2026, la respuesta es 2026-06-20.",
  "El comercio es el nombre del local seguido de su dirección, tal como están impresos.",
  "Si un dato no es legible, usa null. No inventes productos ni valores.",
].join(" ");

export function normalizarNombreOCR(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|l|lt|cc|un|u)\b/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Acepta 1290, 1290,50, 1.290 y 1.290,50; rechaza formatos ambiguos. */
export function parsearMontoOCR(valor: string | number): number | null {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) / 100 : null;
  }
  const texto = valor.trim();
  if (!texto) return null;

  const conDecimal = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(texto);
  if (conDecimal) {
    return Number(`${conDecimal[1].replace(/\./g, "")}.${conDecimal[2]}`);
  }
  const conMiles = /^\d{1,3}(?:\.\d{3})+$/.test(texto);
  if (conMiles) return Number(texto.replace(/\./g, ""));
  if (/^\d+(?:[.,]\d{1,2})?$/.test(texto)) return Number(texto.replace(",", "."));
  return null;
}

/** El modelo suele envolver el JSON en cercas de código o añadir saludos. */
export function extraerJson(texto: string): unknown | null {
  const limpio = texto
    .replace(/^```(?:json)?/im, "")
    .replace(/```$/im, "")
    .trim();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio === -1 || fin <= inicio) return null;
  try {
    return JSON.parse(limpio.slice(inicio, fin + 1)) as unknown;
  } catch {
    return null;
  }
}

function esRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validarBoletaOCR(valor: unknown): ValidacionOCR {
  if (!esRegistro(valor)) return { ok: false, error: "El modelo no devolvió un objeto JSON." };
  if (!Array.isArray(valor.items) || valor.items.length === 0) {
    return { ok: false, error: "El modelo no detectó ítems en la boleta." };
  }
  if (valor.items.length > 60) {
    return { ok: false, error: "La boleta tiene demasiados ítems para revisar en pantalla." };
  }

  const items: ItemOCR[] = [];
  for (let i = 0; i < valor.items.length; i++) {
    const fila = valor.items[i];
    if (!esRegistro(fila)) {
      return { ok: false, error: `El ítem ${i + 1} no tiene un formato válido.` };
    }
    const nombre = typeof fila.nombre === "string" ? fila.nombre.trim() : "";
    if (nombre.length < 2 || nombre.length > 120) {
      return { ok: false, error: `El ítem ${i + 1} no tiene un nombre legible.` };
    }
    const precio = parsearMontoOCR(fila.precio as string | number);
    if (precio === null || precio <= 0) {
      return { ok: false, error: `El ítem ${i + 1} tiene un precio inválido.` };
    }
    const cantidad =
      fila.cantidad === null || fila.cantidad === undefined
        ? null
        : Number(fila.cantidad);
    items.push({
      nombre,
      precio,
      cantidad:
        cantidad !== null && Number.isFinite(cantidad) && cantidad > 0
          ? Math.round(cantidad)
          : null,
    });
  }

  const fecha = typeof valor.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor.fecha)
    ? valor.fecha
    : null;
  const comercio =
    typeof valor.comercio === "string" && valor.comercio.trim().length > 0
      ? valor.comercio.trim().slice(0, 120)
      : null;

  return { ok: true, datos: { comercio, fecha, items } };
}

/** Coincidencia simple por tokens entre el nombre de la boleta y el catálogo. */
export function coincideProducto(
  nombreOCR: string,
  nombreCatalogo: string,
  marcaCatalogo: string,
): boolean {
  const tokensOCR = new Set(
    normalizarNombreOCR(nombreOCR)
      .split(" ")
      .filter((t) => t.length >= 4),
  );
  if (tokensOCR.size === 0) return false;
  const textoCatalogo = normalizarNombreOCR(`${nombreCatalogo} ${marcaCatalogo}`);
  let aciertos = 0;
  for (const token of tokensOCR) {
    if (textoCatalogo.includes(token)) aciertos++;
  }
  return aciertos / tokensOCR.size >= 0.6;
}
