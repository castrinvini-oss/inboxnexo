-- InboxNexo Pro — funções operacionais e administrativas
-- (continuação de 20261102000002_functions.sql; mesmas regras de SECURITY DEFINER)

-- ---------------------------------------------------------------------------
-- Limitação de taxa (chamada pelo servidor Next.js com credencial privilegiada)
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_key is null or char_length(p_key) > 200 or p_window_seconds < 1 or p_max < 1 then
    raise exception 'parametros_invalidos' using errcode = 'P0001';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limits (key, window_start, hits) values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

create or replace function public.record_audit(p_actor uuid, p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  select private.audit(p_actor, p_action, p_target_type, p_target_id, p_details);
$$;

-- ---------------------------------------------------------------------------
-- Limpeza física (Supabase Cron, a cada minuto, em lotes)
-- ---------------------------------------------------------------------------
create or replace function private.purge_expired(p_batch integer default 5000, p_max_batches integer default 20)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_total integer := 0;
  v_n integer;
  v_dedup integer;
  v_events integer;
  v_i integer := 0;
begin
  loop
    v_i := v_i + 1;
    with doomed as (
      select id from public.messages
       where expires_at <= now()
       order by expires_at
       limit p_batch
       for update skip locked
    )
    delete from public.messages m using doomed where m.id = doomed.id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < p_batch or v_i >= p_max_batches;
  end loop;

  delete from private.message_dedup where expires_at <= now();
  get diagnostics v_dedup = row_count;
  delete from private.ingest_events where received_at < now() - interval '24 hours';
  get diagnostics v_events = row_count;
  delete from private.rate_limits where window_start < now() - interval '1 day';
  delete from public.support_grants where expires_at < now() - interval '1 day';
  delete from private.maintenance_runs where finished_at < now() - interval '7 days';
  delete from public.audit_log where at < now() - interval '180 days';

  insert into private.maintenance_runs (job, started_at, deleted_messages, deleted_dedup, deleted_events)
  values ('purge_expired', v_started, v_total, v_dedup, v_events);

  return jsonb_build_object('deleted_messages', v_total, 'deleted_dedup', v_dedup, 'deleted_events', v_events);
end;
$$;

-- ---------------------------------------------------------------------------
-- Administração (exige papel admin + MFA)
-- ---------------------------------------------------------------------------
create or replace function public.admin_ops_status()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_settings private.app_settings;
  v_last private.maintenance_runs;
begin
  perform private.require_admin();
  select * into v_settings from private.app_settings where id;
  select * into v_last from private.maintenance_runs where job = 'purge_expired' order by finished_at desc limit 1;
  return jsonb_build_object(
    'mail_domain', v_settings.mail_domain,
    'ingest_paused', v_settings.ingest_paused,
    'retention_seconds', v_settings.message_retention_seconds,
    'default_max_mailboxes', v_settings.default_max_mailboxes,
    'default_max_messages_per_hour', v_settings.default_max_messages_per_hour,
    'last_purge_at', v_last.finished_at,
    'last_purge_deleted', v_last.deleted_messages,
    'expired_pending', (select count(*) from public.messages where expires_at <= now()),
    'oldest_expired_seconds', (select extract(epoch from now() - min(expires_at))::integer from public.messages where expires_at <= now()),
    'active_messages', (select count(*) from public.messages where expires_at > now()),
    'users', (select count(*) from public.profiles),
    'mailboxes_active', (select count(*) from public.mailboxes where status = 'active'),
    'mailboxes_disabled', (select count(*) from public.mailboxes where status = 'disabled'),
    'ingest_last_hour', (select jsonb_object_agg(coalesce(outcome, 'pending'), n) from (
        select outcome, count(*) as n from private.ingest_events
         where received_at > now() - interval '1 hour' group by outcome) s)
  );
end;
$$;

create or replace function public.admin_list_users(p_search text default null)
returns table (
  id uuid, email text, display_name text, disabled boolean, is_admin boolean,
  max_mailboxes integer, max_messages_per_hour integer, mailbox_count bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select p.id, p.email, p.display_name, p.disabled, private.has_admin_role(p.id),
           p.max_mailboxes, p.max_messages_per_hour,
           (select count(*) from public.mailboxes b where b.owner_id = p.id and b.status <> 'deleted'),
           p.created_at
      from public.profiles p
     where p_search is null or p.email ilike '%' || replace(replace(p_search, '%', ''), '_', '\_') || '%'
     order by p.created_at desc
     limit 500;
end;
$$;

create or replace function public.admin_update_user(p_user uuid, p_max_mailboxes integer, p_max_messages_per_hour integer, p_disabled boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_admin uuid := private.require_admin();
begin
  if p_user = v_admin and p_disabled then
    raise exception 'nao_pode_desativar_a_si_mesmo' using errcode = 'P0001';
  end if;
  update public.profiles
     set max_mailboxes = p_max_mailboxes,
         max_messages_per_hour = p_max_messages_per_hour,
         disabled = coalesce(p_disabled, disabled)
   where id = p_user;
  if not found then
    raise exception 'usuario_nao_encontrado' using errcode = 'P0002';
  end if;
  perform private.audit(v_admin, 'admin.user_update', 'user', p_user::text,
    jsonb_build_object('max_mailboxes', p_max_mailboxes, 'max_messages_per_hour', p_max_messages_per_hour, 'disabled', p_disabled));
end;
$$;

create or replace function public.admin_list_mailboxes(p_search text default null)
returns table (id uuid, local_part text, domain text, status text, owner_id uuid, owner_email text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select b.id, b.local_part, b.domain, b.status, b.owner_id, p.email, b.created_at
      from public.mailboxes b left join public.profiles p on p.id = b.owner_id
     where p_search is null or b.local_part ilike '%' || replace(replace(p_search, '%', ''), '_', '\_') || '%'
        or p.email ilike '%' || replace(replace(p_search, '%', ''), '_', '\_') || '%'
     order by b.created_at desc
     limit 500;
end;
$$;

create or replace function public.admin_update_settings(
  p_ingest_paused boolean, p_default_max_mailboxes integer, p_default_max_messages_per_hour integer
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_admin uuid := private.require_admin();
begin
  update private.app_settings
     set ingest_paused = coalesce(p_ingest_paused, ingest_paused),
         default_max_mailboxes = coalesce(p_default_max_mailboxes, default_max_mailboxes),
         default_max_messages_per_hour = coalesce(p_default_max_messages_per_hour, default_max_messages_per_hour),
         updated_at = now()
   where id;
  perform private.audit(v_admin, 'admin.settings_update', 'settings', null,
    jsonb_build_object('ingest_paused', p_ingest_paused, 'default_max_mailboxes', p_default_max_mailboxes,
                       'default_max_messages_per_hour', p_default_max_messages_per_hour));
end;
$$;

create or replace function public.admin_list_audit(p_limit integer default 200)
returns setof public.audit_log
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select * from public.audit_log order by at desc limit least(greatest(p_limit, 1), 1000);
end;
$$;

-- ---------------------------------------------------------------------------
-- Procedimento controlado de administrador (somente via SQL Editor/psql
-- com o papel postgres; nenhuma permissão para anon/authenticated/service_role)
-- ---------------------------------------------------------------------------
create or replace function private.bootstrap_admin(p_email text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare v_user uuid;
begin
  if exists (select 1 from private.user_roles where role = 'admin') then
    raise exception 'ja_existe_administrador: use private.grant_admin()';
  end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'usuario_nao_encontrado: convide o usuario pelo Supabase Auth primeiro';
  end if;
  insert into private.user_roles (user_id, role, granted_by) values (v_user, 'admin', 'bootstrap:' || current_user);
  perform private.audit(null, 'admin.bootstrap', 'user', v_user::text, '{}'::jsonb);
  return 'administrador inicial criado: ' || v_user::text;
end;
$$;

create or replace function private.grant_admin(p_email text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'usuario_nao_encontrado';
  end if;
  insert into private.user_roles (user_id, role, granted_by) values (v_user, 'admin', 'sql:' || current_user)
  on conflict (user_id) do nothing;
  perform private.audit(null, 'admin.grant', 'user', v_user::text, '{}'::jsonb);
  return 'papel admin concedido: ' || v_user::text;
end;
$$;

create or replace function private.revoke_admin(p_email text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  delete from private.user_roles where user_id = v_user;
  perform private.audit(null, 'admin.revoke', 'user', v_user::text, '{}'::jsonb);
  return 'papel admin removido';
end;
$$;
