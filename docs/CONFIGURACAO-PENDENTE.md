# Configuração pendente

## Estado após a implantação (02/11/2026)

| Item | Valor real | Estado |
|---|---|---|
| Nameservers (Hostinger) | `kevin.ns.cloudflare.com`, `sneh.ns.cloudflare.com` | Trocados e propagados (1.1.1.1 e 8.8.8.8) |
| DNSSEC | Não estava ativo antes da troca | Reativação pelo Cloudflare: opcional, pendente |
| CNAME `painel` | `8fca31615dcff42d.vercel-dns-017.com` (DNS only) | Ativo; HTTPS emitido pela Vercel |
| TXT `_vercel` | `vc-domain-verify=painel.inboxnexo.online,fa42b36fe38f39f07698` | Domínio verificado na Vercel (escopo `castro21`) |
| Email Routing | MX `route1/2/3.mx.cloudflare.net`, SPF e DKIM do Cloudflare | Ativo |
| Catch-all | Send to a Worker → `inboxnexo-email-ingest` | Ativo |
| Supabase | Projeto `pqlyehehbeldaojspouo` (org "umbra", sa-east-1, Free) | Migrations aplicadas e verificadas; cron ativo |
| Edge Function `ingest` | `https://pqlyehehbeldaojspouo.supabase.co/functions/v1/ingest` | Publicada, JWT desligado, HMAC configurado (401 sem assinatura) |
| Auth | Cadastro público desligado; Site URL e redirect do painel; TOTP habilitado | Configurado |
| Segredos | HMAC (Supabase + Worker), `SUPABASE_SECRET_KEY` (Vercel) | Gravados por `scripts/configurar-segredos.ps1` |
| Administrador inicial | `castrinvini@gmail.com` | Papel concedido via `private.bootstrap_admin`; MFA no primeiro login |
| SMTP do Auth + templates | Provedor a escolher | **Pendente** (necessário para convites e recuperação) |
| `TRUSTED_AUTHSERV_IDS` | vazio | **Pendente** (ver DIAGNOSTICO.md) |
| Teste real | — | **Pendente** (TESTE-REAL.md) |

Observação: um projeto Supabase (`mahyzjebjajkgojwabtb`, org "HOT - RICK") e um projeto Vercel (`inboxnexo-pro`, equipe "fy-rick") foram criados por engano em outra conta e devem ser apagados pelo dono dela.

## Tabela de referência original

Estado em 02/11/2026, antes da implantação: **nenhuma** configuração externa tinha sido feita. Os valores abaixo são placeholders: não os publique literalmente.

**Classificação:** 🟢 público (pode aparecer em DNS ou no navegador) · 🔴 segredo (só no servidor/provedor, nunca versionado) · 🟡 configuração do provedor (fica no painel do serviço, não no código)

