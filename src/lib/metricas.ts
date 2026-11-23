/**
 * US-F1. Agregaciones del panel DIDESE.
 *
 * Son funciones puras: la página del panel solo trae filas de Supabase y las
 * convierte aquí. Así las bandas, la canasta y la variación se pueden probar
 * sin base de datos y con números conocidos.
 */

export type FilaMetrica = {
  valor: number;
  fecha_registro: string;
  id_producto: number;
  id_comercio?: number;
  categoria: string;
};

export type Resumen = {
  registros: number;
  promedio: number;
  minimo: number;
  maximo: number;
  desviacion: number;
  productos: number;
  comercios: number;
};

export type PorCategoria = {
  categoria: string;
  registros: number;
  promedio: number;
  minimo: number;
  maximo: number;
};

function redondear(valor: number) {
  return Math.round(valor * 100) / 100;
}

export function resumenGeneral(filas: FilaMetrica[]): Resumen {
  if (filas.length === 0) {
    return {
      registros: 0,
      promedio: 0,
      minimo: 0,
      maximo: 0,
      desviacion: 0,
      productos: 0,
      comercios: 0,
    };
  }

  const valores = filas.map((f) => f.valor);
  const promedio = valores.reduce((a, b) => a + b, 0) / valores.length;
  const varianza =
    valores.reduce((a, b) => a + (b - promedio) ** 2, 0) / valores.length;

  return {
    registros: filas.length,
    promedio: redondear(promedio),
    minimo: redondear(Math.min(...valores)),
    maximo: redondear(Math.max(...valores)),
    desviacion: redondear(Math.sqrt(varianza)),
    productos: new Set(filas.map((f) => f.id_producto)).size,
    comercios: 0,
  };
}

export function agregarPorCategoria(filas: FilaMetrica[]): PorCategoria[] {
  const grupos = new Map<string, number[]>();

  for (const fila of filas) {
    const valores = grupos.get(fila.categoria) ?? [];
    valores.push(fila.valor);
    grupos.set(fila.categoria, valores);
  }

  return [...grupos.entries()]
    .map(([categoria, valores]) => ({
      categoria,
      registros: valores.length,
      promedio: redondear(
        valores.reduce((a, b) => a + b, 0) / valores.length,
      ),
      minimo: redondear(Math.min(...valores)),
      maximo: redondear(Math.max(...valores)),
    }))
    .sort((a, b) => b.registros - a.registros || a.categoria.localeCompare(b.categoria));
}

/**
 * Canasta básica comunal: suma del precio mínimo vigente de cada producto en
 * el período. Usa el mínimo porque es el precio que efectivamente estuvo
 * disponible para el vecino, y evita depender de una marca de "canasta" en el
 * catálogo, que hoy no existe.
 */
export function canastaBasica(filas: FilaMetrica[]) {
  const minimos = new Map<number, { valor: number; categoria: string }>();

  for (const fila of filas) {
    const actual = minimos.get(fila.id_producto);
    if (!actual || fila.valor < actual.valor) {
      minimos.set(fila.id_producto, {
        valor: fila.valor,
        categoria: fila.categoria,
      });
    }
  }

  const productos = [...minimos.entries()].map(([id_producto, dato]) => ({
    id_producto,
    ...dato,
  }));

  return {
    productos: productos.length,
    total: redondear(productos.reduce((a, p) => a + p.valor, 0)),
    detalle: productos.sort((a, b) => a.categoria.localeCompare(b.categoria)),
  };
}

/** Fecha ISO en Chile para una fecha UTC dada, sin depender de la zona local. */
export function fechaISOEnChile(fecha: Date) {
  const formato = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partes = Object.fromEntries(
    formato.formatToParts(fecha).map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}`;
}

export function desplazarDias(iso: string, dias: number) {
  const fecha = new Date(`${iso}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Variación de la semana que termina en `hasta` respecto a la inmediatamente
 * anterior. Devuelve null cuando alguna de las dos semanas no tiene datos.
 */
export function variacionSemanal(filas: FilaMetrica[], hasta: string) {
  const inicioActual = desplazarDias(hasta, -6);
  const inicioAnterior = desplazarDias(hasta, -13);

  const promedio = (lista: number[]) =>
    lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : null;

  const actual = promedio(
    filas
      .filter(
        (f) => f.fecha_registro.slice(0, 10) >= inicioActual,
      )
      .map((f) => f.valor),
  );
  const anterior = promedio(
    filas
      .filter((f) => {
        const dia = f.fecha_registro.slice(0, 10);
        return dia >= inicioAnterior && dia < inicioActual;
      })
      .map((f) => f.valor),
  );

  if (actual === null || anterior === null || anterior === 0) return null;

  return redondear(((actual - anterior) / anterior) * 100);
}
