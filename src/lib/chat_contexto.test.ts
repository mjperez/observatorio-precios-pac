import { describe, expect, it } from "vitest";
import {
  construirSystemPrompt,
  esConsultaSoloOfertas,
  extraerFuentes,
  extraerPalabrasClave,
  formatearPesoChileno,
  obtenerPrecioEfectivo,
  resolverConfiguracionIA,
  sanitizarHistorialMensajes,
  type ProductoConPrecios,
  type ResultadoComparador,
} from "./chat_contexto";

describe("extraerPalabrasClave", () => {
  it("extrae términos relevantes del producto e ignora stopwords en español", () => {
    const tokens = extraerPalabrasClave(
      "¿Dónde está más barato el arroz grado 1 en Pedro Aguirre Cerda?"
    );
    expect(tokens).toEqual(["arroz", "grado"]);
  });

  it("normaliza tildes, elimina duplicados y respeta el límite de 6 términos", () => {
    const tokens = extraerPalabrasClave(
      "Azúcar, aceite vegetal, fideos tallarines, leche entera, pan hallulla, huevos blancos, harina"
    );
    expect(tokens).toEqual([
      "azucar",
      "aceite",
      "vegetal",
      "fideos",
      "tallarines",
      "leche",
    ]);
  });

  it("retorna arreglo vacío si la pregunta solo contiene palabras vacías", () => {
    expect(extraerPalabrasClave("Hola, ¿cómo funciona esto hoy?")).toEqual([]);
  });
});

describe("sanitizarHistorialMensajes", () => {
  it("rechaza entradas inválidas o historiales cuyo último turno no sea del usuario", () => {
    expect(sanitizarHistorialMensajes(null)).toEqual([]);
    expect(sanitizarHistorialMensajes([])).toEqual([]);
    expect(
      sanitizarHistorialMensajes([
        { role: "user", content: "Hola" },
        { role: "assistant", content: "Hola vecino" },
      ])
    ).toEqual([]);
  });

  it("limita el historial a los últimos 10 turnos y trunca mensajes de usuario a 600 caracteres", () => {
    const largo = "a".repeat(750);
    const historial = Array.from({ length: 13 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: i === 12 ? largo : `Mensaje ${i}`,
    }));

    const resultado = sanitizarHistorialMensajes(historial, 10, 600);
    expect(resultado).toHaveLength(10);
    expect(resultado[0].content).toBe("Mensaje 3");
    expect(resultado[9].role).toBe("user");
    expect(resultado[9].content).toHaveLength(600);
  });

  it("elimina caracteres de control invisibles", () => {
    const resultado = sanitizarHistorialMensajes([
      { role: "user", content: "Precio\u0000 del\u0007 pan" },
    ]);
    expect(resultado).toEqual([{ role: "user", content: "Precio del pan" }]);
  });
});

describe("formatearPesoChileno y precios efectivos", () => {
  it("formatea montos en formato chileno $X.XXX", () => {
    expect(formatearPesoChileno(990)).toBe("$990");
    expect(formatearPesoChileno(1490)).toBe("$1.490");
    expect(formatearPesoChileno(12500)).toBe("$12.500");
  });

  it("prioriza precio_oferta cuando oferta_vigente es true", () => {
    const base: ResultadoComparador = {
      id_comercio: 1,
      comercio: "Almacén Don Tito",
      matriz_nombre: null,
      direccion: "Av. Clotario Blest 4120",
      tipo: "Almacén",
      valor: 1800,
      precio_oferta: 1390,
      oferta_vigente: true,
      fecha_inicio_vigencia: "2026-11-20",
      fecha_fin_vigencia: "2026-11-30",
      condiciones: "Máximo 2 unidades por boleta",
      fecha_registro: "2026-11-22",
      origen: "terreno",
      distancia_m: null,
    };

    expect(obtenerPrecioEfectivo(base)).toEqual({
      precio: 1390,
      esOferta: true,
    });

    expect(
      obtenerPrecioEfectivo({ ...base, oferta_vigente: false })
    ).toEqual({
      precio: 1800,
      esOferta: false,
    });
  });

  it("detecta consultas generales sobre ofertas vigentes", () => {
    expect(esConsultaSoloOfertas("¿Qué ofertas hay vigentes hoy?")).toBe(true);
    expect(esConsultaSoloOfertas("¿Cuánto vale el kilo de pan?")).toBe(false);
  });
});

