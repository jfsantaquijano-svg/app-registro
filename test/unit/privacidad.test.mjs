// Prueba de privacidad: nada del archivo privado de una persona puede quedar en este repositorio público
// (ni en los archivos ni en el historial de git).
// La lista de lo prohibido NO vive aquí (la lista misma revelaría los datos): se lee de una carpeta privada,
// indicada en la variable PRIVADO_DIR o en el archivo local `ruta.privado.txt` (ignorado por git).
// Esa carpeta tiene: arranque.json, palabras-prohibidas.txt y, opcional, privacidad-permitidas.txt.
// Si no hay carpeta privada, la prueba se salta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function carpetaPrivada() {
  if (process.env.PRIVADO_DIR) return process.env.PRIVADO_DIR;
  const ruta = path.join(RAIZ, 'ruta.privado.txt');
  if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim();
  return null;
}

const DIR = carpetaPrivada();
const HAY = !!DIR && existsSync(path.join(DIR, 'arranque.json'));

const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ.,%/+&-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Ventanas de N palabras seguidas (de 12 letras o más). */
function ventanas(texto, n = 4) {
  const p = norm(texto).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= p.length; i++) {
    const v = p.slice(i, i + n).join(' ');
    if (v.length >= 12) out.add(v);
  }
  return out;
}

function textosDe(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => textosDe(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => textosDe(y, out));
  return out;
}

function lineas(archivo) {
  const ruta = path.join(DIR, archivo);
  if (!existsSync(ruta)) return [];
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function archivosPublicos() {
  const lista = [...git('ls-files').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
  return [...new Set(lista)].filter((f) => existsSync(path.join(RAIZ, f)) && !/\.(png|jpg|webp|ico)$/i.test(f) && !f.startsWith('node_modules/'));
}

function revisar(texto, prohibidas, frases, permitidas) {
  const hallado = [];
  const t = ` ${norm(texto)} `;
  for (const w of prohibidas) {
    const nw = norm(w);
    if (nw && new RegExp(`(^|[^a-z0-9ñ])${nw.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9ñ]|$)`).test(t)) hallado.push(`palabra prohibida: "${w}"`);
  }
  for (const v of ventanas(texto)) if (frases.has(v) && !permitidas.some((p) => v.includes(p))) hallado.push(`frase del archivo privado: "${v}"`);
  return hallado;
}

test('privacidad: ningún archivo del repositorio tiene datos del archivo privado', { skip: !HAY && 'sin carpeta privada' }, () => {
  const privado = JSON.parse(readFileSync(path.join(DIR, 'arranque.json'), 'utf8'));
  const prohibidas = lineas('palabras-prohibidas.txt');
  const permitidas = lineas('privacidad-permitidas.txt').map(norm);
  const frases = new Set();
  for (const s of textosDe(privado)) for (const v of ventanas(s)) frases.add(v);
  assert.ok(prohibidas.length > 0, 'falta palabras-prohibidas.txt en la carpeta privada');
  const problemas = [];
  for (const f of archivosPublicos()) {
    const texto = `${f}\n${readFileSync(path.join(RAIZ, f), 'utf8')}`;
    for (const h of revisar(texto, prohibidas, frases, permitidas)) problemas.push(`${f}: ${h}`);
  }
  assert.deepEqual(problemas, []);
});

test('privacidad: el historial de git tampoco tiene datos del archivo privado', { skip: !HAY && 'sin carpeta privada' }, () => {
  const privado = JSON.parse(readFileSync(path.join(DIR, 'arranque.json'), 'utf8'));
  const prohibidas = lineas('palabras-prohibidas.txt');
  const permitidas = lineas('privacidad-permitidas.txt').map(norm);
  const frases = new Set();
  for (const s of textosDe(privado)) for (const v of ventanas(s)) frases.add(v);
  let historial = '';
  try {
    historial = git('log', '--all', '-p', '--format=commit %H%n%an <%ae>%n%B');
  } catch {
    historial = '';
  }
  const problemas = revisar(historial, prohibidas, frases, permitidas);
  assert.deepEqual(problemas, []);
});
