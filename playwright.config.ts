import { defineConfig } from '@playwright/test';

const aoVivo = process.env.PW_VER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Uma segunda tentativa automática absorve lentidão e instabilidade pontual do sistema.
  // Ao ver o teste rodando (modo visual) não repete, para o QA acompanhar o erro de primeira.
  retries: aoVivo ? 0 : Number(process.env.PW_RETRIES ?? 1),
  reporter: 'list',
  use: {
    // Esperas mais pacientes por clique/preenchimento e por carregamento de página.
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    launchOptions: aoVivo ? { slowMo: 700 } : undefined,
  },
});