describe("construirSystemPrompt y extraerFuentes", () => {
  const muestra: ProductoConPrecios[] = [
    {
      producto: {
        id_producto: 10,
        nombre: "Arroz Grado 1",
        marca: "Tucapel",
        formato: "1",
        unidad: "kg",
        categoria: "Abarrotes",
      },
      precios: [
        {
          id_comercio: 2,
          comercio: "Supermercado PAC Centro",
          matriz_nombre: null,
          direccion: "Av. Departamental 3500",
          tipo: "Supermercado",
          valor: 1650,
          precio_oferta: null,
          oferta_vigente: false,
          fecha_inicio_vigencia: null,
          fecha_fin_vigencia: null,
          condiciones: null,
          fecha_registro: "2026-11-21",
          origen: "terreno",
          distancia_m: null,
        },
        {
          id_comercio: 5,
          comercio: "Almacén La Victoria",
          matriz_nombre: null,
          direccion: "Calle La Marina 2810",
          tipo: "Almacén",
          valor: 1590,
          precio_oferta: 1290,
          oferta_vigente: true,
          fecha_inicio_vigencia: "2026-11-20",
          fecha_fin_vigencia: "2026-11-25",
          condiciones: "Pago en efectivo o débito",
          fecha_registro: "2026-11-22",
          origen: "terreno",
          distancia_m: null,
        },
      ],
    },
  ];

  it("extrae fuentes ordenadas de menor a mayor precio efectivo", () => {
    const fuentes = extraerFuentes(muestra);
    expect(fuentes).toEqual([
      {
        producto: "Arroz Grado 1 Tucapel 1",
        comercio: "Almacén La Victoria",
        precio: 1290,
        esOferta: true,
      },
      {
        producto: "Arroz Grado 1 Tucapel 1",
        comercio: "Supermercado PAC Centro",
        precio: 1650,
        esOferta: false,
      },
    ]);
  });

  it("construye el prompt institucional con datos de Supabase y aclaración ciudadana obligatoria", () => {
    const prompt = construirSystemPrompt({
      productosConPrecios: muestra,
      totalComerciosActivos: 14,
      nombresComercios: ["Almacén La Victoria", "Supermercado PAC Centro"],
      fechaConsulta: "22 de noviembre de 2026",
    });

    expect(prompt).toContain("Observatorio de Precios PAC");
    expect(prompt).toContain("Arroz Grado 1");
    expect(prompt).toContain("Almacén La Victoria");
    expect(prompt).toContain("$1.290");
    expect(prompt).toContain("OFERTA VIGENTE");
    expect(prompt).toContain("Pago en efectivo o débito");
    expect(prompt).toContain(
      "Los precios son referenciales según la última recolección validada y el stock en sala no está garantizado."
    );
    expect(prompt).toContain("/comparador");
  });
});

describe("resolverConfiguracionIA", () => {
  it("detecta DeepSeek automáticamente cuando existe DEEPSEEK_API_KEY", () => {
    const config = resolverConfiguracionIA({
      DEEPSEEK_API_KEY: "sk-ds-123",
    });
    expect(config).toEqual({
      provider: "deepseek",
      apiKey: "sk-ds-123",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
  });

  it("permite cambiar a OpenAI y personalizar modelo o URL base", () => {
    const config = resolverConfiguracionIA({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-oa-456",
      AI_MODEL: "gpt-4o",
    });
    expect(config).toEqual({
      provider: "openai",
      apiKey: "sk-oa-456",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
    });
  });

  it("retorna null cuando no hay ninguna clave configurada", () => {
    expect(resolverConfiguracionIA({})).toBeNull();
  });
});