| Serviço | Campo / registro | Valor conhecido ou placeholder | Tipo | Onde obter o valor real | Onde configurar | Como verificar | Estado atual |
|---|---|---|---|---|---|---|---|
| Hostinger | Verificação do titular | — | 🟡 | E-mail enviado pela Hostinger / hPanel | Link do e-mail | Aviso some do hPanel | **Pendente** (screenshot) |
| Hostinger | Nameserver 1 | `<CLOUDFLARE_NAMESERVER_1_ATRIBUIDO>` (hoje: `byte.dns-parking.com`) | 🟢 | Cloudflare, ao adicionar a zona | hPanel → Nameservers | `Resolve-DnsName inboxnexo.online -Type NS` | Pendente |
| Hostinger | Nameserver 2 | `<CLOUDFLARE_NAMESERVER_2_ATRIBUIDO>` (hoje: `pixel.dns-parking.com`) | 🟢 | Cloudflare, ao adicionar a zona | hPanel → Nameservers | Idem | Pendente |
| Hostinger/Cloudflare | DNSSEC (DS) | Dados DS exibidos pelo Cloudflare | 🟢 | Cloudflare → DNS → Settings | hPanel → DNSSEC | `Resolve-DnsName inboxnexo.online -Type DS` | Pendente (verificar estado atual antes da troca) |
| Cloudflare | Zona `inboxnexo.online` | — | 🟡 | — | Cloudflare → Add a domain | Status **Active** | Pendente |
| Cloudflare | CNAME `painel` | `<CNAME_FORNECIDO_PELA_VERCEL>` (DNS only) | 🟢 | Vercel → Settings → Domains | Cloudflare → DNS | `Resolve-DnsName painel.inboxnexo.online -Type CNAME` + Vercel "Valid Configuration" | Pendente |
| Cloudflare | MX/TXT do Email Routing | `<REGISTROS_EMAIL_ROUTING_FORNECIDOS_PELO_CLOUDFLARE>` | 🟢 | Assistente do Email Routing | Cloudflare → DNS (automático pelo assistente) | `Resolve-DnsName ... -Type MX` / `-Type TXT` | Pendente |
| Cloudflare | Catch-all → Worker | `inboxnexo-email-ingest` | 🟡 | — | Email Routing → Routing rules | Regra **Active** + TESTE-REAL | Pendente |
| Cloudflare Worker | `MAIL_DOMAIN` | `inboxnexo.online` | 🟢 | Conhecido | `wrangler.jsonc` (vars) | `wrangler deploy` mostra bindings | Código pronto |
| Cloudflare Worker | `INGEST_ENDPOINT_URL` | `<INGEST_ENDPOINT_URL>` = `<SUPABASE_PROJECT_URL>/functions/v1/ingest` | 🟡 | Supabase (URL do projeto) | `wrangler secret put` | Teste real: mensagem chega | Pendente |
| Cloudflare Worker | `INGEST_HMAC_SECRET` | `<INGEST_HMAC_SECRET>` | 🔴 | Gerar localmente (48 bytes aleatórios) | `wrangler secret put` | Teste real (401 nos logs = divergente) | Pendente |
| Cloudflare Worker | `TRUSTED_AUTHSERV_IDS` | vazio (nenhum selo) | 🟡 | Inspeção de mensagens reais ([DIAGNOSTICO.md](DIAGNOSTICO.md#selo-de-remetente-autenticado)) | `wrangler.jsonc` | Procedimento com cabeçalho forjado | Pendente (manter vazio até verificar) |
| Supabase | URL do projeto | `<SUPABASE_PROJECT_URL>` | 🟢 | Project Settings → API | Vercel (`SUPABASE_URL`) | Painel abre sem erro de configuração | Pendente |
| Supabase | Chave publicável | `<SUPABASE_PUBLISHABLE_KEY>` | 🟢 | Project Settings → API Keys | Vercel (`SUPABASE_PUBLISHABLE_KEY`) | Login funciona | Pendente |
| Supabase | Chave secreta | `<SUPABASE_SERVER_SECRET>` | 🔴 | Project Settings → API Keys | Vercel (`SUPABASE_SECRET_KEY`) e `supabase secrets` (`INBOXNEXO_SERVER_SECRET`) | Convite e ingestão funcionam | Pendente |
| Supabase | `INGEST_HMAC_SECRET` | `<INGEST_HMAC_SECRET>` (mesmo do Worker) | 🔴 | O mesmo valor gerado acima | `supabase secrets set` | Teste real | Pendente |
| Supabase | Migrations + cron | `supabase/migrations/*` | 🟡 | Repositório | `supabase db push` | Database → Cron Jobs; tabela `private.maintenance_runs` | Código pronto e testado localmente |
| Supabase Auth | Cadastro público | Desativado | 🟡 | — | Auth → Providers → Email | Sem botão "cadastre-se"; signup pela API falha | Pendente |
| Supabase Auth | MFA TOTP | Habilitado | 🟡 | — | Auth → Multi-Factor | Admin passa por `/mfa` | Pendente |
| Supabase Auth | Site URL / Redirect URLs | `https://painel.inboxnexo.online` / `.../auth/confirm` | 🟢 | Conhecido | Auth → URL Configuration | Link de convite abre o painel | Pendente |
| Supabase Auth | SMTP | Credenciais do provedor SMTP escolhido | 🔴 | Provedor SMTP | Auth → SMTP Settings | Convite chega ao e-mail externo | Pendente |
| Supabase Auth | Templates (convite/recuperação) | Ver [ADMINISTRADOR.md](ADMINISTRADOR.md) | 🟡 | — | Auth → Emails → Templates | Link aponta para `/auth/confirm?token_hash=...` | Pendente |
| Vercel | Projeto | Root Directory `apps/web` | 🟡 | — | Vercel → New Project | Build verde | Pendente |
| Vercel | `APP_URL` | `https://painel.inboxnexo.online` | 🟢 | Conhecido | Environment Variables (Production) | Login funciona (Origin aceita) | Pendente |
| Vercel | `MAIL_DOMAIN` | `inboxnexo.online` | 🟢 | Conhecido | Environment Variables | Convite recusa e-mails `@inboxnexo.online` | Pendente |
| Vercel | `MESSAGE_RETENTION_SECONDS` | `3600` | 🟢 | Conhecido (informativo; a regra efetiva está no banco) | Environment Variables | — | Pendente |
| Vercel | Domínio | `painel.inboxnexo.online` | 🟢 | — | Settings → Domains | Certificado HTTPS emitido | Pendente |
| Painel | Administrador inicial | E-mail externo do administrador | 🟡 | Você | Supabase Auth + `scripts/create-admin.sql` | Acesso à Administração com MFA | Pendente |
