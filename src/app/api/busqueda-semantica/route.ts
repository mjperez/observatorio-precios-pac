import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  aLiteralVector,
  embeddingLocal,
  generarEmbedding,
  similitudCoseno,
} from "@/lib/embeddings";
import { fusionarRangos, type Candidato, type Fusionado } from "@/lib/hibrida";
import {
  agruparAlias,
  nombreDeCategoria,
  textoProducto,
  type FilaAlias,
} from "@/lib/texto_producto";

type Respuesta = {
  productos: Fusionado[];
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

  const vectoriales: Candidato[] = (errorRpc || !Array.isArray(rpc) ? [] : rpc).map(
    (fila: {
      formato: string;
      id_producto: number;
      marca: string;
      nombre: string;
      similitud: number;
    }) => ({
      formato: fila.formato,
      id_producto: fila.id_producto,
      marca: fila.marca,
      nombre: fila.nombre,
      similitud: Number(fila.similitud.toFixed(4)),
    }),
  );

  // La vía léxica se calcula siempre, no solo cuando falla la vectorial: aporta
  // las consultas indirectas que el vector no relaciona, como "cazuela" con
  // papas. Sus vectores se generan aquí porque los de la columna pueden venir
  // de otro proveedor y no serían comparables.
  const { data: catalogo, error: errorCatalogo } = await supabase
    .from("productos")
    .select("id_producto, id_categoria, nombre, marca, formato, categorias(nombre)")
    .eq("activo", true);

  if (errorCatalogo && vectoriales.length === 0) {
    console.error("[busqueda-semantica] Error leyendo catálogo:", errorCatalogo);
    return NextResponse.json(
      { error: "No se pudo realizar la búsqueda. Intenta nuevamente." },
      { status: 500 },
    );
  }

  const { data: filasAlias } = await supabase
    .from("aliases")
    .select("alias, id_categoria, id_producto");

  const mapasAlias = agruparAlias((filasAlias ?? []) as FilaAlias[]);
  const vectorConsulta = embeddingLocal(consulta);

  const lexicos: Candidato[] = (catalogo ?? [])
    .map((producto) => {
      const texto = textoProducto(
        {
          id_producto: producto.id_producto,
          id_categoria: producto.id_categoria,
          nombre: producto.nombre,
          marca: producto.marca,
          formato: producto.formato,
          categoria: nombreDeCategoria(producto.categorias),
        },
        mapasAlias,
      );
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
    productos: fusionarRangos(vectoriales, lexicos, limite),
    proveedor: embedding.proveedor,
    degradado: vectoriales.length === 0 || embedding.degradado,
    tiempo_ms: Math.round(performance.now() - inicio),
  };
  return NextResponse.json(respuesta);
}
