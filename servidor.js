import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const playwrightDir = path.join(root, 'tests', 'e2e', 'gravados');
const port = Number(process.env.PORT) || 4173;
let running = null;

fs.mkdirSync(playwrightDir, { recursive: true });

// Só existe um motor de teste (Playwright). As funções abaixo mantêm a forma antiga das chamadas.
function engineOf() {
  return 'playwright';
}

function folderOf() {
  return playwrightDir;
}

function safeName(name) {
  const base = path.basename(String(name || ''));
  return /^[a-z0-9][a-z0-9-_]*\.spec\.js$/.test(base) ? base : null;
}

function listTests() {
  return fs.readdirSync(playwrightDir)
    .filter((file) => file.endsWith('.spec.js'))
    .map((name) => {
      let semVerificacao = false;
      try { semVerificacao = !hasVerification(fs.readFileSync(path.join(playwrightDir, name), 'utf8')); } catch { /* ignora */ }
      return { name, engine: 'playwright', semVerificacao };
    });
}

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function chromeInstalled() {
  const env = process.env;
  const candidates = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);
  return candidates.some((file) => fs.existsSync(file));
}

function browserEnv(headed) {
  const env = { ...process.env };
  if (headed) env.PW_VER = '1';
  else delete env.PW_VER;
  const creds = readCreds();
  env.TESTE_EMAIL = creds.email;
  env.TESTE_SENHA = creds.senha;
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonOut;
  const configured = env.PLAYWRIGHT_BROWSERS_PATH;
  if (!configured) return env;
  let found = false;
  try {
    found = fs.readdirSync(configured).some((name) => {
      if (!/^chromium[-_]/.test(name)) return false;
      const dir = path.join(configured, name);
      return ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app'].some((rel) => {
        return fs.existsSync(path.join(dir, ...rel.split('/')));
      });
    });
  } catch {
    found = false;
  }
  if (!found) delete env.PLAYWRIGHT_BROWSERS_PATH;
  return env;
}

let runState = { status: 'idle', code: null, log: '', kind: 'test', results: null };

// ---------- Credenciais (ficam fora dos testes) ----------
const credFile = path.join(root, 'credenciais.json');
const stateDir = path.join(root, '.roteiro');
fs.mkdirSync(stateDir, { recursive: true });

function readCreds() {
  try {
    const data = JSON.parse(fs.readFileSync(credFile, 'utf8'));
    return { email: String(data.email || ''), senha: String(data.senha || '') };
  } catch {
    return { email: '', senha: '' };
  }
}

