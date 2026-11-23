import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  construirSystemPrompt,
  esConsultaSoloOfertas,
  extraerFuentes,
  extraerPalabrasClave,
  resolverConfiguracionIA,
  sanitizarHistorialMensajes,
  type ProductoCatalogo,
  type ProductoConPrecios,
  type ResultadoComparador,
} from "@/lib/chat_contexto";

const VENTANA_RATE_LIMIT_MS = 60_000;
const MAX_PETICIONES_POR_MINUTO = 20;
const TIMEOUT_IA_MS = 25_000;

interface EntradaRateLimit {
  conteo: number;
  reinicioEn: number;
}

const registroRateLimit = new Map<string, EntradaRateLimit>();

function obtenerIpCliente(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const primeraIp = forwardedFor.split(",")[0]?.trim();
    if (primeraIp) return primeraIp;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "ip-desconocida";
}

function verificarRateLimit(ip: string): boolean {
  const ahora = Date.now();

  if (registroRateLimit.size > 500) {
    for (const [clave, valor] of registroRateLimit.entries()) {
      if (valor.reinicioEn <= ahora) {
        registroRateLimit.delete(clave);
      }
    }
  }

  const actual = registroRateLimit.get(ip);
  if (!actual || actual.reinicioEn <= ahora) {
    registroRateLimit.set(ip, {
      conteo: 1,
      reinicioEn: ahora + VENTANA_RATE_LIMIT_MS,
    });
    return true;
  }

  if (actual.conteo >= MAX_PETICIONES_POR_MINUTO) {
    return false;
  }

  actual.conteo += 1;
  return true;
}

function sanitizarTokenFiltroPostgrest(token: string): string {
  return token.replace(/[^a-z0-9]/gi, "");
}

interface FilaProductoSupabase {
  id_producto: number;
  nombre: string;
  marca: string | null;
  formato: string | null;
  unidad: string | null;
  categorias: { nombre: string } | Array<{ nombre: string }> | null;
}

function mapearProducto(fila: FilaProductoSupabase): ProductoCatalogo {
  const categoriaNombre = Array.isArray(fila.categorias)
    ? fila.categorias[0]?.nombre ?? null
    : fila.categorias?.nombre ?? null;

  return {
    id_producto: fila.id_producto,
    nombre: fila.nombre,
    marca: fila.marca,
    formato: fila.formato,
    unidad: fila.unidad,
    categoria: categoriaNombre,
  };
}

