/** Mensagens em português para erros conhecidos do banco/API. */
const MESSAGES: Record<string, string> = {
  limite_caixas: "Você atingiu o limite de caixas da sua conta.",
  identificador_invalido: "Identificador inválido.",
  identificador_reservado: "Este identificador é reservado.",
  endereco_indisponivel: "Este endereço não está disponível.",
  caixa_nao_encontrada: "Caixa não encontrada.",
  status_invalido: "Status inválido.",
  prazo_invalido: "Prazo inválido.",
  acesso_negado: "Acesso negado.",
  nao_autenticado: "Sua sessão expirou. Entre novamente.",
  conta_desativada: "Sua conta está desativada.",
  sem_autorizacao_do_proprietario: "O proprietário não autorizou o acesso de suporte a esta caixa.",
  nao_pode_desativar_a_si_mesmo: "Você não pode desativar a própria conta.",
  usuario_nao_encontrado: "Usuário não encontrado.",
};

export function dbErrorCode(message: string | undefined): string {
  if (!message) return "erro_interno";
  const known = Object.keys(MESSAGES).find((k) => message.includes(k));
  return known ?? "erro_interno";
}

export function errorMessage(code: string): string {
  return MESSAGES[code] ?? "Não foi possível concluir a operação. Tente novamente.";
}
