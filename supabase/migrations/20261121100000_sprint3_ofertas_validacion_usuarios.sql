-- 0022 · Sprint 3 · Ofertas, flujo de validación, caducidad automática y RLS usuarios_comercios

-- 1. Nuevos campos en public.precios para ofertas, vigencia, condiciones y flujo de revisión
alter table public.precios
  add column if not exists precio_oferta         numeric(10,2),
  add column if not exists fecha_inicio_vigencia date default current_date,
  add column if not exists fecha_fin_vigencia    date,
  add column if not exists condiciones           text,
  add column if not exists oferta_activa         boolean not null default false,
  add column if not exists estado_validacion     varchar(20) not null default 'pendiente',
  add column if not exists motivo_rechazo        text,
  add column if not exists validado_por          uuid references public.usuarios (id_usuario),
  add column if not exists fecha_validacion      timestamptz;

-- Los registros históricos ya validados quedan marcados como 'aprobado'
update public.precios
set estado_validacion = case when validado then 'aprobado' else 'pendiente' end
where estado_validacion = 'pendiente' and validado = true;

alter table public.precios
  drop constraint if exists precios_precio_oferta_check,
  add constraint precios_precio_oferta_check
    check (precio_oferta is null or (precio_oferta > 0 and precio_oferta < valor));

alter table public.precios
  drop constraint if exists precios_vigencia_oferta_check,
  add constraint precios_vigencia_oferta_check
    check (
      fecha_fin_vigencia is null
      or fecha_inicio_vigencia is null
      or fecha_fin_vigencia >= fecha_inicio_vigencia
    );

alter table public.precios
  drop constraint if exists precios_estado_validacion_check,
  add constraint precios_estado_validacion_check
    check (estado_validacion in ('pendiente', 'aprobado', 'rechazado'));

create index if not exists idx_precios_estado_validacion
  on public.precios (estado_validacion, fecha_registro desc);

create index if not exists idx_precios_ofertas_vigencia
  on public.precios (oferta_activa, fecha_fin_vigencia)
  where precio_oferta is not null;

-- 2. Trigger para mantener sincronizados oferta_activa, vigente_desde y vigente_hasta
create or replace function public.fn_sincronizar_oferta_precio()
returns trigger
language plpgsql
as $$
begin
  if new.fecha_inicio_vigencia is not null then
    new.vigente_desde := new.fecha_inicio_vigencia;
  end if;

  if new.fecha_fin_vigencia is not null then
    new.vigente_hasta := new.fecha_fin_vigencia;
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

drop trigger if exists trg_sincronizar_oferta_precio on public.precios;
create trigger trg_sincronizar_oferta_precio
  before insert or update on public.precios
  for each row execute function public.fn_sincronizar_oferta_precio();

-- 3. Función para desactivar automáticamente ofertas vencidas
create or replace function public.fn_desactivar_ofertas_vencidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actualizados integer;
begin
  update public.precios
  set oferta_activa = false
  where oferta_activa = true
    and fecha_fin_vigencia is not null
    and fecha_fin_vigencia < current_date;

  get diagnostics v_actualizados = row_count;
  return v_actualizados;
end;
$$;

grant execute on function public.fn_desactivar_ofertas_vencidas() to authenticated;

-- 4. Endurecimiento de RLS en precios (evita IDOR entre comercios) y usuarios_comercios
drop policy if exists insertar_precio on public.precios;
create policy insertar_precio on public.precios
  for insert to authenticated
  with check (
    public.obtener_rol() in ('terreno', 'administrador')
    or (
      public.obtener_rol() = 'comercio'
      and exists (
        select 1
        from public.usuarios_comercios uc
        join public.usuarios u on u.id_usuario = uc.id_usuario
        where u.auth_uid = auth.uid()
          and uc.id_comercio = precios.id_comercio
      )
    )
  );

alter table if exists public.usuarios_comercios enable row level security;

drop policy if exists ver_vinculos_propios on public.usuarios_comercios;
create policy ver_vinculos_propios on public.usuarios_comercios
  for select to authenticated
  using (
    public.obtener_rol() = 'administrador'
    or exists (
      select 1
      from public.usuarios u
      where u.id_usuario = usuarios_comercios.id_usuario
        and u.auth_uid = auth.uid()
    )
  );

