"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/**
 * Chamada às rotas do próprio painel. Nada é armazenado no navegador
 * (cache: "no-store"); sessão expirada leva ao login.
 */
export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "rede", "Sem conexão com o servidor. Verifique sua internet.");
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const err = (data ?? {}) as { error?: string; message?: string };
    if (response.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ApiError(response.status, err.error ?? "erro", err.message ?? "Não foi possível concluir a operação.");
  }
  return data as T;
}
