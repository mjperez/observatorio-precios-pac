import { describe, expect, it, vi } from "vitest";
import {
  DIMENSIONES_EMBEDDING,
  aLiteralVector,
  desdeLiteralVector,
  embeddingLocal,
  generarEmbedding,
  normalizarTexto,
  similitudCoseno,
  tokenizar,
} from "./embeddings";

describe("embeddings locales (US-E1)", () => {
  it("normaliza tildes, puntuación y mayúsculas", () => {
    expect(normalizarTexto("¿Verduras Baratas?")).toBe("verduras baratas");
  });

  it("expande términos del dominio comunal", () => {
    const tokens = tokenizar("algo para hacer cazuela");
    expect(tokens).toContain("cazuela");
    expect(tokens).toContain("zapallo");
    expect(tokens).toContain("papa");
  });

  it("produce vectores deterministas de la dimensión declarada", () => {
    const a = embeddingLocal("leche entera");
    const b = embeddingLocal("leche entera");
    expect(a).toHaveLength(DIMENSIONES_EMBEDDING);
    expect(a).toEqual(b);
  });

  it("la similitud de un texto consigo mismo es 1 y con otro distinto es menor", () => {
    const a = embeddingLocal("arroz grano largo");
    const b = embeddingLocal("arroz grano largo");
    const c = embeddingLocal("detergente liquido");
    expect(similitudCoseno(a, b)).toBeCloseTo(1, 5);
    expect(similitudCoseno(a, c)).toBeLessThan(similitudCoseno(a, b));
  });

  it("serializa y reconstruye el vector para PostgREST", () => {
    const vector = embeddingLocal("pan integral");
    const reconstruido = desdeLiteralVector(aLiteralVector(vector));
    expect(reconstruido).not.toBeNull();
    expect(reconstruido?.length).toBe(vector.length);
    expect(reconstruido?.[0]).toBeCloseTo(vector[0], 5);
  });

  it("usa el vector léxico cuando no hay clave configurada", async () => {
    const resultado = await generarEmbedding("arroz", {});
    expect(resultado.proveedor).toBe("local");
    expect(resultado.degradado).toBe(true);
    expect(resultado.vector).toEqual(embeddingLocal("arroz"));
  });

  it("usa OpenAI cuando hay clave y responde con un vector válido", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ embedding: [1, 0, 0, 0] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const resultado = await generarEmbedding(
      "arroz",
      { OPENAI_API_KEY: "clave-de-prueba" },
      fetchMock,
    );
    expect(resultado.proveedor).toBe("openai");
    expect(resultado.degradado).toBe(false);
    expect(resultado.vector).toEqual([1, 0, 0, 0]);
  });

  it("cae al modo local si el proveedor falla", async () => {
    const fetchMock = vi.fn(async () => new Response("error", { status: 500 })) as unknown as typeof fetch;
    const resultado = await generarEmbedding(
      "arroz",
      { OPENAI_API_KEY: "clave-de-prueba" },
      fetchMock,
    );
    expect(resultado.proveedor).toBe("local");
    expect(resultado.degradado).toBe(true);
  });
});
