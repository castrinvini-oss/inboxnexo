# Criação do administrador inicial

O papel administrativo fica na tabela `private.user_roles`, que **não é acessível pela API**. Nenhum usuário consegue se promover, e não existe senha padrão no código.

## Pré-requisitos

- Migrations aplicadas (Etapa C do [DNS.md](DNS.md)).
- SMTP do Supabase Auth configurado, para que o convite chegue.
- Templates de e-mail ajustados (ver abaixo).

## Passo a passo

1. **Supabase Dashboard → Authentication → Users → Invite user.** Informe um e-mail **externo e permanente** (por exemplo, a sua conta pessoal ou corporativa). Nunca use um endereço `@inboxnexo.online`: essas caixas expiram e não servem para recuperar o acesso.
2. Abra o e-mail, clique no link, depois em **Continuar** na página `/auth/confirm`, e defina uma senha com pelo menos 12 caracteres.
3. **Supabase Dashboard → SQL Editor**, execute (substitua o e-mail):
   ```sql
   select private.bootstrap_admin('seu-email@externo.com');
   ```
   A função só funciona enquanto **não existir nenhum administrador**. Se já existir, ela recusa a execução.
4. Saia e entre de novo no painel. Você será levado a `/mfa`. Cadastre um aplicativo autenticador (TOTP) e confirme o código.
5. Acesse **Administração**. Sem MFA verificado na sessão (`aal2`), tanto o painel quanto o banco recusam operações administrativas.

## Templates de e-mail do Supabase Auth

Em **Authentication → Emails → Templates**, troque o link padrão para que ele aponte para a página de confirmação do painel. A confirmação acontece por botão (POST), para que scanners de e-mail não consumam o token.

- **Invite user:**
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
- **Reset password:**
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

Em **Authentication → URL Configuration**, defina:

- Site URL: `https://painel.inboxnexo.online`
- Redirect URLs: `https://painel.inboxnexo.online/auth/confirm` (em desenvolvimento, inclua também `http://localhost:3000/auth/confirm`)

## Administradores adicionais e revogação

Pelo SQL Editor, apenas:

```sql
select private.grant_admin('outra-pessoa@externo.com');
select private.revoke_admin('outra-pessoa@externo.com');
```

Todas essas ações ficam registradas em `public.audit_log`, sem conteúdo de mensagens.

## Acesso administrativo ao conteúdo de clientes

Administradores **não leem** mensagens diretamente: a RLS bloqueia esse acesso. Para dar suporte:

1. O proprietário clica em **Autorizar suporte** na caixa (vale 1 hora e pode ser revogado).
2. O administrador, com MFA, abre **Administração → Caixas → Suporte → Ler mensagens**.
3. A função `admin_read_mailbox_messages` confere a autorização vigente, respeita a expiração das mensagens e registra `admin.content_access` na auditoria.
