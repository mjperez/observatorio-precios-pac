/**
 * Módulo puro de validación de fechas del calendario gregoriano y reglas
 * de negocio para precios y ofertas comerciales en el Observatorio de Precios PAC.
 *
 * Sin dependencias de Next.js, React ni Supabase para permitir pruebas
 * unitarias deterministas en Vitest.
 */

const REGEX_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const DIAS_POR_MES: readonly number[] = [
  31, // Enero
  28, // Febrero (no bisiesto)
  31, // Marzo
  30, // Abril
  31, // Mayo
  30, // Junio
  31, // Julio
  31, // Agosto
  30, // Septiembre
  31, // Octubre
  30, // Noviembre
  31, // Diciembre
];

export const ANIO_MINIMO_PERMITIDO = 2020;
export const ANIO_MAXIMO_PERMITIDO = 2100;
export const LONGITUD_MAXIMA_CONDICIONES = 300;
export const ZONA_HORARIA_CHILE = "America/Santiago";

export interface FechaGregoriana {
  anio: number;
  mes: number;
  dia: number;
  iso: string;
}

export interface EntradaValidacionOferta {
  valor: number;
  precio_oferta?: number | null;
  fecha_inicio_vigencia?: string | null;
  fecha_fin_vigencia?: string | null;
  condiciones?: string | null;
}

export interface OpcionesValidacionOferta {
  /** Exige fechas de inicio y fin cuando se informa un `precio_oferta`. Por defecto: `true`. */
  requerirFechasVigencia?: boolean;
  /** Rechaza ofertas cuya `fecha_fin_vigencia` ya expiró respecto a `fechaReferencia`. Por defecto: `false`. */
  rechazarOfertaVencida?: boolean;
  /** Fecha de referencia `YYYY-MM-DD` (en horario de Chile si no se indica). */
  fechaReferencia?: string;
}

export interface OfertaNormalizada {
  tiene_oferta: boolean;
  precio_oferta: number | null;
  fecha_inicio_vigencia: string | null;
  fecha_fin_vigencia: string | null;
  condiciones: string | null;
  oferta_activa: boolean;
}

export type CampoErrorOferta =
  | "valor"
  | "precio_oferta"
  | "fecha_inicio_vigencia"
  | "fecha_fin_vigencia"
  | "condiciones";

export interface ErrorValidacionOferta {
  campo: CampoErrorOferta;
  mensaje: string;
}

export type ResultadoValidacionOferta =
  | {
      ok: true;
      datos: OfertaNormalizada;
    }
  | {
      ok: false;
      errores: ErrorValidacionOferta[];
    };

export interface EstadoVigenciaOferta {
  precio_oferta: number | null;
  oferta_activa?: boolean | null;
  fecha_inicio_vigencia: string | null;
  fecha_fin_vigencia: string | null;
}

/**
 * Valida que el monto sea un número finito positivo con máximo 2 decimales,
 * compatible con `numeric(10,2)` en PostgreSQL y `parsearPrecio` en `csv.ts`.
 */
export function esMontoMonetarioValido(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isFinite(valor) &&
    valor > 0 &&
    Math.round(valor * 100) === valor * 100
  );
}

/**
 * Determina si un año es bisiesto según las reglas exactas del calendario gregoriano:
 * divisible por 4, excepto los divisibles por 100, salvo que también sean divisibles por 400.
 */
export function esAnioBisiesto(anio: number): boolean {
  if (!Number.isInteger(anio)) {
    return false;
  }
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/**
 * Retorna la cantidad máxima de días válidos para un mes (1-12) y año dados.
 */
export function diasEnMes(anio: number, mes: number): number {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return 0;
  }
  if (mes === 2 && esAnioBisiesto(anio)) {
    return 29;
  }
  return DIAS_POR_MES[mes - 1];
}

/**
 * Parsea y valida estrictamente una fecha en formato `YYYY-MM-DD` contra el
 * calendario gregoriano real (rechaza `2026-02-29`, `2026-02-30`, `2026-04-31`, etc.).
 */
export function parsearFechaGregoriana(
  valor: unknown,
  rangoAnios: { min?: number; max?: number } = {},
): FechaGregoriana | null {
  if (typeof valor !== "string") {
    return null;
  }

  const limpio = valor.trim();
  const coincidencia = REGEX_FECHA_ISO.exec(limpio);
  if (!coincidencia) {
    return null;
  }

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);

  const minAnio = rangoAnios.min ?? ANIO_MINIMO_PERMITIDO;
  const maxAnio = rangoAnios.max ?? ANIO_MAXIMO_PERMITIDO;

  if (anio < minAnio || anio > maxAnio) {
    return null;
  }

  if (mes < 1 || mes > 12) {
    return null;
  }

  const maxDias = diasEnMes(anio, mes);
  if (dia < 1 || dia > maxDias) {
    return null;
  }

  return {
    anio,
    mes,
    dia,
    iso: limpio,
  };
}

