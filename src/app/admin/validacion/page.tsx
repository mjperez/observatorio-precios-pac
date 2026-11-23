import Link from "next/link";
import { requerirRol } from "@/lib/auth";
import { Contenedor, EncabezadoPagina } from "@/components/ui/pagina";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Insignia } from "@/components/ui/etiqueta";
import { Panel, PanelCabecera } from "@/components/ui/panel";
import {
  aprobarPrecio,
  aprobarTodosPendientes,
  ejecutarCaducidadOfertas,
  rechazarPrecio,
} from "./acciones";

export const metadata = { title: "Validación de precios y ofertas" };

export default async function ValidacionPage({
  searchParams,
}: {
  searchParams: Promise<{ caducidad?: string; anomalias?: string }>;
}) {
  const { supabase } = await requerirRol("terreno", "administrador");
  const params = await searchParams;
  const soloAnomalias = params.anomalias === "1";

  // Ejecución automática de desactivación de ofertas vencidas al abrir la bandeja
  const { data: ofertasCaducadas } = await supabase.rpc("fn_desactivar_ofertas_vencidas");

  let consulta = supabase
    .from("precios")
    .select(
      `
      id_precio,
      valor,
      precio_oferta,
      fecha_inicio_vigencia,
      fecha_fin_vigencia,
      condiciones,
      origen,
      es_anomalia,
      detalle_anomalia,
      fecha_registro,
      comercios ( nombre, direccion ),
      productos ( nombre, marca, formato )
    `,
    )
    .eq("estado_validacion", "pendiente");

  if (soloAnomalias) consulta = consulta.eq("es_anomalia", true);

  const { data: pendientes } = await consulta
    .order("fecha_registro", { ascending: false })
    .limit(100);

  const { count: totalAnomalias } = await supabase
    .from("precios")
    .select("*", { count: "exact", head: true })
    .eq("estado_validacion", "pendiente")
    .eq("es_anomalia", true);

  const lista = pendientes ?? [];

  return (
    <Contenedor>
      <EncabezadoPagina
        miga={[
          { etiqueta: "Inicio", href: "/" },
          { etiqueta: "Panel", href: "/admin" },
          { etiqueta: "Validación" },
        ]}
        eyebrow="Control de calidad"
        titulo="Bandeja de validación"
        descripcion="Aprueba o rechaza precios y ofertas ingresados por comercios o planillas antes de su publicación ciudadana."
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={
                soloAnomalias
                  ? "/admin/validacion"
                  : "/admin/validacion?anomalias=1"
              }
              className="inline-flex h-10 items-center border border-pac-linea-fuerte px-4 text-[11px] font-bold uppercase tracking-[0.09em] text-pac-azul transition-colors hover:border-pac-azul hover:bg-pac-azul-tenue"
            >
              {soloAnomalias
                ? "Ver todos los pendientes"
                : `Solo anomalías (${totalAnomalias ?? 0})`}
            </Link>
            <form action={ejecutarCaducidadOfertas}>
              <Boton type="submit">Desactivar ofertas vencidas</Boton>
            </form>
            {lista.length > 0 && (
              <form action={aprobarTodosPendientes}>
                <Boton type="submit">Aprobar todos ({lista.length})</Boton>
              </form>
            )}
          </div>
        }
      />

      <div className="mt-6 flex flex-col gap-4 pb-14">
        {(Number(ofertasCaducadas ?? 0) > 0 || params.caducidad === "ok") && (
          <Aviso tono="exito" titulo="Control de vigencia ejecutado">
            Se verificaron las fechas de término y se desactivaron{" "}
            <strong>{Number(ofertasCaducadas ?? 0)}</strong> ofertas vencidas.
          </Aviso>
        )}

        <Panel acento="azul">
          <PanelCabecera
            titulo={`Registros pendientes (${lista.length})`}
            descripcion="Solo los precios aprobados aparecen en el comparador y en el historial público."
          />

          {lista.length === 0 ? (
            <div className="p-8 text-center text-[13.5px] text-pac-tinta-suave">
              No hay precios ni ofertas pendientes de revisión.
            </div>
          ) : (
            <ul className="divide-y divide-pac-linea">
              {lista.map((item) => {
                const comercio = Array.isArray(item.comercios)
                  ? item.comercios[0]
                  : item.comercios;
                const producto = Array.isArray(item.productos)
                  ? item.productos[0]
                  : item.productos;

                return (
                  <li
                    key={item.id_precio}
                    className="flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-pac-azul">
                          {producto?.nombre ?? "Producto"}
                        </span>
                        <span className="text-[12.5px] text-pac-tinta-suave">
                          {producto?.marca} · {producto?.formato}
                        </span>
                        <span className="border border-pac-linea bg-pac-fondo px-2 py-0.5 font-mono text-[11px] uppercase text-pac-tinta-suave">
                          Origen: {item.origen ?? "manual"}
                        </span>
                        {item.es_anomalia && (
                          <Insignia tono="destacado">
                            Anomalía detectada
                          </Insignia>
                        )}
                      </div>

                      <p className="mt-1 text-[13px] text-pac-tinta">
                        <strong>{comercio?.nombre}</strong> — {comercio?.direccion}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-4 text-[13px]">
                        <span>
                          Normal:{" "}
                          <strong className="font-mono">
                            ${Number(item.valor).toLocaleString("es-CL")}
                          </strong>
                        </span>

                        {item.precio_oferta && (
                          <span className="text-pac-rojo">
                            Oferta:{" "}
                            <strong className="font-mono">
                              ${Number(item.precio_oferta).toLocaleString("es-CL")}
                            </strong>{" "}
                            ({item.fecha_inicio_vigencia ?? "hoy"} →{" "}
                            {item.fecha_fin_vigencia ?? "sin término"})
                          </span>
                        )}
                      </div>

                      {item.condiciones && (
                        <p className="mt-1 text-[12px] text-pac-tinta-suave">
                          Condiciones: {item.condiciones}
                        </p>
                      )}

                      {item.detalle_anomalia && (
                        <p
                          className="mt-2 border-l-[3px] border-l-pac-rojo bg-pac-rojo-tenue px-3 py-2 text-[12px] leading-snug text-pac-tinta"
                          aria-label="Motivo de la alerta de anomalía"
                        >
                          {item.detalle_anomalia}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <form action={aprobarPrecio}>
                        <input type="hidden" name="id_precio" value={item.id_precio} />
                        <Boton type="submit">Aprobar</Boton>
                      </form>

                      <form action={rechazarPrecio} className="flex items-center gap-1.5">
                        <input type="hidden" name="id_precio" value={item.id_precio} />
                        <input
                          type="text"
                          name="motivo"
                          placeholder="Motivo rechazo"
                          aria-label="Motivo de rechazo"
                          className="h-9 w-40 border border-pac-linea-fuerte bg-white px-2.5 text-[12px] text-pac-tinta focus:border-pac-rojo focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="h-9 border border-pac-rojo/40 bg-white px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-pac-rojo transition-colors hover:bg-pac-rojo hover:text-white"
                        >
                          Rechazar
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </Contenedor>
  );
}
