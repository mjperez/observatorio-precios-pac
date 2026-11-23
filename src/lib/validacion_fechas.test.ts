import { describe, expect, it } from "vitest";
import {
  compararFechasISO,
  diasEnMes,
  esAnioBisiesto,
  esFechaGregorianaValida,
  esMontoMonetarioValido,
  estaOfertaVigenteEnFecha,
  normalizarCondicionesOferta,
  obtenerFechaHoyChile,
  parsearFechaGregoriana,
  validarOferta,
} from "./validacion_fechas";

describe("Calendario Gregoriano (esAnioBisiesto, diasEnMes, esFechaGregorianaValida)", () => {
  it("identifica correctamente años bisiestos y seculares", () => {
    expect(esAnioBisiesto(2024)).toBe(true);
    expect(esAnioBisiesto(2028)).toBe(true);
    expect(esAnioBisiesto(2000)).toBe(true);
    expect(esAnioBisiesto(2026)).toBe(false);
    expect(esAnioBisiesto(2025)).toBe(false);
    expect(esAnioBisiesto(1900)).toBe(false);
    expect(esAnioBisiesto(2024.5)).toBe(false);
  });

  it("calcula los días exactos por mes considerando años bisiestos", () => {
    expect(diasEnMes(2026, 2)).toBe(28);
    expect(diasEnMes(2024, 2)).toBe(29);
    expect(diasEnMes(2026, 4)).toBe(30);
    expect(diasEnMes(2026, 12)).toBe(31);
    expect(diasEnMes(2026, 0)).toBe(0);
    expect(diasEnMes(2026, 13)).toBe(0);
  });

  it("acepta fechas reales del calendario gregoriano incluyendo 29 de febrero bisiesto", () => {
    expect(esFechaGregorianaValida("2026-01-01")).toBe(true);
    expect(esFechaGregorianaValida("2026-02-28")).toBe(true);
    expect(esFechaGregorianaValida("2024-02-29")).toBe(true);
    expect(esFechaGregorianaValida("2028-02-29")).toBe(true);
    expect(esFechaGregorianaValida("2026-04-30")).toBe(true);
    expect(esFechaGregorianaValida("2026-12-31")).toBe(true);

    const parsed = parsearFechaGregoriana("  2026-11-22  ");
    expect(parsed).toEqual({
      anio: 2026,
      mes: 11,
      dia: 22,
      iso: "2026-11-22",
    });
  });

  it("rechaza fechas inexistentes que JavaScript Date suele aceptar por desbordamiento", () => {
    expect(esFechaGregorianaValida("2026-02-29")).toBe(false);
    expect(esFechaGregorianaValida("2026-02-30")).toBe(false);
    expect(esFechaGregorianaValida("2026-02-31")).toBe(false);
    expect(esFechaGregorianaValida("2026-04-31")).toBe(false);
    expect(esFechaGregorianaValida("2026-06-31")).toBe(false);
    expect(esFechaGregorianaValida("2026-09-31")).toBe(false);
    expect(esFechaGregorianaValida("2026-11-31")).toBe(false);
    expect(esFechaGregorianaValida("2026-01-32")).toBe(false);
    expect(esFechaGregorianaValida("2026-00-15")).toBe(false);
    expect(esFechaGregorianaValida("2026-13-01")).toBe(false);
    expect(esFechaGregorianaValida("2026-05-00")).toBe(false);
  });

  it("rechaza formatos malformados, timestamps o tipos no string", () => {
    expect(esFechaGregorianaValida("2026/05/10")).toBe(false);
    expect(esFechaGregorianaValida("10-05-2026")).toBe(false);
    expect(esFechaGregorianaValida("2026-5-1")).toBe(false);
    expect(esFechaGregorianaValida("2026-05-10T12:00:00Z")).toBe(false);
    expect(esFechaGregorianaValida("")).toBe(false);
    expect(esFechaGregorianaValida(null)).toBe(false);
    expect(esFechaGregorianaValida(undefined)).toBe(false);
    expect(esFechaGregorianaValida(20260510)).toBe(false);
    expect(esFechaGregorianaValida("1999-01-01")).toBe(false);
    expect(esFechaGregorianaValida("2150-01-01")).toBe(false);
  });
});

