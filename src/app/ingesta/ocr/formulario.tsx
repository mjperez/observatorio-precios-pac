"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Loader2, ScanLine } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Panel } from "@/components/ui/panel";
import { coincideProducto, type BoletaOCR } from "@/lib/ocr";
import { confirmarBoletaOCR, type EstadoOCR } from "./acciones";

const supabase = createClient();

type Comercio = { id_comercio: number; nombre: string };
type Producto = {
  formato: string;
  id_producto: number;
  marca: string;
  nombre: string;
};
type Analisis = { ruta: string; datos: BoletaOCR };

export function FormularioOCR() {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [idComercio, setIdComercio] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [asignaciones, setAsignaciones] = useState<Record<number, number>>({});
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

  const items = useMemo(() => {
    if (!analisis) return [];
    return analisis.datos.items.map((item, indice) => ({
      id_producto: asignaciones[indice] ?? 0,
      nombre: item.nombre,
      valor: item.precio,
    }));
  }, [analisis, asignaciones]);

  async function analizar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAnalisis(null);
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

      setAnalisis({ ruta: json.ruta, datos: json.datos });
      const sugerencias: Record<number, number> = {};
      json.datos.items.forEach((item, indice) => {
        const candidato = productos.find((p) =>
          coincideProducto(item.nombre, p.nombre, p.marca),
        );
        if (candidato) sugerencias[indice] = candidato.id_producto;
      });
      setAsignaciones(sugerencias);
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

            <form action={accion} className="space-y-4 p-4">
              <input type="hidden" name="comercio" value={idComercio} />
              <input type="hidden" name="ruta" value={analisis.ruta} />
              <input type="hidden" name="items" value={JSON.stringify(items)} />

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
                    {analisis.datos.items.map((item, indice) => (
                      <tr key={`${item.nombre}-${indice}`} className="border-b border-pac-linea">
                        <td className="px-2 py-2">{item.nombre}</td>
                        <td className="px-2 py-2">${item.precio.toLocaleString("es-CL")}</td>
                        <td className="px-2 py-2">
                          <label htmlFor={`producto-${indice}`} className="sr-only">
                            Producto del catálogo para {item.nombre}
                          </label>
                          <select
                            id={`producto-${indice}`}
                            required
                            value={asignaciones[indice] ?? ""}
                            onChange={(e) =>
                              setAsignaciones((prev) => ({
                                ...prev,
                                [indice]: Number(e.target.value),
                              }))
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

              <Boton type="submit" variante="primario" disabled={guardando || items.some((i) => !i.id_producto)}>
                {guardando ? "Guardando…" : "Confirmar y guardar precios"}
              </Boton>
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
