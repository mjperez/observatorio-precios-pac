import { requerirRol } from "@/lib/auth";
import { Contenedor, EncabezadoPagina } from "@/components/ui/pagina";
import { Panel, PanelCabecera, Cifra } from "@/components/ui/panel";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Etiqueta, Insignia } from "@/components/ui/etiqueta";
import { TIPOS_COMERCIO } from "@/lib/tipos_comercio";
import {
  agregarPorCategoria,
  canastaBasica,
  desplazarDias,
  fechaISOEnChile,
  resumenGeneral,
  variacionSemanal,
  type FilaMetrica,
} from "@/lib/metricas";

export const metadata = { title: "Estadísticas comunales" };

type Parametros = {
  desde?: string;
  hasta?: string;
  tipo?: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function pesos(valor: number) {
  return `$${valor.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Parametros>;
}) {
  const { supabase } = await requerirRol("administrador");
  const params = await searchParams;

  const hoy = fechaISOEnChile(new Date());
  const hasta = params.hasta && ISO.test(params.hasta) ? params.hasta : hoy;
  const desde =
    params.desde && ISO.test(params.desde) ? params.desde : desplazarDias(hasta, -29);
  const tipo =
    params.tipo && TIPOS_COMERCIO.some((t) => t.valor === params.tipo)
      ? params.tipo
      : "todos";

  const { data: todosComercios } = await supabase
    .from("comercios")
    .select("id_comercio, tipo")
    .eq("activo", true);

  const comerciosValidos = (todosComercios ?? []).filter(
    (c) => tipo === "todos" || c.tipo === tipo,
  );
  // Un array vacío en `.in()` genera una consulta inválida; se fuerza un id
  // inexistente para que la respuesta sea simplemente vacía.
  const idsComercios = comerciosValidos.length
    ? comerciosValidos.map((c) => c.id_comercio)
    : [-1];

  const { data: catalogo } = await supabase
    .from("productos")
    .select("id_producto, nombre, categorias(nombre)");

  const categoriaPorProducto = new Map<number, string>();
  const nombrePorProducto = new Map<number, string>();
  for (const producto of catalogo ?? []) {
    const categoria = Array.isArray(producto.categorias)
      ? producto.categorias[0]
      : producto.categorias;
    categoriaPorProducto.set(
      producto.id_producto,
      categoria?.nombre ?? "Sin categoría",
    );
    nombrePorProducto.set(producto.id_producto, producto.nombre);
  }

  const consulta = supabase
    .from("precios")
    .select("valor, fecha_registro, id_producto, id_comercio")
    .eq("estado_validacion", "aprobado")
    .in("id_comercio", idsComercios)
    .gte("fecha_registro", `${desde}T00:00:00Z`)
    .lte("fecha_registro", `${hasta}T23:59:59Z`);

  const { data: registros } = await consulta;

  const filas: FilaMetrica[] = (registros ?? []).map((f) => ({
    valor: Number(f.valor),
    fecha_registro: f.fecha_registro,
    id_producto: f.id_producto,
    id_comercio: f.id_comercio,
    categoria: categoriaPorProducto.get(f.id_producto) ?? "Sin categoría",
  }));

  const resumen = resumenGeneral(filas);
  resumen.comercios = new Set(filas.map((f) => f.id_comercio)).size;
  const porCategoria = agregarPorCategoria(filas);
  const canasta = canastaBasica(filas);

  // La variación semanal se calcula con 14 días, aunque el filtro principal
  // sea más amplio, para que siempre compare dos semanas completas.
  const { data: quincena } = await supabase
    .from("precios")
    .select("valor, fecha_registro, id_producto")
    .eq("estado_validacion", "aprobado")
    .in("id_comercio", idsComercios)
    .gte("fecha_registro", `${desplazarDias(hasta, -13)}T00:00:00Z`)
    .lte("fecha_registro", `${hasta}T23:59:59Z`);

  const filasSemana: FilaMetrica[] = (quincena ?? []).map((f) => ({
    valor: Number(f.valor),
    fecha_registro: f.fecha_registro,
    id_producto: f.id_producto,
    categoria: categoriaPorProducto.get(f.id_producto) ?? "Sin categoría",
  }));
  const variacion = variacionSemanal(filasSemana, hasta);

  return (
    <Contenedor>
      <EncabezadoPagina
        miga={[
          { etiqueta: "Inicio", href: "/" },
          { etiqueta: "Panel", href: "/admin" },
          { etiqueta: "Métricas" },
        ]}
        eyebrow="DIDESE"
        titulo="Estadísticas comunales"
        descripcion="Promedios, dispersión y cobertura de los precios aprobados en Pedro Aguirre Cerda. Solo se publican registros validados."
      />

      <form
        action="/admin/metricas"
        method="get"
        className="mt-6 flex flex-wrap items-end gap-3 border border-pac-linea bg-white p-4"
      >
        <Campo etiqueta="Desde" para="desde" className="w-40">
          <Entrada id="desde" name="desde" type="date" value={desde} />
        </Campo>
        <Campo etiqueta="Hasta" para="hasta" className="w-40">
          <Entrada id="hasta" name="hasta" type="date" value={hasta} />
        </Campo>
        <Campo etiqueta="Tipo de comercio" para="tipo" className="w-56">
          <Selector id="tipo" name="tipo" defaultValue={tipo}>
            <option value="todos">Todos los comercios</option>
            {TIPOS_COMERCIO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </Selector>
        </Campo>
        <Boton type="submit" variante="institucional">
          Aplicar filtros
        </Boton>
      </form>

      <section
        aria-label="Indicadores del período"
        className="mt-6 grid grid-cols-2 gap-px border border-pac-linea bg-pac-linea sm:grid-cols-4"
      >
        <div className="bg-white px-4 py-4">
          <Cifra valor={resumen.registros} rotulo="Precios aprobados" />
        </div>
        <div className="bg-white px-4 py-4">
          <Cifra valor={pesos(resumen.promedio)} rotulo="Promedio comunal" />
        </div>
        <div className="bg-white px-4 py-4">
          <Cifra valor={pesos(resumen.minimo)} rotulo="Mínimo del período" />
        </div>
        <div className="bg-white px-4 py-4">
          <Cifra valor={pesos(resumen.maximo)} rotulo="Máximo del período" />
        </div>
        <div className="bg-white px-4 py-4">
          <Cifra valor={pesos(resumen.desviacion)} rotulo="Desviación típica" />
        </div>
        <div className="bg-white px-4 py-4">
          <Cifra valor={resumen.productos} rotulo="Productos relevados" />
        </div>
        <div className="bg-white px-4 py-4">
          <Cifra
            valor={`${resumen.comercios} de ${comerciosValidos.length}`}
            rotulo="Cobertura de comercios"
          />
        </div>
        <div className="bg-white px-4 py-4">
          <Cifra
            valor={variacion === null ? "s/d" : `${variacion > 0 ? "+" : ""}${variacion} %`}
            rotulo="Variación semana anterior"
          />
        </div>
      </section>

      <div className="mt-6 grid gap-6 pb-14 lg:grid-cols-2">
        <Panel>
          <PanelCabecera
            titulo="Agregación por categoría"
            descripcion={`Promedios entre ${desde} y ${hasta}.`}
          />
          {porCategoria.length === 0 ? (
            <p className="p-5 text-[13px] text-pac-tinta-suave">
              No hay precios aprobados en el período seleccionado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">
                  Precios aprobados agrupados por categoría de alimento
                </caption>
                <thead>
                  <tr className="border-y border-pac-linea bg-pac-fondo text-left">
                    <th scope="col" className="px-4 py-2 font-bold">Categoría</th>
                    <th scope="col" className="px-4 py-2 text-right font-bold">Registros</th>
                    <th scope="col" className="px-4 py-2 text-right font-bold">Promedio</th>
                    <th scope="col" className="px-4 py-2 text-right font-bold">Mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {porCategoria.map((c) => (
                    <tr key={c.categoria} className="border-b border-pac-linea">
                      <th scope="row" className="px-4 py-2 text-left font-medium">
                        {c.categoria}
                      </th>
                      <td className="cifra px-4 py-2 text-right">{c.registros}</td>
                      <td className="cifra px-4 py-2 text-right">{pesos(c.promedio)}</td>
                      <td className="cifra px-4 py-2 text-right">{pesos(c.minimo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelCabecera
            titulo="Canasta básica comunal"
            descripcion="Suma del precio mínimo aprobado de cada producto en el período."
          />
          <div className="flex items-center justify-between border-b border-pac-linea px-5 py-4">
            <Etiqueta>Total de la canasta</Etiqueta>
            <span className="cifra font-slab text-[24px] font-bold text-pac-azul">
              {pesos(canasta.total)}
            </span>
          </div>
          {canasta.detalle.length === 0 ? (
            <p className="p-5 text-[13px] text-pac-tinta-suave">
              Sin productos para la canasta en el período seleccionado.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">
                  Precio mínimo por producto incluido en la canasta
                </caption>
                <thead>
                  <tr className="border-y border-pac-linea bg-pac-fondo text-left">
                    <th scope="col" className="px-4 py-2 font-bold">Producto</th>
                    <th scope="col" className="px-4 py-2 font-bold">Categoría</th>
                    <th scope="col" className="px-4 py-2 text-right font-bold">Mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {canasta.detalle.map((p) => (
                    <tr key={p.id_producto} className="border-b border-pac-linea">
                      <th scope="row" className="px-4 py-2 text-left font-medium">
                        {nombrePorProducto.get(p.id_producto) ?? "Producto"}
                      </th>
                      <td className="px-4 py-2 text-pac-tinta-suave">{p.categoria}</td>
                      <td className="cifra px-4 py-2 text-right">{pesos(p.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-5 py-4">
            <Insignia tono="neutro">US-F1 · {canasta.productos} productos</Insignia>
          </div>
        </Panel>
      </div>
    </Contenedor>
  );
}

