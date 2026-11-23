import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  aLiteralVector,
  embeddingLocal,
  generarEmbedding,
  similitudCoseno,
} from "@/lib/embeddings";

type ProductoResultado = {
  formato: string;
  id_producto: number;
  marca: string;
  nombre: string;
  similitud: number;
};

type Respuesta = {
  productos: ProductoResultado[];
  proveedor: "openai" | "local";
  degradado: boolean;
  tiempo_ms: number;
};

/** Búsqueda por lenguaje natural (US-E1). No requiere autenticación. */
export async function GET(request: NextRequest) {
  const inicio = performance.now();
  const consulta = (request.nextUrl.searchParams.get("q") ?? "").trim();

  if (consulta.length < 2 || consulta.length > 120) {
    return NextResponse.json(
      { error: "La consulta debe tener entre 2 y 120 caracteres." },
      { status: 400 },
    );
  }

  const embedding = await generarEmbedding(consulta);
  const supabase = await createClient();
  const limite = 8;

  const { data: rpc, error: errorRpc } = await supabase.rpc(
    "fn_buscar_productos_semanticos",
    { consulta: aLiteralVector(embedding.vector), limite },
  );

  if (!errorRpc && Array.isArray(rpc) && rpc.length > 0) {
    const respuesta: Respuesta = {
      productos: rpc.map((fila) => ({
        formato: fila.formato,
        id_producto: fila.id_producto,
        marca: fila.marca,
        nombre: fila.nombre,
        similitud: Number(fila.similitud.toFixed(4)),
      })),
      proveedor: embedding.proveedor,
      degradado: embedding.degradado,
      tiempo_ms: Math.round(performance.now() - inicio),
    };
    return NextResponse.json(respuesta);
  }

  // Sin la migración aplicada o sin vectores cargados, se calcula la
  // similitud sobre el catálogo activo. El modo queda marcado en la respuesta.
  const { data: catalogo, error: errorCatalogo } = await supabase
    .from("productos")
    .select("id_producto, nombre, marca, formato, categorias(nombre)")
    .eq("activo", true);

  if (errorCatalogo) {
    console.error("[busqueda-semantica] Error leyendo catálogo:", errorCatalogo);
    return NextResponse.json(
      { error: "No se pudo realizar la búsqueda. Intenta nuevamente." },
      { status: 500 },
    );
  }

  const vectorConsulta =
    embedding.proveedor === "local" ? embedding.vector : embeddingLocal(consulta);

  const productos: ProductoResultado[] = (catalogo ?? [])
    .map((producto) => {
      const categoria = Array.isArray(producto.categorias)
        ? producto.categorias[0]?.nombre
        : null;
      const texto = `${producto.nombre} ${producto.marca} ${producto.formato} ${categoria ?? ""}`;
      return {
        formato: producto.formato,
        id_producto: producto.id_producto,
        marca: producto.marca,
        nombre: producto.nombre,
        similitud: Number(similitudCoseno(vectorConsulta, embeddingLocal(texto)).toFixed(4)),
      };
    })
    .filter((producto) => producto.similitud > 0)
    .sort((a, b) => b.similitud - a.similitud)
    .slice(0, limite);

  const respuesta: Respuesta = {
    productos,
    proveedor: embedding.proveedor,
    degradado: true,
    tiempo_ms: Math.round(performance.now() - inicio),
  };
  return NextResponse.json(respuesta);
}
