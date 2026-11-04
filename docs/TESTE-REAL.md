# Roteiro de teste real (após a implantação)

Execute depois das Etapas A–E do [DNS.md](DNS.md). Anote data, hora e resultado de cada passo. Só considere o sistema **validado em produção** quando todos os passos passarem.

Preparação:

- Usuário **A** (administrador com MFA) e usuário **B** (comum), convidados com e-mails externos diferentes.
- Um remetente externo (por exemplo, uma conta Gmail ou Outlook pessoal).
- Terminal com `npx wrangler tail inboxnexo-email-ingest` aberto (mostra os logs operacionais, sem conteúdo).

## 1. Recebimento básico

1. Como **B**, crie a caixa `teste-b01`. Copie o endereço pelo botão.
2. Do remetente externo, envie para `teste-b01@inboxnexo.online` o assunto `Teste 1` e o corpo `Seu código de verificação é 048213`.
3. **Esperado:** em até ~1 minuto a mensagem aparece na caixa sem recarregar a página; o código `048213` aparece em destaque (com o zero inicial); a contagem regressiva começa perto de `60:00`; o selo mostra "Remetente não verificado" (enquanto `TRUSTED_AUTHSERV_IDS` estiver vazio).
4. No `wrangler tail`: um `ingest_response` com `http: 200, status: "stored"`.

## 2. Subendereço e cabeçalho To

1. Envie para `teste-b01+loja@inboxnexo.online`. **Esperado:** a mensagem chega na mesma caixa, com "via +loja".

## 3. Destinatário desconhecido e caixa desativada

1. Envie para `naoexiste-xyz@inboxnexo.online`. **Esperado:** o remetente recebe uma devolução (bounce); nenhuma caixa é criada (confira em Administração → Caixas).
2. Como **B**, desative `teste-b01` e envie de novo. **Esperado:** devolução; nada novo na caixa. Reative a caixa em seguida.

## 4. Isolamento entre usuários

1. Como **B**, abra uma mensagem e copie da barra de endereços o ID da caixa (`/caixas/<id>`).
2. Entre como **A** (ou um terceiro usuário comum) e acesse `https://painel.inboxnexo.online/caixas/<id>`. **Esperado:** "Caixa não encontrada".
3. Opcional (técnico): com a chave publicável e um token de **A**, faça `GET <SUPABASE_PROJECT_URL>/rest/v1/messages?mailbox_id=eq.<id>`. **Esperado:** lista vazia.
4. Como **A** em Administração → Caixas → Suporte → Ler: **Esperado:** erro "O proprietário não autorizou…". Como **B**, clique em "Autorizar suporte" e repita: **Esperado:** mensagens visíveis e registro `admin.content_access` na Auditoria.

## 5. Expiração

1. Anote o horário de recebimento da mensagem do passo 1.
2. Deixe a caixa aberta. **Esperado:** ao completar 60 minutos, a mensagem some da tela sozinha (sem recarregar).
3. Recarregue e confira a contagem. **Esperado:** a mensagem não volta.
4. Em Administração → Estado operacional, "Última limpeza" deve ter menos de 2 minutos, e "Vencidas aguardando exclusão" deve voltar a 0 após a próxima execução.
5. (SQL Editor) `select count(*) from public.messages where expires_at <= now();` deve ser 0 ou próximo de 0.

## 6. Reentrega e falha temporária

1. Em Administração, clique em **Pausar recebimento**.
2. Envie uma mensagem para `teste-b01`. **Esperado:** nada é armazenado; o `wrangler tail` mostra `http: 503`/`status: "paused"` e uma exceção.
3. **Anote o que o remetente recebe** (atraso com novas tentativas, ou devolução). Esse é o comportamento real do provedor para falhas temporárias, que a documentação do handler não descreve.
4. Retome o recebimento. Se o remetente reenviar automaticamente, confirme que a mensagem aparece **uma única vez**.

## 7. Código do Instagram (se aplicável)

1. Em uma conta do Instagram **sua**, adicione ou altere o e-mail para uma caixa do InboxNexo e solicite o código.
2. **Esperado:** se a mensagem chegar, o código aparece em destaque. O selo de autenticidade só aparece depois do procedimento de [DIAGNOSTICO.md](DIAGNOSTICO.md#selo-de-remetente-autenticado).
3. Não há garantia de que o Instagram aceite o domínio ou envie todos os códigos. O sistema processa apenas o que efetivamente recebe.

## 8. Sessão e logout

1. Clique em **Sair**. **Esperado:** volta ao login; o botão "voltar" do navegador não mostra mensagens (a página exige nova autenticação).
2. Em DevTools → Application: nenhum dado de mensagem em Local Storage, IndexedDB ou Cache Storage; os cookies `sb-*` estão marcados como `HttpOnly` e `Secure`.
