import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { iniciarServidor, abrirNavegador, nuevaPagina, RAIZ } from './ayuda.mjs';

let srv;
let nav;
let copia;
before(async () => {
  copia = mkdtempSync(path.join(tmpdir(), 'app-registro-'));
  for (const x of ['index.html', 'estilos.css', 'manifest.webmanifest', 'sw.js', 'iconos', 'src']) cpSync(path.join(RAIZ, x), path.join(copia, x), { recursive: true });
  srv = await iniciarServidor(copia);
  nav = await abrirNavegador();
});
after(async () => {
  await nav?.close();
  srv?.cerrar();
  rmSync(copia, { recursive: true, force: true });
});

test('versión nueva: aparece el aviso y al tocarlo se actualiza', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url, { ahora: null });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.getByTestId('banner-version').count(), 0);
  // Publico una versión nueva del service worker
  const sw = path.join(copia, 'sw.js');
  writeFileSync(sw, readFileSync(sw, 'utf8').replace(/const VERSION = '[^']+';/, "const VERSION = 'prueba-nueva';"));
  // El servidor de prueba compara fechas por segundo: la versión nueva lleva una fecha posterior.
  const despues = new Date(Date.now() + 60000);
  utimesSync(sw, despues, despues);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.getByTestId('banner-version').waitFor();
  assert.equal(await page.getByTestId('banner-version').innerText(), 'Versión nueva: toca para actualizar');
  await Promise.all([page.waitForEvent('load'), page.getByTestId('banner-version').click()]);
  await page.waitForSelector('body[data-listo="1"]');
  const cajas = await page.evaluate(() => caches.keys());
  assert.deepEqual(cajas, ['app-registro-prueba-nueva']);
  assert.equal(await page.getByTestId('banner-version').count(), 0);
  assert.deepEqual(errores, []);
  await contexto.close();
});
