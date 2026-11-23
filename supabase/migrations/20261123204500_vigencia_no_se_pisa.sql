-- 0030 · la fecha de vigencia no se pisa al editar un precio
--
-- fn_sincronizar_oferta_precio copiaba fecha_inicio_vigencia sobre vigente_desde
-- en cualquier UPDATE. Como fecha_inicio_vigencia se agrego despues con valor
-- por defecto current_date, toda la serie historica quedo con 2026-11-23 en esa
-- columna, y editar un precio le movia la fecha de vigencia al dia de la
-- edicion. Eso rompe la semana a la que pertenece el precio.
--
-- Dos partes: el trigger deja de copiar salvo que el campo de origen cambie, y
-- los registros existentes se normalizan con la fecha de vigencia real.

-- ---------------------------------------------------------------- trigger
create or replace function public.fn_sincronizar_oferta_precio()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.fecha_inicio_vigencia is not null then
      new.vigente_desde := new.fecha_inicio_vigencia;
    end if;
    if new.fecha_fin_vigencia is not null then
      new.vigente_hasta := new.fecha_fin_vigencia;
    end if;
  else
    -- En un UPDATE solo se sincroniza si el campo de origen cambio de verdad.
    if new.fecha_inicio_vigencia is distinct from old.fecha_inicio_vigencia
       and new.fecha_inicio_vigencia is not null then
      new.vigente_desde := new.fecha_inicio_vigencia;
    end if;
    if new.fecha_fin_vigencia is distinct from old.fecha_fin_vigencia
       and new.fecha_fin_vigencia is not null then
      new.vigente_hasta := new.fecha_fin_vigencia;
    end if;
  end if;

  if new.precio_oferta is not null
     and (new.fecha_fin_vigencia is null or new.fecha_fin_vigencia >= current_date) then
    new.oferta_activa := true;
  else
    new.oferta_activa := false;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- normalizacion
-- Cada precio recupera como inicio de vigencia la fecha real de la serie.
-- Queda registrado en la auditoria: son 540 movimientos nuevos, cada uno con la
-- fila anterior y la nueva.
update public.precios
   set fecha_inicio_vigencia = vigente_desde
 where fecha_inicio_vigencia is distinct from vigente_desde;
