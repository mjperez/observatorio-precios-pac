import { describe, expect, it } from "vitest";
import { fusionarRangos, type Candidato } from "./hibrida";

function candidato(id: number, similitud = 0.5): Candidato {
  return {
    id_producto: id,
    nombre: `Producto ${id}`,
    marca: "sin marca",
    formato: "1 kg",
    similitud,
  };
}

describe("fusión de rankings (US-E1)", () => {
  it("devuelve vacío cuando ambas vías están vacías", () => {
    expect(fusionarRangos([], [], 8)).toEqual([]);
  });

  it("normaliza el puntaje del primero a 1 y conserva el orden", () => {
    const resultado = fusionarRangos([candidato(1), candidato(2)], [], 8);
    expect(resultado[0].puntaje).toBe(1);
    expect(resultado.map((r) => r.id_producto)).toEqual([1, 2]);
    expect(resultado[0].origen).toBe("vector");
  });

  it("sube un producto que aparece alto en las dos vías", () => {
    // El producto 2 es tercero en la vía vectorial pero primero en la léxica,
    // así que acumula dos aportes y adelanta al producto 1.
    const resultado = fusionarRangos(
      [candidato(1), candidato(3), candidato(2)],
      [candidato(2), candidato(4)],
      8,
    );
    expect(resultado[0].id_producto).toBe(2);
    expect(resultado[0].origen).toBe("ambos");
  });

  it("marca como léxico lo que solo aparece en la vía de tokens", () => {
    const resultado = fusionarRangos([candidato(1)], [candidato(2)], 8);
    const soloLexico = resultado.find((r) => r.id_producto === 2);
    expect(soloLexico?.origen).toBe("lexico");
    expect(soloLexico?.similitud).toBe(0.5);
  });

  it("respeta el límite de resultados", () => {
    const lista = Array.from({ length: 12 }, (_, i) => candidato(i + 1));
    expect(fusionarRangos(lista, [], 8)).toHaveLength(8);
  });

  it("no duplica un producto presente en ambas vías", () => {
    const resultado = fusionarRangos([candidato(1), candidato(2)], [candidato(2), candidato(1)], 8);
    expect(resultado).toHaveLength(2);
  });

  it("empata el puntaje cuando dos productos aparecen en la misma posición", () => {
    const resultado = fusionarRangos([candidato(1)], [candidato(2)], 8);
    expect(resultado[0].puntaje).toBe(resultado[1].puntaje);
  });
});
