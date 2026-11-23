"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { parsearPrecio } from "@/lib/csv";
import { obtenerFechaHoyChile, validarOferta } from "@/lib/validacion_fechas";

const ROLES_INGESTA = ["comercio", "terreno", "administrador"];

export type ResultadoManual = {
  ok: boolean;
  mensaje: string | null;
};

export async function registrarPrecioManual(
  _estado: ResultadoManual | null,
  formData: FormData,
): Promise<ResultadoManual> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, mensaje: "La sesión expiró. Vuelve a ingresar." };

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("id_usuario, roles(nombre)")
    .eq("auth_uid", user.id)
    .maybeSingle();

  const rol = perfil?.roles?.nombre;
  if (!perfil || !rol || !ROLES_INGESTA.includes(rol)) {
    return { ok: false, mensaje: "Tu rol no tiene permisos para registrar precios." };
  }

  const idComercio = Number(formData.get("comercio"));
  const idProducto = Number(formData.get("producto"));
  if (!Number.isInteger(idComercio) || idComercio <= 0) {
    return { ok: false, mensaje: "Selecciona un comercio válido." };
  }
  if (!Number.isInteger(idProducto) || idProducto <= 0) {
    return { ok: false, mensaje: "Selecciona un producto del catálogo." };
  }

  if (rol === "comercio") {
    const { data: vinculo } = await supabase
      .from("usuarios_comercios")
      .select("id_comercio")
      .eq("id_usuario", perfil.id_usuario)
      .eq("id_comercio", idComercio)
      .maybeSingle();

    if (!vinculo) {
      return { ok: false, mensaje: "Ese comercio no está asociado a tu usuario." };
    }
  }

  const valorBruto = String(formData.get("valor") ?? "");
  const valor = parsearPrecio(valorBruto);
  if (valor === null) {
    return {
      ok: false,
      mensaje: "Precio normal inválido. Usa formato numérico sin separador de miles (ej: 1490 o 1490,50).",
    };
  }

  const ofertaBruta = String(formData.get("precio_oferta") ?? "").trim();
  let precioOferta: number | null = null;
  if (ofertaBruta !== "") {
    precioOferta = parsearPrecio(ofertaBruta);
    if (precioOferta === null) {
      return { ok: false, mensaje: "Precio oferta inválido." };
    }
  }

  const fechaInicio = String(formData.get("fecha_inicio_vigencia") ?? "").trim() || null;
  const fechaFin = String(formData.get("fecha_fin_vigencia") ?? "").trim() || null;

  const tipoCondicion = String(formData.get("tipo_condicion") ?? "").trim();
  const detalleCondicion = String(formData.get("condiciones") ?? "").trim();
  const condicionesFinal = [tipoCondicion, detalleCondicion].filter(Boolean).join(": ") || null;

  const validacion = validarOferta(
    {
      valor,
      precio_oferta: precioOferta,
      fecha_inicio_vigencia: fechaInicio,
      fecha_fin_vigencia: fechaFin,
      condiciones: condicionesFinal,
    },
    {
      requerirFechasVigencia: true,
      rechazarOfertaVencida: true,
    },
  );

  if (!validacion.ok) {
    return {
      ok: false,
      mensaje: validacion.errores.map((e) => e.mensaje).join(" "),
    };
  }

  const origen = rol === "terreno" ? "terreno" : "manual";
  const hoyChile = obtenerFechaHoyChile();

  const { error } = await supabase.from("precios").insert({
    id_comercio: idComercio,
    id_producto: idProducto,
    valor,
    precio_oferta: validacion.datos.precio_oferta,
    fecha_inicio_vigencia: validacion.datos.fecha_inicio_vigencia ?? hoyChile,
    fecha_fin_vigencia: validacion.datos.fecha_fin_vigencia,
    condiciones: validacion.datos.condiciones,
    origen,
    validado: false,
    estado_validacion: "pendiente",
  });

  if (error) {
    console.error("[ingesta/manual] Error insertando precio:", error);
    return { ok: false, mensaje: "No se pudo registrar el precio. Intenta nuevamente." };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/validacion");
  revalidatePath("/ingesta/manual");

  return {
    ok: true,
    mensaje:
      "Registro enviado a la bandeja de validación. Se publicará en el comparador una vez aprobado.",
  };
}
