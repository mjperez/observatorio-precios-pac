import { describe, expect, it } from "vitest";
import { agruparAlias, nombreDeCategoria, textoProducto } from "./texto_producto";

describe("texto de producto para la búsqueda (US-E1)", () => {
  it("separa alias de categoría y de producto", () => {
    const mapas = agruparAlias([
      { alias: "papa", id_categoria: 4, id_producto: null },
      { alias: "marraqueta", id_categoria: null, id_producto: 1 },
      { alias: "  ", id_categoria: 4, id_producto: null },
    ]);

    expect(mapas.porCategoria.get(4)).toEqual(["papa"]);
    expect(mapas.porProducto.get(1)).toEqual(["marraqueta"]);
    expect(mapas.porCategoria.size).toBe(1);
    expect(mapas.porProducto.size).toBe(1);
  });

  it("incluye nombre, marca, formato, categoría y los dos tipos de alias", () => {
    const mapas = agruparAlias([
      { alias: "papa", id_categoria: 4, id_producto: null },
      { alias: "patata", id_categoria: null, id_producto: 10 },
    ]);

    const texto = textoProducto(
      {
        id_producto: 10,
        id_categoria: 4,
        nombre: "Papas",
        marca: "sin marca",
        formato: "1 kg",
        categoria: "Verduras y tubérculos",
      },
      mapas,
    );

    expect(texto).toBe("Papas sin marca 1 kg Verduras y tubérculos papa patata");
  });

  it("no repite un término idéntico", () => {
    const mapas = agruparAlias([
      { alias: "sin marca", id_categoria: null, id_producto: 1 },
    ]);

    const texto = textoProducto(
      {
        id_producto: 1,
        id_categoria: 1,
        nombre: "Pan corriente",
        marca: "sin marca",
        formato: "1 kg",
        categoria: "Pan y cereales",
      },
      mapas,
    );

    expect(texto.match(/sin marca/g)).toHaveLength(1);
  });

  it("agrega el alias suelto aunque el nombre ya lo contenga", () => {
    // El Set deduplica términos completos, no palabras dentro de un término.
    // Que "marraqueta" quede dos veces no altera el vector léxico, porque la
    // tokenización vuelve a deduplicar por palabra.
    const mapas = agruparAlias([
      { alias: "marraqueta", id_categoria: null, id_producto: 1 },
    ]);

    const texto = textoProducto(
      {
        id_producto: 1,
        id_categoria: 1,
        nombre: "Pan corriente (marraqueta)",
        marca: "sin marca",
        formato: "1 kg",
        categoria: "Pan y cereales",
      },
      mapas,
    );

    expect(texto).toContain("Pan corriente (marraqueta)");
    expect(texto.endsWith("marraqueta")).toBe(true);
  });

  it("omite la categoría cuando el producto no tiene", () => {
    const texto = textoProducto(
      {
        id_producto: 2,
        id_categoria: 1,
        nombre: "Arroz",
        marca: "sin marca",
        formato: "1 kg",
        categoria: null,
      },
      agruparAlias([]),
    );

    expect(texto).toBe("Arroz sin marca 1 kg");
  });

  it("normaliza la categoría venga como objeto o como arreglo", () => {
    expect(nombreDeCategoria({ nombre: "Frutas" })).toBe("Frutas");
    expect(nombreDeCategoria([{ nombre: "Frutas" }])).toBe("Frutas");
    expect(nombreDeCategoria(null)).toBeNull();
  });
});
