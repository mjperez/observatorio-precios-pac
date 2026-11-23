-- 0029 · la auditoría guarda los valores, no solo el evento
--
-- Hasta ahora el registro de auditoría decía quién, cuándo y sobre qué fila,
-- pero no cuál era el valor. Con eso no se puede responder qué cambió: solo
-- que hubo un cambio. Esta migración agrega el payload (fila anterior y fila
-- nueva en jsonb) y lo incorpora al hash.
--
-- Los eslabones anteriores se mantienen válidos: se verifica con el payload
-- v1 cuando ambas columnas son nulas, y con el v2 cuando hay payload. No se
-- recalcula ningún hash histórico, porque reescribir la cadena es justamente
-- lo que la cadena existe para impedir.

alter table public.registros_auditoria
  add column if not exists datos_anteriores jsonb,
  add column if not exists datos_nuevos     jsonb;

comment on column public.registros_auditoria.datos_anteriores is
  'Fila completa antes del cambio. Nula en los eslabones previos a la migración 0029.';
comment on column public.registros_auditoria.datos_nuevos is
  'Fila completa después del cambio. Nula en los eslabones previos a la migración 0029.';

-- ---------------------------------------------------------------- payload v2
-- Extiende el texto firmado con las dos filas. Se apoya en la definición v1
-- para no duplicar el formato de los metadatos.
create or replace function public.fn_payload_auditoria_v2(
  p_tabla        varchar,
  p_accion       varchar,
  p_registro_id  integer,
  p_fecha        timestamptz,
  p_id_usuario   uuid,
  p_hash_previo  char(64),
  p_anteriores   jsonb,
  p_nuevos       jsonb
)
returns text
language sql immutable
as $$
  select public.fn_payload_auditoria(p_tabla, p_accion, p_registro_id, p_fecha,
                                     p_id_usuario, p_hash_previo)
      || '|' || coalesce(p_anteriores::text, '')
      || '|' || coalesce(p_nuevos::text, '');
$$;

comment on function public.fn_payload_auditoria_v2(varchar, varchar, integer, timestamptz, uuid, char, jsonb, jsonb) is
  'Texto que se firma desde la migración 0029. Incluye las filas anterior y nueva.';

-- ---------------------------------------------------------------- trigger
-- Ahora cubre también el borrado: es el caso donde el valor anterior es lo
-- único que queda.
create or replace function public.fn_auditar_precio()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id_anterior   integer;
  v_hash_anterior char(64);
  v_id_usuario    uuid;
  v_fecha         timestamptz := now();
  v_hash          char(64);
  v_anteriores    jsonb;
  v_nuevos        jsonb;
  v_registro_id   integer;
begin
  select id_registro, hash into v_id_anterior, v_hash_anterior
  from public.registros_auditoria
  order by id_registro desc
  limit 1;

  select id_usuario into v_id_usuario
  from public.usuarios
  where auth_uid = auth.uid();

  if tg_op in ('UPDATE', 'DELETE') then
    v_anteriores := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_nuevos := to_jsonb(new);
  end if;

  -- En un trigger de INSERT, OLD no esta asignado y leerlo lanza error, asi que
  -- el identificador se resuelve por rama y no con coalesce.
  if tg_op = 'DELETE' then
    v_registro_id := old.id_precio;
  else
    v_registro_id := new.id_precio;
  end if;

  v_hash := encode(digest(
    public.fn_payload_auditoria_v2('precios', tg_op, v_registro_id, v_fecha,
                                   v_id_usuario, v_hash_anterior,
                                   v_anteriores, v_nuevos),
    'sha256'), 'hex');

  insert into public.registros_auditoria
    (id_usuario, tabla, accion, registro_id, fecha, hash, hash_anterior,
     datos_anteriores, datos_nuevos)
  values
    (v_id_usuario, 'precios', tg_op, v_registro_id, v_fecha, v_hash, v_id_anterior,
     v_anteriores, v_nuevos);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_auditar_precio on public.precios;
create trigger trg_auditar_precio
  after insert or update or delete on public.precios
  for each row execute function public.fn_auditar_precio();

-- ---------------------------------------------------------------- verificador
-- Elige el payload según el eslabón: los antiguos no tienen filas guardadas.
create or replace function public.fn_verificar_auditoria()
returns table (id_registro_roto integer, motivo text)
language sql stable
set search_path = public, extensions
as $$
  with cadena as (
    select a.id_registro,
           a.id_usuario,
           a.tabla,
           a.accion,
           a.registro_id,
           a.fecha,
           a.hash,
           a.hash_anterior,
           a.datos_anteriores,
           a.datos_nuevos,
           lag(a.id_registro) over (order by a.id_registro) as id_previo,
           lag(a.hash)        over (order by a.id_registro) as hash_previo
    from public.registros_auditoria a
  ),
  evaluado as (
    select c.*,
           encode(digest(
             case
               when c.datos_anteriores is null and c.datos_nuevos is null
                 then public.fn_payload_auditoria(c.tabla, c.accion, c.registro_id, c.fecha,
                                                  c.id_usuario, c.hash_previo)
               else public.fn_payload_auditoria_v2(c.tabla, c.accion, c.registro_id, c.fecha,
                                                   c.id_usuario, c.hash_previo,
                                                   c.datos_anteriores, c.datos_nuevos)
             end,
             'sha256'), 'hex') as hash_esperado
    from cadena c
  )
  select e.id_registro,
         case
           when e.hash_anterior is distinct from e.id_previo
             then 'el puntero al registro anterior no es el inmediatamente previo'
           else 'el hash no coincide con el recalculado'
         end
  from evaluado e
  where e.hash_anterior is distinct from e.id_previo
     or e.hash is distinct from e.hash_esperado
  order by e.id_registro;
$$;
