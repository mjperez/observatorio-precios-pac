"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Aviso } from "@/components/ui/aviso";

type Resultado = {
  formato: string;
  id_producto: number;
  marca: string;
  nombre: string;
  similitud: number;
};

type Respuesta = {
  productos?: Resultado[];
  degradado?: boolean;
  tiempo_ms?: number;
  error?: string;
};

type Producto = {
  id_producto: number;
  nombre: string;
  marca: string;
  formato: string;
};

/** Buscador por lenguaje natural del comparador (US-E1). */
export function BusquedaSemantica({
  onSeleccionar,
}: {
  onSeleccionar: (producto: Producto) => void;
}) {
  const [texto, setTexto] = useState("");
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const peticion = useRef<AbortController | null>(null);

  useEffect(() => () => peticion.current?.abort(), []);

  async function buscar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const consulta = texto.trim();
    if (consulta.length < 2) return;

    peticion.current?.abort();
    const controlador = new AbortController();
    peticion.current = controlador;
    setCargando(true);

    try {
      const res = await fetch(
        `/api/busqueda-semantica?q=${encodeURIComponent(consulta)}`,
        { signal: controlador.signal },
      );
      const json = (await res.json()) as Respuesta;
      if (!res.ok) throw new Error(json.error ?? "No se pudo buscar");
      setRespuesta(json);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setRespuesta({ error: "No se pudo completar la búsqueda. Intenta nuevamente." });
    } finally {
      if (!controlador.signal.aborted) setCargando(false);
    }
  }

  return (
    <div className="border-b border-pac-linea bg-pac-fondo px-3 py-3">
      <form onSubmit={buscar} className="flex gap-2">
        <label htmlFor="busqueda-semantica" className="sr-only">
          Buscar por lenguaje natural
        </label>
        <input
          id="busqueda-semantica"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej: algo para hacer cazuela"
          className="h-9 min-w-0 flex-1 rounded-md border border-pac-linea-fuerte bg-white px-3 text-[13px] placeholder:text-pac-tinta-suave/70 focus:border-pac-azul focus:outline-none focus:ring-2 focus:ring-pac-azul/15"
        />
        <button
          type="submit"
          disabled={cargando || texto.trim().length < 2}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-pac-azul bg-pac-azul px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-40"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {cargando ? "Buscando" : "Sugerir"}
        </button>
      </form>

      {respuesta?.error && (
        <div className="mt-2">
          <Aviso tono="error">{respuesta.error}</Aviso>
        </div>
      )}

      {respuesta?.productos && respuesta.productos.length > 0 && (
        <ul className="mt-2 divide-y divide-pac-linea border border-pac-linea bg-white">
          {respuesta.productos.map((producto) => (
            <li key={producto.id_producto}>
              <button
                type="button"
                onClick={() =>
                  onSeleccionar({
                    id_producto: producto.id_producto,
                    nombre: producto.nombre,
                    marca: producto.marca,
                    formato: producto.formato,
                  })
                }
                className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left hover:bg-pac-azul-tenue"
              >
                <span className="text-[12.5px] text-pac-tinta">{producto.nombre}</span>
                <span className="micro shrink-0 text-pac-tinta-suave">
                  {(producto.similitud * 100).toFixed(0)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {respuesta?.productos?.length === 0 && (
        <p className="mt-2 text-[12px] text-pac-tinta-suave">
          No hay productos relacionados con esa consulta.
        </p>
      )}

      {respuesta?.degradado && (
        <p className="mt-2 text-[11px] leading-snug text-pac-tinta-suave">
          Búsqueda léxica local: no hay proveedor de embeddings configurado o
          los vectores aún no están cargados. {respuesta.tiempo_ms ?? 0} ms.
        </p>
      )}
    </div>
  );
}
