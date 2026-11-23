-- Sprint 4 / US-E1: búsqueda por similitud de coseno sobre el catálogo.
-- La extensión se crea en el esquema "extensions", que es el convencional en
-- Supabase. La API mantiene un modo léxico local cuando no hay proveedor de
-- embeddings configurado, así que la migración no es requisito para consultar.

create extension if not exists vector with schema extensions;

alter table public.productos
  add column if not exists embedding extensions.vector(256);

comment on column public.productos.embedding is
  'Vector de 256 dimensiones del nombre, marca y categoría del producto (US-E1).';

drop index if exists public.idx_productos_embedding;
create index idx_productos_embedding
  on public.productos using hnsw (embedding extensions.vector_cosine_ops);

drop function if exists public.fn_buscar_productos_semanticos(extensions.vector, integer);
create function public.fn_buscar_productos_semanticos(
  consulta extensions.vector(256),
  limite integer default 8
)
returns table (
  id_producto integer,
  nombre text,
  marca text,
  formato text,
  similitud double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    p.id_producto,
    p.nombre,
    p.marca,
    p.formato,
    (1 - (p.embedding <=> consulta))::double precision as similitud
  from public.productos p
  where p.activo and p.embedding is not null
  order by p.embedding <=> consulta
  limit least(greatest(limite, 1), 20);
$$;

revoke all on function public.fn_buscar_productos_semanticos(extensions.vector, integer) from public;
grant execute on function public.fn_buscar_productos_semanticos(extensions.vector, integer) to anon, authenticated;