function writeCreds(creds) {
  const data = { email: String(creds.email || ''), senha: String(creds.senha || '') };
  fs.writeFileSync(credFile, JSON.stringify(data, null, 2), 'utf8');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Troca e-mail/senha escritos no código por variáveis lidas de credenciais.json.
function externalizeCredentials(code) {
  let out = String(code);
  if (!out.includes("from '@playwright/test'")) return out;
  const creds = readCreds();
  const swap = (value, name) => {
    if (!value) return;
    const literal = escapeRegExp(jsLiteral(value));
    const re = new RegExp("(\\.fill\\((?:[^\\n]*?,\\s*)?)'" + literal + "'(\\s*\\))", 'g');
    out = out.replace(re, '$1' + name + '$2');
  };
  swap(creds.email, 'EMAIL');
  swap(creds.senha, 'PASSWORD');
  out = out.replace(/^const EMAIL = .*\r?\n/m, '').replace(/^const PASSWORD = .*\r?\n/m, '');
  const decl = [];
  if (/\bEMAIL\b/.test(out)) decl.push("const EMAIL = process.env.TESTE_EMAIL ?? '';");
  if (/\bPASSWORD\b/.test(out)) decl.push("const PASSWORD = process.env.TESTE_SENHA ?? '';");
  if (decl.length) {
    out = out.replace(/^(import .*from '@playwright\/test';\r?\n)/m, '$1\n' + decl.join('\n') + '\n');
  }
  return out;
}

function scrubFile(file) {
  try {
    const before = fs.readFileSync(file, 'utf8');
    const after = externalizeCredentials(before);
    if (after !== before) fs.writeFileSync(file, after, 'utf8');
  } catch {
    // arquivo ausente: nada a fazer
  }
}

function scrubAllSpecs() {
  fs.readdirSync(playwrightDir)
    .filter((file) => file.endsWith('.spec.js'))
    .forEach((file) => scrubFile(path.join(playwrightDir, file)));
}

// ---------- Resultado por teste ----------
const jsonOut = path.join(stateDir, 'ultimo-resultado.json');

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function relFromRoot(abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

// ---------- Erros em português ----------
function nomeAmigavel(raw) {
  let value = String(raw || '').replace(/\\'/g, "'").trim();
  value = value.replace(/^text=/, '').replace(/^button:text-is\("(.*)"\)$/, '$1');
  return value.length > 70 ? value.slice(0, 67) + '...' : value;
}

function descreverPasso(line) {
  const l = String(line || '').trim();
  if (!l) return '';
  const first = (re) => { const m = l.match(re); return m ? nomeAmigavel(m[1]) : ''; };
  const alvo = first(/(?:page\.(?:click|fill|dblclick|hover)|page\.locator|page\.getByText)\(\s*'((?:\\'|[^'])*)'/);
  if (/\.fill\(/.test(l) || l.startsWith('await preencherRotulo(')) return 'Preencher o campo "' + (alvo || first(/preencherRotulo\(\s*'((?:\\'|[^'])*)'/)) + '"';
  if (/\.selectOption\(/.test(l)) return 'Escolher uma opção em "' + (alvo || 'lista') + '"';
  if (/\.dblclick\(/.test(l)) return 'Clicar duas vezes em "' + alvo + '"';
  if (/\.hover\(/.test(l)) return 'Passar o mouse sobre "' + alvo + '"';
  if (/\.click\(/.test(l)) return 'Clicar em "' + alvo + '"';
  if (/page\.goto\(/.test(l)) return 'Abrir a página';
  if (/waitForURL\(/.test(l)) {
    const m = l.match(/includes\('((?:\\'|[^'])*)'\)/);
    return 'Esperar chegar no endereço' + (m ? ' "' + nomeAmigavel(m[1]) + '"' : '');
  }
  if (/expect\(page\.getByText\(/.test(l)) return 'Verificar que aparece o texto "' + first(/getByText\(\s*'((?:\\'|[^'])*)'/) + '"';
  if (/toContainText\(/.test(l)) return 'Verificar o texto "' + first(/toContainText\(\s*'((?:\\'|[^'])*)'/) + '" em "' + alvo + '"';
  if (/keyboard\.press\(/.test(l)) return 'Apertar a tecla ' + first(/press\(\s*'((?:\\'|[^'])*)'/);
  return 'Um passo do teste';
}

function explicarMotivo(message) {
  const m = stripAnsi(message);
  if (/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_TIMED_OUT|ERR_INTERNET_DISCONNECTED/.test(m)) {
    return 'Não consegui abrir o endereço. Confira se o sistema está no ar e se a internet está ok.';
  }
  if (/strict mode violation/.test(m)) {
    return 'Mais de um elemento da tela combina com esse passo, e o teste não sabe qual escolher. Grave de novo clicando em algo mais específico.';
  }
  if (/intercepts pointer events|not visible|not stable|not enabled/.test(m)) {
    return 'O elemento existe, mas está coberto, escondido ou desabilitado (talvez ainda carregando).';
  }
  if (/waitForURL/.test(m) && /Timeout/.test(m)) {
    return 'A página não chegou no endereço esperado a tempo. O login pode ter falhado ou o sistema redirecionou para outro lugar.';
  }
  if (/Timeout \d+ms exceeded/.test(m) && /waiting for|locator|getBy/.test(m)) {
    return 'Não encontrei esse elemento na tela a tempo. Ele pode ter mudado de nome ou de lugar, ou a página demorou.';
  }
  if (/toContainText|toBeVisible|Expected (substring|string)|Expected:/.test(m)) {
    return 'O texto esperado não apareceu na tela.';
  }
  if (/Timeout/.test(m)) return 'O teste demorou mais que o tempo permitido.';
  return 'Erro inesperado. Veja o detalhe técnico.';
}

function sourceLineOf(file, lineNo) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    return lines[lineNo - 1] || '';
  } catch {
    return '';
  }
}

function hasVerification(code) {
  return /expect\(|waitForURL\(/.test(String(code));
}

function summarizeReport() {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
  } catch {
    return null;
  }
  const items = [];
  const walk = (suite) => {
    (suite.specs || []).forEach((spec) => {
      (spec.tests || []).forEach((test) => {
        const last = (test.results || []).slice(-1)[0] || {};
        const attach = last.attachments || [];
        const pick = (type) => {
          const found = attach.find((a) => a.path && String(a.contentType || '').startsWith(type));
          return found ? relFromRoot(found.path) : '';
        };
        const status = test.status === 'expected' ? 'passed'
          : test.status === 'skipped' ? 'skipped'
          : test.status === 'flaky' ? 'flaky' : 'failed';
        const abs = path.resolve(root, 'tests', 'e2e', spec.file || '');
        const err = last.error || {};
        const lineNo = (err.location && err.location.line)
          || Number((String(err.stack || '').match(/\.spec\.js:(\d+)/) || [])[1]) || 0;
        let code = '';
        try { code = fs.readFileSync(abs, 'utf8'); } catch { code = ''; }
        items.push({
          file: path.basename(spec.file || ''),
          title: spec.title,
          status,
          duration: last.duration || 0,
          passo: status === 'failed' && lineNo ? descreverPasso(sourceLineOf(abs, lineNo)) : '',
          motivo: status === 'failed' ? explicarMotivo(err.message || '') : '',
          semVerificacao: status !== 'failed' && !hasVerification(code),
          error: status === 'failed' ? stripAnsi(err.message || '').slice(0, 800) : '',
          screenshot: pick('image/'),
          video: pick('video/'),
        });
      });
    });
    (suite.suites || []).forEach(walk);
  };
  (report.suites || []).forEach(walk);
  return {
    items,
    total: items.length,
    passed: items.filter((i) => i.status === 'passed' || i.status === 'flaky').length,
    failed: items.filter((i) => i.status === 'failed').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
  };
}

async function readJson(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    send(res, 400, 'JSON inválido', 'text/plain; charset=utf-8');
    return null;
  }
}

function startTestRun(res, engine, files, headed, workers) {
  const args = ['playwright', 'test', ...files, '--reporter=list,json', '--workers=' + workers, ...(headed ? ['--headed'] : [])];
  runState = { status: 'running', code: null, log: '', kind: 'test', engine, results: null };
  try {
    running = spawn('npx', args, { cwd: root, shell: true, windowsHide: !headed, env: browserEnv(headed) });
  } catch (err) {
    running = null;
    runState = { status: 'error', code: null, log: err.message, kind: 'test', results: null };
    send(res, 500, err.message, 'text/plain; charset=utf-8');
    return;
  }
  watchRun(running);
  send(res, 202, JSON.stringify({ started: true, engine, files }), 'application/json; charset=utf-8');
}

function jsLiteral(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// Ids/classes gerados automaticamente (mudam a cada versão do sistema) quebram o teste.
function unstableSelector(sel) {
  return /#:r|\[id=['"]?:r|radix-|headlessui-|react-select-|mui-\d|\bcss-[a-z0-9]{5,}|\b(?:sc|jsx|svelte)-[a-z0-9]{5,}|#[\w-]*\d{4,}|\.[\w-]*\d{5,}/i.test(sel);
}

function selectorList(selectors) {
  const list = [];
  (selectors || []).forEach((item) => {
    const value = Array.isArray(item) ? item[0] : item;
    if (value) list.push(String(value));
  });
  const stable = list.filter((sel) => !unstableSelector(sel));
  return stable.length ? stable : list;
}

function buttonAccessibleName(list) {
  const stronger = list.some((sel) => (
    sel.includes('data-testid') || sel.includes('data-test') || sel.startsWith('#') || /\[name=/.test(sel)
  ));
  if (stronger) return '';
  const label = list.find((sel) => sel.startsWith('aria/') || sel.startsWith('text/'));
  if (!label) return '';
  const name = label.slice(label.indexOf('/') + 1).trim();
  if (!name || name.startsWith('[')) return '';
  const targetsButton = list.some((sel) => (
    !sel.startsWith('aria/')
    && !sel.startsWith('text/')
    && !sel.startsWith('xpath/')
    && !sel.startsWith('pierce/')
    && /\bbutton\b/.test(sel)
    && !/>\s*svg\b/.test(sel)
  ));
  return targetsButton ? name : '';
}

function pickSelector(selectors) {
  const list = selectorList(selectors);
  const rank = (sel) => {
    if (sel.includes('data-testid') || sel.includes('data-test')) return 0;
    if (/\[name=/.test(sel) || sel.startsWith('#')) return 1;
    if (sel.startsWith('aria/')) return 2;
    if (sel.startsWith('text/')) return 3;
    if (sel.includes(':nth')) return 5;
    if (sel.startsWith('xpath/') || sel.startsWith('pierce/')) return 6;
    return 4;
  };
  list.sort((a, b) => rank(a) - rank(b));
  return list[0] || '';
}

function qualifiedButtonCss(list) {
  const candidates = list.filter((sel) => (
    !sel.startsWith('aria/')
    && !sel.startsWith('text/')
    && !sel.startsWith('xpath/')
    && !sel.startsWith('pierce/')
    && /(^|[\s>+~])button\b/.test(sel)
    && !/>\s*svg\b/.test(sel)
    && (/[.#]/.test(sel) || /[\s>+~]/.test(sel))
  ));
  if (!candidates.length) return '';
  candidates.sort((a, b) => {
    const score = (sel) => ((sel.includes('.') || sel.includes('#')) ? 10 : 0) + sel.length;
    return score(b) - score(a);
  });
  return candidates[0];
}

function controlCss(list, tag) {
  const re = new RegExp('(^|[\\s>+~])' + tag + '\\b');
  const candidates = list.filter((sel) => (
    !sel.startsWith('aria/')
    && !sel.startsWith('text/')
    && !sel.startsWith('xpath/')
    && !sel.startsWith('pierce/')
    && re.test(sel)
    && !/>\s*svg\b/.test(sel)
  ));
  if (!candidates.length) return '';
  candidates.sort((a, b) => {
    const score = (sel) => ((sel.includes('.') || sel.includes('#')) ? 10 : 0) + sel.length;
    return score(b) - score(a);
  });
  return candidates[0];
}

function locatorExpr(selectors) {
  const list = selectorList(selectors);
  const tagged = qualifiedButtonCss(list);
  if (tagged) return "page.locator('" + jsLiteral(tagged) + "')";
  const field = controlCss(list, 'select') || controlCss(list, 'textarea') || controlCss(list, 'input');
  if (field) return "page.locator('" + jsLiteral(field) + "')";
  const buttonName = buttonAccessibleName(list);
  if (buttonName) {
    const name = String(buttonName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return "page.locator('button:text-is(\"" + name + "\")')";
  }
  const sel = pickSelector(list);
  if (!sel) return "page.locator('body')";
  if (sel.startsWith('aria/') || sel.startsWith('text/')) {
    return "page.getByText('" + jsLiteral(sel.slice(sel.indexOf('/') + 1)) + "')";
  }
  if (sel.startsWith('xpath/')) return "page.locator('" + jsLiteral('xpath=' + sel.slice(6)) + "')";
  const css = sel.startsWith('pierce/') ? sel.slice(7) : sel;
  return "page.locator('" + jsLiteral(css) + "')";
}

function waitForRecordedNavigation(url) {
  if (!url) {
    return [
      "  await page.waitForLoadState('load');",
      "  await Promise.race([page.waitForLoadState('networkidle'), page.waitForTimeout(8000)]);",
    ];
  }
  // Só confere o endereço (sem ?parâmetros e #âncora), que mudam a cada execução.
  let clean = String(url);
  try {
    const parsed = new URL(clean);
    clean = parsed.origin + parsed.pathname;
  } catch {
    clean = clean.split(/[?#]/)[0];
  }
  clean = clean.replace(/\/+$/, '');
  return [
    "  await page.waitForURL(url => url.href.replace(/\\/+$/, '').includes('" + jsLiteral(clean) + "'), { timeout: 30000, waitUntil: 'commit' });",
    "  await Promise.race([page.waitForLoadState('networkidle'), page.waitForTimeout(8000)]);",
  ];
}

function valueCall(selectors, value) {
  const list = selectorList(selectors);
  const expr = locatorExpr(selectors);
  const quoted = "'" + jsLiteral(value) + "'";
  if (controlCss(list, 'select')) return expr + '.selectOption(' + quoted + ')';
  return expr + '.fill(' + quoted + ')';
}

function navigationUrl(step) {
  const events = (step && step.assertedEvents) || [];
  const found = events.find((event) => event && event.type === 'navigation' && event.url);
  return found ? found.url : '';
}

function chromeRecordingToSpec(recording, title) {
  const steps = Array.isArray(recording) ? recording : recording && recording.steps;
  if (!Array.isArray(steps)) return null;
  const name = title || (recording && recording.title) || 'gravacao';
  const lines = [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('" + jsLiteral(name) + "', async ({ page }) => {",
    '  test.setTimeout(90000);',
  ];
  let actions = 0;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const type = step && step.type;
    if (type === 'setViewport' && step.width && step.height) {
      lines.push('  await page.setViewportSize({ width: ' + Number(step.width) + ', height: ' + Number(step.height) + ' });');
      actions += 1;
      continue;
    }
    if (type === 'navigate' && step.url) {
      lines.push("  await page.goto('" + jsLiteral(step.url) + "');");
      actions += 1;
      continue;
    }
    if (type === 'click' || type === 'doubleClick' || type === 'hover') {
      const method = type === 'doubleClick' ? 'dblclick' : type === 'hover' ? 'hover' : 'click';
      const locator = locatorExpr(step.selectors);
      const extra = step.button === 'secondary' ? "{ button: 'right' }" : '';
      lines.push('  await ' + locator + '.' + method + '(' + extra + ')' + ';');
      actions += 1;
      continue;
    }
    if (type === 'change') {
      lines.push('  await ' + valueCall(step.selectors, step.value) + ';');
      actions += 1;
      continue;
    }
    if (type === 'keyDown' && step.key) {
      const next = steps[i + 1];
      const pair = next && next.type === 'keyUp' && next.key === step.key;
      lines.push("  await page.keyboard.press('" + jsLiteral(step.key) + "');");
      if (pair) {
        const destination = navigationUrl(next);
        if (destination) lines.push(...waitForRecordedNavigation(destination));
        i += 1;
      }
      actions += 1;
      continue;
    }
    if (type === 'keyUp') {
      const destination = navigationUrl(step);
      if (destination) {
        lines.push(...waitForRecordedNavigation(destination));
        actions += 1;
      }
      continue;
    }
    if (type === 'scroll') {
      lines.push('  await page.mouse.wheel(' + Number(step.x || 0) + ', ' + Number(step.y || 0) + ');');
      actions += 1;
    }
  }
  lines.push('});', '');
  if (!actions) return null;
  return lines.join('\n');
}

function quotedAt(source, start) {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return null;
  let value = '';
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1];
      if (next === 'n') value += '\n';
      else if (next === 'r') value += '\r';
      else value += next || '';
      i += 1;
      continue;
    }
    if (ch === quote) return { value, end: i + 1 };
    value += ch;
  }
  return null;
}

function puppeteerQuotedName(raw) {
  let label = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\' && raw[i + 1]) {
      label += raw[i + 1];
      i += 1;
      continue;
    }
    if (ch === ')') return label;
    label += ch;
  }
  return label;
}

function puppeteerSelectors(block) {
  const found = [];
  const marker = '.locator(';
  let from = 0;
  while (from < block.length) {
    const at = block.indexOf(marker, from);
    if (at < 0) break;
    const quoteAt = block.slice(at + marker.length).search(/['"]/);
    if (quoteAt < 0) break;
    const parsed = quotedAt(block, at + marker.length + quoteAt);
    if (!parsed) break;
    found.push(parsed.value);
    from = parsed.end;
  }
  return found.map((sel) => {
    if (sel.startsWith('::-p-aria(')) {
      const label = puppeteerQuotedName(sel.slice('::-p-aria('.length));
      if (!label || label.startsWith('[')) return '';
      return 'aria/' + label;
    }
    if (sel.startsWith('::-p-text(')) {
      const label = puppeteerQuotedName(sel.slice('::-p-text('.length));
      return label ? 'text/' + label : '';
    }
    if (sel.startsWith('::-p-xpath(')) {
      const inner = sel.endsWith(')') ? sel.slice('::-p-xpath('.length, -1) : sel.slice('::-p-xpath('.length);
      return 'xpath/' + inner;
    }
    if (sel.includes('>>>')) return sel.split('>>>').pop().trim();
    return sel;
  }).filter(Boolean);
}

function puppeteerExportToSpec(source, title) {
  if (!source.includes('puppeteer') || !source.includes('Locator.race')) return null;
  const lines = [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('" + jsLiteral(title || 'gravacao') + "', async ({ page }) => {",
    '  test.setTimeout(90000);',
  ];
  const pending = [];
  let cursor = 0;
  const markers = ['setViewport(', '.goto(', 'Locator.race(', 'keyboard.down(', 'keyboard.up('];
  while (cursor < source.length) {
    let nextAt = -1;
    let kind = '';
    markers.forEach((marker) => {
      const at = source.indexOf(marker, cursor);
      if (at >= 0 && (nextAt < 0 || at < nextAt)) {
        nextAt = at;
        kind = marker;
      }
    });
    if (nextAt < 0) break;
    if (kind === 'setViewport(') {
      const width = source.slice(nextAt).match(/width:\s*(\d+)/);
      const height = source.slice(nextAt).match(/height:\s*(\d+)/);
      if (width && height) pending.push({ type: 'viewport', width: width[1], height: height[1] });
      cursor = nextAt + kind.length;
      continue;
    }
    if (kind === '.goto(') {
      const parsed = quotedAt(source, source.slice(nextAt + kind.length).search(/['"]/) + nextAt + kind.length);
      if (parsed) pending.push({ type: 'goto', url: parsed.value });
      cursor = parsed ? parsed.end : nextAt + kind.length;
      continue;
    }
    if (kind === 'keyboard.down(' || kind === 'keyboard.up(') {
      const parsed = quotedAt(source, source.slice(nextAt + kind.length).search(/['"]/) + nextAt + kind.length);
      const around = source.slice(Math.max(0, nextAt - 250), nextAt);
      pending.push({
        type: kind === 'keyboard.down(' ? 'down' : 'up',
        key: parsed ? parsed.value : 'Enter',
        navigation: kind === 'keyboard.up(' && around.includes('waitForNavigation'),
      });
      cursor = parsed ? parsed.end : nextAt + kind.length;
      continue;
    }
    const tail = source.slice(nextAt);
    const method = tail.match(/\]\)[\s\S]*?\.(click|dblclick|fill|hover)\(/);
    if (!method) {
      cursor = nextAt + kind.length;
      continue;
    }
    const block = tail.slice(0, method.index + method[0].length);
    const callAt = nextAt + method.index + method[0].length;
    let value = '';
    if (method[1] === 'fill') {
      const parsed = quotedAt(source, source.slice(callAt).search(/['"]/) + callAt);
      value = parsed ? parsed.value : '';
      cursor = parsed ? parsed.end : callAt;
    } else {
      cursor = callAt;
    }
    pending.push({
      type: method[1],
      selectors: puppeteerSelectors(block),
      value,
    });
  }

  let actions = 0;
  for (let i = 0; i < pending.length; i += 1) {
    const step = pending[i];
    if (step.type === 'viewport') {
      lines.push('  await page.setViewportSize({ width: ' + step.width + ', height: ' + step.height + ' });');
      actions += 1;
      continue;
    }
    if (step.type === 'goto') {
      lines.push("  await page.goto('" + jsLiteral(step.url) + "');");
      actions += 1;
      continue;
    }
    if (step.type === 'fill') {
      lines.push('  await ' + valueCall(step.selectors, step.value) + ';');
      actions += 1;
      continue;
    }
    if (step.type === 'click' || step.type === 'dblclick' || step.type === 'hover') {
      const method = step.type === 'dblclick' ? 'dblclick' : step.type;
      const locator = locatorExpr(step.selectors);
      lines.push('  await ' + locator + '.' + method + '()' + ';');
      actions += 1;
      continue;
    }
    if (step.type === 'down') {
      const next = pending[i + 1];
      lines.push("  await page.keyboard.press('" + jsLiteral(step.key) + "');");
      if (next && next.type === 'up' && next.key === step.key) {
        if (next.navigation) lines.push(...waitForRecordedNavigation(''));
        i += 1;
      }
      actions += 1;
    }
  }
  lines.push('});', '');
  if (!actions) return null;
  return lines.join('\n');
}

function recordingToSpec(source, title) {
  const text = String(source || '');
  if (text.includes("from '@playwright/test'") || text.includes('from "@playwright/test"')) {
    return text.endsWith('\n') ? text : text + '\n';
  }
  const puppeteer = puppeteerExportToSpec(text, title);
  if (puppeteer) return puppeteer;
  try {
    return chromeRecordingToSpec(JSON.parse(text), title);
  } catch {
    return null;
  }
}

function watchRun(child) {
  const append = (chunk) => { runState.log += chunk.toString(); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (err) => {
    runState.status = 'error';
    runState.log += '\n' + err.message;
    running = null;
  });
  child.on('exit', (code) => {
    if (runState.kind === 'record' && code === 0) {
      if (runState.file) scrubFile(runState.file);
      runState.status = 'saved';
    } else {
      runState.status = code === 0 ? 'passed' : 'failed';
      if (runState.kind === 'test') runState.results = summarizeReport();
    }
    runState.code = code;
    running = null;
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1:' + port);

  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/roteiro.html')) {
    send(res, 200, fs.readFileSync(path.join(root, 'roteiro.html')), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/tests') {
    send(res, 200, JSON.stringify({ files: listTests() }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/tests/file') {
    const engine = engineOf(url.searchParams.get('engine'));
    const fileName = safeName(url.searchParams.get('name'), engine);
    if (!fileName) {
      send(res, 400, 'Nome inválido', 'text/plain; charset=utf-8');
      return;
    }
    const dest = path.join(folderOf(engine), fileName);
    if (!fs.existsSync(dest)) {
      send(res, 404, 'Teste não encontrado', 'text/plain; charset=utf-8');
      return;
    }
    send(res, 200, JSON.stringify({ fileName, engine, code: fs.readFileSync(dest, 'utf8') }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tests') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(res, 400, 'JSON inválido', 'text/plain; charset=utf-8');
      return;
    }

    const engine = engineOf(body.engine);
    const fileName = safeName(body.fileName, engine);
    const code = externalizeCredentials(String(body.code || ''));
    const recognizable = code.includes("from '@playwright/test'");
    if (!fileName || !recognizable || code.length > 200000) {
      send(res, 400, 'Nome ou código inválido.', 'text/plain; charset=utf-8');
      return;
    }

    const dest = path.join(folderOf(engine), fileName);
    fs.writeFileSync(dest, code, 'utf8');
    const relative = path.relative(root, dest).split(path.sep).join('/');
    send(res, 200, JSON.stringify({ path: relative, engine }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/run') {
    send(res, 200, JSON.stringify(runState), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(res, 400, 'JSON inválido', 'text/plain; charset=utf-8');
      return;
    }
    if (running) {
      send(res, 409, 'Já existe um teste em execução. Espere a janela fechar.', 'text/plain; charset=utf-8');
      return;
    }
    const engine = engineOf(body.engine);
    const fileName = safeName(body.fileName, engine);
    const spec = fileName && path.join(folderOf(engine), fileName);
    if (!spec || !fs.existsSync(spec)) {
      send(res, 404, 'Salve o teste antes de rodar.', 'text/plain; charset=utf-8');
      return;
    }
    const relative = path.relative(root, spec).split(path.sep).join('/');
    const headed = body.headed !== false;
    startTestRun(res, engine, [relative], headed, 1);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/credenciais') {
    send(res, 200, JSON.stringify(readCreds()), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/credenciais') {
    const body = await readJson(req, res);
    if (!body) return;
    writeCreds(body);
    scrubAllSpecs();
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run-all') {
    const body = await readJson(req, res);
    if (!body) return;
    if (running) {
      send(res, 409, 'Já existe um teste em execução. Espere terminar.', 'text/plain; charset=utf-8');
      return;
    }
    const available = fs.readdirSync(playwrightDir).filter((f) => f.endsWith('.spec.js'));
    const asked = Array.isArray(body.files) && body.files.length ? body.files : available;
    const files = asked
      .map((name) => safeName(name, 'playwright'))
      .filter((name) => name && available.includes(name))
      .map((name) => 'tests/e2e/gravados/' + name);
    if (!files.length) {
      send(res, 400, 'Nenhum teste para rodar.', 'text/plain; charset=utf-8');
      return;
    }
    const headed = body.headed === true;
    const workers = headed ? 1 : Math.min(4, Math.max(1, Number(body.workers) || 2));
    startTestRun(res, 'playwright', files, headed, workers);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/arquivo') {
    const abs = path.resolve(root, String(url.searchParams.get('path') || ''));
    const allowed = path.join(root, 'test-results') + path.sep;
    if (!abs.startsWith(allowed) || !fs.existsSync(abs)) {
      send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
      return;
    }
    const types = { '.png': 'image/png', '.webm': 'video/webm', '.zip': 'application/zip' };
    send(res, 200, fs.readFileSync(abs), types[path.extname(abs)] || 'application/octet-stream');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(res, 400, 'JSON inválido', 'text/plain; charset=utf-8');
      return;
    }
    const fileName = safeName(body.fileName, 'playwright');
    const code = recordingToSpec(body.source, body.title || fileName);
    if (!fileName || !code || code.length > 200000 || !code.includes("from '@playwright/test'")) {
      send(res, 400, 'A gravação não tem passos que o Playwright reconhece. Exporte o JSON ou o script Puppeteer do Recorder do Chrome.', 'text/plain; charset=utf-8');
      return;
    }
    const dest = path.join(playwrightDir, fileName);
    fs.writeFileSync(dest, externalizeCredentials(code), 'utf8');
    const relative = path.relative(root, dest).split(path.sep).join('/');
    send(res, 200, JSON.stringify({ path: relative, fileName, engine: 'playwright' }), 'application/json; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/record') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(res, 400, 'JSON inválido', 'text/plain; charset=utf-8');
      return;
    }
    if (running) {
      send(res, 409, 'Feche a janela de gravação ou espere o teste terminar.', 'text/plain; charset=utf-8');
      return;
    }
    const fileName = safeName(body.fileName, 'playwright');
    const target = safeUrl(body.url);
    if (!fileName || !target) {
      send(res, 400, 'Informe um nome de arquivo e uma URL http(s).', 'text/plain; charset=utf-8');
      return;
    }
    const dest = path.join(playwrightDir, fileName);
    const relative = path.relative(root, dest).split(path.sep).join('/');
    // Usa o Google Chrome se estiver instalado; senão, o Chromium que o Playwright baixou.
    const channel = chromeInstalled() ? ['--channel', 'chrome'] : [];
    const args = ['playwright', 'codegen', ...channel, '--target', 'playwright-test', '--output', relative, target];
    runState = { status: 'running', code: null, log: '', kind: 'record', file: dest, results: null };
    try {
      running = spawn('npx', args, {
        cwd: root,
        shell: true,
        windowsHide: false,
        env: browserEnv(true),
      });
    } catch (err) {
      running = null;
      runState = { status: 'error', code: null, log: err.message, kind: 'record' };
      send(res, 500, err.message, 'text/plain; charset=utf-8');
      return;
    }
    watchRun(running);
    send(res, 202, JSON.stringify({ started: true, fileName, path: relative }), 'application/json; charset=utf-8');
    return;
  }

  send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
});

scrubAllSpecs();

server.listen(port, '127.0.0.1', () => {
  console.log('Roteiro em http://127.0.0.1:' + port);
  console.log('Testes em tests/e2e/gravados');
});
