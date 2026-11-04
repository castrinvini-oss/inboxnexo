# InboxNexo Pro — configura os segredos de produção SEM exibi-los na tela.
# Execute na pasta do projeto:  powershell -ExecutionPolicy Bypass -File scripts\configurar-segredos.ps1
#
# O que faz:
#   1. Gera um segredo HMAC aleatório (48 bytes) e grava no Supabase e no Worker.
#   2. Copia a chave de servidor do Supabase para a Vercel (variável sensível).
#   3. Publica o painel novamente para usar a nova variável.
# Nenhum valor secreto é impresso nem salvo em arquivo.

$ErrorActionPreference = "Stop"
$ProjectRef = "pqlyehehbeldaojspouo"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "1/4  Verificando o login no Supabase..." -ForegroundColor Cyan
npx --yes supabase@latest projects list -o json | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "     Abrindo o login (aperte Enter e cole o código de verificação)..." -ForegroundColor Cyan
  npx --yes supabase@latest login
  if ($LASTEXITCODE -ne 0) { throw "Login no Supabase falhou." }
}

Write-Host "2/4  Gerando e gravando o segredo HMAC (Supabase + Worker)..." -ForegroundColor Cyan
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$hmac = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
npx --yes supabase@latest secrets set "INGEST_HMAC_SECRET=$hmac" --project-ref $ProjectRef --yes | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Falha ao gravar o segredo no Supabase." }
Push-Location workers\email-ingest
$hmac | npx wrangler secret put INGEST_HMAC_SECRET | Out-Null
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "Falha ao gravar o segredo no Worker." }
Remove-Variable hmac, bytes

Write-Host "3/4  Copiando a chave de servidor do Supabase para a Vercel..." -ForegroundColor Cyan
$raw = (npx --yes supabase@latest projects api-keys --project-ref $ProjectRef --reveal -o json) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "Falha ao ler as chaves do Supabase." }
# Avisos do CLI podem vir junto; mantém só o JSON.
$keys = $raw.Substring($raw.IndexOf('['), $raw.LastIndexOf(']') - $raw.IndexOf('[') + 1) | ConvertFrom-Json
Remove-Variable raw
$server = ($keys | Where-Object { $_.type -eq "secret" } | Select-Object -First 1).api_key
if (-not $server) { $server = ($keys | Where-Object { $_.name -eq "service_role" } | Select-Object -First 1).api_key }
if (-not $server) { throw "Chave de servidor não encontrada. Crie uma em Project Settings > API Keys." }
$server | npx --yes vercel@65.9.0 env add SUPABASE_SECRET_KEY production --sensitive --force --scope castro21 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Falha ao gravar SUPABASE_SECRET_KEY na Vercel." }
Remove-Variable server, keys

Write-Host "4/4  Publicando o painel novamente..." -ForegroundColor Cyan
npx --yes vercel@65.9.0 deploy --prod --yes --scope castro21 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Falha no deploy da Vercel." }

Write-Host "Pronto: segredos configurados e painel publicado." -ForegroundColor Green
