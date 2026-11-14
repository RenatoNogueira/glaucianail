# Relatório de QA — Agenda Manicure & Pé de Curi

Escopo: API (Express), armazenamento, sessões, regras de agendamento e prontidão para a Vercel.
Método: revisão de código + suíte automatizada (`npm test`, 68 testes). Os testes foram escritos **antes** das
correções; 15 falharam no código original e todos passam agora.

## Bloqueadores para a Vercel (arquitetura)

| # | Problema | Impacto | Correção |
|---|----------|---------|----------|
| A1 | Dados em arquivo (`data/db.json`) | Disco da Vercel é efêmero e só leitura: **todos os dados se perderiam** | Camada de armazenamento com PostgreSQL/Supabase (`lib/store.js`); arquivo continua no uso local |
| A2 | Sessões em memória (`express-session`) | Cada requisição pode cair em outra instância: login "some" | Sessão assinada em cookie (HMAC-SHA256), `lib/session.js` |
| A3 | Logo salva em disco | Perdida a cada deploy | Logo guardada na tabela `assets` do Postgres |
| A4 | `app.listen` e backups em disco no import | Incompatível com função serverless | `server.js` exporta o app; `api/index.js` é o handler; backups automáticos só no modo arquivo (no Postgres use o backup do provedor + botão de download) |
| A5 | Fuso horário do servidor | Vercel roda em UTC: "hoje/agora" erraria 3 h e liberaria/bloquearia horários errados | Fuso explícito `America/Sao_Paulo` (`TZ_NAME`) |

## Bugs de lógica

| # | Severidade | Problema | Correção |
|---|-----------|----------|----------|
| B1 | Alta | **Corrida**: dois pedidos simultâneos no mesmo horário podiam ambos passar (leitura + gravação não atômicas em ambiente distribuído) | Transação com trava de linha (`SELECT … FOR UPDATE`) em toda escrita **e** índice único parcial no banco (`appointments_slot_ativo_uk`); teste com 10 pedidos simultâneos → só 1 vence |
| B2 | Média | `isDate` aceitava `2026-02-31` (JS "arredonda" para 03/03) → horários criados na data errada | Validação por ida-e-volta em UTC |
| B3 | Média | Admin podia **aprovar um pedido cancelado** ou mudar um já decidido (via API) | Só pedidos `pendente` mudam de status (409 nos demais) |
| B4 | Média | Aprovar/recusar enviava o WhatsApp **antes** de gravar e sem timeout: uma API lenta travava a requisição e uma falha de rede podia perder a decisão do admin | Grava primeiro e só depois notifica; `fetch` com timeout de 6 s |
| B5 | Média | Cadastro aceitava nome de 500+ caracteres e telefone com qualquer quantidade de dígitos | Nome 2–80; telefone `55` + DDD + número; senha 6–72 (limite do bcrypt) |
| B6 | Baixa | Cliente podia acumular pedidos ilimitados (spam de agenda) | Máx. 5 pedidos ativos futuros por cliente (429) |
| B7 | Baixa | Desativar o último serviço ativo via edição deixava o site sem serviços | Bloqueado também na edição (já era no exclusão) |
| B8 | Baixa | Sessão expirada → telas com erros soltos | Front volta ao login automaticamente em 401 |

## Segurança

| # | Severidade | Problema | Correção |
|---|-----------|----------|----------|
| S1 | **Alta** | Admin com senha padrão `admin123` e `SESSION_SECRET` padrão se faltassem variáveis | Em produção o servidor **não inicia** sem `ADMIN_PASS` (≥8) e `SESSION_SECRET` (≥16) |
| S2 | Alta | Sem limite de tentativas de login (força bruta no admin e nas clientes) | 8 falhas / 15 min por IP (+telefone) → 429. Limite por instância (best effort na Vercel) |
| S3 | Média | Sem proteção CSRF explícita | Cookie `SameSite=Lax` + checagem de `Origin` em toda escrita (403) |
| S4 | Média | Erros devolviam página HTML com stack trace (JSON inválido, exceções) | Handler global: sempre JSON, sem detalhes internos |
| S5 | Baixa | Cookie sem `Secure` em produção; sem cabeçalhos de segurança | `Secure` em produção, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; `x-powered-by` removido |
| S6 | Baixa | Upload de logo | Já seguro: só PNG/JPG/WEBP, confere assinatura real do arquivo, limite 1,5 MB, sem SVG |

Verificado e sem achados: escape de HTML no front (todos os dados do usuário passam por `esc()`/`textContent`),
rotas administrativas protegidas, cliente não acessa agendamento de outra pessoa, exclusão de cliente derruba a sessão.

## Limitações conhecidas (não bloqueiam)

- O limitador de tentativas é por instância serverless; para proteção forte use o *Vercel Firewall / WAF rate limiting*.
- Sessão "sem estado" não pode ser revogada antes de expirar (8 h). Trocar `SESSION_SECRET` desloga todos.
- O modo Postgres foi validado com `pg-mem` (Postgres em memória) e o SQL é simples e padrão, mas **não foi testado no Supabase real**
  nem na Vercel; faça o *smoke test* do `DEPLOY.md` após o primeiro deploy.
- Cancelamento pela cliente não avisa a admin por WhatsApp (a admin vê no painel).
- O sistema carrega as tabelas inteiras a cada requisição (ideal para um estúdio: centenas de clientes e milhares de agendamentos). Acima disso, trocar por consultas filtradas.

## Como reexecutar

```bash
npm test
```
