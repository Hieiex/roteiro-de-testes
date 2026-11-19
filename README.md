# Roteiro

> Grave, rode e acompanhe testes do seu sistema, sem escrever código.

O Roteiro é para quem faz QA e quer automatizar testes sem programar. Você usa o sistema no navegador, o Roteiro grava os passos, e depois repete tudo sozinho, quantas vezes quiser, em um teste ou em vários de uma vez. Por baixo usa o [Playwright](https://playwright.dev).

## Instalação

Você precisa de internet na primeira vez e do [Node.js](https://nodejs.org) (versão 18 ou mais nova). No Windows, se o Node não estiver instalado, o `iniciar.bat` tenta instalá-lo sozinho (pode aparecer um pedido de permissão). Se não conseguir, ele avisa e você instala em nodejs.org (botão LTS, opções padrão). O Google Chrome é opcional: se não tiver, o Roteiro usa o navegador que ele mesmo baixa.

```bash
git clone https://github.com/Hieiex/roteiro-de-testes.git
cd roteiro-de-testes
```

**Windows:** dê duplo clique em **`iniciar.bat`**.
**Mac/Linux:** rode `./iniciar.sh`.

Na primeira vez ele instala o que falta, incluindo um navegador de teste de cerca de 150 MB (leva alguns minutos). Se algo falhar, ele mostra o erro e explica o que fazer, por exemplo quando a rede da empresa bloqueia o download. O Roteiro abre sozinho no navegador, em **http://127.0.0.1:4173**. Para encerrar, feche a janela preta do terminal.

Pelo terminal, se preferir: `npm install`, `npx playwright install chromium` e `npm start`.

## Criar um teste

1. Em **1. Configuração**, informe a **URL do sistema** e, se o teste precisar de login, o **e-mail** e a **senha**. Eles ficam só no seu computador (`credenciais.json`), nunca dentro dos testes.
2. Dê um **nome** ao teste (por exemplo `login-valido`).
3. Clique em **Gravar no Chrome**. Uma janela abre: use o sistema normalmente. Ao **fechar a janela**, o teste fica salvo.
   - Outra opção: exporte a gravação do **Recorder** do Chrome (DevTools) e importe o arquivo em "Ou importe a exportação...".
4. Em **2. Passos**, confira e ajuste a lista. Adicione **"Verificar que aparece o texto"** com algo que só aparece quando o teste deu certo (por exemplo `Bem-vindo`). Sem essa verificação, o teste só clica e pode passar mesmo com a tela errada.
5. Clique em **Salvar teste**.

## Rodar um teste

Em **3. Executar & Salvar**:
- **Ver no navegador**: abre a janela e você acompanha cada passo.
- **Rodar sem abrir**: roda escondido, mais rápido.

## Rodar vários testes em lote

Use o painel **4. Rodar em lote**, mais abaixo na página:

1. Marque os testes que quer rodar. **Marcar todos** e **Desmarcar todos** ajudam.
2. Escolha como rodar:
   - **Ver o navegador rodando**: um teste por vez, com a janela aberta. Bom para acompanhar.
   - Sem marcar: escondido, e você escolhe em **Testes ao mesmo tempo** quantos rodam juntos (1 a 4). Mais rápido, bom para rodar tudo.
3. Clique em **Rodar selecionados** e espere.
4. No fim aparece o resumo, por exemplo **"5 teste(s): 4 passou(aram), 1 falhou(aram)"**, com uma linha por teste:
   - ✔ passou
   - ✘ falhou: mostra **em qual passo falhou** e **o motivo em português**, com link para o **print** e o **vídeo** da falha. O "Detalhe técnico" tem a mensagem original.
   - ⚠ **passou só na 2ª tentativa**: o teste ou o sistema está instável.
   - ⚠ **sem verificação**: o teste não confere nada. Adicione "Verificar que aparece o texto".

Só um lote ou teste roda por vez. Se um falhar, o Roteiro tenta mais uma vez automaticamente (no modo "Ver no navegador" não repete, para você ver o erro de primeira).

Pelo terminal, também dá para rodar todos os testes gravados: `npm run e2e`.

## Onde ficam os arquivos

| O quê | Onde | Vai para o Git? |
|---|---|---|
| Testes gravados | `tests/e2e/gravados/*.spec.js` | Não |
| E-mail e senha | `credenciais.json` | Não |
| Prints e vídeos das falhas | `test-results/` | Não |

Nada disso é versionado: o `.gitignore` libera apenas os arquivos da ferramenta. Para compartilhar testes com o time, copie os arquivos de `tests/e2e/gravados/` para um repositório seu.

## Problemas comuns

- **"Já existe um teste em execução"**: espere o atual terminar ou feche a janela de gravação.
- **"Não consegui abrir o endereço"**: confira se o sistema está no ar e se a URL está certa.
- **O Chrome não abre para gravar**: rode `npx playwright install chromium` e tente de novo.
- **Porta 4173 ocupada**: feche o outro Roteiro aberto, ou use outra porta (`PORT=4180 npm start`; no Windows, `set PORT=4180` e depois `npm start`).

## Variáveis (opcional)

- `PORT`: porta do Roteiro (padrão 4173).
- `PW_RETRIES`: tentativas extras quando um teste falha (padrão 1; no modo visual é 0).
