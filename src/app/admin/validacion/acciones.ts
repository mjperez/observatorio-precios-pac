"use server";

import { revalidatePath } from "next/cache";
import { requerirRol } from "@/lib/auth";

function auditoria(perfilId: string) {
  return {
    validado_por: perfilId,
    fecha_validacion: new Date().toISOString(),
  };
}

function refrescar() {
  revalidatePath("/admin");
  revalidatePath("/admin/validacion");
}

export async function aprobarPrecio(formData: FormData) {
  const { supabase, perfil } = await requerirRol("terreno", "administrador");
  const idPrecio = Number(formData.get("id_precio"));

  if (!Number.isInteger(idPrecio) || idPrecio <= 0) return;

  const { error } = await supabase
    .from("precios")
    .update({
      estado_validacion: "aprobado",
      validado: true,
      motivo_rechazo: null,
      ...auditoria(perfil.id_usuario),
    })
    .eq("id_precio", idPrecio);

  if (error) console.error("[admin/validacion] Error aprobando precio:", error);
  refrescar();
}

export async function rechazarPrecio(formData: FormData) {
  const { supabase, perfil } = await requerirRol("terreno", "administrador");
  const idPrecio = Number(formData.get("id_precio"));
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!Number.isInteger(idPrecio) || idPrecio <= 0) return;

  const { error } = await supabase
    .from("precios")
    .update({
      estado_validacion: "rechazado",
      validado: false,
      motivo_rechazo: motivo || null,
      ...auditoria(perfil.id_usuario),
    })
    .eq("id_precio", idPrecio);

  if (error) console.error("[admin/validacion] Error rechazando precio:", error);
  refrescar();
}

export async function aprobarTodosPendientes() {
  const { supabase, perfil } = await requerirRol("terreno", "administrador");

  const { data: pendientes, error: errorLectura } = await supabase
    .from("precios")
    .select("id_precio")
    .eq("estado_validacion", "pendiente");

  if (errorLectura) {
    console.error("[admin/validacion] Error leyendo pendientes:", errorLectura);
    return;
  }

  const ids = (pendientes ?? []).map((fila) => fila.id_precio);
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("precios")
    .update({
      estado_validacion: "aprobado",
      validado: true,
      motivo_rechazo: null,
      ...auditoria(perfil.id_usuario),
    })
    .in("id_precio", ids);

  if (error) console.error("[admin/validacion] Error aprobando pendientes:", error);
  refrescar();
}

export async function ejecutarCaducidadOfertas() {
  const { supabase } = await requerirRol("terreno", "administrador");

  const { error } = await supabase.rpc("fn_desactivar_ofertas_vencidas");

  if (error) {
    console.error("[admin/validacion] Error desactivando ofertas vencidas:", error);
  }
  refrescar();
}
