/**
 * Indexa el catálogo en `productos.embedding` para la búsqueda por similitud
 * (US-E1). Sin esta columna poblada, `fn_buscar_productos_semanticos` devuelve
 * cero filas y la API responde con el modo léxico.
 *
 * Uso:
 *   npm run indexar               # solo los productos con embedding en NULL
 *   npm run indexar -- --forzar   # reindexa todo el catálogo
 *
 * El vector se genera con el mismo módulo que usa /api/busqueda-semantica, de
 * modo que el espacio vectorial de la consulta y el del catálogo coinciden.
 * Con OPENAI_API_KEY se usa el proveedor externo; sin ella se usan vectores
 * léxicos, que aprovechan el índice HNSW pero no aportan significado.
 *
 * Credenciales: si existe SUPABASE_SERVICE_ROLE_KEY se usa esa. Si no, el
 * script inicia sesión con INDEXADOR_EMAIL e INDEXADOR_PASSWORD, que deben
 * corresponder a una cuenta con rol administrador para pasar la política RLS
 * `admin_productos`.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { aLiteralVector, generarEmbedding } from "../src/lib/embeddings";

config({ path: ".env.local" });

const LOTE = 25;
const forzar = process.argv.includes("--forzar");
const esperaProveedor = Boolean(
  process.env.OPENAI_API_KEY ?? process.env.EMBEDDING_API_KEY,
);

type FilaProducto = {
  id_producto: number;
  nombre: string;
  marca: string;
  formato: string;
  categorias: { nombre: string } | { nombre: string }[] | null;
};

function exigir(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta ${nombre} en .env.local`);
    process.exit(1);
  }
  return valor;
}

function nombreCategoria(categorias: FilaProducto["categorias"]): string {
  if (Array.isArray(categorias)) return categorias[0]?.nombre ?? "";
  return categorias?.nombre ?? "";
}

async function main() {
  const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
  const claveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(
    url,
    claveServicio ?? exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  );

  if (!claveServicio) {
    const { error } = await supabase.auth.signInWithPassword({
      email: exigir("INDEXADOR_EMAIL"),
      password: exigir("INDEXADOR_PASSWORD"),
    });
    if (error) {
      console.error("No se pudo iniciar sesión como indexador:", error.message);
      process.exit(1);
    }
    console.log("Sesión iniciada con la cuenta indexadora.");
  }

  const consulta = supabase
    .from("productos")
    .select("id_producto, nombre, marca, formato, categorias(nombre)")
    .eq("activo", true)
    .order("id_producto");

  const { data, error } = await (forzar ? consulta : consulta.is("embedding", null));

  if (error) {
    console.error("No se pudo leer el catálogo:", error.message);
    process.exit(1);
  }

  const productos = (data ?? []) as FilaProducto[];
  if (productos.length === 0) {
    console.log("No hay productos pendientes. Usa --forzar para reindexar todo.");
    return;
  }

  console.log(`${productos.length} productos por indexar.`);

  let indexados = 0;
  let fallidos = 0;
  const proveedores = new Set<string>();

  for (let i = 0; i < productos.length; i += LOTE) {
    const lote = productos.slice(i, i + LOTE);

    for (const producto of lote) {
      const texto = [
        producto.nombre,
        producto.marca,
        producto.formato,
        nombreCategoria(producto.categorias),
      ]
        .filter(Boolean)
        .join(" ");

      try {
        const embedding = await generarEmbedding(texto);

        // Si hay proveedor configurado y la respuesta cae al vector léxico, es
        // un fallo transitorio. Guardarlo mezclaría dos espacios vectoriales en
        // la misma columna y arruinaría las similitudes.
        if (esperaProveedor && embedding.proveedor === "local") {
          throw new Error(
            "el proveedor no respondió y el vector sería léxico; se omite la fila",
          );
        }

        proveedores.add(embedding.proveedor);

        const { error: errorUpdate } = await supabase
          .from("productos")
          .update({ embedding: aLiteralVector(embedding.vector) })
          .eq("id_producto", producto.id_producto);

        if (errorUpdate) throw new Error(errorUpdate.message);
        indexados++;
      } catch (fallo) {
        fallidos++;
        console.error(
          `Producto ${producto.id_producto} (${producto.nombre}):`,
          fallo instanceof Error ? fallo.message : fallo,
        );
      }
    }

    console.log(`${Math.min(i + LOTE, productos.length)}/${productos.length}`);
  }

  console.log(
    `\nIndexados: ${indexados}. Fallidos: ${fallidos}. Proveedor: ${[...proveedores].join(", ") || "ninguno"}.`,
  );

  if (proveedores.has("local")) {
    console.log(
      "Los vectores son léxicos: la búsqueda aprovecha el índice, pero sigue comparando palabras y no significado.",
    );
  }
}

main().catch((error) => {
  console.error("Error inesperado:", error);
  process.exit(1);
});
