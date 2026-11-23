import { describe, expect, it } from "vitest";
import {
  coincideProducto,
  extraerJson,
  normalizarNombreOCR,
  parsearMontoOCR,
  validarBoletaOCR,
} from "./ocr";

describe("lector de boletas (US-C3)", () => {
  it("normaliza nombres quitando tildes y medidas", () => {
    expect(normalizarNombreOCR("Arroz Grano Largo 1 kg")).toBe("arroz grano largo");
  });

  it("interpreta montos chilenos con y sin separador de miles", () => {
    expect(parsearMontoOCR("1290")).toBe(1290);
    expect(parsearMontoOCR("1290,50")).toBe(1290.5);
    expect(parsearMontoOCR("1.290")).toBe(1290);
    expect(parsearMontoOCR("1.290,50")).toBe(1290.5);
    expect(parsearMontoOCR(1290)).toBe(1290);
  });

  it("rechaza montos ambiguos", () => {
    expect(parsearMontoOCR("1,299")).toBeNull();
    expect(parsearMontoOCR("abc")).toBeNull();
    expect(parsearMontoOCR(-1)).toBeNull();
  });

  it("extrae JSON de una respuesta con cerca de código", () => {
    const respuesta = 'Claro:\n```json\n{"items":[{"nombre":"Pan","precio":800}]}\n```';
    expect(extraerJson(respuesta)).toMatchObject({ items: [{ nombre: "Pan" }] });
  });

  it("devuelve null si el modelo no entrega JSON", () => {
    expect(extraerJson("No pude leer la boleta")).toBeNull();
  });

  it("acepta una boleta válida y conserva comercio y fecha", () => {
    const resultado = validarBoletaOCR({
      comercio: "Almacén Sanhueza",
      fecha: "2026-11-23",
      items: [{ nombre: "Arroz", precio: "1.290", cantidad: 2 }],
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.datos.items[0].precio).toBe(1290);
      expect(resultado.datos.comercio).toBe("Almacén Sanhueza");
    }
  });

  it("rechaza boletas sin ítems", () => {
    const resultado = validarBoletaOCR({ items: [] });
    expect(resultado).toMatchObject({ ok: false });
  });

  it("rechaza ítems con precio inválido", () => {
    const resultado = validarBoletaOCR({ items: [{ nombre: "Pan", precio: "x" }] });
    expect(resultado).toMatchObject({ ok: false });
  });

  it("relaciona el nombre de la boleta con el catálogo", () => {
    expect(coincideProducto("Arroz grano largo 1 kg", "Arroz grano largo", "Belilla")).toBe(true);
    expect(coincideProducto("Arroz grano largo", "Detergente liquido", "Snap")).toBe(false);
  });
});
