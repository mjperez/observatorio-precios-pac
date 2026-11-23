import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { PROMPT_OCR, extraerJson, validarBoletaOCR } from "@/lib/ocr";

const TAMANO_MAXIMO = 5_242_880;
const MIME_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type RespuestaModelo = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

/** Analiza una boleta y devuelve un borrador para confirmación (US-C3). */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "La sesión expiró. Vuelve a ingresar." }, { status: 401 });
  }

  const claveDeepSeek = process.env.DEEPSEEK_API_KEY;
  const clave = claveDeepSeek ?? process.env.OPENAI_API_KEY;
  if (!clave) {
    return NextResponse.json(
      {
        error:
          "El lector de boletas no está disponible: falta configurar DEEPSEEK_API_KEY u OPENAI_API_KEY en el servidor. Puedes usar la carga manual o por planilla.",
      },
      { status: 503 },
    );
  }

  const datos = await request.formData();
  const imagen = datos.get("imagen");
  if (!(imagen instanceof File) || imagen.size === 0) {
    return NextResponse.json({ error: "Selecciona una imagen de la boleta." }, { status: 400 });
  }
  if (!MIME_PERMITIDOS.has(imagen.type)) {
    return NextResponse.json(
      { error: "Formato no admitido. Usa JPG, PNG o WebP." },
      { status: 400 },
    );
  }
  if (imagen.size > TAMANO_MAXIMO) {
    return NextResponse.json(
      { error: "La imagen supera 5 MB. Toma una foto más liviana." },
      { status: 400 },
    );
  }

  const ruta = `${user.id}/${randomUUID()}.${EXTENSIONES[imagen.type]}`;
  const { error: errorSubida } = await supabase.storage
    .from("boletas")
    .upload(ruta, await imagen.arrayBuffer(), {
      contentType: imagen.type,
      upsert: false,
    });

  if (errorSubida) {
    console.error("[ocr/route] Error subiendo imagen:", errorSubida);
    return NextResponse.json(
      { error: "No se pudo guardar la imagen en el bucket protegido." },
      { status: 500 },
    );
  }

  try {
    const base64 = Buffer.from(await imagen.arrayBuffer()).toString("base64");
    const modelo =
      process.env.VISION_MODEL ?? (claveDeepSeek ? "deepseek-flash" : "gpt-4o-mini");
    const baseUrl =
      process.env.VISION_BASE_URL ??
      (claveDeepSeek ? "https://api.deepseek.com" : "https://api.openai.com/v1");

    const respuesta = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        max_tokens: 1200,
        // DeepSeek activa el razonamiento por defecto; en una boleta solo suma
        // latencia y tokens antes de devolver el JSON.
        ...(claveDeepSeek ? { thinking: { type: "disabled" } } : {}),
        messages: [
          { role: "system", content: PROMPT_OCR },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrae los datos de esta boleta." },
              {
                type: "image_url",
                image_url: { url: `data:${imagen.type};base64,${base64}` },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const json = (await respuesta.json()) as RespuestaModelo;
    const contenido = json.choices?.[0]?.message?.content;
    if (typeof contenido !== "string") throw new Error("Respuesta sin texto");

    const boleta = validarBoletaOCR(extraerJson(contenido));
    if (!boleta.ok) {
      await supabase.storage.from("boletas").remove([ruta]);
      return NextResponse.json({ error: boleta.error }, { status: 422 });
    }

    return NextResponse.json({ ruta, datos: boleta.datos });
  } catch (error) {
    console.error("[ocr/route] Error procesando boleta:", error);
    await supabase.storage.from("boletas").remove([ruta]);
    return NextResponse.json(
      { error: "No se pudo leer la boleta. Revisa la imagen o usa la carga manual." },
      { status: 502 },
    );
  }
}
