import { requerirRol } from "@/lib/auth";
import { Contenedor, EncabezadoPagina } from "@/components/ui/pagina";
import FormularioManual from "./formulario";

export const metadata = { title: "Registro manual de precios" };

export default async function RegistroManualPage() {
  const { supabase, perfil, rol } = await requerirRol(
    "comercio",
    "terreno",
    "administrador",
  );

  let comercios: { id_comercio: number; nombre: string }[] = [];

  if (rol === "comercio") {
    const { data } = await supabase
      .from("usuarios_comercios")
      .select("id_comercio, comercios(nombre)")
      .eq("id_usuario", perfil.id_usuario);

    comercios = (data ?? [])
      .filter((r) => r.comercios !== null)
      .map((r) => ({
        id_comercio: r.id_comercio,
        nombre: r.comercios?.nombre ?? `#${r.id_comercio}`,
      }));
  } else {
    const { data } = await supabase
      .from("comercios")
      .select("id_comercio, nombre")
      .eq("activo", true)
      .order("nombre");

    comercios = data ?? [];
  }

  const { data: productos } = await supabase
    .from("productos")
    .select("id_producto, nombre, marca, formato")
    .eq("activo", true)
    .order("nombre");

  return (
    <Contenedor>
      <EncabezadoPagina
        miga={[
          { etiqueta: "Inicio", href: "/" },
          { etiqueta: "Carga de precios", href: "/ingesta" },
          { etiqueta: "Registro manual" },
        ]}
        titulo="Registro manual de precios"
        descripcion="Registra precios normales o promocionales uno por uno. Quedan pendientes hasta ser aprobados por el equipo de validación."
      />

      <div className="mt-8 pb-14">
        <FormularioManual comercios={comercios} productos={productos ?? []} />
      </div>
    </Contenedor>
  );
}
