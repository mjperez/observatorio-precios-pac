import { requerirRol } from "@/lib/auth";
import { Contenedor, EncabezadoPagina } from "@/components/ui/pagina";
import { FormularioOCR } from "./formulario";

export const metadata = { title: "Lectura de boletas" };

export default async function PaginaOCR() {
  const { rol } = await requerirRol("terreno", "administrador");

  return (
    <Contenedor>
      <EncabezadoPagina
        miga={[
          { etiqueta: "Inicio", href: "/" },
          { etiqueta: "Carga de precios", href: "/ingesta" },
          { etiqueta: "Lectura de boletas" },
        ]}
        titulo="Lectura de boletas con IA"
        descripcion="Sube una foto, revisa los productos detectados y confírmalos. Los precios quedan pendientes de validación antes de publicarse."
        acciones={<span className="micro text-pac-tinta-suave">Perfil {rol}</span>}
      />
      <div className="py-8">
        <FormularioOCR />
      </div>
    </Contenedor>
  );
}
