# InboxNexo Pro

Aplicação de recebimento de e-mails com caixas individuais em `identificador@inboxnexo.online`, identificação de códigos de confirmação e exclusão automática das mensagens uma hora após o recebimento. Painel em `https://painel.inboxnexo.online` (planejado).

## Estado atual

| Item | Estado |
|---|---|
| Código (painel, Worker, Edge Function, migrations, testes) | **Implementado** |
| Testes automatizados (73), typecheck, build do painel, bundle do Worker | **Executados localmente e aprovados** |
| Banco testado em PostgreSQL real (PGlite/WASM) com RLS | **Testado localmente** (sem pg_cron, que não existe no PGlite) |
| Supabase, Vercel, Cloudflare (DNS, Email Routing, Worker) | **Configuração externa pendente** ([CONFIGURACAO-PENDENTE.md](docs/CONFIGURACAO-PENDENTE.md)) |
| Implantação | **Não implantado** |
| Validação em produção | **Não validado**: siga [TESTE-REAL.md](docs/TESTE-REAL.md) após implantar |

Nenhuma mensagem está sendo recebida hoje. O domínio ainda usa os nameservers da Hostinger e a verificação do titular está pendente (dados do screenshot).

## Arquitetura

```
Remetente ──SMTP──▶ Cloudflare Email Routing (catch-all)
                         │  "Send to a Worker"
                         ▼
                  Email Worker (TypeScript, postal-mime)
                  · destinatário = envelope (message.to)
                  · MIME → texto, código, verificação do remetente
                         │  HTTPS + HMAC-SHA-256 (timestamp + evento + corpo)
                         ▼
                  Supabase Edge Function "ingest"
                  · verifica assinatura ANTES de interpretar
                         │  RPC ingest_message (service_role)
                         ▼
                  PostgreSQL (RLS) ◀── Supabase Cron: limpeza a cada minuto
                         ▲
                         │  identidade do usuário (RLS)
         Painel Next.js na Vercel (rotas de servidor, cookies HttpOnly)
                         ▲
                     Navegador
```

O catch-all apenas **encaminha** tudo ao Worker. Quem decide se existe uma caixa, a quem pertence e se está ativa é o banco (`ingest_message`). Roteamento não é armazenamento.

### Decisões principais

| Tema | Decisão |
|---|---|
| Sessão | O navegador fala **somente** com o Next.js. Cookies do Supabase Auth gravados como `HttpOnly`, `SameSite=Lax`, `Secure` em produção; renovação no `proxy.ts` do servidor. Nenhum token é lido no cliente. |
| CSRF | Rotas que alteram estado exigem `Origin` igual a `APP_URL` e corpo `application/json`. |
| Autorização | Consultas de usuários usam a identidade dele e respeitam RLS. A chave secreta só é usada para limitação de taxa, auditoria e Auth Admin (convite/bloqueio). |
| Administradores | Papel em `private.user_roles` (fora da API). Exige MFA (`aal2`) no servidor **e** no banco. Criado por procedimento SQL controlado. |
| Conteúdo para admin | Só com autorização temporária do proprietário, dentro do prazo e auditado. |
| Worker → Edge | HMAC-SHA-256 sobre `v1:timestamp:eventId:corpo`, comparação em tempo constante, janela de 5 min, replay persistente (`private.ingest_events`), dois segredos aceitos durante a rotação. |
| Deduplicação | Chave SHA-256 de (caixa, Message-ID, Date, MAIL FROM, assunto, hash do texto). Única por caixa; mantida 24 h em `private.message_dedup` (sem conteúdo) para que uma reentrega não recrie nem renove a mensagem. |
| Expiração | `expires_at = received_at + 1 h`, com `received_at = now()` do banco. O cabeçalho `Date` é ignorado. |
| HTML | Convertido em texto no Worker; o painel exibe só texto (React escapa). CSP bloqueia imagens remotas e scripts externos. |
| Anexos e MIME bruto | Não armazenados. |

## Regras das caixas

- **Identificador:** 3–32 caracteres ASCII `[a-z0-9._-]`, começando e terminando com letra ou número, sem `..`. Convertido para minúsculas no cadastro **e** no recebimento (`packages/core/src/normalize.ts` e `private.valid_local_part`).
- **Domínio:** exatamente `inboxnexo.online`. Subdomínios e outros domínios são rejeitados.
- **`+` (subendereço):** `nome+tag@` é entregue na caixa `nome`, com a tag registrada. O `+` nunca é aceito em identificadores, então não há colisão.
- **Pontos:** preservados. `a.b` e `ab` são caixas diferentes.
- **Desconhecido:** rejeitado (`setReject`, erro permanente). **Nenhuma caixa é criada automaticamente.**
- **Desativada, excluída ou de usuário desativado:** rejeitada; nada é armazenado.
- **Excluída:** o endereço fica reservado para sempre (status `deleted`) e não é reutilizado por outro cliente.
- **Reservados:** `admin`, `postmaster`, `abuse`, `security`, `noreply`, `suporte` etc. (`private.reserved_local_parts`).
- **Limites:** caixas por usuário e mensagens por hora (padrões configuráveis em Administração; valores por usuário opcionais). Cota excedida resulta em rejeição.
- **Tamanho:** 5 MiB por mensagem (`MAX_RAW_BYTES`), verificado antes e durante a leitura; texto truncado em 100 mil caracteres.

