-- 0023 · Restringe fn_desactivar_ofertas_vencidas al equipo de validación
--
-- La migración del sprint 3 creó esta función con SECURITY DEFINER y le dio
-- EXECUTE a authenticated. Eso permite que cualquier usuario autenticado
-- ejecute la desactivación global de ofertas vencidas por RPC, sin pasar por
-- la pantalla de validación. La firma no cambia, así que el cliente no requiere
-- ajustes: solo se agrega el control de rol dentro de la función.

create or replace function public.fn_desactivar_ofertas_vencidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actualizados integer;
begin
  if public.obtener_rol() not in ('terreno', 'administrador') then
    raise exception 'No tienes permisos para desactivar ofertas vencidas.'
      using errcode = '42501';
  end if;

  update public.precios
  set oferta_activa = false
  where oferta_activa = true
    and fecha_fin_vigencia is not null
    and fecha_fin_vigencia < current_date;

  get diagnostics v_actualizados = row_count;
  return v_actualizados;
end;
$$;

-- Por defecto EXECUTE está disponible para PUBLIC. Se revoca ese acceso y se
-- deja únicamente authenticated, que es el grupo al que pertenecen los usuarios
-- de la app. El control de rol ocurre dentro de la función.
revoke execute on function public.fn_desactivar_ofertas_vencidas() from public;
revoke execute on function public.fn_desactivar_ofertas_vencidas() from anon;
grant execute on function public.fn_desactivar_ofertas_vencidas() to authenticated;
