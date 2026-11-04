# Guia de DNS e implantação (ordem obrigatória)

Este guia é para quem não é especialista. Cada etapa diz **em qual serviço** ela acontece. Siga a ordem: as etapas seguintes dependem das anteriores.

> **Estado de partida (screenshot da Hostinger, não consulta em tempo real):** domínio `inboxnexo.online` registrado na Hostinger, nameservers `byte.dns-parking.com` e `pixel.dns-parking.com`, verificação do titular **pendente**. Nada configurado em Cloudflare, Supabase ou Vercel.

Valores entre `< >` são placeholders. **Nunca** publique o placeholder literalmente: copie o valor real do painel indicado. A tabela completa está em [CONFIGURACAO-PENDENTE.md](CONFIGURACAO-PENDENTE.md).

---

## Etapa A — Hostinger: verificação do titular

**Onde:** e-mail do titular e hPanel da Hostinger.

1. Procure na caixa de entrada (e no spam) o e-mail de verificação de contato do titular enviado pela Hostinger e clique no link de confirmação.
2. Se não encontrar: **hPanel → Domínios → inboxnexo.online** e use a opção de reenviar o e-mail de verificação.
3. Volte ao hPanel e confirme que o aviso de verificação pendente sumiu.

Essa verificação é exigida pelo registrador (regras da ICANN). Ela **não** é a ativação DNS do Cloudflare nem a validação de domínio da Vercel. Domínios sem verificação podem ser suspensos.
Referência: [Hostinger: verificar dados do titular](https://www.hostinger.com/support/1583443-how-to-verify-domain-registrant-s-contact-details-at-hostinger/).

---

## Etapa B — Cloudflare: DNS autoritativo

**Onde:** painel do Cloudflare e hPanel da Hostinger.

1. **Inventário antes de mudar (Hostinger):** em **hPanel → Domínios → inboxnexo.online → DNS / Nameservers**, anote (ou exporte) todos os registros existentes: A, AAAA, CNAME, MX, TXT (SPF, verificações), CAA, SRV. Para cada um, identifique a função. Não apague nada cuja função você não conhece.
2. **Cloudflare → Add a domain →** `inboxnexo.online` → escolha o plano (Free é suficiente para DNS e Email Routing).
3. **Confira a importação:** a descoberta automática do Cloudflare pode não encontrar todos os registros. Compare com o inventário do passo 1 e adicione o que faltar.
4. **Copie os dois nameservers atribuídos à zona**, exibidos pelo Cloudflare (ex.: `<CLOUDFLARE_NAMESERVER_1_ATRIBUIDO>` e `<CLOUDFLARE_NAMESERVER_2_ATRIBUIDO>`). Eles são específicos da sua conta: não use valores de exemplo da internet.
5. **DNSSEC antes da troca:** no hPanel, verifique se o DNSSEC está ativo para o domínio (ou rode `Resolve-DnsName inboxnexo.online -Type DS`). Se houver registro DS, **desative o DNSSEC na Hostinger e espere o DS sumir** antes de trocar os nameservers. Do contrário, o domínio pode deixar de resolver. Siga o [procedimento oficial](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/).
6. **Troca da delegação (Hostinger):** **hPanel → Domínios → inboxnexo.online → DNS / Nameservers → Alterar nameservers → nameservers personalizados.** Substitua `byte.dns-parking.com` e `pixel.dns-parking.com` pelos dois valores reais do passo 4.
   Criar registros NS dentro da zona antiga **não** troca a delegação: a alteração precisa ser feita no registrador.
7. **Aguarde a ativação:** o Cloudflare mostra a zona como **Active** quando detecta a nova delegação. Pode levar de minutos a 24 horas, às vezes mais. Use **Check nameservers** no Cloudflare e as consultas da seção [Verificação no Windows](#verificação-no-windows).
8. **DNSSEC depois da ativação (opcional, recomendado):** **Cloudflare → DNS → Settings → DNSSEC → Enable**. Copie os dados do registro DS exibidos pelo Cloudflare e cadastre-os no hPanel (seção DNSSEC do domínio).

O domínio **continua registrado na Hostinger**. Depois da ativação, os registros DNS passam a ser gerenciados no Cloudflare: alterações feitas na zona DNS da Hostinger deixam de ter efeito.

---

## Etapa C — Supabase (banco, Auth e Edge Function)

**Onde:** painel do Supabase e terminal do seu computador.

1. **Criar o projeto** em supabase.com. Escolha a região (por exemplo, São Paulo) e guarde a senha do banco em um gerenciador de senhas.
2. **Pegar os identificadores:** em **Project Settings → API Keys**, anote a URL do projeto (`<SUPABASE_PROJECT_URL>`), a chave publicável (`<SUPABASE_PUBLISHABLE_KEY>`) e a chave secreta (`<SUPABASE_SERVER_SECRET>`, que é **segredo**).
3. **Aplicar migrations** (na pasta do projeto):
   ```bash
   npx supabase login
   npx supabase link --project-ref <REF_DO_PROJETO>
   npx supabase db push
   ```
   Isso cria tabelas, RLS, funções e o agendamento `inboxnexo-purge-expired` (pg_cron, a cada minuto).
   Confira em **Database → Cron Jobs** se o job aparece ativo.
4. **Auth:**
   - **Authentication → Sign In / Providers → Email:** mantenha e-mail/senha habilitado e **desative "Allow new users to sign up"**. O cadastro é somente por convite.
   - **Authentication → Multi-Factor:** habilite TOTP.
   - **Authentication → URL Configuration:** Site URL `https://painel.inboxnexo.online`; Redirect URLs `https://painel.inboxnexo.online/auth/confirm`.
   - **Authentication → Emails → SMTP Settings:** configure um provedor SMTP próprio para convites e recuperação (o servidor padrão do Supabase serve só para testes e tem limites baixos). Esse envio é **separado** do recebimento via Email Routing.
   - **Templates:** ajuste os links de convite e recuperação conforme [ADMINISTRADOR.md](ADMINISTRADOR.md).
5. **Edge Function:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   # copie o valor gerado: ele é o INGEST_HMAC_SECRET (segredo)
   npx supabase secrets set INGEST_HMAC_SECRET=<INGEST_HMAC_SECRET> INBOXNEXO_SERVER_SECRET=<SUPABASE_SERVER_SECRET>
   npm run sync:shared
   npx supabase functions deploy ingest --no-verify-jwt
   ```
   A URL da função é `<SUPABASE_PROJECT_URL>/functions/v1/ingest`. Ela é o `<INGEST_ENDPOINT_URL>`.
6. **Painel na Vercel:** importe o repositório, defina **Root Directory = `apps/web`** e cadastre as variáveis de [apps/web/.env.example](../apps/web/.env.example) em **Production**. Use um projeto Supabase separado para **Preview** e **Development**: nunca aponte previews para o banco de produção. Faça o deploy.
7. **Administrador inicial:** siga [ADMINISTRADOR.md](ADMINISTRADOR.md).

---

## Etapa D — Vercel: `painel.inboxnexo.online`

**Onde:** painel da Vercel e painel do Cloudflare. Pré-requisito: Etapa B concluída (zona ativa no Cloudflare).

1. **Vercel → Project → Settings → Domains → Add:** `painel.inboxnexo.online`.
2. A Vercel mostra o registro DNS esperado. Copie o **destino CNAME exibido para este projeto** (`<CNAME_FORNECIDO_PELA_VERCEL>`). Não use um valor genérico de exemplo.
3. **Cloudflare → DNS → Records → Add record:**
   - Type: `CNAME`
   - Name: `painel`
   - Target: o valor do passo 2
   - Proxy status: **DNS only** (nuvem cinza). Isso simplifica a validação e a emissão do certificado.
4. Se a Vercel pedir um registro de verificação (TXT `_vercel` ou similar), crie-o **com o valor exato exibido**. Só crie se for solicitado.
5. Aguarde a Vercel mostrar **Valid Configuration** e o certificado HTTPS emitido. Abra `https://painel.inboxnexo.online` e confira o cadeado.

**Não** troque os nameservers do domínio para a Vercel nesta arquitetura: o DNS autoritativo é o Cloudflare.
Referência: [Vercel: adicionar domínio](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

---

## Etapa E — Recebimento de e-mails (Email Routing + Worker)

**Onde:** terminal, painel do Cloudflare.

1. **Implantar o Worker:**
   ```bash
   cd workers/email-ingest
   npx wrangler login
   npx wrangler secret put INGEST_HMAC_SECRET     # o MESMO valor da Etapa C.5
   npx wrangler secret put INGEST_ENDPOINT_URL    # <SUPABASE_PROJECT_URL>/functions/v1/ingest
   npx wrangler deploy
   ```
2. **Cloudflare → (domínio) → Email → Email Routing → Get started / Enable.**
3. **Registros DNS do Email Routing:** o assistente mostra os registros MX e TXT (SPF) necessários (`<REGISTROS_EMAIL_ROUTING_FORNECIDOS_PELO_CLOUDFLARE>`). Use **Add records automatically** ou copie nomes, valores e prioridades **exatamente** como exibidos.
   - **Antes:** verifique se já existem MX de outro serviço (por exemplo, e-mail da Hostinger). O Email Routing precisa ser o único destino MX do domínio raiz. Se houver um serviço em uso, decida conscientemente antes de removê-lo.
   - **SPF:** um nome só pode ter **um** registro TXT `v=spf1`. Se já existir um, una os mecanismos em uma única política válida em vez de criar um segundo.
4. Se o onboarding exigir **verificação de um endereço de destino**, siga-a. Ela não será usada no fluxo normal: **não** configure encaminhamento das mensagens dos clientes para uma caixa pessoal.
5. **Routing rules → Catch-all address → Edit:** Action **Send to a Worker** → selecione `inboxnexo-email-ingest` → **Save** e confirme que está **Active**.
6. **Revise as regras específicas (Custom addresses):** regras específicas têm prioridade sobre o catch-all. Remova as que desviariam mensagens de caixas cadastradas.

O que **não** fazer:

- Não crie MX apontando para a Vercel, para `painel.inboxnexo.online` ou para a URL do Worker.
- Não crie wildcard DNS (`*`) para representar o catch-all: o catch-all é uma **regra de e-mail**, não um registro DNS.
- Não apague registros de outros serviços sem identificar a função de cada um.

Referências: [Configuração DNS do Email Routing](https://developers.cloudflare.com/email-service/configuration/domains/) · [Regras e catch-all](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/).

Depois disso, siga o roteiro [TESTE-REAL.md](TESTE-REAL.md).

---

## Verificação no Windows

Abra o **PowerShell** e rode as consultas abaixo. `-Server 1.1.1.1` evita o cache do seu provedor; compare com e sem ele.

```powershell
Resolve-DnsName inboxnexo.online -Type NS
Resolve-DnsName inboxnexo.online -Type NS -Server 1.1.1.1
Resolve-DnsName inboxnexo.online -Type MX
Resolve-DnsName inboxnexo.online -Type TXT
Resolve-DnsName painel.inboxnexo.online -Type CNAME
Resolve-DnsName inboxnexo.online -Type DS
```

O que verificar em cada resultado (sem presumir valores):

| Consulta | O que conferir |
|---|---|
| `NS` | Os dois nomes listados devem ser **exatamente** os atribuídos pelo Cloudflare na Etapa B.4. Se ainda aparecer `dns-parking.com`, a troca não foi feita ou não propagou. |
| `MX` | Devem aparecer **somente** os servidores e prioridades exibidos pelo assistente do Email Routing. MX de outro serviço indica conflito. |
| `TXT` | Deve haver **um único** registro iniciado por `v=spf1`, contendo o mecanismo indicado pelo Cloudflare. Dois registros SPF invalidam a política. |
| `CNAME painel` | O destino deve ser **o mesmo** valor exibido pela Vercel na Etapa D.2. |
| `DS` | Vazio antes da migração (ou após desativar o DNSSEC na Hostinger). Depois de reativar o DNSSEC pelo Cloudflare, deve corresponder aos dados DS exibidos pelo Cloudflare. |

Resolver DNS corretamente **não comprova** que o recebimento ponta a ponta funciona. Isso só é confirmado pelo [TESTE-REAL.md](TESTE-REAL.md).
