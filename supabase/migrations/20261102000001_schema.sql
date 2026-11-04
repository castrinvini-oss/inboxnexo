-- InboxNexo Pro — esquema base
-- Tabelas expostas ficam em "public" (sempre com RLS). Dados internos ficam
-- em "private", que não é exposto pela API de dados do Supabase.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Configuração operacional (linha única)
-- ---------------------------------------------------------------------------
create table private.app_settings (
  id boolean primary key default true check (id),
  mail_domain text not null default 'inboxnexo.online',
  default_max_mailboxes integer not null default 5 check (default_max_mailboxes between 0 and 1000),
  default_max_messages_per_hour integer not null default 60 check (default_max_messages_per_hour between 0 and 10000),
  message_retention_seconds integer not null default 3600 check (message_retention_seconds between 60 and 3600),
  ingest_paused boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.app_settings (id) values (true);

-- Identificadores reservados para administração e operação.
create table private.reserved_local_parts (
  local_part text primary key,
  reason text not null default 'operacional'
);
insert into private.reserved_local_parts (local_part, reason) values
  ('admin','administração'), ('administrador','administração'), ('root','administração'),
  ('postmaster','RFC 5321'), ('abuse','RFC 2142'), ('hostmaster','RFC 2142'),
  ('webmaster','RFC 2142'), ('security','RFC 2142'), ('seguranca','operacional'),
  ('mailer-daemon','operacional'), ('noreply','operacional'), ('no-reply','operacional'),
  ('suporte','operacional'), ('support','operacional'), ('contato','operacional'),
  ('contact','operacional'), ('info','operacional'), ('painel','operacional'),
  ('financeiro','operacional'), ('billing','operacional'), ('dmarc','operacional'),
  ('dmarc-reports','operacional'), ('privacy','operacional'), ('privacidade','operacional'),
  ('www','operacional'), ('mail','operacional'), ('email','operacional'),
  ('inboxnexo','marca'), ('sistema','operacional'), ('system','operacional');

-- ---------------------------------------------------------------------------
-- Perfis e papéis
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text check (char_length(display_name) <= 100),
  max_mailboxes integer check (max_mailboxes between 0 and 1000),
  max_messages_per_hour integer check (max_messages_per_hour between 0 and 10000),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Papéis ficam fora do alcance da API: nenhum usuário consegue alterá-los.
create table private.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  granted_at timestamptz not null default now(),
  granted_by text not null
);

-- ---------------------------------------------------------------------------
-- Caixas
-- ---------------------------------------------------------------------------
-- Linhas nunca são apagadas fisicamente: o identificador fica reservado para
-- sempre (status 'deleted'), evitando reutilização por outro cliente.
create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete set null,
  local_part text not null,
  domain text not null,
  status text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint mailboxes_local_part_key unique (local_part),
  constraint mailboxes_local_part_format check (
    char_length(local_part) between 3 and 32
    and local_part ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
    and position('..' in local_part) = 0
  ),
  constraint mailboxes_owner_required check (owner_id is not null or status = 'deleted')
);
create index mailboxes_owner_idx on public.mailboxes (owner_id) where status <> 'deleted';

-- ---------------------------------------------------------------------------
-- Mensagens (conteúdo temporário: expira 1 hora após o recebimento)
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  dedup_key text not null check (dedup_key ~ '^[0-9a-f]{64}$'),
  from_address text check (char_length(from_address) <= 320),
  from_name text check (char_length(from_name) <= 200),
  subject text not null default '' check (char_length(subject) <= 998),
  text_body text not null default '' check (char_length(text_body) <= 100000),
  code text check (code ~ '^[0-9]{4,10}$'),
  code_status text not null default 'none' check (code_status in ('found', 'ambiguous', 'none')),
  code_candidates text[] not null default '{}',
  code_rule text,
  sender_verification text not null default 'nao_verificado'
    check (sender_verification in ('verificado', 'falhou', 'nao_verificado')),
  sender_service text,
  recipient_tag text check (char_length(recipient_tag) <= 64),
  raw_size integer not null default 0,
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,
  read_at timestamptz,
  constraint messages_dedup_key unique (mailbox_id, dedup_key),
  constraint messages_expiry_after_receipt check (expires_at > received_at),
  constraint messages_code_consistency check ((code_status = 'found') = (code is not null))
);
create index messages_mailbox_received_idx on public.messages (mailbox_id, received_at desc);
create index messages_expires_idx on public.messages (expires_at);

-- Chaves opacas (SHA-256) para impedir duplicação em reentregas mesmo depois
-- que a mensagem foi apagada. Não contém conteúdo. Retenção: 24 horas.
create table private.message_dedup (
  mailbox_id uuid not null,
  dedup_key text not null,
  expires_at timestamptz not null,
  primary key (mailbox_id, dedup_key)
);
create index message_dedup_expires_idx on private.message_dedup (expires_at);

-- Proteção persistente contra replay (identificador do evento HMAC).
-- Retenção: 24 horas (muito maior que a janela de 5 minutos da assinatura).
create table private.ingest_events (
  event_id uuid primary key,
  received_at timestamptz not null default now(),
  outcome text
);
create index ingest_events_received_idx on private.ingest_events (received_at);

-- Limitação de taxa (login, recuperação e endpoints sensíveis).
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on private.rate_limits (window_start);

-- Execuções da limpeza (apenas contagens).
create table private.maintenance_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default clock_timestamp(),
  deleted_messages integer not null default 0,
  deleted_dedup integer not null default 0,
  deleted_events integer not null default 0
);
create index maintenance_runs_job_idx on private.maintenance_runs (job, finished_at desc);

-- ---------------------------------------------------------------------------
-- Acesso de suporte autorizado pelo proprietário da caixa (temporário)
-- ---------------------------------------------------------------------------
create table public.support_grants (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.mailboxes (id) on delete cascade,
  granted_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create index support_grants_mailbox_idx on public.support_grants (mailbox_id, expires_at);

-- ---------------------------------------------------------------------------
-- Auditoria administrativa (NUNCA contém corpo, assunto, remetente ou código)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
