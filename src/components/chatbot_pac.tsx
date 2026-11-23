"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Tag,
  X,
} from "lucide-react";

interface FuentePrecioUI {
  producto: string;
  comercio: string;
  precio: number;
  esOferta: boolean;
}

interface MensajeUI {
  id: string;
  role: "user" | "assistant";
  content: string;
  fuentes?: FuentePrecioUI[];
  esError?: boolean;
}

const PREGUNTAS_SUGERIDAS: string[] = [
  "¿Dónde está más barato el arroz?",
  "¿Qué ofertas hay vigentes hoy?",
  "¿Cómo funciona el comparador?",
];

const MENSAJE_BIENVENIDA: MensajeUI = {
  id: "bienvenida-pac",
  role: "assistant",
  content:
    "Hola. Soy el asistente del Observatorio de Precios PAC. Puedes consultarme por precios de productos en almacenes y supermercados de Pedro Aguirre Cerda, ofertas vigentes o cómo usar el portal.",
};

let consecutivoMensajes = 0;
function idMensaje(prefijo: string): string {
  consecutivoMensajes += 1;
  return `${prefijo}-${consecutivoMensajes}`;
}

function formatearCifraCLP(monto: number): string {
  const redondeado = Math.round(monto);
  return `$${Math.abs(redondeado)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function ChatbotPac() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeUI[]>([MENSAJE_BIENVENIDA]);
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargando] = useState(false);

  const finMensajesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (abierto) {
      finMensajesRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, cargando, abierto]);

  useEffect(() => {
    if (abierto) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [abierto]);

  const limpiarConversacion = () => {
    if (cargando) return;
    setMensajes([MENSAJE_BIENVENIDA]);
    setEntrada("");
  };

  const enviarConsulta = async (textoConsulta: string) => {
    const limpio = textoConsulta.trim();
    if (!limpio || cargando) return;

    const nuevoMensajeUsuario: MensajeUI = {
      id: idMensaje("user"),
      role: "user",
      content: limpio.slice(0, 600),
    };

    const historialActualizado = [...mensajes, nuevoMensajeUsuario];
    setMensajes(historialActualizado);
    setEntrada("");
    setCargando(true);

    const payloadMensajes = historialActualizado
      .filter((m) => m.id !== MENSAJE_BIENVENIDA.id && !m.esError)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    try {
      const respuesta = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: payloadMensajes }),
      });

      const datos = (await respuesta.json()) as {
        reply?: string;
        fuentes?: FuentePrecioUI[];
        error?: string;
      };

      if (!respuesta.ok || !datos.reply) {
        setMensajes((prev) => [
          ...prev,
          {
            id: idMensaje("err"),
            role: "assistant",
            content:
              datos.error ||
              "No fue posible obtener una respuesta en este momento. Intenta nuevamente.",
            esError: true,
          },
        ]);
        return;
      }

      setMensajes((prev) => [
        ...prev,
        {
          id: idMensaje("bot"),
          role: "assistant",
          content: datos.reply as string,
          fuentes: Array.isArray(datos.fuentes) ? datos.fuentes : undefined,
        },
      ]);
    } catch {
      setMensajes((prev) => [
        ...prev,
        {
          id: idMensaje("err"),
          role: "assistant",
          content:
            "Error de red al conectar con el Observatorio PAC. Verifica tu conexión e intenta de nuevo.",
          esError: true,
        },
      ]);
    } finally {
      setCargando(false);
    }
  };

  const manejarSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void enviarConsulta(entrada);
  };

  const mostrarSugerencias = mensajes.length === 1 && !cargando;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end print:hidden">
      {abierto && (
        <section
          aria-label="Ventana de chat del Asistente Observatorio PAC"
          className="mb-3 flex max-h-[75vh] w-[calc(100vw-2.5rem)] flex-col border border-pac-linea-fuerte bg-white shadow-xl rounded-none sm:w-96"
        >
          {/* Cabecera Institucional */}
          <header className="flex items-center justify-between border-b-2 border-pac-rojo bg-pac-azul px-4 py-3 text-white">
            <div className="min-w-0 pr-2">
              <h2 className="truncate text-sm font-semibold tracking-tight">
                Asistente Observatorio PAC
              </h2>
              <p className="truncate text-xs text-white/85">
                Consulta precios y comercios en tiempo real
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={limpiarConversacion}
                disabled={cargando || mensajes.length <= 1}
                title="Limpiar conversación"
                aria-label="Limpiar conversación"
                className="p-1.5 text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 rounded-none"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                title="Cerrar asistente"
                aria-label="Cerrar asistente"
                className="p-1.5 text-white/85 transition-colors hover:bg-white/15 hover:text-white rounded-none"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* Área de Mensajes */}
          <div
            role="log"
            aria-live="polite"
            className="flex-1 space-y-3 overflow-y-auto bg-white p-3.5 text-sm"
          >
            {mensajes.map((msg) => {
              const esUsuario = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    esUsuario ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={
                      esUsuario
                        ? "ml-8 bg-pac-azul px-3.5 py-2.5 text-white rounded-none"
                        : msg.esError
                          ? "mr-6 border border-pac-rojo bg-pac-fondo px-3.5 py-2.5 text-pac-rojo rounded-none"
                          : "mr-6 border border-pac-linea bg-pac-fondo px-3.5 py-2.5 text-pac-tinta rounded-none"
                    }
                  >
                    {msg.esError && (
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>Aviso del sistema</span>
                      </div>
                    )}
                    <p className="whitespace-pre-line leading-relaxed">
                      {msg.content}
                    </p>

                    {msg.fuentes && msg.fuentes.length > 0 && (
                      <div className="mt-2.5 border-t border-pac-linea pt-2">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-pac-tinta-suave">
                          Registros consultados
                        </p>
                        <ul className="space-y-1">
                          {msg.fuentes.map((f, idx) => (
                            <li
                              key={`${msg.id}-f-${idx}`}
                              className="flex items-center justify-between gap-2 border border-pac-linea bg-white px-2 py-1 text-xs"
                            >
                              <span className="truncate text-pac-tinta">
                                <strong className="font-medium">
                                  {f.producto}
                                </strong>{" "}
                                · {f.comercio}
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                {f.esOferta && (
                                  <span className="inline-flex items-center gap-0.5 bg-pac-rojo px-1 py-0.5 text-[10px] font-semibold text-white">
                                    <Tag className="h-2.5 w-2.5" />
                                    OFERTA
                                  </span>
                                )}
                                <span className="cifra font-mono font-semibold text-pac-azul">
                                  {formatearCifraCLP(f.precio)}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {mostrarSugerencias && (
              <div className="pt-1">
                <p className="mb-1.5 text-xs font-medium text-pac-tinta-suave">
                  Consultas frecuentes:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PREGUNTAS_SUGERIDAS.map((sugerencia) => (
                    <button
                      key={sugerencia}
                      type="button"
                      onClick={() => void enviarConsulta(sugerencia)}
                      className="border border-pac-linea-fuerte bg-pac-azul-tenue px-2.5 py-1.5 text-left text-xs font-medium text-pac-azul transition-colors hover:bg-pac-azul hover:text-white rounded-none"
                    >
                      {sugerencia}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {cargando && (
              <div className="mr-6 flex items-center gap-2 border border-pac-linea bg-pac-fondo px-3.5 py-2.5 text-xs text-pac-tinta-suave rounded-none">
                <Loader2 className="h-4 w-4 animate-spin text-pac-azul" />
                <span>Consultando precios en la comuna...</span>
              </div>
            )}

            <div ref={finMensajesRef} />
          </div>

          {/* Formulario de Envío */}
          <form
            onSubmit={manejarSubmit}
            className="flex items-center border-t border-pac-linea-fuerte bg-white"
          >
            <input
              ref={inputRef}
              type="text"
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              maxLength={600}
              disabled={cargando}
              placeholder="Ej: precio del aceite, ofertas hoy..."
              aria-label="Escribe tu consulta sobre precios en Pedro Aguirre Cerda"
              className="flex-1 bg-transparent px-3.5 py-2.5 text-sm text-pac-tinta placeholder:text-pac-tinta-suave focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={cargando || !entrada.trim()}
              aria-label="Enviar consulta"
              className="flex items-center justify-center bg-pac-azul px-4 py-2.5 text-white transition-colors hover:bg-pac-azul/90 disabled:cursor-not-allowed disabled:opacity-45 rounded-none"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          {/* Pie Metodológico */}
          <footer className="border-t border-pac-linea bg-pac-fondo px-3.5 py-2 text-[11px] leading-snug text-pac-tinta-suave">
            Datos referenciales de comercios adheridos en PAC. Stock sujeto a
            disponibilidad en local.
          </footer>
        </section>
      )}

      {/* Botón Flotante Institucional */}
      <button
        type="button"
        onClick={() => setAbierto((prev) => !prev)}
        aria-expanded={abierto}
        aria-label={
          abierto
            ? "Cerrar asistente virtual Observatorio PAC"
            : "Abrir asistente virtual Observatorio PAC"
        }
        className="flex items-center gap-2.5 border-2 border-pac-rojo bg-pac-azul px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-pac-rojo focus:ring-offset-2 rounded-none"
      >
        {abierto ? (
          <>
            <X className="h-5 w-5" />
            <span>Cerrar ayuda</span>
          </>
        ) : (
          <>
            <MessageSquare className="h-5 w-5" />
            <span>Asistente PAC</span>
          </>
        )}
      </button>
    </div>
  );
}

export default ChatbotPac;
