-- InboxNexo Pro — funções
-- Todas as funções SECURITY DEFINER usam search_path vazio, qualificam nomes
-- e validam autorização internamente. Permissões de execução são concedidas
-- explicitamente em 20261102000004_rls_and_grants.sql.

-- ---------------------------------------------------------------------------
-- Autorização
-- ---------------------------------------------------------------------------
create or replace function private.has_admin_role(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.user_roles r where r.user_id = p_user and r.role = 'admin');
$$;

-- Administrador efetivo: papel admin + sessão com MFA (aal2).
create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and private.has_admin_role(auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

create or replace function private.require_admin()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

create or replace function private.require_user()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'nao_autenticado' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.disabled) then
    raise exception 'conta_desativada' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function private.audit(p_actor uuid, p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (p_actor, p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Perfis: criados automaticamente para cada usuário do Supabase Auth
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Ao remover um perfil, as caixas viram "deleted" (endereço continua bloqueado).
create or replace function private.handle_profile_delete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.messages m using public.mailboxes b where m.mailbox_id = b.id and b.owner_id = old.id;
  update public.mailboxes set status = 'deleted', deleted_at = now(), updated_at = now()
   where owner_id = old.id and status <> 'deleted';
  return old;
end;
$$;

create trigger on_profile_delete
  before delete on public.profiles
  for each row execute function private.handle_profile_delete();

-- ---------------------------------------------------------------------------
-- Conta atual
-- ---------------------------------------------------------------------------
create or replace function public.my_account()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_settings private.app_settings;
begin
  if v_uid is null then
    raise exception 'nao_autenticado' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  select * into v_settings from private.app_settings where id;
  return jsonb_build_object(
    'id', v_uid,
    'email', v_profile.email,
    'display_name', v_profile.display_name,
    'disabled', coalesce(v_profile.disabled, false),
    'has_admin_role', private.has_admin_role(v_uid),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'mail_domain', v_settings.mail_domain,
    'retention_seconds', v_settings.message_retention_seconds,
    'max_mailboxes', coalesce(v_profile.max_mailboxes, v_settings.default_max_mailboxes),
    'max_messages_per_hour', coalesce(v_profile.max_messages_per_hour, v_settings.default_max_messages_per_hour),
    'mailbox_count', (select count(*) from public.mailboxes b where b.owner_id = v_uid and b.status <> 'deleted')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Caixas
-- ---------------------------------------------------------------------------
create or replace function private.valid_local_part(p text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p is not null
     and char_length(p) between 3 and 32
     and p ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
     and position('..' in p) = 0;
$$;

create or replace function public.create_mailbox(p_local_part text default null)
returns public.mailboxes
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_settings private.app_settings;
  v_limit integer;
  v_count integer;
  v_local text;
  v_row public.mailboxes;
  v_attempt integer := 0;
begin
  select * into v_settings from private.app_settings where id;
  select coalesce(p.max_mailboxes, v_settings.default_max_mailboxes) into v_limit
    from public.profiles p where p.id = v_uid;
  -- Serializa criações do mesmo usuário para respeitar o limite.
  perform pg_advisory_xact_lock(hashtext('create_mailbox:' || v_uid::text));
  select count(*) into v_count from public.mailboxes b where b.owner_id = v_uid and b.status <> 'deleted';
  if v_count >= coalesce(v_limit, 0) then
    raise exception 'limite_caixas' using errcode = 'P0001';
  end if;

  if p_local_part is null or btrim(p_local_part) = '' then
    loop
      v_attempt := v_attempt + 1;
      v_local := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
      exit when not exists (select 1 from public.mailboxes b where b.local_part = v_local)
            and not exists (select 1 from private.reserved_local_parts r where r.local_part = v_local);
      if v_attempt > 10 then
        raise exception 'endereco_indisponivel' using errcode = 'P0001';
      end if;
    end loop;
  else
    v_local := lower(btrim(p_local_part));
    if not private.valid_local_part(v_local) then
      raise exception 'identificador_invalido' using errcode = 'P0001';
    end if;
    if exists (select 1 from private.reserved_local_parts r where r.local_part = v_local) then
      raise exception 'identificador_reservado' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.mailboxes (owner_id, local_part, domain)
    values (v_uid, v_local, v_settings.mail_domain)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'endereco_indisponivel' using errcode = 'P0001';
  end;

  perform private.audit(v_uid, 'mailbox.create', 'mailbox', v_row.id::text, jsonb_build_object('address', v_local || '@' || v_settings.mail_domain));
  return v_row;
end;
$$;

create or replace function private.authorize_mailbox(p_id uuid)
returns public.mailboxes
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_row public.mailboxes;
begin
  select * into v_row from public.mailboxes where id = p_id and status <> 'deleted';
  if v_row.id is null or (v_row.owner_id <> v_uid and not private.is_admin()) then
    raise exception 'caixa_nao_encontrada' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

create or replace function public.set_mailbox_status(p_id uuid, p_status text)
returns public.mailboxes
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row public.mailboxes := private.authorize_mailbox(p_id);
begin
  if p_status not in ('active', 'disabled') then
    raise exception 'status_invalido' using errcode = 'P0001';
  end if;
  update public.mailboxes set status = p_status, updated_at = now() where id = v_row.id returning * into v_row;
  perform private.audit(auth.uid(), 'mailbox.status', 'mailbox', v_row.id::text, jsonb_build_object('status', p_status));
  return v_row;
end;
$$;

create or replace function public.delete_mailbox(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_row public.mailboxes := private.authorize_mailbox(p_id);
begin
  delete from public.messages where mailbox_id = v_row.id;
  delete from public.support_grants where mailbox_id = v_row.id;
  update public.mailboxes set status = 'deleted', deleted_at = now(), updated_at = now() where id = v_row.id;
  perform private.audit(auth.uid(), 'mailbox.delete', 'mailbox', v_row.id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Acesso de suporte autorizado pelo proprietário
-- ---------------------------------------------------------------------------
create or replace function public.grant_support_access(p_mailbox_id uuid, p_hours integer)
returns public.support_grants
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_row public.support_grants;
begin
  if p_hours is null or p_hours < 1 or p_hours > 24 then
    raise exception 'prazo_invalido' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.mailboxes b where b.id = p_mailbox_id and b.owner_id = v_uid and b.status <> 'deleted') then
    raise exception 'caixa_nao_encontrada' using errcode = 'P0002';
  end if;
  update public.support_grants set revoked_at = now() where mailbox_id = p_mailbox_id and revoked_at is null;
  insert into public.support_grants (mailbox_id, granted_by, expires_at)
  values (p_mailbox_id, v_uid, now() + make_interval(hours => p_hours))
  returning * into v_row;
  perform private.audit(v_uid, 'support.grant', 'mailbox', p_mailbox_id::text, jsonb_build_object('hours', p_hours));
  return v_row;
end;
$$;

create or replace function public.revoke_support_access(p_mailbox_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_uid uuid := private.require_user();
begin
  if not exists (select 1 from public.mailboxes b where b.id = p_mailbox_id and b.owner_id = v_uid) then
    raise exception 'caixa_nao_encontrada' using errcode = 'P0002';
  end if;
  update public.support_grants set revoked_at = now() where mailbox_id = p_mailbox_id and revoked_at is null;
  perform private.audit(v_uid, 'support.revoke', 'mailbox', p_mailbox_id::text, '{}'::jsonb);
end;
$$;

-- Leitura administrativa: exige MFA, autorização vigente do proprietário,
-- respeita a expiração e é auditada.
create or replace function public.admin_read_mailbox_messages(p_mailbox_id uuid)
returns table (
  id uuid, from_address text, from_name text, subject text, text_body text,
  code text, code_status text, sender_verification text, received_at timestamptz, expires_at timestamptz
)
language plpgsql volatile security definer set search_path = ''
as $$
declare v_admin uuid := private.require_admin();
begin
  if not exists (
    select 1 from public.support_grants g
     where g.mailbox_id = p_mailbox_id and g.revoked_at is null and g.expires_at > now()
  ) then
    raise exception 'sem_autorizacao_do_proprietario' using errcode = '42501';
  end if;
  perform private.audit(v_admin, 'admin.content_access', 'mailbox', p_mailbox_id::text, '{}'::jsonb);
  return query
    select m.id, m.from_address, m.from_name, m.subject, m.text_body, m.code, m.code_status,
           m.sender_verification, m.received_at, m.expires_at
      from public.messages m
     where m.mailbox_id = p_mailbox_id and m.expires_at > now()
     order by m.received_at desc
     limit 100;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ingestão (executada SOMENTE pela Edge Function com credencial de servidor)
-- ---------------------------------------------------------------------------
create or replace function public.ingest_message(p jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_settings private.app_settings;
  v_event uuid;
  v_local text := lower(p #>> '{recipient,localPart}');
  v_mailbox public.mailboxes;
  v_owner public.profiles;
  v_limit integer;
  v_recent integer;
  v_dedup text := p ->> 'dedupKey';
  v_id uuid;
  v_code_status text := coalesce(p #>> '{code,status}', 'none');
  v_code text := p #>> '{code,value}';
  v_candidates text[];
  v_outcome text;
begin
  select * into v_settings from private.app_settings where id;
  if v_settings.ingest_paused then
    return jsonb_build_object('status', 'paused');
  end if;

  begin
    v_event := (p ->> 'eventId')::uuid;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;

  insert into private.ingest_events (event_id) values (v_event) on conflict do nothing;
  if not found then
    return jsonb_build_object('status', 'replay');
  end if;

  select * into v_mailbox from public.mailboxes where local_part = v_local;
  if v_mailbox.id is null then
    v_outcome := 'unknown_mailbox';
  elsif v_mailbox.status <> 'active' then
    v_outcome := 'inactive_mailbox';
  else
    select * into v_owner from public.profiles where id = v_mailbox.owner_id;
    if v_owner.id is null or v_owner.disabled then
      v_outcome := 'inactive_mailbox';
    end if;
  end if;

  if v_outcome is null then
    -- Reentrega: a chave opaca é mantida por 24 h, então a mesma mensagem não
    -- é duplicada nem tem seu prazo renovado.
    if exists (select 1 from private.message_dedup d where d.mailbox_id = v_mailbox.id and d.dedup_key = v_dedup)
       or exists (select 1 from public.messages m where m.mailbox_id = v_mailbox.id and m.dedup_key = v_dedup) then
      v_outcome := 'duplicate';
    end if;
  end if;

  if v_outcome is null then
    v_limit := coalesce(v_owner.max_messages_per_hour, v_settings.default_max_messages_per_hour);
    select count(*) into v_recent
      from public.messages m join public.mailboxes b on b.id = m.mailbox_id
     where b.owner_id = v_owner.id and m.received_at > now() - interval '1 hour';
    if v_recent >= v_limit then
      v_outcome := 'quota_exceeded';
    end if;
  end if;

  if v_outcome is null then
    insert into private.message_dedup (mailbox_id, dedup_key, expires_at)
    values (v_mailbox.id, v_dedup, now() + interval '24 hours')
    on conflict do nothing;
    if not found then
      v_outcome := 'duplicate';
    end if;
  end if;

  if v_outcome is null then
    if v_code_status <> 'found' then
      v_code := null;
    end if;
    select coalesce(array_agg(x), '{}') into v_candidates
      from (select jsonb_array_elements_text(coalesce(p #> '{code,candidates}', '[]'::jsonb)) as x limit 5) c;

    -- received_at usa o relógio do banco (now()); o cabeçalho Date é ignorado.
    insert into public.messages (
      mailbox_id, dedup_key, from_address, from_name, subject, text_body,
      code, code_status, code_candidates, code_rule, sender_verification, sender_service,
      recipient_tag, raw_size, received_at, expires_at
    ) values (
      v_mailbox.id, v_dedup,
      nullif(p ->> 'fromAddress', ''), nullif(p ->> 'fromName', ''),
      coalesce(p ->> 'subject', ''), coalesce(p ->> 'textBody', ''),
      v_code, v_code_status, v_candidates, p #>> '{code,ruleId}',
      coalesce(p #>> '{sender,verification}', 'nao_verificado'), p #>> '{sender,serviceId}',
      nullif(p #>> '{recipient,tag}', ''), coalesce((p ->> 'rawSize')::integer, 0),
      now(), now() + make_interval(secs => v_settings.message_retention_seconds)
    ) returning id into v_id;
    v_outcome := 'stored';
  end if;

  update private.ingest_events set outcome = v_outcome where event_id = v_event;
  return jsonb_strip_nulls(jsonb_build_object('status', v_outcome, 'messageId', v_id));
end;
$$;

