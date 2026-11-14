# Deploy na Vercel com Supabase

O sistema fala com o Supabase pela **API (URL + chave secreta)**. Há também um modo alternativo por string de conexão Postgres (`DATABASE_URL`) — veja o fim do arquivo.

## 1. Preparar o banco (1 vez)

1. No Supabase, abra o projeto → **SQL Editor** → *New query*.
2. Cole **todo** o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**. Pode rodar de novo sem risco (é idempotente).
   Isso cria as tabelas, os 4 serviços padrão e as **funções** que o sistema usa.

O que é criado:

| Onde | O quê |
|---|---|
| schema **`agenda`** (privado, **não** exposto pela API) | tabelas `users`, `services`, `slots`, `appointments`, `meta`, `assets` |
| schema `public` | 8 funções `agenda_*` (carregar, travar, aplicar alterações, logo) — executáveis **somente** pela chave secreta (`service_role`) |

Regras garantidas pelo próprio banco: WhatsApp único, **um horário nunca tem dois pedidos ativos** (índice único parcial),
formato de datas/horas/telefone, RLS ligado sem políticas. A *publishable key* **não** consegue ler nem chamar nada disso.

> Requisito: a **Data API** do projeto precisa estar ativa (Project Settings → Data API; é o padrão) e o schema `public` exposto (também padrão).

> Sem o passo 2 o site responde com a dica *"As funções do banco ainda não existem"* em `/api/health`.

## 2. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Obrigatória | Observação |
|---|---|---|
| `SUPABASE_URL` | **sim** | Project URL, ex.: `https://SEU-REF.supabase.co` |
| `SUPABASE_SECRET_KEY` | **sim** | chave **secreta** (`sb_secret_...`). Fica só no servidor; **nunca** em código, no navegador ou no chat |
| `ADMIN_PASS` | **sim** | mínimo 8 caracteres e diferente de `admin123` |
| `SESSION_SECRET` | **sim** | texto aleatório (≥16). Gere: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USER` | não | padrão `admin` |
| `STUDIO_NAME` | não | nome inicial (depois dá para mudar em Configurações) |
| `TZ_NAME` | não | padrão `America/Sao_Paulo` |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` | não | envio automático pela API da Meta |
| `ALLOWED_ORIGINS` | não | só se usar mais de um domínio |

`SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_JWKS_URL` **não são usadas** (não precisa cadastrá-las). Depois de salvar as variáveis, faça **Redeploy**.

## 3. Publicar
```bash
npm i -g vercel
vercel          # preview
vercel --prod   # produção
```
Ou conecte o repositório no painel. **Framework Preset: Other** (o `vercel.json` já força `"framework": null`), sem Build Command, Output Directory `public`.

> Se o build falhar com *"No entrypoint found which imports express"*: é a detecção automática de Express da Vercel. Confirme em *Settings → Build & Development* que o preset é **Other** (não "Express"). O backend é a função `api/index.js`, que carrega `server.js`.

## 4. Erro 500 ao abrir o site? Use o diagnóstico
Abra `https://SEU-DOMINIO/api/health`. Ele responde `503` com o **código** do erro e uma **dica** (sem expor chaves):

| Código / etapa | Causa provável |
|---|---|
| `"etapa":"configuracao"` | faltam `ADMIN_PASS` e/ou `SESSION_SECRET` (ou estão iguais aos exemplos). A lista vem em `variaveis` |
| `SEM_DATABASE_URL` | faltam `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (depois de definir, faça **Redeploy**) |
| `SCHEMA_AUSENTE` / `PGRST202` | o `supabase/schema.sql` ainda não foi executado no SQL Editor |
| `PGRST301` / `401` / `403` | chave recusada: use a chave **secreta** e a URL do mesmo projeto |
| `ENOTFOUND` | `SUPABASE_URL` incorreta |
| `FUNCTION_INVOCATION_FAILED` (texto) | falha ao carregar a função (versões antigas, quando faltava `ADMIN_PASS`/`SESSION_SECRET`). Atualize o deploy |

O detalhe completo fica nos logs: Vercel → *Deployments* → *Functions* / *Logs*.

## 5. Smoke test (faça após o primeiro deploy)
1. `https://SEU-DOMINIO/api/health` → `"ok": true` e `"armazenamento":"supabase-api"`.
2. Abra `/admin.html`, entre, libere horários na aba **Agenda**.
3. Em uma janela anônima, cadastre uma cliente e faça um agendamento; aprove no painel e confira o link de WhatsApp.
4. No Supabase → *Table Editor* → schema `agenda`: as linhas devem aparecer em `users`, `slots` e `appointments`.

## 6. Levar os dados locais para o Supabase (opcional)
Se você já tem clientes/agendamentos em `data/db.json`:
```bash
SUPABASE_URL="https://SEU-REF.supabase.co" SUPABASE_SECRET_KEY="sb_secret_..." npm run import:pg
```
O script **recusa** sobrescrever um banco que já tenha clientes ou agendamentos (use `--force` só se tiver certeza) e também envia a logo.

## 7. Backups e atualizações
- Dados e logo ficam no Supabase: atualizar o código **não** apaga nada.
- Backups: botão **Baixar backup** (Configurações) + backups do Supabase (diários nos planos pagos; no plano gratuito, baixe o backup com frequência).
- Mudanças futuras na estrutura dos dados passam por `lib/schema.js` → `npm run schema` → rodar o novo `schema.sql`.
- Plano gratuito do Supabase **pausa o projeto após 1 semana sem uso**: o primeiro acesso depois disso falha até você reativá-lo no painel.

## Como funciona a segurança contra reservas duplicadas
Cada alteração pega uma **trava** no banco (função `agenda_lock`, com validade de 10 s), lê os dados, aplica a mudança e grava tudo numa
única transação (`agenda_apply`). Assim, duas pessoas tentando o mesmo horário ao mesmo tempo são atendidas uma de cada vez, e o índice
único do banco é a segunda barreira. Se uma instância cair no meio, a trava expira sozinha.

## Alternativa: conexão Postgres direta (`DATABASE_URL`)
Se preferir, defina `DATABASE_URL` com a string do **Transaction pooler** (porta **6543**; a conexão direta é só IPv6 e não funciona na Vercel).
Ela tem prioridade sobre `SUPABASE_URL`. Nesse modo o sistema cria as tabelas sozinho (não precisa do `schema.sql`). Outras opções: `DB_SCHEMA`, `DATABASE_SSL_CA`.

## Desenvolvimento local
```bash
npm install
npm start      # usa data/db.json (ou o Supabase, se SUPABASE_URL + SUPABASE_SECRET_KEY estiverem no .env)
npm test       # 69 testes
npm run schema # regenera supabase/schema.sql (após mudar lib/schema.js ou lib/rpc-sql.js)
```
