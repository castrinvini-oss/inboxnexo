-- InboxNexo Pro — limpeza agendada (Supabase Cron / pg_cron)
-- Executa a cada minuto. Se o pg_cron estiver indisponível ou atrasado, as
-- mensagens vencidas continuam INACESSÍVEIS (RLS filtra expires_at > now());
-- apenas a exclusão física fica para a próxima execução bem-sucedida.

create extension if not exists pg_cron;

select cron.schedule(
  'inboxnexo-purge-expired',
  '* * * * *',
  $$select private.purge_expired(5000, 20)$$
);

-- Monitoramento:
--   select * from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'inboxnexo-purge-expired')
--    order by start_time desc limit 20;
-- O painel administrativo mostra "última limpeza" e "vencidas pendentes".