describe("Comparación de fechas y zona horaria de Chile", () => {
  it("compara fechas ISO de forma determinista", () => {
    expect(compararFechasISO("2026-11-20", "2026-11-22")).toBe(-1);
    expect(compararFechasISO("2026-11-22", "2026-11-22")).toBe(0);
    expect(compararFechasISO("2026-12-01", "2026-11-30")).toBe(1);
    expect(() => compararFechasISO("2026-02-29", "2026-03-01")).toThrow();
  });

  it("resuelve la fecha actual en horario oficial de Chile (America/Santiago)", () => {
    const instanteUtcMedianoche = new Date("2026-11-23T01:30:00.000Z");
    expect(obtenerFechaHoyChile(instanteUtcMedianoche)).toBe("2026-11-22");
  });
});

describe("Validación monetaria compatible con numeric(10,2)", () => {
  it("acepta enteros y hasta 2 decimales positivos", () => {
    expect(esMontoMonetarioValido(1490)).toBe(true);
    expect(esMontoMonetarioValido(1290.5)).toBe(true);
    expect(esMontoMonetarioValido(990.99)).toBe(true);
  });

  it("rechaza cero, negativos, NaN o más de 2 decimales", () => {
    expect(esMontoMonetarioValido(0)).toBe(false);
    expect(esMontoMonetarioValido(-500)).toBe(false);
    expect(esMontoMonetarioValido(Number.NaN)).toBe(false);
    expect(esMontoMonetarioValido(1290.555)).toBe(false);
  });
});