/**
 * Verifica si una cadena corresponde a una fecha `YYYY-MM-DD` real en el calendario gregoriano.
 */
export function esFechaGregorianaValida(
  valor: unknown,
  rangoAnios?: { min?: number; max?: number },
): boolean {
  return parsearFechaGregoriana(valor, rangoAnios) !== null;
}

/**
 * Compara dos fechas válidas en formato `YYYY-MM-DD` sin depender de zonas horarias locales.
 * Retorna `-1` si `fechaA < fechaB`, `0` si son iguales, o `1` si `fechaA > fechaB`.
 */
export function compararFechasISO(fechaA: string, fechaB: string): -1 | 0 | 1 {
  const a = parsearFechaGregoriana(fechaA);
  const b = parsearFechaGregoriana(fechaB);

  if (!a || !b) {
    throw new Error(
      `No se pueden comparar fechas inválidas: "${fechaA}" vs "${fechaB}"`,
    );
  }

  if (a.iso < b.iso) return -1;
  if (a.iso > b.iso) return 1;
  return 0;
}

/**
 * Obtiene la fecha calendario actual (`YYYY-MM-DD`) en la zona horaria oficial
 * de Chile (`America/Santiago`), evitando desfases por servidores en UTC.
 */
export function obtenerFechaHoyChile(ahora: Date = new Date()): string {
  const formateador = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA_CHILE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formateador.format(ahora);
}

/**
 * Sanitiza el texto de condiciones comerciales eliminando caracteres de control
 * y recortando espacios redundantes.
 */
export function normalizarCondicionesOferta(
  condiciones: string | null | undefined,
): string | null {
  if (typeof condiciones !== "string") {
    return null;
  }
  const limpio = condiciones
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return limpio.length > 0 ? limpio : null;
}

function normalizarTextoOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}

/**
 * Valida las reglas de negocio completas de un precio y su posible oferta comercial:
 * - Precio normal positivo con máximo 2 decimales (`numeric(10,2)`).
 * - `precio_oferta` opcional; si existe, debe ser válido y estrictamente `< valor`.
 * - Fechas `fecha_inicio_vigencia` y `fecha_fin_vigencia` válidas en calendario gregoriano.
 * - `fecha_inicio_vigencia <= fecha_fin_vigencia`.
 * - Sin fechas ni condiciones huérfanas si no se declaró `precio_oferta`.
 */
