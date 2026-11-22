import { requerirRol } from "@/lib/auth";
import { Contenedor, EncabezadoPagina } from "@/components/ui/pagina";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Panel, PanelCabecera } from "@/components/ui/panel";
import {
  actualizarRolUsuario,
  desvincularComercioUsuario,
  vincularComercioUsuario,
} from "./acciones";

export const metadata = { title: "Administración de usuarios" };

const MENSAJES_ERROR: Record<string, string> = {
  datos: "Parámetros inválidos en la solicitud.",
  autodegradacion: "No puedes modificar tu propio rol de administrador.",
  rol: "No se pudo actualizar el rol del usuario.",
  vinculo: "No se pudo asociar el comercio al usuario.",
};

export default async function AdminUsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { supabase } = await requerirRol("administrador");
  const params = await searchParams;

  const [{ data: usuarios }, { data: roles }, { data: comercios }, { data: vinculos }] =
    await Promise.all([
      supabase
        .from("usuarios")
        .select("id_usuario, nombre, email, id_rol, fecha_registro, roles(nombre)")
        .order("nombre"),
      supabase.from("roles").select("id_rol, nombre").order("id_rol"),
      supabase.from("comercios").select("id_comercio, nombre").eq("activo", true).order("nombre"),
      supabase.from("usuarios_comercios").select("id_usuario, id_comercio, comercios(nombre)"),
    ]);

  const vinculosPorUsuario = new Map<string, { id_comercio: number; nombre: string }[]>();
  for (const v of vinculos ?? []) {
    const com = Array.isArray(v.comercios) ? v.comercios[0] : v.comercios;
    const lista = vinculosPorUsuario.get(v.id_usuario) ?? [];
    lista.push({
      id_comercio: v.id_comercio,
      nombre: com?.nombre ?? `Comercio #${v.id_comercio}`,
    });
    vinculosPorUsuario.set(v.id_usuario, lista);
  }

  return (
    <Contenedor>
      <EncabezadoPagina
        miga={[
          { etiqueta: "Inicio", href: "/" },
          { etiqueta: "Panel", href: "/admin" },
          { etiqueta: "Usuarios" },
        ]}
        eyebrow="Control de acceso"
        titulo="Administración de usuarios y locales"
        descripcion="Asigna roles operativos (administrador, terreno, comercio, vecino) y vincula los establecimientos autorizados para cada comerciante."
      />

      <div className="mt-6 flex flex-col gap-4 pb-14">
        {params.error && (
          <Aviso tono="error" titulo="No se completó la acción">
            {MENSAJES_ERROR[params.error] ?? "Ocurrió un error inesperado."}
          </Aviso>
        )}
        {params.ok && (
          <Aviso tono="exito" titulo="Cambios guardados">
            Los permisos y vínculos del usuario se actualizaron correctamente.
          </Aviso>
        )}

        <Panel acento="azul">
          <PanelCabecera
            titulo={`Cuentas registradas (${(usuarios ?? []).length})`}
            descripcion="Los usuarios con rol comercio solo pueden cargar precios en sus locales asociados."
          />

          <ul className="divide-y divide-pac-linea">
            {(usuarios ?? []).map((u) => {
              const locales = vinculosPorUsuario.get(u.id_usuario) ?? [];
              return (
                <li key={u.id_usuario} className="flex flex-col gap-4 p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-bold text-pac-azul">{u.nombre}</p>
                      <p className="text-[12.5px] text-pac-tinta-suave">{u.email}</p>
                    </div>

                    <form action={actualizarRolUsuario} className="flex items-center gap-2">
                      <input type="hidden" name="id_usuario" value={u.id_usuario} />
                      <select
                        name="id_rol"
                        defaultValue={u.id_rol}
                        aria-label={`Rol para ${u.nombre}`}
                        className="h-9 border border-pac-linea-fuerte bg-white px-3 text-[13px] text-pac-tinta focus:border-pac-azul focus:outline-none"
                      >
                        {(roles ?? []).map((r) => (
                          <option key={r.id_rol} value={r.id_rol}>
                            {r.nombre}
                          </option>
                        ))}
                      </select>
                      <Boton type="submit">Guardar rol</Boton>
                    </form>
                  </div>

                  <div className="border-t border-pac-linea pt-3">
                    <p className="micro mb-2 text-pac-tinta-suave">Comercios vinculados</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {locales.length === 0 ? (
                        <span className="text-[12px] text-pac-tinta-suave">
                          Sin locales asociados.
                        </span>
                      ) : (
                        locales.map((loc) => (
                          <form
                            key={loc.id_comercio}
                            action={desvincularComercioUsuario}
                            className="inline-flex items-center gap-1.5 border border-pac-linea bg-pac-fondo px-2.5 py-1 text-[12px]"
                          >
                            <input type="hidden" name="id_usuario" value={u.id_usuario} />
                            <input type="hidden" name="id_comercio" value={loc.id_comercio} />
                            <span className="font-medium text-pac-tinta">{loc.nombre}</span>
                            <button
                              type="submit"
                              title="Quitar vínculo"
                              className="ml-1 font-bold text-pac-rojo hover:underline"
                            >
                              ×
                            </button>
                          </form>
                        ))
                      )}

                      <form action={vincularComercioUsuario} className="ml-auto flex items-center gap-2">
                        <input type="hidden" name="id_usuario" value={u.id_usuario} />
                        <select
                          name="id_comercio"
                          aria-label={`Vincular comercio a ${u.nombre}`}
                          className="h-8 border border-pac-linea-fuerte bg-white px-2 text-[12px] text-pac-tinta"
                        >
                          {(comercios ?? []).map((c) => (
                            <option key={c.id_comercio} value={c.id_comercio}>
                              {c.nombre}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="h-8 border border-pac-azul/40 bg-white px-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-pac-azul hover:bg-pac-azul-tenue"
                        >
                          + Vincular
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </Contenedor>
  );
}
