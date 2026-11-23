"use client";

import { useActionState, useState } from "react";
import { registrarPrecioManual, type ResultadoManual } from "./acciones";
import { Aviso } from "@/components/ui/aviso";
import { Boton } from "@/components/ui/boton";
import { Campo, Selector } from "@/components/ui/campo";
import { Panel, PanelCabecera } from "@/components/ui/panel";

type Comercio = { id_comercio: number; nombre: string };
type Producto = { id_producto: number; nombre: string; marca: string; formato: string };

export default function FormularioManual({
  comercios,
  productos,
}: {
  comercios: Comercio[];
  productos: Producto[];
}) {
  const [estado, accion, pendiente] = useActionState<ResultadoManual | null, FormData>(
    registrarPrecioManual,
    null,
  );
  const [tieneOferta, setTieneOferta] = useState(false);

  if (comercios.length === 0) {
    return (
      <Aviso tono="alerta" titulo="Sin comercios vinculados">
        Tu usuario no tiene comercios asociados. Solicita al administrador vincular un local.
      </Aviso>
    );
  }

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <Panel acento="azul">
        <PanelCabecera
          titulo="Registro individual de precio u oferta"
          descripcion="Los registros ingresan en estado pendiente hasta ser aprobados por el equipo de validación."
        />

        <form action={accion}>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Campo etiqueta="Comercio" para="comercio" requerido>
              <Selector
                id="comercio"
                name="comercio"
                required
                defaultValue={comercios[0].id_comercio}
              >
                {comercios.map((c) => (
                  <option key={c.id_comercio} value={c.id_comercio}>
                    {c.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Producto del catálogo" para="producto" requerido>
              <Selector id="producto" name="producto" required>
                <option value="">Selecciona un producto…</option>
                {productos.map((p) => (
                  <option key={p.id_producto} value={p.id_producto}>
                    {p.nombre} — {p.marca} ({p.formato})
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Precio normal ($ CLP)" para="valor" requerido>
              <input
                id="valor"
                name="valor"
                type="text"
                inputMode="decimal"
                placeholder="Ej: 1890"
                required
                className="h-10 w-full border border-pac-linea-fuerte bg-white px-3 font-mono text-[13.5px] text-pac-tinta focus:border-pac-azul focus:outline-none"
              />
            </Campo>

            <div className="flex flex-col justify-end pb-1">
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-medium text-pac-tinta">
                <input
                  type="checkbox"
                  checked={tieneOferta}
                  onChange={(e) => setTieneOferta(e.target.checked)}
                  className="size-4 accent-pac-azul"
                />
                Incluir precio de oferta promocional
              </label>
            </div>

            {tieneOferta && (
              <>
                <Campo etiqueta="Precio oferta ($ CLP)" para="precio_oferta" requerido>
                  <input
                    id="precio_oferta"
                    name="precio_oferta"
                    type="text"
                    inputMode="decimal"
                    placeholder="Ej: 1490"
                    required
                    className="h-10 w-full border border-pac-linea-fuerte bg-white px-3 font-mono text-[13.5px] text-pac-tinta focus:border-pac-azul focus:outline-none"
                  />
                </Campo>

                <Campo etiqueta="Tipo de condición" para="tipo_condicion">
                  <Selector id="tipo_condicion" name="tipo_condicion" defaultValue="">
                    <option value="">Sin restricción (todo público)</option>
                    <option value="Compra mínima">Compra mínima</option>
                    <option value="Medio de pago">Medio de pago específico</option>
                    <option value="Membresía / Club">Membresía o club de vecinos</option>
                    <option value="Hasta agotar stock">Hasta agotar stock</option>
                  </Selector>
                </Campo>

                <Campo etiqueta="Inicio de vigencia" para="fecha_inicio_vigencia" requerido>
                  <input
                    id="fecha_inicio_vigencia"
                    name="fecha_inicio_vigencia"
                    type="date"
                    defaultValue={hoy}
                    required
                    className="h-10 w-full border border-pac-linea-fuerte bg-white px-3 text-[13.5px] text-pac-tinta focus:border-pac-azul focus:outline-none"
                  />
                </Campo>

                <Campo etiqueta="Término de vigencia" para="fecha_fin_vigencia" requerido>
                  <input
                    id="fecha_fin_vigencia"
                    name="fecha_fin_vigencia"
                    type="date"
                    min={hoy}
                    required
                    className="h-10 w-full border border-pac-linea-fuerte bg-white px-3 text-[13.5px] text-pac-tinta focus:border-pac-azul focus:outline-none"
                  />
                </Campo>

                <div className="sm:col-span-2">
                  <Campo etiqueta="Detalle de condiciones" para="condiciones">
                    <input
                      id="condiciones"
                      name="condiciones"
                      type="text"
                      maxLength={240}
                      placeholder="Ej: Válido llevando 2 o más unidades, o pagando con CuentaRUT"
                      className="h-10 w-full border border-pac-linea-fuerte bg-white px-3 text-[13.5px] text-pac-tinta focus:border-pac-azul focus:outline-none"
                    />
                  </Campo>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end border-t border-pac-linea bg-pac-fondo/50 px-5 py-3.5">
            <Boton type="submit" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Enviar a validación"}
            </Boton>
          </div>
        </form>
      </Panel>

      {estado && (
        <Aviso
          tono={estado.ok ? "exito" : "error"}
          titulo={estado.ok ? "Registro recibido" : "No se pudo guardar"}
        >
          {estado.mensaje}
        </Aviso>
      )}
    </div>
  );
}
