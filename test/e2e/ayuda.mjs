// Ayudas para las pruebas de punta a punta: servidor local, navegador y arranque de prueba.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ARRANQUE = path.join(RAIZ, 'test/arranque-prueba.json');
export const CAPTURAS = path.join(RAIZ, 'test/capturas');
export const DESCARGAS = path.join(RAIZ, 'test/descargas');
mkdirSync(CAPTURAS, { recursive: true });
mkdirSync(DESCARGAS, { recursive: true });

/** Fecha y hora "de hoy" en las pruebas (un miércoles). */
export const AHORA = new Date('2030-01-09T08:00:00');

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/** Sirve la app con python3 -m http.server en un puerto local. */
export async function iniciarServidor(raiz = RAIZ) {
  const puerto = await puertoLibre();
  const proc = spawn('python3', ['-m', 'http.server', String(puerto), '--bind', '127.0.0.1'], { cwd: raiz, stdio: 'ignore' });
  const url = `http://127.0.0.1:${puerto}/`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) break;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, cerrar: () => proc.kill() };
}

export async function abrirNavegador() {
  const opciones = {};
  if (process.env.CHROMIUM_PATH) opciones.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opciones);
}

/** Contexto con pantalla de celular (412 × 915), tema oscuro y reloj fijo. */
export async function nuevaPagina(navegador, url, { ahora = AHORA, escala = 1 } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: escala,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'es',
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await contexto.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  if (ahora) await page.clock.install({ time: ahora });
  await page.goto(url);
  await page.waitForSelector('body[data-listo="1"]');
  return { contexto, page, errores };
}

export async function importarArchivo(page, ruta, boton = 'importar-inicio') {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId(boton).click()]);
  await fc.setFiles(ruta);
}

export async function importarArranque(page) {
  await importarArchivo(page, ARRANQUE);
  await page.getByTestId('btn-comida').waitFor();
}

export async function captura(page, nombre) {
  const ruta = path.join(CAPTURAS, `${nombre}.png`);
  await page.screenshot({ path: ruta });
  return ruta;
}

/** Lee todo lo guardado en IndexedDB. */
export function leerDB(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('app-registro');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('datos', 'readonly');
          const st = tx.objectStore('datos');
          const out = {};
          const cur = st.openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (c) {
              out[c.key] = c.value;
              c.continue();
            } else resolve(out);
          };
          cur.onerror = () => reject(cur.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function esperarAviso(page, texto) {
  await page.locator('.toast', { hasText: texto }).first().waitFor();
}

/** Cierra la hoja de arriba con su botón ✕. */
export async function cerrarHoja(page) {
  await page.locator('.hoja').last().getByRole('button', { name: 'Cerrar' }).click();
}
