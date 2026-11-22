"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { parsearPrecio } from "@/lib/csv";

const ROLES_INGESTA = ["comercio", "terreno", "administrador"];
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

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
    if (precioOferta >= valor) {
      return {
        ok: false,
        mensaje: "El precio de oferta debe ser estrictamente menor al precio normal.",
      };
    }
  }

  const fechaInicio = String(formData.get("fecha_inicio_vigencia") ?? "").trim() || null;
  const fechaFin = String(formData.get("fecha_fin_vigencia") ?? "").trim() || null;

  if (fechaInicio && !FECHA_ISO.test(fechaInicio)) {
    return { ok: false, mensaje: "Fecha de inicio de vigencia inválida." };
  }
  if (fechaFin && !FECHA_ISO.test(fechaFin)) {
    return { ok: false, mensaje: "Fecha de término de vigencia inválida." };
  }
  if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
    return {
      ok: false,
      mensaje: "La fecha de término de vigencia no puede ser anterior al inicio.",
    };
  }
  if (precioOferta !== null && !fechaFin) {
    return {
      ok: false,
      mensaje: "Toda oferta debe indicar una fecha de término de vigencia.",
    };
  }

  const tipoCondicion = String(formData.get("tipo_condicion") ?? "").trim();
  const detalleCondicion = String(formData.get("condiciones") ?? "").trim();
  const condicionesFinal = [tipoCondicion, detalleCondicion].filter(Boolean).join(": ") || null;

  const origen = rol === "terreno" ? "terreno" : "manual";

  const { error } = await supabase.from("precios").insert({
    id_comercio: idComercio,
    id_producto: idProducto,
    valor,
    precio_oferta: precioOferta,
    fecha_inicio_vigencia: fechaInicio ?? new Date().toISOString().slice(0, 10),
    fecha_fin_vigencia: fechaFin,
    condiciones: condicionesFinal,
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
