# Diagnóstico e recuperação de falhas

## Onde olhar

| Componente | Logs | O que é registrado |
|---|---|---|
| Email Worker | `npx wrangler tail inboxnexo-email-ingest` ou Cloudflare → Workers → Logs | Resultado (`stored`, `duplicate`, rejeições), status HTTP, ID do evento, tamanho. **Sem** corpo, assunto, código ou endereços. |
| Email Routing | Cloudflare → Email → Email Routing → Activity Log | Entregas, rejeições e falhas por mensagem. |
| Edge Function | Supabase → Edge Functions → ingest → Logs | `ingest`, `ingest_rejected` (motivo da assinatura), `ingest_db_error`. |
| Banco | Supabase → Logs; `cron.job_run_details`; `private.maintenance_runs` | Execuções da limpeza (apenas contagens). |
| Painel | Vercel → Project → Logs | `db_error` com código, sem dados de usuário. |

## Sintomas comuns

### Nenhuma mensagem chega

1. `Resolve-DnsName inboxnexo.online -Type MX`: o MX é o do Email Routing? (ver [DNS.md](DNS.md#verificação-no-windows))
2. Cloudflare → Email Routing: o status está habilitado e o catch-all está **Active** com **Send to a Worker**?
3. Existe uma regra específica que captura o endereço antes do catch-all?
4. `wrangler tail` mostra a invocação? Se não mostrar, o problema está antes do Worker (DNS ou roteamento).
5. Erro `EXCEEDED_CPU` nos logs: o plano Workers Free limita a CPU a 10 ms por invocação; mensagens grandes podem exceder. Use o plano Workers Paid.

### Worker registra `http: 401`

O segredo HMAC difere entre Worker e Edge Function, ou o relógio está fora da janela de 5 minutos (raro, pois os dois usam relógio de servidor). Refaça `wrangler secret put INGEST_HMAC_SECRET` e `supabase secrets set INGEST_HMAC_SECRET=...` com o **mesmo** valor.

### Worker registra `http: 503`

- `status: "paused"`: o recebimento foi pausado em Administração.
- `banco_indisponivel`: o RPC falhou (banco indisponível, migrations ausentes ou chave secreta inválida). Veja os logs da Edge Function.

Em ambos os casos o Worker lança exceção e **não** confirma o recebimento. O que acontece com a mensagem depende do Cloudflare e do servidor remetente: a página oficial do handler **não documenta** se uma exceção gera falha temporária SMTP com reenvio. Use o passo 6 de [TESTE-REAL.md](TESTE-REAL.md) para observar o comportamento real, e não presuma reenvios ilimitados.

### Mensagens vencidas acumulam

O painel administrativo avisa quando a limpeza não roda há mais de 5 minutos. As mensagens **continuam inacessíveis** (a RLS filtra `expires_at > now()`); só a exclusão física atrasa.

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'inboxnexo-purge-expired';
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'inboxnexo-purge-expired')
 order by start_time desc limit 10;
-- Execução manual:
select private.purge_expired(5000, 20);
```

Se o job sumiu, reaplique `supabase/migrations/20261102000005_cron.sql` no SQL Editor.

### Login retorna "Serviço temporariamente indisponível"

A limitação de taxa consulta o banco com a chave secreta e falha fechada. Confira `SUPABASE_URL` e `SUPABASE_SECRET_KEY` na Vercel e se o projeto Supabase está ativo (projetos Free são pausados após inatividade).

### Login retorna "Origem da requisição não permitida"

`APP_URL` na Vercel não corresponde ao endereço acessado (por exemplo, com barra extra ou `http`). Use exatamente `https://painel.inboxnexo.online`.

### Convite não chega

SMTP do Supabase Auth não configurado ou com limite atingido. Veja Supabase → Logs → Auth.

## Selo de remetente autenticado

Por padrão, `TRUSTED_AUTHSERV_IDS` está **vazio** e nenhuma mensagem recebe o selo "Remetente autenticado". Isso é intencional: um remetente pode inserir um cabeçalho `Authentication-Results` falso, e há relato público de que Workers ligados ao Email Routing **não** recebem esse cabeçalho com SPF/DKIM/DMARC ([workerd#6740](https://github.com/cloudflare/workerd/issues/6740)).

Para habilitar o selo com segurança:

1. Em `wrangler.jsonc`, defina `DIAGNOSTIC_AUTH_HEADERS` como `"true"` e faça o deploy.
2. Envie uma mensagem de um provedor que assina DKIM (Gmail, por exemplo). No `wrangler tail`, o evento `diagnostic_auth_headers` lista os `authservIds` presentes, sem valores.
3. **Teste de falsificação:** a partir de um servidor que você controla, envie uma mensagem contendo um cabeçalho `Authentication-Results: <authserv-id observado>; dmarc=pass header.from=mail.instagram.com`. Confirme que o cabeçalho **adicionado pelo Cloudflare aparece antes** do forjado (o primeiro da lista).
4. Só se o cabeçalho do Cloudflare aparecer em **toda** mensagem e sempre no topo, preencha `TRUSTED_AUTHSERV_IDS` com o authserv-id observado. Volte `DIAGNOSTIC_AUTH_HEADERS` para `"false"` e refaça o deploy.
5. Se o Cloudflare não adicionar o cabeçalho, mantenha a lista vazia: o painel continuará exibindo "Remetente não verificado", separado de "Código identificado".

Domínios reconhecidos: `RECOGNIZED_SENDER_DOMAINS` (padrão `instagram:Instagram:mail.instagram.com`). Confirme os domínios oficiais na central de ajuda do serviço antes de acrescentá-los.

## Rotação do segredo HMAC

1. Gere um novo valor: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
2. Supabase: `npx supabase secrets set INGEST_HMAC_SECRET=<novo> INGEST_HMAC_SECRET_PREVIOUS=<antigo>` (a função aceita os dois).
3. Worker: `npx wrangler secret put INGEST_HMAC_SECRET` com o **novo** valor.
4. Confirme mensagens com `status: "stored"` no `wrangler tail`.
5. Após 10 minutos: `npx supabase secrets unset INGEST_HMAC_SECRET_PREVIOUS`.

Em caso de vazamento, faça a rotação imediatamente e revise os logs da Edge Function por `ingest_rejected`.

## Rotação da chave secreta do Supabase

Crie uma nova chave secreta em Project Settings → API Keys, atualize `SUPABASE_SECRET_KEY` (Vercel, com novo deploy) e `INBOXNEXO_SERVER_SECRET` (`supabase secrets set`), confirme o funcionamento e então revogue a chave antiga.

## Recuperação

| Situação | Ação |
|---|---|
| Banco fora do ar | Pause o recebimento se possível; acompanhe o status do Supabase. Mensagens não confirmadas dependem do reenvio do remetente. |
| Deploy ruim do painel | Vercel → Deployments → Promote/rollback para o deploy anterior. |
| Deploy ruim do Worker | `npx wrangler rollback` ou Cloudflare → Workers → Deployments. |
| Migração com erro | Corrija com uma **nova** migration; não edite migrations já aplicadas. |
| Conta comprometida | Administração → Usuários → Desativar (bloqueia login no Auth e no banco); revogue admin via SQL se necessário. |
