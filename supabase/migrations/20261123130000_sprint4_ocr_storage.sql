-- Sprint 4 / US-C3: bucket privado para las imágenes de boletas.
-- El objeto queda bajo la carpeta del usuario autenticado; la boleta y sus
-- precios se insertan recién después de la confirmación en pantalla.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'boletas',
  'boletas',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ocr_subir_propia_boleta" on storage.objects;
create policy "ocr_subir_propia_boleta" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'boletas'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "ocr_ver_propia_boleta" on storage.objects;
create policy "ocr_ver_propia_boleta" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'boletas'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.obtener_rol() = 'administrador'
    )
  );

drop policy if exists "ocr_borrar_propia_boleta" on storage.objects;
create policy "ocr_borrar_propia_boleta" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'boletas'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- La política original de boletas excluía al administrador; la confirmación
-- del Sprint 4 se permite a terreno y administrador.
drop policy if exists insertar_boleta on public.boletas;
create policy insertar_boleta on public.boletas
  for insert to authenticated
  with check (public.obtener_rol() in ('comercio', 'terreno', 'administrador'));
