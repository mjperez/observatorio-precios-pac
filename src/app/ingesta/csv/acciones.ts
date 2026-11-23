"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { parseCsv, parsearPrecio } from "@/lib/csv";
import { obtenerFechaHoyChile, validarOferta } from "@/lib/validacion_fechas";

const ROLES_INGESTA = ["comercio", "terreno", "administrador"];
const TAMANO_MAXIMO = 900_000;
const FILAS_MAXIMAS = 500;
const COLUMNAS = ["nombre", "marca", "formato", "precio"];

export type ErrorFila = { linea: number; mensaje: string };

export type ResultadoCarga = {
  ok: boolean;
  insertadas: number;
  errores: ErrorFila[];
  mensaje: string | null;
};

function fallo(mensaje: string): ResultadoCarga {
  return { ok: false, insertadas: 0, errores: [], mensaje };
}

export async function cargarCsv(
  _estado: ResultadoCarga | null,
  formData: FormData,
): Promise<ResultadoCarga> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fallo("La sesión expiró. Vuelve a ingresar.");

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("id_usuario, roles(nombre)")
    .eq("auth_uid", user.id)
    .maybeSingle();

  const rol = perfil?.roles?.nombre;
  if (!perfil || !rol || !ROLES_INGESTA.includes(rol)) {
    return fallo("Tu rol no permite cargar precios.");
  }

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return fallo("Selecciona un archivo CSV.");
  }
  if (archivo.size > TAMANO_MAXIMO) {
    return fallo("El archivo supera 900 KB. Divide la planilla en partes.");
  }

  const idComercio = Number(formData.get("comercio"));
  if (!Number.isInteger(idComercio) || idComercio <= 0) {
    return fallo("Selecciona un comercio.");
  }

  if (rol === "comercio") {
    const { data: vinculo } = await supabase
      .from("usuarios_comercios")
      .select("id_comercio")
      .eq("id_usuario", perfil.id_usuario)
      .eq("id_comercio", idComercio)
      .maybeSingle();

    if (!vinculo) return fallo("Ese comercio no está asociado a tu usuario.");
  }

  const texto = await archivo.text();
  const filas = parseCsv(texto);

  if (filas.length === 0) return fallo("El archivo está vacío.");
  if (filas.length > FILAS_MAXIMAS + 1) {
    return fallo(`La planilla supera ${FILAS_MAXIMAS} filas. Divídela en partes.`);
  }

  const cabecera = filas[0].map((c) => c.trim().toLowerCase());
  const indices = COLUMNAS.map((c) => cabecera.indexOf(c));
  if (indices.some((i) => i === -1)) {
    return fallo(
      "La primera fila debe tener las columnas nombre, marca, formato y precio.",
    );
  }

  const idxOferta = cabecera.indexOf("precio_oferta");
  const idxInicio = cabecera.indexOf("fecha_inicio_vigencia");
  const idxFin = cabecera.indexOf("fecha_fin_vigencia");
  const idxCondiciones = cabecera.indexOf("condiciones");

  const { data: productos, error: errorCatalogo } = await supabase
    .from("productos")
    .select("id_producto, nombre, marca, formato, activo");

  if (errorCatalogo) {
    console.error("[ingesta/csv] Error leyendo catálogo:", errorCatalogo);
    return fallo("No se pudo validar el catálogo de productos. Intenta nuevamente.");
  }

  const clave = (nombre: string, marca: string, formato: string) =>
    `${nombre.trim().toLowerCase()}|${marca.trim().toLowerCase()}|${formato.trim().toLowerCase()}`;

  const catalogo = new Map(
    (productos ?? []).map((p) => [clave(p.nombre, p.marca, p.formato), p]),
  );

  const hoyChile = obtenerFechaHoyChile();
  const errores: ErrorFila[] = [];
  const insertables: {
    id_producto: number;
    id_comercio: number;
    valor: number;
    precio_oferta: number | null;
    fecha_inicio_vigencia: string;
    fecha_fin_vigencia: string | null;
    condiciones: string | null;
    origen: string;
    validado: boolean;
    estado_validacion: string;
  }[] = [];
  const vistos = new Map<number, number>();

  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i];
    const linea = i + 1;

    if (fila.every((c) => c.trim() === "")) continue;

    if (fila.length < COLUMNAS.length) {
      errores.push({ linea, mensaje: "faltan columnas en la fila" });
      continue;
    }

    const nombre = fila[indices[0]];
    const marca = fila[indices[1]];
    const formato = fila[indices[2]];
    const precioBruto = fila[indices[3]];

    const valor = parsearPrecio(precioBruto);
    if (valor === null) {
      errores.push({
        linea,
        mensaje: `precio inválido ("${precioBruto.trim()}"): usa 1290 o 1290,50, sin separador de miles`,
      });
      continue;
    }

    const producto = catalogo.get(clave(nombre, marca, formato));
    if (!producto) {
      errores.push({
        linea,
        mensaje: `el producto "${nombre.trim()}" (${marca.trim()}, ${formato.trim()}) no está en el catálogo`,
      });
      continue;
    }
    if (!producto.activo) {
      errores.push({ linea, mensaje: `el producto "${producto.nombre}" está inactivo` });
      continue;
    }

    const lineaPrevia = vistos.get(producto.id_producto);
    if (lineaPrevia !== undefined) {
      errores.push({
        linea,
        mensaje: `producto repetido: ya aparece en la línea ${lineaPrevia}`,
      });
      continue;
    }
    vistos.set(producto.id_producto, linea);

    const ofertaRaw = idxOferta !== -1 ? (fila[idxOferta] ?? "").trim() : "";
    let precioOferta: number | null = null;
    if (ofertaRaw !== "") {
      precioOferta = parsearPrecio(ofertaRaw);
      if (precioOferta === null) {
        errores.push({
          linea,
          mensaje: `precio_oferta inválido ("${ofertaRaw}"): usa formato numérico sin separador de miles`,
        });
        continue;
      }
    }

    const inicioRaw = idxInicio !== -1 ? (fila[idxInicio] ?? "").trim() || null : null;
    const finRaw = idxFin !== -1 ? (fila[idxFin] ?? "").trim() || null : null;
    const condRaw = idxCondiciones !== -1 ? (fila[idxCondiciones] ?? "").trim() || null : null;

    // Si hay oferta en CSV y no se especificó inicio, asume la fecha actual en Chile
    const inicioEfectivo =
      precioOferta !== null && inicioRaw === null ? hoyChile : inicioRaw;

    const validacion = validarOferta(
      {
        valor,
        precio_oferta: precioOferta,
        fecha_inicio_vigencia: inicioEfectivo,
        fecha_fin_vigencia: finRaw,
        condiciones: condRaw,
      },
      {
        requerirFechasVigencia: true,
        rechazarOfertaVencida: true,
        fechaReferencia: hoyChile,
      },
    );

    if (!validacion.ok) {
      for (const err of validacion.errores) {
        errores.push({ linea, mensaje: err.mensaje });
      }
      continue;
    }

    insertables.push({
      id_producto: producto.id_producto,
      id_comercio: idComercio,
      valor,
      precio_oferta: validacion.datos.precio_oferta,
      fecha_inicio_vigencia: validacion.datos.fecha_inicio_vigencia ?? hoyChile,
      fecha_fin_vigencia: validacion.datos.fecha_fin_vigencia,
      condiciones: validacion.datos.condiciones,
      origen: "csv",
      validado: false,
      estado_validacion: "pendiente",
    });
  }

  if (errores.length > 0) {
    return {
      ok: false,
      insertadas: 0,
      errores,
      mensaje: "No se cargó nada: corrige las filas indicadas y vuelve a subir la planilla.",
    };
  }

  if (insertables.length === 0) {
    return fallo("La planilla no tiene filas con datos.");
  }

  const { error: errorInsercion } = await supabase.from("precios").insert(insertables);

  if (errorInsercion) {
    console.error("[ingesta/csv] Error insertando precios:", errorInsercion);
    return fallo("No se pudieron registrar los precios. Verifica tus permisos o intenta más tarde.");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/validacion");
  revalidatePath("/ingesta/csv");

  return {
    ok: true,
    insertadas: insertables.length,
    errores: [],
    mensaje: `Se cargaron ${insertables.length} precios en estado pendiente de validación.`,
  };
}