describe("Reglas de validación de ofertas (validarOferta)", () => {
  it("valida correctamente un precio normal sin oferta (entero o con 2 decimales)", () => {
    const res = validarOferta({
      valor: 1890.5,
      precio_oferta: null,
      fecha_inicio_vigencia: "",
      fecha_fin_vigencia: null,
      condiciones: "   ",
    });

    expect(res).toEqual({
      ok: true,
      datos: {
        tiene_oferta: false,
        precio_oferta: null,
        fecha_inicio_vigencia: null,
        fecha_fin_vigencia: null,
        condiciones: null,
        oferta_activa: false,
      },
    });
  });

  it("rechaza fechas o condiciones huérfanas cuando no hay precio de oferta", () => {
    const res = validarOferta({
      valor: 2500,
      precio_oferta: null,
      fecha_inicio_vigencia: "2026-11-20",
      fecha_fin_vigencia: "2026-11-25",
      condiciones: "Pagando con tarjeta",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      const campos = res.errores.map((e) => e.campo);
      expect(campos).toContain("fecha_inicio_vigencia");
      expect(campos).toContain("fecha_fin_vigencia");
      expect(campos).toContain("condiciones");
    }
  });

  it("exige que precio_oferta sea estrictamente menor al precio normal y válido", () => {
    const igual = validarOferta(
      {
        valor: 1500,
        precio_oferta: 1500,
        fecha_inicio_vigencia: "2026-11-20",
        fecha_fin_vigencia: "2026-11-25",
      },
      { fechaReferencia: "2026-11-22" },
    );
    expect(igual.ok).toBe(false);

    const mayor = validarOferta(
      {
        valor: 1500,
        precio_oferta: 1650,
        fecha_inicio_vigencia: "2026-11-20",
        fecha_fin_vigencia: "2026-11-25",
      },
      { fechaReferencia: "2026-11-22" },
    );
    expect(mayor.ok).toBe(false);

    const tresDecimales = validarOferta(
      {
        valor: 1500,
        precio_oferta: 1299.555,
        fecha_inicio_vigencia: "2026-11-20",
        fecha_fin_vigencia: "2026-11-25",
      },
      { fechaReferencia: "2026-11-22" },
    );
    expect(tresDecimales.ok).toBe(false);

    const dosDecimalesValido = validarOferta(
      {
        valor: 1500,
        precio_oferta: 1299.5,
        fecha_inicio_vigencia: "2026-11-20",
        fecha_fin_vigencia: "2026-11-25",
      },
      { fechaReferencia: "2026-11-22" },
    );
    expect(dosDecimalesValido.ok).toBe(true);
  });

  it("rechaza fechas inexistentes en calendario gregoriano dentro de una oferta", () => {
    const res = validarOferta({
      valor: 3000,
      precio_oferta: 2490,
      fecha_inicio_vigencia: "2026-02-29",
      fecha_fin_vigencia: "2026-04-31",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errores).toHaveLength(2);
      expect(res.errores[0].campo).toBe("fecha_inicio_vigencia");
      expect(res.errores[1].campo).toBe("fecha_fin_vigencia");
    }
  });

  it("rechaza ofertas donde fecha_fin_vigencia es anterior a fecha_inicio_vigencia", () => {
    const res = validarOferta({
      valor: 3000,
      precio_oferta: 2490,
      fecha_inicio_vigencia: "2026-11-25",
      fecha_fin_vigencia: "2026-11-20",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errores[0].campo).toBe("fecha_fin_vigencia");
    }
  });

  it("acepta ofertas válidas, incluyendo ofertas relámpago de un solo día, y normaliza condiciones", () => {
    const res = validarOferta(
      {
        valor: 2000,
        precio_oferta: 1490,
        fecha_inicio_vigencia: "2026-11-22",
        fecha_fin_vigencia: "2026-11-22",
        condiciones: "  Máximo 3 unidades\npor boleta  ",
      },
      { fechaReferencia: "2026-11-22" },
    );

    expect(res).toEqual({
      ok: true,
      datos: {
        tiene_oferta: true,
        precio_oferta: 1490,
        fecha_inicio_vigencia: "2026-11-22",
        fecha_fin_vigencia: "2026-11-22",
        condiciones: "Máximo 3 unidades por boleta",
        oferta_activa: true,
      },
    });
  });

  it("marca oferta_activa=false o rechaza si la fecha_fin_vigencia ya expiró según configuración", () => {
    const marcadaInactiva = validarOferta(
      {
        valor: 2000,
        precio_oferta: 1500,
        fecha_inicio_vigencia: "2026-11-01",
        fecha_fin_vigencia: "2026-11-10",
      },
      { fechaReferencia: "2026-11-22" },
    );

    expect(marcadaInactiva.ok).toBe(true);
    if (marcadaInactiva.ok) {
      expect(marcadaInactiva.datos.oferta_activa).toBe(false);
    }

    const rechazada = validarOferta(
      {
        valor: 2000,
        precio_oferta: 1500,
        fecha_inicio_vigencia: "2026-11-01",
        fecha_fin_vigencia: "2026-11-10",
      },
      { fechaReferencia: "2026-11-22", rechazarOfertaVencida: true },
    );
    expect(rechazada.ok).toBe(false);
  });

  it("sanitiza caracteres de control y valida longitud máxima en condiciones", () => {
    expect(normalizarCondicionesOferta("Válido\tcon\r\napp")).toBe("Válido con app");

    const larga = "A".repeat(301);
    const res = validarOferta(
      {
        valor: 2000,
        precio_oferta: 1500,
        fecha_inicio_vigencia: "2026-11-20",
        fecha_fin_vigencia: "2026-11-25",
        condiciones: larga,
      },
      { fechaReferencia: "2026-11-22" },
    );
    expect(res.ok).toBe(false);
  });
});

describe("Evaluación de vigencia activa (estaOfertaVigenteEnFecha)", () => {
  const ofertaBase = {
    precio_oferta: 990,
    oferta_activa: true,
    fecha_inicio_vigencia: "2026-11-15",
    fecha_fin_vigencia: "2026-11-22",
  };

  it("evalúa los límites inclusivos de inicio y fin de vigencia", () => {
    expect(estaOfertaVigenteEnFecha(ofertaBase, "2026-11-14")).toBe(false);
    expect(estaOfertaVigenteEnFecha(ofertaBase, "2026-11-15")).toBe(true);
    expect(estaOfertaVigenteEnFecha(ofertaBase, "2026-11-18")).toBe(true);
    expect(estaOfertaVigenteEnFecha(ofertaBase, "2026-11-22")).toBe(true);
    expect(estaOfertaVigenteEnFecha(ofertaBase, "2026-11-23")).toBe(false);
  });

  it("retorna false si oferta_activa es false o precio_oferta es nulo", () => {
    expect(
      estaOfertaVigenteEnFecha({ ...ofertaBase, oferta_activa: false }, "2026-11-18"),
    ).toBe(false);
    expect(
      estaOfertaVigenteEnFecha({ ...ofertaBase, precio_oferta: null }, "2026-11-18"),
    ).toBe(false);
  });
});
