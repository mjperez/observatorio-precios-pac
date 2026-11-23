/**
 * Texto que representa a un producto para la búsqueda (US-E1).
 *
 * Lo usan el indexador de embeddings y la vía léxica de
 * /api/busqueda-semantica. Tiene que ser el mismo texto en los dos lados: si el
 * índice vectoriza una cosa y la consulta compara contra otra, las vías dejan
 * de ser comparables y aparecen resultados que ninguna de las dos justifica.
 *
 * Los alias de producto entran porque la tabla `aliases` existe para que un
 * vecino encuentre "marraqueta" cuando el catálogo dice "pan corriente", y
 * porque aportan la forma singular que la tokenización no deriva. Los alias de
 * categoría no entran: designan a la categoría, no a sus integrantes.
 */

export type FilaAlias = {
  alias: string;
  id_categoria: number | null;
  id_producto: number | null;
};

export type MapasAlias = {
  /** No se usa para construir el texto; queda para expandir consultas. */
  porCategoria: Map<number, string[]>;
  porProducto: Map<number, string[]>;
};

export type ProductoParaTexto = {
  id_producto: number;
  id_categoria: number;
  nombre: string;
  marca: string;
  formato: string;
  categoria: string | null;
};

export function agruparAlias(filas: FilaAlias[]): MapasAlias {
  const porCategoria = new Map<number, string[]>();
  const porProducto = new Map<number, string[]>();

  for (const fila of filas) {
    const termino = fila.alias?.trim();
    if (!termino) continue;

    if (fila.id_categoria !== null) {
      porCategoria.set(fila.id_categoria, [
        ...(porCategoria.get(fila.id_categoria) ?? []),
        termino,
      ]);
    } else if (fila.id_producto !== null) {
      porProducto.set(fila.id_producto, [
        ...(porProducto.get(fila.id_producto) ?? []),
        termino,
      ]);
    }
  }

  return { porCategoria, porProducto };
}

export function nombreDeCategoria(
  categorias: { nombre: string } | { nombre: string }[] | null,
): string | null {
  if (Array.isArray(categorias)) return categorias[0]?.nombre ?? null;
  return categorias?.nombre ?? null;
}

export function textoProducto(producto: ProductoParaTexto, alias: MapasAlias): string {
  // Solo los alias del producto. Un alias de categoría designa a la categoría,
  // no a cada uno de sus integrantes: inyectarlo en todos haría que el té
  // heredara "gaseosa" y el azúcar "dulce de leche", que es falso. Para que
  // "papa" encuentre Papas hay que cargarlo como alias del producto.
  const terminos = new Set<string>([
    producto.nombre,
    producto.marca,
    producto.formato,
    producto.categoria ?? "",
    ...(alias.porProducto.get(producto.id_producto) ?? []),
  ]);

  return [...terminos]
    .map((termino) => termino.trim())
    .filter(Boolean)
    .join(" ");
}
