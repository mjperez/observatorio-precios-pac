import { describe, expect, it } from "vitest";
import {
  agregarPorCategoria,
  canastaBasica,
  desplazarDias,
  resumenGeneral,
  variacionSemanal,
  type FilaMetrica,
} from "./metricas";

function fila(
  valor: number,
  fecha_registro: string,
  id_producto = 1,
  categoria = "Alimentos",
): FilaMetrica {
  return { valor, fecha_registro, id_producto, categoria };
}

describe("resumenGeneral", () => {
  it("calcula promedio, extremos y desviación poblacional", () => {
    const resultado = resumenGeneral([
      fila(100, "2026-11-20"),
      fila(200, "2026-11-20"),
      fila(300, "2026-11-20"),
    ]);

    expect(resultado).toMatchObject({
      registros: 3,
      promedio: 200,
      minimo: 100,
      maximo: 300,
      desviacion: 81.65,
    });
  });

  it("devuelve ceros cuando no hay filas", () => {
    expect(resumenGeneral([]).registros).toBe(0);
    expect(resumenGeneral([]).promedio).toBe(0);
  });
});

describe("agregarPorCategoria", () => {
  it("agrupa por categoría y ordena por cantidad de registros", () => {
    const resultado = agregarPorCategoria([
      fila(100, "2026-11-20", 1, "Aseo"),
      fila(300, "2026-11-20", 2, "Alimentos"),
      fila(500, "2026-11-20", 3, "Alimentos"),
    ]);

    expect(resultado[0].categoria).toBe("Alimentos");
    expect(resultado[0].promedio).toBe(400);
    expect(resultado[1].promedio).toBe(100);
  });
});

describe("canastaBasica", () => {
  it("toma el mínimo de cada producto y lo suma", () => {
    const resultado = canastaBasica([
      fila(100, "2026-11-20", 1),
      fila(90, "2026-11-21", 1),
      fila(200, "2026-11-20", 2),
    ]);

    expect(resultado.productos).toBe(2);
    expect(resultado.total).toBe(290);
    expect(resultado.detalle[0].valor).toBe(90);
  });
});

describe("variacionSemanal", () => {
  it("compara la semana que cierra en la fecha dada con la anterior", () => {
    const filas = [
      fila(100, "2026-11-10T12:00:00Z"),
      fila(100, "2026-11-11T12:00:00Z"),
      fila(120, "2026-11-18T12:00:00Z"),
      fila(140, "2026-11-19T12:00:00Z"),
    ];

    expect(variacionSemanal(filas, "2026-11-19")).toBe(30);
  });

  it("devuelve null si falta alguna de las dos semanas", () => {
    expect(variacionSemanal([fila(100, "2026-11-19T12:00:00Z")], "2026-11-19")).toBeNull();
  });
});

describe("desplazarDias", () => {
  it("cruza correctamente el límite del mes", () => {
    expect(desplazarDias("2026-11-01", -1)).toBe("2026-10-31");
    expect(desplazarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});