function calcularRelevanciaProducto(
  producto: ProductoCatalogo,
  keywords: string[]
): number {
  if (keywords.length === 0) return 0;
  const nombreNorm = producto.nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const marcaNorm = (producto.marca ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let puntaje = 0;
  for (const kw of keywords) {
    if (nombreNorm.includes(kw)) puntaje += 3;
    if (marcaNorm.includes(kw)) puntaje += 1;
  }
  return puntaje;
}

export async function POST(request: NextRequest) {
  const ip = obtenerIpCliente(request);
  if (!verificarRateLimit(ip)) {
    return NextResponse.json(
      {
        error:
          "Has superado el límite de consultas por minuto (20 solicitudes/min). Por favor, espera unos segundos e intenta nuevamente.",
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "El formato de la solicitud es inválido." },
      { status: 400 }
    );
  }

  const rawMessages =
    body && typeof body === "object"
      ? (body as { messages?: unknown }).messages
      : undefined;

  const mensajes = sanitizarHistorialMensajes(rawMessages, 10, 600);
  if (mensajes.length === 0) {
    return NextResponse.json(
      {
        error:
          "Debes enviar al menos un mensaje válido para consultar al asistente.",
      },
      { status: 400 }
    );
  }

  const configIA = resolverConfiguracionIA();
  if (!configIA) {
    console.error("[chat/route] Falta configurar AI_API_KEY en el servidor.");
    return NextResponse.json(
      {
        error:
          "El asistente virtual no está disponible temporalmente. Puedes revisar los precios vigentes directamente en la sección Comparador.",
      },
      { status: 503 }
    );
  }

  try {
    const supabase = await createClient();
    const ultimoMensajeUsuario = mensajes[mensajes.length - 1].content;
    const keywords = extraerPalabrasClave(ultimoMensajeUsuario);
    const buscaOfertas = esConsultaSoloOfertas(ultimoMensajeUsuario);

    const tokensLimpios = keywords
      .map(sanitizarTokenFiltroPostgrest)
      .filter((t) => t.length >= 2);

    const consultaProductos = async (): Promise<ProductoCatalogo[]> => {
      if (tokensLimpios.length > 0) {
        const filtrosOr = tokensLimpios
          .flatMap((kw) => [`nombre.ilike.%${kw}%`, `marca.ilike.%${kw}%`])
          .join(",");

        const { data, error } = await supabase
          .from("productos")
          .select(
            "id_producto, nombre, marca, formato, unidad, categorias(nombre)"
          )
          .eq("activo", true)
          .or(filtrosOr)
          .limit(12);

        if (!error && data && data.length > 0) {
          return (data as unknown as FilaProductoSupabase[]).map(mapearProducto);
        }
      }

      const { data, error } = await supabase
        .from("productos")
        .select(
          "id_producto, nombre, marca, formato, unidad, categorias(nombre)"
        )
        .eq("activo", true)
        .order("id_producto", { ascending: true })
        .limit(buscaOfertas ? 8 : 6);

      if (error || !data) return [];
      return (data as unknown as FilaProductoSupabase[]).map(mapearProducto);
    };

    const consultaComercios = async (): Promise<{
      total: number;
      nombres: string[];
    }> => {
      const { data, count, error } = await supabase
        .from("comercios")
        .select("nombre", { count: "exact" })
        .eq("activo", true)
        .limit(8);

      if (error) {
        return { total: 0, nombres: [] };
      }

      const nombres = (data ?? [])
        .map((c: { nombre: string | null }) => c.nombre)
        .filter((n): n is string => Boolean(n));

      return {
        total: count ?? nombres.length,
        nombres,
      };
    };

    const [catalogoEncontrado, infoComercios] = await Promise.all([
      consultaProductos(),
      consultaComercios(),
    ]);

    const candidatos =
      tokensLimpios.length > 0
        ? [...catalogoEncontrado].sort(
            (a, b) =>
              calcularRelevanciaProducto(b, keywords) -
              calcularRelevanciaProducto(a, keywords)
          )
        : catalogoEncontrado;

    const productosSeleccionados = candidatos.slice(0, 3);

    const productosConPrecios: ProductoConPrecios[] = await Promise.all(
      productosSeleccionados.map(async (producto) => {
        const { data, error } = await supabase.rpc("fn_comparador", {
          p_producto: producto.id_producto,
        });

        const precios =
          !error && Array.isArray(data)
            ? (data as ResultadoComparador[])
            : [];

        return {
          producto,
          precios,
        };
      })
    );

    const fechaConsulta = new Intl.DateTimeFormat("es-CL", {
      dateStyle: "long",
      timeZone: "America/Santiago",
    }).format(new Date());

    const systemPrompt = construirSystemPrompt({
      productosConPrecios,
      totalComerciosActivos: infoComercios.total,
      nombresComercios: infoComercios.nombres,
      fechaConsulta,
    });

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_IA_MS);

    let respuestaIA: Response;
    try {
      respuestaIA = await fetch(`${configIA.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${configIA.apiKey}`,
        },
        body: JSON.stringify({
          model: configIA.model,
          messages: [
            { role: "system", content: systemPrompt },
            ...mensajes,
          ],
          temperature: 0.2,
          max_tokens: 650,
        }),
        signal: controlador.signal,
      });
    } finally {
      clearTimeout(temporizador);
    }

    if (!respuestaIA.ok) {
      console.error(
        `[chat/route] Error de proveedor IA (${configIA.provider}): HTTP ${respuestaIA.status}`
      );
      return NextResponse.json(
        {
          error:
            "No fue posible procesar tu consulta en este momento. Intenta nuevamente en unos segundos o usa el Comparador.",
        },
        { status: 502 }
      );
    }

    const payloadIA = (await respuestaIA.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const reply = payloadIA.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return NextResponse.json(
        {
          error:
            "El asistente no pudo generar una respuesta válida. Por favor, reformula tu consulta.",
        },
        { status: 502 }
      );
    }

    const fuentes =
      tokensLimpios.length > 0 || buscaOfertas
        ? extraerFuentes(productosConPrecios)
        : [];

    return NextResponse.json({
      reply,
      fuentes,
    });
  } catch (error) {
    const esTimeout =
      error instanceof Error && error.name === "AbortError";
    console.error(
      `[chat/route] Fallo inesperado en endpoint de chat${esTimeout ? " (timeout)" : ""}.`
    );
    return NextResponse.json(
      {
        error:
          "Ocurrió un problema de conexión al consultar los datos del Observatorio PAC. Por favor, inténtalo nuevamente.",
      },
      { status: 500 }
    );
  }
}
