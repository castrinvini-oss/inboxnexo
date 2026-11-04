-- InboxNexo Pro — Row Level Security e permissões
-- Princípio: negar tudo e conceder o mínimo. As regras valem também para
-- acessos diretos à API de dados (PostgREST), não só para o painel.

-- ---------------------------------------------------------------------------
-- Schema privado: nenhuma tabela acessível às funções de API.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
-- As políticas RLS chamam private.is_admin(), portanto authenticated precisa
-- de USAGE no schema e EXECUTE apenas nessa função (não exposta pela API).
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS habilitado e forçado em todas as tabelas expostas
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.mailboxes enable row level security;
alter table public.messages enable row level security;
alter table public.support_grants enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.profiles, public.mailboxes, public.messages, public.support_grants, public.audit_log
  from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

-- Perfis: o usuário vê o próprio perfil; administradores (MFA) veem todos.
-- Nenhuma escrita direta: alterações passam por funções com autorização.
grant select on public.profiles to authenticated;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

-- Caixas: somente as próprias e não excluídas. Escrita apenas via funções.
grant select on public.mailboxes to authenticated;
create policy mailboxes_select on public.mailboxes
  for select to authenticated
  using (owner_id = (select auth.uid()) and status <> 'deleted');

-- Mensagens: somente das próprias caixas e dentro do prazo de validade.
-- Administradores NÃO têm leitura direta; usam admin_read_mailbox_messages().
grant select, delete on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

create policy messages_select on public.messages
  for select to authenticated
  using (
    expires_at > now()
    and exists (
      select 1 from public.mailboxes b
       where b.id = messages.mailbox_id and b.owner_id = (select auth.uid()) and b.status <> 'deleted'
    )
  );

create policy messages_update_read on public.messages
  for update to authenticated
  using (
    expires_at > now()
    and exists (
      select 1 from public.mailboxes b
       where b.id = messages.mailbox_id and b.owner_id = (select auth.uid()) and b.status <> 'deleted'
    )
  )
  with check (
    exists (
      select 1 from public.mailboxes b
       where b.id = messages.mailbox_id and b.owner_id = (select auth.uid()) and b.status <> 'deleted'
    )
  );

create policy messages_delete on public.messages
  for delete to authenticated
  using (
    exists (
      select 1 from public.mailboxes b
       where b.id = messages.mailbox_id and b.owner_id = (select auth.uid())
    )
  );

-- Autorizações de suporte: visíveis ao proprietário da caixa e a admins (MFA).
grant select on public.support_grants to authenticated;
create policy support_grants_select on public.support_grants
  for select to authenticated
  using (
    granted_by = (select auth.uid())
    or (select private.is_admin())
  );

-- Auditoria: somente administradores com MFA.
grant select on public.audit_log to authenticated;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Visão com contagens (security_invoker: respeita a RLS de quem consulta)
-- ---------------------------------------------------------------------------
create view public.mailbox_overview
with (security_invoker = true) as
  select b.id, b.local_part, b.domain, b.status, b.created_at,
         (select count(*) from public.messages m where m.mailbox_id = b.id and m.expires_at > now()) as message_count,
         (select count(*) from public.messages m where m.mailbox_id = b.id and m.expires_at > now() and m.read_at is null) as unread_count,
         (select max(g.expires_at) from public.support_grants g
           where g.mailbox_id = b.id and g.revoked_at is null and g.expires_at > now()) as support_until
    from public.mailboxes b
   where b.status <> 'deleted';

revoke all on public.mailbox_overview from public, anon, authenticated;
grant select on public.mailbox_overview to authenticated;

-- ---------------------------------------------------------------------------
-- Funções: revogar o padrão (EXECUTE para PUBLIC) e conceder explicitamente
-- ---------------------------------------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated, service_role;

grant execute on function public.my_account() to authenticated;
grant execute on function public.create_mailbox(text) to authenticated;
grant execute on function public.set_mailbox_status(uuid, text) to authenticated;
grant execute on function public.delete_mailbox(uuid) to authenticated;
grant execute on function public.grant_support_access(uuid, integer) to authenticated;
grant execute on function public.revoke_support_access(uuid) to authenticated;
grant execute on function public.admin_read_mailbox_messages(uuid) to authenticated;
grant execute on function public.admin_ops_status() to authenticated;
grant execute on function public.admin_list_users(text) to authenticated;
grant execute on function public.admin_update_user(uuid, integer, integer, boolean) to authenticated;
grant execute on function public.admin_list_mailboxes(text) to authenticated;
grant execute on function public.admin_update_settings(boolean, integer, integer) to authenticated;
grant execute on function public.admin_list_audit(integer) to authenticated;

-- Somente a credencial de servidor (Edge Function / servidor Next.js).
grant execute on function public.ingest_message(jsonb) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.record_audit(uuid, text, text, text, jsonb) to service_role;

-- Novas funções criadas no futuro não recebem EXECUTE automático.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