## Códigos de confirmação

- Regras extensíveis em `packages/core/src/codes.ts`: padrões fortes por serviço (Instagram em PT/EN/ES) e regra genérica com palavras de contexto.
- Código sempre como texto (zeros à esquerda preservados).
- Datas, horários, telefones, valores, CEP, pedidos e protocolos são descartados; números sem contexto não viram código.
- Mais de um candidato resulta em ambiguidade (sem destaque). Sem evidência suficiente: "Nenhum código identificado".
- **Código encontrado ≠ remetente autenticado.** O selo depende de um `Authentication-Results` de um authserv-id confiável **configurado pelo operador** (vazio por padrão) e de DMARC `pass` alinhado ao `From` de um domínio reconhecido. Veja [DIAGNOSTICO.md](docs/DIAGNOSTICO.md#selo-de-remetente-autenticado).
- Não há garantia de que o Instagram aceite o domínio ou envie todos os códigos.

## Expiração, limpeza e retenção

1. **Expiração de acesso:** as políticas RLS, as rotas e a interface só mostram mensagens com `expires_at > now()`. Vale mesmo que a limpeza esteja parada (testado).
2. **Exclusão física:** `private.purge_expired` roda a cada minuto pelo Supabase Cron, em lotes de 5.000 (até 20 lotes), usando o índice em `expires_at`. Ela remove corpo, assunto, remetente e código (todos na mesma linha). Execuções ficam em `private.maintenance_runs` (só contagens); o painel avisa se não houver execução há mais de 5 minutos.

A exclusão física acontece na próxima execução após o vencimento e pode atrasar se o banco ou o cron estiverem indisponíveis.

**Dados auxiliares retidos (sem conteúdo):** chaves de deduplicação (hash, 24 h), IDs de eventos HMAC (24 h), contadores de limitação de taxa (1 dia), auditoria administrativa (180 dias, sem conteúdo de mensagens).

**Backups e logs dos provedores:** um `DELETE` não remove cópias já incluídas em backups do Supabase (diários nos planos pagos; PITR, se contratado, mantém histórico pelo período escolhido) nem conteúdo já copiado pelo usuário. Logs do Cloudflare, Supabase e Vercel não recebem corpo, assunto ou código pelo código desta aplicação, mas seguem a retenção de cada provedor. Consulte as políticas vigentes de cada serviço antes de assumir compromissos de privacidade.

**No navegador:** contagem regressiva, remoção automática ao expirar, revalidação ao recuperar foco, `Cache-Control: no-store`, nenhum dado de mensagem em localStorage/IndexedDB/cache offline (só a preferência de tema), logout com navegação completa (descarta o estado em memória) e revalidação se a página voltar do cache de navegação.

## Estrutura

```
inboxnexo-pro/
├── apps/web/                    Painel Next.js 16 (App Router, Tailwind 4)
│   ├── src/proxy.ts             Renovação de sessão e proteção de páginas
│   ├── src/app/api/...          Rotas de servidor (auth, caixas, mensagens, admin)
│   ├── src/app/...              Páginas (login, recuperar, mfa, caixas, admin)
│   ├── src/lib/                 Sessão, CSRF, limitação de taxa, polling
│   ├── vercel.json, next.config.ts (CSP e cabeçalhos), .env.example
├── workers/email-ingest/        Email Worker (wrangler.jsonc, .dev.vars.example)
├── packages/core/               Código compartilhado: normalização, códigos, HMAC,
│                                verificação do remetente, HTML→texto, contrato do payload
├── supabase/
│   ├── migrations/              001 esquema · 002–003 funções · 004 RLS/permissões · 005 cron
│   ├── functions/ingest/        Edge Function (handler testável + index Deno)
│   ├── functions/_shared/core/  Cópia gerada de packages/core (npm run sync:shared)
│   ├── functions/env.example    Segredos da Edge Function (placeholders)
│   └── config.toml
├── tests/                       Banco (RLS), Edge Function, pipeline ponta a ponta,
│   └── fixtures/                mensagens MIME sintéticas
├── scripts/                     sync-shared.mjs, create-admin.sql
└── docs/                        DNS, configuração pendente, diagnóstico, admin, teste real
```

## Versões utilizadas (travadas em `package-lock.json`)

| Pacote | Versão |
|---|---|
| Node.js (testado) | 24.20.0 (mínimo 20.9) |
| next | 16.4.3 |
| react / react-dom | 19.3.1 |
| typescript | 5.9.3 |
| tailwindcss / @tailwindcss/postcss | 4.3.3 |
| @supabase/supabase-js | 2.118.0 |
| @supabase/ssr | 0.12.7 |
| zod | 4.6.7 |
| postal-mime | 4.2.0 |
| wrangler | 4.156.1 |
| @cloudflare/workers-types | 4.20260702.1 |
| vitest | 4.1.12 |
| @electric-sql/pglite (testes) | 0.5.14 |
| PostgreSQL alvo | 17 (`supabase/config.toml`) |

O TypeScript 7 e o Vitest 5 já existiam, mas optei pelas linhas 5.9 e 4.1, que são estáveis e compatíveis com Next 16.

## Instalação local

```bash
npm install
npm run sync:shared
npm test            # 73 testes: core, banco (RLS), Edge Function, pipeline
npm run typecheck   # raiz + painel + Worker
npm run build       # build de produção do painel
```

O npm 11 bloqueia scripts de instalação não aprovados (avisos sobre `esbuild` e `workerd`). Os testes e o build funcionaram mesmo assim; para usar `wrangler dev` localmente, rode `npm install-scripts approve workerd esbuild`.

Para executar o painel contra um Supabase real (ou local com `npx supabase start`, que exige Docker):

```bash
cp apps/web/.env.example apps/web/.env.local   # preencha os valores reais
npm run dev -w @inboxnexo/web
```

Worker local: copie `workers/email-ingest/.dev.vars.example` para `.dev.vars`, preencha e rode `npx wrangler dev`.

## Implantação

Siga **na ordem** o [docs/DNS.md](docs/DNS.md): A (Hostinger), B (Cloudflare), C (Supabase + Vercel), D (domínio do painel), E (Email Routing + Worker). Depois: [ADMINISTRADOR.md](docs/ADMINISTRADOR.md) e [TESTE-REAL.md](docs/TESTE-REAL.md).

Ambientes: use projetos Supabase separados para desenvolvimento/preview e produção, e cadastre as variáveis da Vercel por ambiente. Segredos nunca usam o prefixo `NEXT_PUBLIC_`; neste projeto o navegador não recebe nenhuma chave do Supabase.

## Custos e limites (consultados em 02/11/2026; confirme nos sites oficiais)

| Serviço | Pontos relevantes |
|---|---|
| Cloudflare DNS + Email Routing | Disponíveis no plano Free da zona. Limites do Email Routing: mensagens de até 25 MiB, 200 regras por domínio, 200 endereços de destino por conta ([limites](https://developers.cloudflare.com/email-routing/limits/)). |
| Cloudflare Workers | Free: 100 mil requisições/dia e **10 ms de CPU por invocação**; a própria documentação do Email Routing alerta que handlers complexos podem falhar com `EXCEEDED_CPU`. Paid: a partir de US$ 5/mês, com 10 milhões de requisições e 30 milhões de ms de CPU incluídos ([preços](https://developers.cloudflare.com/workers/platform/pricing/)). **Recomendado: Paid.** |
| Supabase | Free: 500 MB de banco, projetos pausados após uma semana de inatividade (inadequado para produção). Pro: a partir de US$ 25/mês por organização, com cobrança por uso excedente. Backups e PITR variam por plano ([preços](https://supabase.com/pricing)). |
| Vercel | Hobby é **somente para uso pessoal e não comercial**; um serviço para clientes exige Pro (US$ 20 por usuário/mês, mais uso excedente) ([Hobby](https://vercel.com/docs/plans/hobby)). |
| SMTP para Auth | Depende do provedor escolhido (convites e recuperação). |

Estimativa mínima para operação comercial: ~US$ 50/mês (Workers Paid + Supabase Pro + Vercel Pro com 1 usuário), mais SMTP e excedentes. Nenhum desses serviços é ilimitado.

## Documentos

- [docs/DNS.md](docs/DNS.md): DNS e implantação passo a passo, com consultas `Resolve-DnsName`
- [docs/CONFIGURACAO-PENDENTE.md](docs/CONFIGURACAO-PENDENTE.md): tabela de valores pendentes (público, segredo, provedor)
- [docs/ADMINISTRADOR.md](docs/ADMINISTRADOR.md): administrador inicial, templates de e-mail, acesso de suporte
- [docs/DIAGNOSTICO.md](docs/DIAGNOSTICO.md): falhas, logs, selo de remetente, rotação de segredos, recuperação
- [docs/TESTE-REAL.md](docs/TESTE-REAL.md): roteiro de validação após implantar
