# Roteiro

> Grave, rode e acompanhe testes do seu sistema, sem escrever código.

Ferramenta para QA criar, rodar e acompanhar testes automatizados de sistemas web **sem escrever código**.
Usa o [Playwright](https://playwright.dev) por baixo.

## O que faz
- **Grava** o teste enquanto você usa o sistema no Chrome (ou importa a gravação do Recorder do DevTools).
- **Edita** os passos em linguagem simples (clicar, preencher, escolher, verificar que um texto aparece).
- **Roda** vendo o navegador funcionando, ou sem abrir.
- **Roda em lote**: marque vários testes e veja quais passaram e quais falharam, com print, vídeo e a explicação do erro em português.
- **Credenciais** (e-mail e senha) ficam em `credenciais.json`, fora dos testes.

## Como usar (Windows)
1. Instale o [Node.js](https://nodejs.org) e o Google Chrome.
2. Dê duplo clique em **`iniciar.bat`**. Na primeira vez ele instala o que falta.
3. O gravador abre em http://127.0.0.1:4173.

Pelo terminal: `npm install`, `npx playwright install chromium` e `npm run recorder`.

## Onde ficam os arquivos
| O quê | Onde | Vai para o Git? |
|---|---|---|
| Testes gravados | `tests/e2e/gravados/*.spec.js` | Não |
| E-mail e senha | `credenciais.json` | Não |
| Prints e vídeos das falhas | `test-results/` | Não |

Nada disso é versionado: o `.gitignore` libera apenas os arquivos da ferramenta.

## Variáveis
- `PORT`: porta do gravador (padrão 4173).
- `PW_RETRIES`: tentativas extras quando um teste falha (padrão 1; no modo visual é 0).