drop policy if exists admin_usuarios_comercios on public.usuarios_comercios;
create policy admin_usuarios_comercios on public.usuarios_comercios
  for all to authenticated
  using (public.obtener_rol() = 'administrador')
  with check (public.obtener_rol() = 'administrador');

-- 5. Actualizar fn_comparador para devolver oferta vigente, condiciones, vigencia y matriz/sucursal
drop function if exists public.fn_comparador(integer, double precision, double precision);

create or replace function public.fn_comparador(
  p_producto integer,
  p_lat      double precision default null,
  p_lng      double precision default null
)
returns table (
  id_comercio           integer,
  comercio              text,
  matriz_nombre         text,
  direccion             text,
  tipo                  text,
  valor                 numeric,
  precio_oferta         numeric,
  oferta_vigente        boolean,
  fecha_inicio_vigencia date,
  fecha_fin_vigencia    date,
  condiciones           text,
  fecha_registro        timestamptz,
  origen                text,
  distancia_m           double precision,
  ref_lat               double precision,
  ref_lng               double precision,
  ref_origen            text
)
language sql
stable
security invoker
set search_path = public
as $$
  with referencia as (
    select coalesce(p_lat, avg(c.lat))::double precision as lat,
           coalesce(p_lng, avg(c.lng))::double precision as lng,
           case
             when p_lat is null or p_lng is null then 'comuna'
             else 'usuario'
           end as origen
    from public.v_comercios_coordenadas c
    where c.activo
  ),
  vigente as (
    select distinct on (pr.id_comercio)
           pr.id_comercio,
           pr.valor,
           case
             when pr.precio_oferta is not null
                  and pr.oferta_activa
                  and (pr.fecha_inicio_vigencia is null or pr.fecha_inicio_vigencia <= current_date)
                  and (pr.fecha_fin_vigencia is null or pr.fecha_fin_vigencia >= current_date)
               then pr.precio_oferta
             else null
           end as precio_oferta,
           (
             pr.precio_oferta is not null
             and pr.oferta_activa
             and (pr.fecha_inicio_vigencia is null or pr.fecha_inicio_vigencia <= current_date)
             and (pr.fecha_fin_vigencia is null or pr.fecha_fin_vigencia >= current_date)
           ) as oferta_vigente,
           pr.fecha_inicio_vigencia,
           pr.fecha_fin_vigencia,
           pr.condiciones,
           pr.fecha_registro,
           pr.origen
    from public.precios pr
    where pr.id_producto = p_producto
      and pr.validado = true
      and pr.valor > 0
      and (pr.vigente_hasta is null or pr.vigente_hasta >= current_date or pr.precio_oferta is not null)
    order by pr.id_comercio,
             pr.vigente_desde desc,
             pr.fecha_registro desc,
             pr.id_precio desc
  )
  select c.id_comercio,
         c.nombre,
         m.nombre as matriz_nombre,
         c.direccion,
         c.tipo,
         v.valor,
         v.precio_oferta,
         v.oferta_vigente,
         v.fecha_inicio_vigencia,
         v.fecha_fin_vigencia,
         v.condiciones,
         v.fecha_registro,
         v.origen,
         case
           when c.lat is null or r.lat is null then null
           else st_distance(
                  st_setsrid(st_makepoint(c.lng, c.lat), 4326)::geography,
                  st_setsrid(st_makepoint(r.lng, r.lat), 4326)::geography
                )::double precision
         end as distancia_m,
         r.lat,
         r.lng,
         r.origen
  from vigente v
  join public.v_comercios_coordenadas c on c.id_comercio = v.id_comercio
  join public.comercios cm on cm.id_comercio = c.id_comercio
  left join public.comercios m on m.id_comercio = cm.id_matriz
  cross join referencia r
  where c.activo
  order by coalesce(v.precio_oferta, v.valor) asc, distancia_m asc nulls last, c.nombre asc;
$$;

grant execute on function public.fn_comparador(integer, double precision, double precision)
  to anon, authenticated;
