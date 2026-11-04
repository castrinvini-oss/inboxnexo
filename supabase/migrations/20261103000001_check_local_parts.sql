-- InboxNexo Pro — verificação de disponibilidade de identificadores (aba Endereços)
-- Somente leitura: não cria caixas. Endereços excluídos aparecem como
-- "em_uso" (nunca são reutilizados) sem revelar se pertencem a outro cliente
-- ou foram excluídos.

create or replace function public.check_local_parts(p_local_parts text[])
returns table (local_part text, status text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if p_local_parts is null or coalesce(array_length(p_local_parts, 1), 0) > 200 then
    raise exception 'parametros_invalidos' using errcode = 'P0001';
  end if;
  return query
    select x.lp,
           case
             when not private.valid_local_part(x.lp) then 'invalido'
             when exists (select 1 from private.reserved_local_parts r where r.local_part = x.lp) then 'reservado'
             when exists (select 1 from public.mailboxes b where b.local_part = x.lp and b.owner_id = v_uid and b.status <> 'deleted') then 'sua_caixa'
             when exists (select 1 from public.mailboxes b where b.local_part = x.lp) then 'em_uso'
             else 'disponivel'
           end
      from (select distinct lower(btrim(u)) as lp from unnest(p_local_parts) as u) x;
end;
$$;

revoke all on function public.check_local_parts(text[]) from public, anon, authenticated, service_role;
grant execute on function public.check_local_parts(text[]) to authenticated;
