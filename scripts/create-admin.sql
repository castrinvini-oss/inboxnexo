-- Procedimento controlado de criação do administrador inicial.
-- Execute no Supabase Dashboard > SQL Editor (papel postgres), DEPOIS de:
--   1. convidar o usuário pelo Supabase Auth com um e-mail EXTERNO e permanente;
--   2. o usuário aceitar o convite e definir a senha no painel.
-- Não há senha padrão nem segredo neste arquivo. Substitua o e-mail abaixo.

select private.bootstrap_admin('<EMAIL_EXTERNO_DO_ADMINISTRADOR>');

-- Funciona apenas enquanto não existir nenhum administrador.
-- Administradores adicionais (somente via SQL Editor):
--   select private.grant_admin('<EMAIL>');
-- Remover papel:
--   select private.revoke_admin('<EMAIL>');
-- Conferir:
--   select u.email, r.granted_at, r.granted_by
--     from private.user_roles r join auth.users u on u.id = r.user_id;
