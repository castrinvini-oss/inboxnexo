import { processEmail, type Env } from "./process.ts";

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Aguardamos a confirmação de persistência; exceções propagam como falha.
    await processEmail(message, env, {
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      uuid: () => crypto.randomUUID(),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  },
} satisfies ExportedHandler<Env>;
