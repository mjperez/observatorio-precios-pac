"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requerirRol } from "@/lib/auth";

const RUTA = "/admin/validacion";

function refrescarPublicaciones() {
  revalidatePath(RUTA);
  revalidatePath("/admin");
  revalidatePath("/comparador");
  revalidatePath("/mapa");
}

function idDe(formData: FormData) {
  const id = Number(formData.get("id_precio"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function aprobarPrecio(formData: FormData) {
  const { supabase, perfil } = await requerirRol("terreno", "administrador");
  const idPrecio = idDe(formData);

  if (!idPrecio) redirect(`${RUTA}?error=datos`);

  const { error } = await supabase
    .from("precios")
    .update({
      estado_validacion: "aprobado",
      validado: true,
      validado_por: perfil?.id_usuario ?? null,
      fecha_validacion: new Date().toISOString(),
      motivo_rechazo: null,
    })
    .eq("id_precio", idPrecio)
    .eq("estado_validacion", "pendiente");

  if (error) redirect(`${RUTA}?error=aprobacion`);

  refrescarPublicaciones();
  redirect(`${RUTA}?ok=aprobado`);
}

export async function rechazarPrecio(formData: FormData) {
  const { supabase, perfil } = await requerirRol("terreno", "administrador");
  const idPrecio = idDe(formData);
  const motivo = String(formData.get("motivo") ?? "").trim();

  if (!idPrecio || motivo.length < 4) redirect(`${RUTA}?error=datos`);

  const { error } = await supabase
    .from("precios")
    .update({
      estado_validacion: "rechazado",
      validado: false,
      validado_por: perfil?.id_usuario ?? null,
      fecha_validacion: new Date().toISOString(),
      motivo_rechazo: motivo.slice(0, 300),
    })
    .eq("id_precio", idPrecio)
    .eq("estado_validacion", "pendiente");

  if (error) redirect(`${RUTA}?error=rechazo`);

  refrescarPublicaciones();
  redirect(`${RUTA}?ok=rechazado`);
}

export async function aprobarTodosPendientes() {
  const { supabase, perfil } = await requerirRol("terreno", "administrador");

  const { error } = await supabase
    .from("precios")
    .update({
      estado_validacion: "aprobado",
      validado: true,
      validado_por: perfil?.id_usuario ?? null,
      fecha_validacion: new Date().toISOString(),
      motivo_rechazo: null,
    })
    .eq("estado_validacion", "pendiente");

  if (error) redirect(`${RUTA}?error=aprobacion-masiva`);

  refrescarPublicaciones();
  redirect(`${RUTA}?ok=aprobacion-masiva`);
}

export async function ejecutarCaducidadOfertas() {
  const { supabase } = await requerirRol("terreno", "administrador");

  const { error } = await supabase.rpc("fn_desactivar_ofertas_vencidas");
  if (error) redirect(`${RUTA}?error=caducidad`);

  refrescarPublicaciones();
  redirect(`${RUTA}?caducidad=ok`);
}
