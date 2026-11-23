-- 0023 · Sprint 3 · Cierre de US-B3 (radio PostGIS) y US-F4 (anomalías)

-- US-B3. Comercios activos dentro de un radio, con ST_DWithin sobre geography.
-- El índice GiST de comercios.ubicacion ya existe desde el esquema base y es
-- el que usa esta función. El tope de 20 km evita consultas desbordadas.
create or replace function public.fn_comercios_en_radio(
  p_lat double precision,
  p_lng double precision,
  p_radio_metros integer
)
returns table (
  id_comercio integer,
  nombre varchar,
  direccion varchar,
  tipo varchar,
  lat double precision,
  lng double precision,
  distancia_metros integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with origen as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as geo
  )
  select c.id_comercio,
         c.nombre,
         c.direccion,
         c.tipo,
         st_y(c.ubicacion::geometry) as lat,
         st_x(c.ubicacion::geometry) as lng,
         round(st_distance(c.ubicacion, o.geo))::integer as distancia_metros
  from public.comercios c
  cross join origen o
  where c.activo
    and st_dwithin(c.ubicacion, o.geo, least(greatest(p_radio_metros, 0), 20000))
  order by distancia_metros, c.nombre;
$$;

comment on function public.fn_comercios_en_radio(double precision, double precision, integer)
  is 'US-B3: comercios activos dentro de un radio en metros desde un punto WGS84.';

grant execute on function public.fn_comercios_en_radio(double precision, double precision, integer)
  to anon, authenticated;

-- US-F4. Bandas estadísticas sobre el histórico del producto. Se comparan los
-- últimos doce meses y se exigen al menos tres observaciones para que la
-- desviación típica tenga sentido. El umbral es el mayor entre el 30 % del
-- promedio y dos desviaciones típicas.
alter table public.precios
  add column if not exists es_anomalia boolean not null default false,
  add column if not exists detalle_anomalia text;

create index if not exists idx_precios_anomalia
  on public.precios (fecha_registro desc)
  where es_anomalia;

create or replace function public.fn_evaluar_anomalia_precio()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_estadisticas record;
  v_umbral numeric;
begin
  -- La aprobación y el rechazo no cambian el valor: no deben reetiquetarse.
  if tg_op = 'UPDATE' and new.valor = old.valor then
    return new;
  end if;

  select count(*) as total,
         avg(valor) as promedio,
         stddev_samp(valor) as desviacion
  into v_estadisticas
  from public.precios
  where id_producto = new.id_producto
    and id_precio is distinct from new.id_precio
    and fecha_registro >= now() - interval '12 months';

  new.es_anomalia := false;
  new.detalle_anomalia := null;

  if v_estadisticas.total >= 3 and v_estadisticas.promedio > 0 then
    v_umbral := greatest(
      v_estadisticas.promedio * 0.30,
      coalesce(v_estadisticas.desviacion, 0) * 2
    );

    if abs(new.valor - v_estadisticas.promedio) > v_umbral then
      new.es_anomalia := true;
      new.estado_validacion := 'pendiente';
      new.validado := false;
      new.detalle_anomalia := format(
        'Precio %s CLP fuera de banda: promedio histórico %s CLP, umbral %s CLP sobre %s observaciones.',
        round(new.valor, 2),
        round(v_estadisticas.promedio, 2),
        round(v_umbral, 2),
        v_estadisticas.total
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_evaluar_anomalia_precio on public.precios;
create trigger trg_evaluar_anomalia_precio
  before insert or update of valor on public.precios
  for each row execute function public.fn_evaluar_anomalia_precio();

-- Bandeja del fiscalizador: los precios marcados por la banda estadística
-- llegan pendientes y se identifican con una insignia en /admin/validacion.
grant execute on function public.fn_evaluar_anomalia_precio() to authenticated;
