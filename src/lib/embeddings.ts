/**
 * Generación de vectores para la búsqueda por lenguaje natural (US-E1).
 *
 * Hay dos rutas. Con OPENAI_API_KEY se usa un modelo de embeddings y se
 * guarda el resultado en pgvector. Sin clave se genera un vector léxico
 * determinista a partir de tokens y trigramas: no es semántica generativa,
 * pero permite que la búsqueda siga funcionando y deja constancia del modo
 * degradado en la respuesta de la API.
 */

export const DIMENSIONES_EMBEDDING = 256;

const PALABRAS_VACIAS = new Set([
  "algo",
  "algunas",
  "algunos",
  "comprar",
  "hay",
  "para",
  "por",
  "con",
  "del",
  "las",
  "los",
  "una",
  "uno",
  "unos",
  "unas",
  "y",
]);

/** Ampliación acotada al dominio comunal. No sustituye a un modelo semántico. */
const SINONIMOS: Record<string, string[]> = {
  cazuela: ["papa", "cebolla", "zapallo", "zanahoria", "choclo"],
  verdura: ["lechuga", "tomate", "zapallo", "zanahoria", "pepino"],
  verduras: ["lechuga", "tomate", "zapallo", "zanahoria", "pepino"],
  desayuno: ["leche", "huevo", "pan", "cafe", "azucar"],
  barato: ["economico", "oferta"],
  economico: ["barato", "oferta"],
  cocina: ["aceite", "sal", "arroz", "fideo"],
};

export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizar(texto: string): string[] {
  const base = normalizarTexto(texto)
    .split(" ")
    .filter((t) => t.length > 2 && !PALABRAS_VACIAS.has(t));
  const expandidos = [...base];
  for (const token of base) {
    expandidos.push(...(SINONIMOS[token] ?? []));
  }
  return [...new Set(expandidos)];
}

/** Hash FNV-1a de 32 bits, estable entre ejecuciones y lenguajes. */
function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizarVector(vector: number[]): number[] {
  const norma = Math.sqrt(vector.reduce((suma, n) => suma + n * n, 0));
  if (norma === 0) return vector;
  return vector.map((n) => n / norma);
}

/**
 * Vector léxico con firma de tokens y trigramas. Se usa sólo cuando no hay
 * proveedor de embeddings configurado; el llamador debe informar el modo.
 */
export function embeddingLocal(
  texto: string,
  dimensiones = DIMENSIONES_EMBEDDING,
): number[] {
  const vector = new Array<number>(dimensiones).fill(0);
  const tokens = tokenizar(texto);

  for (const token of tokens) {
    vector[hashToken(token) % dimensiones] += 1;
    for (let i = 0; i + 3 <= token.length; i++) {
      vector[hashToken(`tri:${token.slice(i, i + 3)}`) % dimensiones] += 0.25;
    }
  }

  return normalizarVector(vector);
}

export function similitudCoseno(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let producto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < n; i++) {
    producto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  return producto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

export function aLiteralVector(vector: number[]): string {
  return `[${vector.map((n) => n.toFixed(6)).join(",")}]`;
}

export function desdeLiteralVector(literal: string): number[] | null {
  const contenido = literal.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!contenido.trim()) return [];
  const partes = contenido.split(",").map((p) => Number(p.trim()));
  if (partes.some((n) => !Number.isFinite(n))) return null;
  return partes;
}

export type ProveedorEmbedding = "openai" | "local";

export type ResultadoEmbedding = {
  vector: number[];
  proveedor: ProveedorEmbedding;
  degradado: boolean;
};

type RespuestaOpenAI = {
  data?: Array<{ embedding?: unknown }>;
};

/** Prioriza el proveedor externo y cae al vector léxico si falla o no hay clave. */
export async function generarEmbedding(
  texto: string,
  env: Record<string, string | undefined> = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoEmbedding> {
  const clave = env.OPENAI_API_KEY ?? env.EMBEDDING_API_KEY;
  if (!clave) {
    return { vector: embeddingLocal(texto), proveedor: "local", degradado: true };
  }

  try {
    const respuesta = await fetchFn("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.EMBEDDING_MODEL ?? "text-embedding-3-small",
        input: texto,
        dimensions: DIMENSIONES_EMBEDDING,
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

    const json = (await respuesta.json()) as RespuestaOpenAI;
    const vector = json.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.some((n) => typeof n !== "number")) {
      throw new Error("Vector inválido en la respuesta del proveedor");
    }

    return {
      vector: vector as number[],
      proveedor: "openai",
      degradado: false,
    };
  } catch (error) {
    console.error("[embeddings] Falló el proveedor, se usa Vector local:", error);
    return { vector: embeddingLocal(texto), proveedor: "local", degradado: true };
  }
}
