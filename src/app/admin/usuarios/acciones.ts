"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requerirRol } from "@/lib/auth";

const RUTA = "/admin/usuarios";

export async function actualizarRolUsuario(formData: FormData) {
  const { supabase, perfil } = await requerirRol("administrador");

  const idUsuario = String(formData.get("id_usuario") ?? "").trim();
  const idRol = Number(formData.get("id_rol"));

  if (!idUsuario || !Number.isInteger(idRol) || idRol <= 0) {
    redirect(`${RUTA}?error=datos`);
  }

  // Evita que el propio administrador se quite su rol accidentalmente
  if (idUsuario === perfil.id_usuario) {
    redirect(`${RUTA}?error=autodegradacion`);
  }

  const { error } = await supabase
    .from("usuarios")
    .update({ id_rol: idRol })
    .eq("id_usuario", idUsuario);

  if (error) {
    redirect(`${RUTA}?error=rol`);
  }

  revalidatePath(RUTA);
  revalidatePath("/admin");
  redirect(`${RUTA}?ok=rol`);
}

export async function vincularComercioUsuario(formData: FormData) {
  const { supabase } = await requerirRol("administrador");

  const idUsuario = String(formData.get("id_usuario") ?? "").trim();
  const idComercio = Number(formData.get("id_comercio"));

  if (!idUsuario || !Number.isInteger(idComercio) || idComercio <= 0) {
    redirect(`${RUTA}?error=datos`);
  }

  const { error } = await supabase
    .from("usuarios_comercios")
    .upsert({ id_usuario: idUsuario, id_comercio: idComercio }, { onConflict: "id_usuario,id_comercio" });

  if (error) {
    redirect(`${RUTA}?error=vinculo`);
  }

  revalidatePath(RUTA);
  redirect(`${RUTA}?ok=vinculo`);
}

export async function desvincularComercioUsuario(formData: FormData) {
  const { supabase } = await requerirRol("administrador");

  const idUsuario = String(formData.get("id_usuario") ?? "").trim();
  const idComercio = Number(formData.get("id_comercio"));

  if (!idUsuario || !Number.isInteger(idComercio) || idComercio <= 0) {
    redirect(`${RUTA}?error=datos`);
  }

  await supabase
    .from("usuarios_comercios")
    .delete()
    .eq("id_usuario", idUsuario)
    .eq("id_comercio", idComercio);

  revalidatePath(RUTA);
  redirect(`${RUTA}?ok=desvinculo`);
}
