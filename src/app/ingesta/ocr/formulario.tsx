"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Panel } from "@/components/ui/panel";
import {
  coincideProducto,
  cuadreBoleta,
  type BoletaOCR,
  type CuadreBoleta,
  type ItemOCR,
} from "@/lib/ocr";
import { confirmarBoletaOCR, type EstadoOCR } from "./acciones";

const supabase = createClient();

type Comercio = { id_comercio: number; nombre: string };
type Producto = {
  formato: string;
  id_producto: number;
  marca: string;
  nombre: string;
};
type Analisis = { ruta: string; datos: BoletaOCR; cuadre: CuadreBoleta };
/** El ítem tal como llega del modelo, más el producto que asigna el revisor. */
type ItemRevision = ItemOCR & { id_producto: number };

export function FormularioOCR() {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [idComercio, setIdComercio] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [items, setItems] = useState<ItemRevision[]>([]);
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estado, accion, guardando] = useActionState<EstadoOCR | null, FormData>(
    confirmarBoletaOCR,
    null,
  );

  useEffect(() => {
    supabase
      .from("comercios")
      .select("id_comercio, nombre")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => setComercios(data ?? []));

    supabase
      .from("productos")
      .select("id_producto, nombre, marca, formato")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => setProductos(data ?? []));
  }, []);

  // Se recalcula en el cliente con cada edición: el del servidor refleja lo que
  // el modelo leyó, este refleja lo que el revisor dejó en pantalla.
  const cuadre = useMemo(() => {
    if (!analisis) return null;
    return cuadreBoleta({
      comercio: analisis.datos.comercio,
      fecha: analisis.datos.fecha,
      subtotal: analisis.datos.subtotal,
      items: items.map((item) => ({
        nombre: item.nombre,
        precio: item.precio,
        cantidad: item.cantidad,
      })),
    });
  }, [analisis, items]);

  async function analizar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAnalisis(null);
    setItems([]);
    if (!archivo) {
      setError("Selecciona una imagen de la boleta.");
      return;
    }

    setAnalizando(true);
    const cuerpo = new FormData();
    cuerpo.set("imagen", archivo);

    try {
      const respuesta = await fetch("/api/ocr", { method: "POST", body: cuerpo });
      const json = (await respuesta.json()) as Analisis & { error?: string };
      if (!respuesta.ok) throw new Error(json.error ?? "No se pudo analizar la boleta.");

      setAnalisis({ ruta: json.ruta, datos: json.datos, cuadre: json.cuadre });
      setItems(
        json.datos.items.map((item) => {
          // Se propone el producto del catálogo que más se parece al nombre
          // leído; el revisor lo cambia si no corresponde.
          const candidato = productos.find((p) =>
            coincideProducto(item.nombre, p.nombre, p.marca),
          );
          return { ...item, id_producto: candidato?.id_producto ?? 0 };
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalizando(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr] lg:items-start">
      <Panel>
        <form onSubmit={analizar} className="space-y-5 p-5">
          <div>
            <EtiquetaBloque>1. Datos de la boleta</EtiquetaBloque>
            <label htmlFor="comercio-ocr" className="mb-1.5 block text-[13px] font-medium">
              Comercio
            </label>
            <select
              id="comercio-ocr"
              required
              value={idComercio}
              onChange={(e) => setIdComercio(e.target.value)}
              className="h-10 w-full rounded-md border border-pac-linea-fuerte bg-white px-3 text-[14px]"
            >
              <option value="">Selecciona un comercio</option>
              {comercios.map((c) => (
                <option key={c.id_comercio} value={c.id_comercio}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="imagen-ocr" className="mb-1.5 block text-[13px] font-medium">
              Fotografía de la boleta
            </label>
            <input
              id="imagen-ocr"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="w-full text-[13px] file:mr-3 file:rounded-md file:border file:border-pac-azul file:bg-white file:px-3 file:py-2 file:text-[12px] file:font-bold file:uppercase file:text-pac-azul"
            />
            <p className="mt-1.5 text-[11px] text-pac-tinta-suave">
              JPG, PNG o WebP. Hasta 5 MB. La imagen queda en un bucket privado.
            </p>
          </div>

          <Boton type="submit" variante="primario" bloque disabled={analizando || !idComercio}>
            {analizando ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Analizando
              </>
            ) : (
              <>
                <ScanLine className="size-4" aria-hidden="true" /> Analizar boleta
              </>
            )}
          </Boton>
        </form>
      </Panel>

      <div className="space-y-4">
        {error && <Aviso tono="error">{error}</Aviso>}
        {estado && (
          <Aviso tono={estado.ok ? "exito" : "error"}>{estado.mensaje}</Aviso>
        )}

        {!analisis && !error && (
          <Aviso tono="info" titulo="Confirmación obligatoria">
            El modelo propone productos y precios, pero nada se guarda hasta que revises
            cada fila y confirmes. Los precios se insertan sin validar para que pasen por
            la bandeja de validación.
          </Aviso>
        )}

        {analisis && (
          <Panel>
            <div className="border-b border-pac-linea p-4">
              <p className="micro text-pac-rojo">2. Revisión</p>
              <h2 className="mt-1 text-[18px] font-bold text-pac-azul">
                {analisis.datos.comercio ?? "Comercio no detectado"}
              </h2>
              <p className="mt-1 text-[12px] text-pac-tinta-suave">
                {analisis.datos.fecha ?? "Fecha no detectada"} · {items.length} ítems
              </p>
            </div>

            {cuadre && !cuadre.cuadra && (
              <div className="border-b border-pac-linea p-4">
                <Aviso tono="alerta" titulo="La suma no cuadra con el subtotal">
                  Los ítems suman ${cuadre.suma.toLocaleString("es-CL")} y la boleta
                  declara ${cuadre.subtotal?.toLocaleString("es-CL")}. Corrige el
                  precio de las filas hasta que coincida: mientras no cuadre no se
                  puede confirmar.
                </Aviso>
              </div>
            )}

            <form action={accion} className="space-y-4 p-4">
              <input type="hidden" name="comercio" value={idComercio} />
              <input type="hidden" name="ruta" value={analisis.ruta} />
              <input
                type="hidden"
                name="items"
                value={JSON.stringify(
                  items.map((item) => ({
                    id_producto: item.id_producto,
                    nombre: item.nombre,
                    valor: item.precio,
                  })),
                )}
              />

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-pac-linea bg-pac-fondo">
                      <th scope="col" className="px-2 py-2 font-bold">Producto detectado</th>
                      <th scope="col" className="px-2 py-2 font-bold">Precio</th>
                      <th scope="col" className="px-2 py-2 font-bold">Producto del catálogo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, indice) => (
                      <tr key={`${item.nombre}-${indice}`} className="border-b border-pac-linea">
                        <td className="px-2 py-2">{item.nombre}</td>
                        <td className="px-2 py-2">
                          <label htmlFor={`precio-${indice}`} className="sr-only">
                            Precio de {item.nombre}
                          </label>
                          <input
                            id={`precio-${indice}`}
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={item.precio}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((fila, i) =>
                                  i === indice
                                    ? { ...fila, precio: Number(e.target.value) }
                                    : fila,
                                ),
                              )
                            }
                            className="cifra h-9 w-24 rounded-md border border-pac-linea-fuerte bg-white px-2 text-right text-[12px]"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <label htmlFor={`producto-${indice}`} className="sr-only">
                            Producto del catálogo para {item.nombre}
                          </label>
                          <select
                            id={`producto-${indice}`}
                            required
                            value={item.id_producto || ""}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((fila, i) =>
                                  i === indice
                                    ? { ...fila, id_producto: Number(e.target.value) }
                                    : fila,
                                ),
                              )
                            }
                            className="h-9 w-full rounded-md border border-pac-linea-fuerte bg-white px-2 text-[12px]"
                          >
                            <option value="">Selecciona producto</option>
                            {productos.map((p) => (
                              <option key={p.id_producto} value={p.id_producto}>
                                {p.nombre} · {p.marca} · {p.formato}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                <Boton
                  type="submit"
                  variante="primario"
                  disabled={
                    guardando ||
                    items.length === 0 ||
                    items.some((item) => !item.id_producto) ||
                    !cuadre?.cuadra
                  }
                >
                  {guardando ? "Guardando…" : "Confirmar y guardar precios"}
                </Boton>
                {!cuadre?.cuadra && (
                  <p className="text-[11px] leading-snug text-pac-tinta-suave">
                    Se habilita cuando la suma de los precios coincide con el
                    subtotal impreso y cada fila tiene un producto del catálogo.
                  </p>
                )}
              </div>
            </form>
          </Panel>
        )}
      </div>
    </div>
  );
}

function EtiquetaBloque({ children }: { children: React.ReactNode }) {
  return <p className="micro mb-3 text-pac-rojo">{children}</p>;
}
