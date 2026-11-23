-- Sprint 4 / US-C3: confirmación atómica de la boleta y sus precios.
-- SECURITY INVOKER: RLS sigue decidiendo quién puede insertar en cada tabla.
-- La transición a "pendiente" evita que un precio leído por IA se publique
-- sin revisión humana.

create or replace function public.fn_confirmar_boleta_ocr(
  p_comercio integer,
  p_ruta text,
  p_items jsonb,
  p_fecha_inicio date default current_date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id_boleta uuid;
  v_item jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La boleta no tiene ítems para confirmar';
  end if;

  insert into public.boletas (id_comercio, imagen_url, raw_ocr)
  values (p_comercio, p_ruta, p_items)
  returning id_boleta into v_id_boleta;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.precios (
      id_producto,
      id_comercio,
      id_boleta,
      valor,
      origen,
      validado,
      estado_validacion,
      fecha_inicio_vigencia
    )
    values (
      (v_item->>'id_producto')::integer,
      p_comercio,
      v_id_boleta,
      (v_item->>'valor')::numeric(10,2),
      'ocr',
      false,
      'pendiente',
      p_fecha_inicio
    );
  end loop;

  return v_id_boleta;
end;
$$;

revoke all on function public.fn_confirmar_boleta_ocr(integer, text, jsonb, date) from public;
grant execute on function public.fn_confirmar_boleta_ocr(integer, text, jsonb, date) to authenticated;
