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

/**
 * Similitud mínima para que un vecino vectorial cuente. Medido sobre el
 * catálogo actual con doce consultas: las que tienen producto puntúan 0,45 o
 * más y las que no lo tienen, 0,39 o menos. Sin este corte, "gaseosa" devuelve
 * azúcar porque el vector siempre entrega sus vecinos más cercanos.
 *
 * No se aplica a la vía léxica, cuya escala es distinta.
 */
const UMBRAL_VECTOR = 0.4;

/**
 * Mínimo de la vía léxica, en su propia escala. El hash de tokens produce
 * colisiones: "detergente" comparte trigramas con "entera" y puntuaba 0,21
 * contra la leche. Con 0,25 ese ruido queda fuera y ninguna consulta del
 * conjunto de prueba depende de esa franja.
 */
const UMBRAL_LEXICO = 0.25;

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

  // La disponibilidad de la vía se mide antes de decidir si hay señal.
  const viaVectorialDisponible = vectoriales.length > 0;

  // La vía léxica se calcula siempre, no solo cuando falla la vectorial: aporta
  // las consultas indirectas que el vector no relaciona, como "cazuela" con
  // papas. Sus vectores se generan aquí porque los de la columna pueden venir
  // de otro proveedor y no serían comparables.
  const { data: catalogo, error: errorCatalogo } = await supabase
    .from("productos")
    .select("id_producto, id_categoria, nombre, marca, formato, categorias(nombre)")
    .eq("activo", true);

  if (errorCatalogo && !viaVectorialDisponible) {
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

  // El corte se decide a nivel de vía, no por producto. Filtrar cada candidato
  // descartaba casos legítimos por centésimas, mientras la vía léxica seguía
  // metiendo ruido. Si ninguna vía alcanza su umbral, no hay respuesta.
  const mejorVector = vectoriales.reduce((maximo, c) => Math.max(maximo, c.similitud), 0);
  const mejorLexico = lexicos.reduce((maximo, c) => Math.max(maximo, c.similitud), 0);
  const haySenal = mejorVector >= UMBRAL_VECTOR || mejorLexico >= UMBRAL_LEXICO;

  const respuesta: Respuesta = {
    productos: haySenal ? fusionarRangos(vectoriales, lexicos, limite) : [],
    proveedor: embedding.proveedor,
    degradado: !viaVectorialDisponible || embedding.degradado,
    tiempo_ms: Math.round(performance.now() - inicio),
  };
  return NextResponse.json(respuesta);
}
