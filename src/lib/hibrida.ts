/**
 * Fusión de rankings para la búsqueda híbrida (US-E1).
 *
 * La vía vectorial ordena por similitud de coseno sobre pgvector y la vía
 * léxica por coincidencia de tokens con expansión de sinónimos. Los dos
 * puntajes no son comparables entre sí, así que se combinan por posición con
 * Reciprocal Rank Fusion, que solo necesita el orden de cada lista y no
 * requiere calibrar pesos.
 *
 * Cada lista aporta 1 / (k + posición). Un producto que aparece alto en ambas
 * suma dos contribuciones y sube; uno que aparece en una sola, baja.
 *
 * El valor habitual de k es 60, pensado para listas de cientos de documentos.
 * Con un catálogo pequeño ese suavizado aplana los aportes y casi todo empata,
 * así que se usa un k bajo: pesa más la cabeza de cada ranking.
 */

export const K_RRF = 10;

export type Candidato = {
  id_producto: number;
  nombre: string;
  marca: string;
  formato: string;
  similitud: number;
};

export type Fusionado = Candidato & {
  /** Relevancia relativa normalizada contra el máximo de la lista. */
  puntaje: number;
  origen: "vector" | "lexico" | "ambos";
};

export function fusionarRangos(
  vectoriales: Candidato[],
  lexicos: Candidato[],
  limite: number,
  k = K_RRF,
): Fusionado[] {
  const acumulado = new Map<
    number,
    { datos: Candidato; puntaje: number; vector: boolean; lexico: boolean }
  >();

  const aportar = (lista: Candidato[], esVector: boolean) => {
    lista.forEach((candidato, posicion) => {
      const aporte = 1 / (k + posicion + 1);
      const actual = acumulado.get(candidato.id_producto);
      if (actual) {
        actual.puntaje += aporte;
        actual.vector = actual.vector || esVector;
        actual.lexico = actual.lexico || !esVector;
      } else {
        acumulado.set(candidato.id_producto, {
          datos: candidato,
          puntaje: aporte,
          vector: esVector,
          lexico: !esVector,
        });
      }
    });
  };

  aportar(vectoriales, true);
  aportar(lexicos, false);

  if (acumulado.size === 0) return [];

  const maximo = Math.max(...[...acumulado.values()].map((fila) => fila.puntaje));

  return [...acumulado.values()]
    .map<Fusionado>((fila) => ({
      ...fila.datos,
      puntaje: Number((fila.puntaje / maximo).toFixed(4)),
      origen: fila.vector && fila.lexico ? "ambos" : fila.vector ? "vector" : "lexico",
    }))
    .sort(
      (a, b) =>
        b.puntaje - a.puntaje ||
        b.similitud - a.similitud ||
        a.id_producto - b.id_producto,
    )
    .slice(0, limite);
}
