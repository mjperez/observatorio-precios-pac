"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { obtenerFechaHoyChile } from "@/lib/validacion_fechas";
import type { Json } from "@/lib/database.types";

const ROLES_OCR = ["terreno", "administrador"];
const MAX_ITEMS = 60;

export type EstadoOCR = {
  ok: boolean;
  mensaje: string;
  id_boleta: string | null;
};

function fallo(mensaje: string): EstadoOCR {
  return { ok: false, mensaje, id_boleta: null };
}

type ItemConfirmado = { id_producto: number; nombre: string; valor: number };

/** Inserta boleta y precios en una sola transacción de Postgres. */
export async function confirmarBoletaOCR(
  _estado: EstadoOCR | null,
  formData: FormData,
): Promise<EstadoOCR> {
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
  if (!perfil || !rol || !ROLES_OCR.includes(rol)) {
    return fallo("Tu rol no permite confirmar boletas.");
  }

  const idComercio = Number(formData.get("comercio"));
  if (!Number.isInteger(idComercio) || idComercio <= 0) {
    return fallo("Selecciona un comercio.");
  }

  const ruta = String(formData.get("ruta") ?? "");
  if (!ruta.startsWith(`${user.id}/`) || ruta.length > 300) {
    return fallo("La imagen de la boleta no corresponde a tu sesión.");
  }

  let items: ItemConfirmado[];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]")) as ItemConfirmado[];
  } catch {
    return fallo("Los ítems de la boleta no son válidos.");
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    return fallo("La boleta debe tener entre 1 y 60 ítems.");
  }
  if (
    items.some(
      (item) =>
        !Number.isInteger(item.id_producto) ||
        item.id_producto <= 0 ||
        !Number.isFinite(item.valor) ||
        item.valor <= 0,
    )
  ) {
    return fallo("Hay ítems sin producto o con un precio inválido.");
  }

  const raw = items.map((item) => ({
    id_producto: item.id_producto,
    nombre: item.nombre,
    valor: item.valor,
  }));

  const { data: idBoleta, error } = await supabase.rpc("fn_confirmar_boleta_ocr", {
    p_comercio: idComercio,
    p_ruta: ruta,
    p_items: raw as unknown as Json,
    p_fecha_inicio: obtenerFechaHoyChile(),
  });

  if (error) {
    console.error("[ingesta/ocr] Error confirmando boleta:", error);
    return fallo("No se pudieron registrar la boleta y sus precios. Intenta nuevamente.");
  }

  revalidatePath("/admin");
  revalidatePath("/admin/validacion");
  revalidatePath("/ingesta/ocr");

  return {
    ok: true,
    mensaje: `Boleta registrada con ${items.length} precios pendientes de validación.`,
    id_boleta: idBoleta,
  };
}