export function validarOferta(
  entrada: EntradaValidacionOferta,
  opciones: OpcionesValidacionOferta = {},
): ResultadoValidacionOferta {
  const {
    requerirFechasVigencia = true,
    rechazarOfertaVencida = false,
    fechaReferencia = obtenerFechaHoyChile(),
  } = opciones;

  const errores: ErrorValidacionOferta[] = [];

  if (!esMontoMonetarioValido(entrada.valor)) {
    errores.push({
      campo: "valor",
      mensaje: "El precio normal debe ser un monto mayor a $0 CLP (máximo 2 decimales).",
    });
  }

  const inicioTexto = normalizarTextoOpcional(entrada.fecha_inicio_vigencia);
  const finTexto = normalizarTextoOpcional(entrada.fecha_fin_vigencia);
  const condicionesLimpias = normalizarCondicionesOferta(entrada.condiciones);
  const tienePrecioOferta =
    entrada.precio_oferta !== null && entrada.precio_oferta !== undefined;

  // Caso 1: Registro sin oferta comercial
  if (!tienePrecioOferta) {
    if (inicioTexto !== null) {
      errores.push({
        campo: "fecha_inicio_vigencia",
        mensaje:
          "No puedes ingresar fecha de inicio de vigencia sin indicar un precio de oferta.",
      });
    }
    if (finTexto !== null) {
      errores.push({
        campo: "fecha_fin_vigencia",
        mensaje:
          "No puedes ingresar fecha de fin de vigencia sin indicar un precio de oferta.",
      });
    }
    if (condicionesLimpias !== null) {
      errores.push({
        campo: "condiciones",
        mensaje:
          "No puedes ingresar condiciones comerciales sin indicar un precio de oferta.",
      });
    }

    if (errores.length > 0) {
      return { ok: false, errores };
    }

    return {
      ok: true,
      datos: {
        tiene_oferta: false,
        precio_oferta: null,
        fecha_inicio_vigencia: null,
        fecha_fin_vigencia: null,
        condiciones: null,
        oferta_activa: false,
      },
    };
  }

  // Caso 2: Registro con precio de oferta
  const precioOferta = entrada.precio_oferta as number;

  if (!esMontoMonetarioValido(precioOferta)) {
    errores.push({
      campo: "precio_oferta",
      mensaje: "El precio de oferta debe ser un monto mayor a $0 CLP (máximo 2 decimales).",
    });
  } else if (esMontoMonetarioValido(entrada.valor) && precioOferta >= entrada.valor) {
    errores.push({
      campo: "precio_oferta",
      mensaje:
        "El precio de oferta debe ser estrictamente menor al precio normal.",
    });
  }

  let inicioValido: FechaGregoriana | null = null;
  let finValido: FechaGregoriana | null = null;

  if (inicioTexto === null) {
    if (requerirFechasVigencia) {
      errores.push({
        campo: "fecha_inicio_vigencia",
        mensaje:
          "La fecha de inicio de vigencia es obligatoria cuando se registra una oferta.",
      });
    }
  } else {
    inicioValido = parsearFechaGregoriana(inicioTexto);
    if (!inicioValido) {
      errores.push({
        campo: "fecha_inicio_vigencia",
        mensaje: `La fecha de inicio "${inicioTexto}" no existe en el calendario gregoriano (formato esperado: YYYY-MM-DD).`,
      });
    }
  }

  if (finTexto === null) {
    if (requerirFechasVigencia) {
      errores.push({
        campo: "fecha_fin_vigencia",
        mensaje:
          "La fecha de fin de vigencia es obligatoria cuando se registra una oferta.",
      });
    }
  } else {
    finValido = parsearFechaGregoriana(finTexto);
    if (!finValido) {
      errores.push({
        campo: "fecha_fin_vigencia",
        mensaje: `La fecha de fin "${finTexto}" no existe en el calendario gregoriano (formato esperado: YYYY-MM-DD).`,
      });
    }
  }

  if (inicioValido && finValido && compararFechasISO(inicioValido.iso, finValido.iso) > 0) {
    errores.push({
      campo: "fecha_fin_vigencia",
      mensaje:
        "La fecha de fin de vigencia no puede ser anterior a la fecha de inicio.",
    });
  }

  const refParseada = parsearFechaGregoriana(fechaReferencia);
  const fechaRefSegura = refParseada ? refParseada.iso : obtenerFechaHoyChile();

  const estaVencida =
    finValido !== null && compararFechasISO(finValido.iso, fechaRefSegura) < 0;

  if (estaVencida && rechazarOfertaVencida) {
    errores.push({
      campo: "fecha_fin_vigencia",
      mensaje: `La oferta ya venció el ${finValido?.iso} (fecha actual: ${fechaRefSegura}).`,
    });
  }

  if (
    condicionesLimpias !== null &&
    condicionesLimpias.length > LONGITUD_MAXIMA_CONDICIONES
  ) {
    errores.push({
      campo: "condiciones",
      mensaje: `Las condiciones comerciales no pueden superar los ${LONGITUD_MAXIMA_CONDICIONES} caracteres.`,
    });
  }

  if (errores.length > 0) {
    return { ok: false, errores };
  }

  return {
    ok: true,
    datos: {
      tiene_oferta: true,
      precio_oferta: precioOferta,
      fecha_inicio_vigencia: inicioValido ? inicioValido.iso : null,
      fecha_fin_vigencia: finValido ? finValido.iso : null,
      condiciones: condicionesLimpias,
      oferta_activa: !estaVencida,
    },
  };
}

/**
 * Evalúa si una oferta está vigente en una fecha dada (`YYYY-MM-DD`),
 * considerando `precio_oferta`, bandera `oferta_activa` y ventana inclusiva
 * `[fecha_inicio_vigencia, fecha_fin_vigencia]`.
 */
export function estaOfertaVigenteEnFecha(
  oferta: EstadoVigenciaOferta,
  fechaReferencia: string = obtenerFechaHoyChile(),
): boolean {
  if (!esMontoMonetarioValido(oferta.precio_oferta)) {
    return false;
  }

  if (oferta.oferta_activa === false) {
    return false;
  }

  const ref = parsearFechaGregoriana(fechaReferencia);
  if (!ref) {
    return false;
  }

  if (oferta.fecha_inicio_vigencia !== null) {
    const inicio = parsearFechaGregoriana(oferta.fecha_inicio_vigencia);
    if (!inicio || compararFechasISO(ref.iso, inicio.iso) < 0) {
      return false;
    }
  }

  if (oferta.fecha_fin_vigencia !== null) {
    const fin = parsearFechaGregoriana(oferta.fecha_fin_vigencia);
    if (!fin || compararFechasISO(ref.iso, fin.iso) > 0) {
      return false;
    }
  }

  return true;
}
