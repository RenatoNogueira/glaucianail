# Deploy na Vercel com Supabase

O projeto já está preparado (`vercel.json`, `api/index.js`, armazenamento em PostgreSQL). Nada foi publicado ainda.

## 1. Banco de dados: Supabase

1. Crie o projeto em <https://supabase.com> (região mais próxima, ex.: São Paulo) e guarde a senha do banco.
2. No projeto: **Connect** (ou *Project Settings → Database → Connection string*) e copie a string do **Transaction pooler**
   (porta **6543**):

   ```
   postgresql://postgres.SEU_REF:SUA_SENHA@aws-0-REGIAO.pooler.supabase.com:6543/postgres
   ```

   > ⚠️ Use o **pooler**. A conexão direta (`db.SEU_REF.supabase.co:5432`) é só IPv6 e **não funciona na Vercel**.
   > Se a senha tiver caracteres especiais (`@ # / ? %`), codifique-os (ex.: `@` → `%40`) ou troque a senha no Supabase.

3. **Criar as tabelas** (escolha um):
   - **Manual (recomendado, 1 minuto):** Supabase → **SQL Editor** → *New query* → cole o conteúdo do arquivo [supabase/schema.sql](supabase/schema.sql) → **Run**. Pode rodar de novo sem risco (é idempotente).
   - **Automático:** não faça nada; o sistema cria tudo sozinho no primeiro acesso (mesmo script).

   O que é criado, no schema **`agenda`** (não exposto pela API pública do Supabase):

   | Tabela | Conteúdo |
   |---|---|
   | `users` | clientes (nome, WhatsApp único, senha criptografada) |
   | `services` | serviços (nome, duração, preço, ícone, ativo) — já vem com os 4 serviços padrão |
   | `slots` | horários publicados pela admin (dia + hora, únicos) |
   | `appointments` | pedidos de agendamento (status, observações, cópia do nome/preço do serviço) |
   | `meta` | contador de ids, versão e configurações (nome/logo do estúdio) |
   | `assets` | arquivo da logo |

   Regras garantidas pelo próprio banco: WhatsApp único, **um horário nunca tem dois pedidos ativos** (índice único parcial),
   formato de datas/horas/telefone, e RLS ligado sem políticas (a *anon key* não lê nada). Os dados — incluindo as senhas
   criptografadas das clientes — só são acessíveis pela string de conexão: **nunca** a publique.
4. Alternativa: a integração **Supabase ↔ Vercel** (Marketplace) cria `POSTGRES_URL` automaticamente; o sistema a reconhece.

## 2. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Obrigatória | Exemplo / observação |
|---|---|---|
| `DATABASE_URL` | **sim** | a string do *Transaction pooler* acima (ou `POSTGRES_URL` da integração) |
| `ADMIN_PASS` | **sim** | mínimo 8 caracteres; sem ela o app não inicia |
| `SESSION_SECRET` | **sim** | texto aleatório (≥16). Gere: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USER` | não | padrão `admin` |
| `STUDIO_NAME` | não | nome inicial (depois dá para mudar em Configurações) |
| `TZ_NAME` | não | padrão `America/Sao_Paulo` |
| `DB_SCHEMA` | não | padrão `agenda` |
| `DATABASE_SSL_CA` | não | certificado CA do Supabase (Settings → Database → SSL). Se definido, o certificado passa a ser **verificado**; sem ele a conexão é criptografada, mas sem verificar o certificado |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` | não | envio automático pela API da Meta |
| `ALLOWED_ORIGINS` | não | só se usar mais de um domínio |

## 3. Publicar
```bash
npm i -g vercel
vercel          # preview
vercel --prod   # produção
```
Ou conecte o repositório no painel. **Framework Preset: Other** (o `vercel.json` já força `"framework": null`), sem Build Command, Output Directory `public`.

> Se o build falhar com *"No entrypoint found which imports express"*: é a detecção automática de Express da Vercel. Confirme em *Settings → Build & Development* que o preset é **Other** (não "Express"). O backend é a função `api/index.js`, que carrega `server.js`.

## 4. Erro 500 ao abrir o site? Use o diagnóstico
Abra `https://SEU-DOMINIO/api/health`. Se o banco não conecta, ele responde `503` com o **código** do erro e uma **dica** da causa (sem expor senha):

| Código / mensagem | Causa provável |
|---|---|
| `"etapa":"configuracao"` | faltam `ADMIN_PASS` e/ou `SESSION_SECRET` (ou estão iguais aos exemplos). A lista de variáveis vem em `variaveis` |
| `FUNCTION_INVOCATION_FAILED` (texto, não JSON) | falha ao carregar a função (versões antigas faziam isso quando faltava `ADMIN_PASS`/`SESSION_SECRET`). Atualize o deploy |
| `SEM_DATABASE_URL` | variável `DATABASE_URL` não definida na Vercel (depois de definir, faça **Redeploy**) |
| `Tenant or user not found` | usuário errado: use o formato `postgres.SEU_REF` do *Transaction pooler* |
| `28P01` | senha incorreta (caracteres especiais precisam ser codificados: `@` → `%40`) |
| `ENOTFOUND` | host errado: use `aws-0-REGIAO.pooler.supabase.com`, não `db.REF.supabase.co` |
| `ECONNREFUSED` / `ETIMEDOUT` | porta errada (use **6543**) ou projeto Supabase pausado |

O detalhe completo do erro fica nos logs: Vercel → *Deployments* → *Functions* / *Logs*.

## 5. Smoke test (faça após o primeiro deploy)
1. `https://SEU-DOMINIO/api/health` → deve mostrar `"armazenamento":"postgres"` e a data de hoje no fuso do Brasil.
   Se der erro de conexão: confira se usou o **pooler (6543)** e se a senha está codificada.
2. No Supabase → *Table Editor* → escolha o schema `agenda`: as 6 tabelas devem existir e `services` deve ter 4 linhas.
3. Abra `/admin.html`, entre, libere horários na aba **Agenda**.
4. Em uma janela anônima, cadastre uma cliente e faça um agendamento; aprove no painel e confira o link de WhatsApp.

## 6. Levar os dados locais para o Supabase (opcional)
Se você já tem clientes/agendamentos em `data/db.json`:
```bash
DATABASE_URL="postgresql://postgres.SEU_REF:SENHA@aws-0-REGIAO.pooler.supabase.com:6543/postgres" npm run import:pg
```
O script **recusa** sobrescrever um banco que já tenha clientes ou agendamentos (use `--force` só se tiver certeza) e também envia a logo.

## 7. Backups e atualizações
- Dados e logo ficam no Postgres: atualizar o código **não** apaga nada.
- Backups: botão **Baixar backup** (Configurações) + backups do Supabase (diários nos planos pagos; no plano gratuito, baixe o backup com frequência).
- Mudanças futuras na estrutura dos dados são tratadas por `migrate()` em `lib/store.js` (nunca descarta registros).
- Plano gratuito do Supabase **pausa o projeto após 1 semana sem uso**: o primeiro acesso depois disso falha até você reativá-lo no painel.

## Desenvolvimento local
```bash
npm install
npm start      # usa data/db.json (ou o Postgres, se DATABASE_URL estiver definida)
npm test       # 53 testes
npm run schema # regenera supabase/schema.sql (após mudar lib/schema.js)
```
