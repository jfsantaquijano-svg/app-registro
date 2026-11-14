import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { iniciarServidor, abrirNavegador, nuevaPagina, importarArchivo, importarArranque, captura, esperarAviso, leerDB, RAIZ, ARRANQUE, DESCARGAS } from './ayuda.mjs';

// Plan sin rutina y con un solo tipo de día (más uno de viaje): alguien que todavía no entrena.
const SIN_RUTINA = path.join(RAIZ, 'test/arranque-sin-rutina.json');

let srv;
let nav;
before(async () => {
  srv = await iniciarServidor();
  nav = await abrirNavegador();
});
after(async () => {
  await nav?.close();
  srv?.cerrar();
});

async function anotarPasos(page, boton, numero) {
  await page.getByTestId(boton).click();
  await page.getByTestId('hoja-pasos').waitFor();
  await page.getByTestId('pasos-num').fill(numero);
  await page.getByTestId('pasos-guardar').click();
  await page.getByTestId('hoja-pasos').waitFor({ state: 'detached' });
}

test('sin rutina: no pregunta "¿Hoy entrenas?", no hay botón de entrenar, el día modelo funciona y los pasos se anotan', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  // Sin buscar un archivo: pega el texto tal como lo dio Claude en el chat (con las marcas del bloque de código)
  await page.getByTestId('pegar-inicio').click();
  await page.getByTestId('pegar-texto').fill('hola');
  await page.getByTestId('pegar-importar').click();
  await esperarAviso(page, 'No se pudo leer');
  assert.equal(await page.getByTestId('hoja-pegar').count(), 1);
  await page.getByTestId('pegar-texto').fill(`Aquí está tu archivo:\n\`\`\`json\n${readFileSync(SIN_RUTINA, 'utf8')}\n\`\`\``);
  await page.getByTestId('pegar-importar').click();
  await esperarAviso(page, 'tus datos quedaron cargados');
  await page.getByTestId('btn-comida').waitFor();

  // El tipo de día ya está dado; se puede cambiar tocándolo
  assert.equal(await page.getByText('¿Hoy entrenas?').count(), 0);
  assert.equal(await page.getByTestId('tipo-actual').innerText(), 'Día normal');
  assert.match(await page.getByTestId('meta-tit').innerText(), /Día normal/);
  assert.match(await page.getByTestId('barra-kcal').innerText(), /\/ 1\.550/);
  // Sin rutina no hay botón de entrenar y "Cerrar el día" ocupa la fila
  assert.equal(await page.getByTestId('btn-entrenar').count(), 0);
  assert.match(await page.getByTestId('btn-cerrar').getAttribute('class'), /doble/);

  // Pasos: hoy sin anotar, y ayer quedó sin anotar (ya venía anotando)
  assert.equal(await page.getByTestId('pasos-hoy').innerText(), '—');
  assert.match(await page.getByTestId('pasos-texto').innerText(), /Toca aquí para anotar los pasos de hoy/);
  assert.match(await page.getByTestId('tarjeta-pasos').innerText(), /\/ 10\.000/);
  await page.getByTestId('pasos-ayer').click();
  assert.equal(await page.getByTestId('pasos-fecha').inputValue(), '2030-01-08');
  await page.getByTestId('pasos-num').fill('9.800');
  await page.getByTestId('pasos-guardar').click();
  await esperarAviso(page, 'Promedio de la semana: 9.000 pasos (2 días)');
  await page.getByTestId('pasos-ayer').waitFor({ state: 'detached' });

  // Hoy: con punto de miles, y otra vez el mismo día reemplaza (no suma ni duplica)
  await anotarPasos(page, 'btn-pasos', '10500');
  await esperarAviso(page, 'Promedio de la semana: 9.500 pasos (3 días)');
  assert.equal(await page.getByTestId('pasos-hoy').innerText(), '10.500');
  assert.equal(await page.getByTestId('pasos-texto').innerText(), '✅ Llegaste a la meta.');
  await page.getByTestId('btn-pasos').click();
  assert.equal(await page.getByTestId('pasos-num').inputValue(), '10500');
  assert.match(await page.getByTestId('pasos-ayuda').innerText(), /Ese día ya tiene 10\.500/);
  await page.getByTestId('pasos-num').fill('11,000');
  await page.getByTestId('pasos-guardar').click();
  await esperarAviso(page, 'Promedio de la semana: 9.667 pasos (3 días)');
  // Un número que no es de pasos no se guarda
  await page.getByTestId('btn-pasos').click();
  await page.getByTestId('pasos-num').fill('mucho');
  await page.getByTestId('pasos-guardar').click();
  await esperarAviso(page, 'solo con números');
  await page.getByTestId('pasos-num').fill('250000');
  await page.getByTestId('pasos-guardar').click();
  await esperarAviso(page, 'parece muy alto');
  await page.locator('.hoja').last().getByRole('button', { name: 'Cerrar' }).click();

  assert.equal(await page.getByTestId('pasos-promedio').innerText(), '9.667 (3 días)');
  assert.equal(await page.getByTestId('pasos-en-meta').innerText(), 'en la meta: 1 de 3');
  await captura(page, '30-sin-rutina-hoy');

  // Planear el día no pregunta el tipo: usa el día modelo de "Día normal"
  await page.getByTestId('btn-planear').click();
  await esperarAviso(page, 'Día planeado');
  for (const m of ['desayuno', 'almuerzo', 'merienda', 'cena']) await page.getByTestId(`hoy-confirmar-${m}`).waitFor();

  // Copiar para Claude: lleva los pasos
  await page.getByTestId('copiar-claude').click();
  await esperarAviso(page, 'Copiado');
  const texto = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(texto, /Pasos promedio: 9\.667 \(3 días anotados\) · meta 10\.000 · en la meta: 1 de 3\n/);
  assert.match(texto, /Pasos: lun 7 ene 8\.200, mar 8 ene 9\.800, mié 9 ene 11\.000/);

  // Entreno: explica cómo llega la rutina, sin decir que falta importar el archivo
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  assert.match(await page.locator('main').innerText(), /Todavía no hay rutina\. Cuando la tengas, llega en tu archivo con "Actualizar plan"/);

  // Cuerpo: promedio por semana (la de antes es la del domingo 6) y la lista para borrar
  await page.locator('nav.tabs [data-tab="cuerpo"]').click();
  assert.equal(await page.getByTestId('pasos-meta').innerText(), 'Meta: 10.000 al día.');
  const filas = await page.getByTestId('tabla-pasos').locator('tbody tr').allInnerTexts();
  assert.deepEqual(
    filas.map((f) => f.split('\t').map((x) => x.trim())),
    [
      ['7 ene', '9.667', '3', '1 de 3'],
      ['31 dic', '6.500', '1', '0 de 1'],
    ],
  );
  await captura(page, '31-sin-rutina-cuerpo');
  await page.locator('summary', { hasText: 'Todos los días' }).click();
  await page.locator('.item', { hasText: '6.500 pasos' }).click();
  await page.getByRole('button', { name: 'Borrar' }).click();
  await page.locator('.item', { hasText: '6.500 pasos' }).waitFor({ state: 'detached' });

  const db = await leerDB(page);
  assert.deepEqual(db['reg.pasos'], [
    { fecha: '2030-01-07', pasos: 8200 },
    { fecha: '2030-01-08', pasos: 9800 },
    { fecha: '2030-01-09', pasos: 11000 },
  ]);
  // El día quedó guardado con su tipo, para que no cambie si más adelante llegan días de entreno
  assert.equal(db['reg.dias']['2030-01-09'].tipo, 'descanso');
  assert.equal(db.rutina, null);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('con días de entreno sigue la pregunta; la meta de pasos se edita en Metas y "Actualizar plan" no borra los pasos', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.getByText('¿Hoy entrenas?').waitFor();
  assert.equal(await page.getByTestId('btn-entrenar').count(), 1);
  assert.doesNotMatch(await page.getByTestId('btn-cerrar').getAttribute('class'), /doble/);
  // Nunca ha anotado pasos: no se le reclama el día de ayer
  assert.equal(await page.getByTestId('pasos-ayer').count(), 0);

  await anotarPasos(page, 'btn-pasos', '5.400');
  assert.equal(await page.getByTestId('pasos-texto').innerText(), 'Te faltan 600 para el mínimo y 2.600 para la meta.');
  await captura(page, '32-con-entreno-pasos');

  // Metas: con punto de miles; el mínimo no puede pasar la meta y, si algo está mal, no se guarda nada
  await page.locator('#btn-menu').click();
  await page.getByTestId('menu-metas').click();
  assert.equal(await page.getByTestId('meta-pasos-meta').inputValue(), '8000');
  assert.equal(await page.getByTestId('meta-pasos-minimo').inputValue(), '6000');
  await page.getByTestId('meta-entreno-kcal').fill('2222');
  await page.getByTestId('meta-pasos-meta').fill('12.000');
  await page.getByTestId('meta-pasos-minimo').fill('13000');
  await page.getByTestId('metas-guardar').click();
  await esperarAviso(page, 'El mínimo de pasos no puede pasar la meta');
  let db = await leerDB(page);
  assert.equal(db.metas.tipos.entreno.kcal, 2000);
  await page.getByTestId('meta-pasos-minimo').fill('7.000');
  await page.getByTestId('metas-guardar').click();
  await esperarAviso(page, 'Metas guardadas');
  db = await leerDB(page);
  assert.deepEqual(db.metas.pasos, { meta: 12000, minimo: 7000 });
  assert.equal(db.metas.tipos.entreno.kcal, 2222);

  // Actualizar plan: la meta vuelve a la del archivo y los pasos anotados quedan
  const plan = JSON.parse(readFileSync(ARRANQUE, 'utf8'));
  plan.registros = { pesos: [] };
  const ruta = path.join(DESCARGAS, 'plan-pasos.txt');
  writeFileSync(ruta, JSON.stringify(plan));
  await page.locator('#btn-menu').click();
  await importarArchivo(page, ruta, 'menu-importar');
  await page.getByTestId('modo-actualizar').click();
  await esperarAviso(page, 'Plan actualizado');
  db = await leerDB(page);
  assert.deepEqual(db.metas.pasos, { meta: 8000, minimo: 6000 });
  assert.deepEqual(db['reg.pasos'], [{ fecha: '2030-01-09', pasos: 5400 }]);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('archivo de arranque con errores: la app los dice antes de cargarlo, se copian para Claude y no se carga hasta decidir', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  const a = JSON.parse(readFileSync(SIN_RUTINA, 'utf8'));
  a.alimentos.find((x) => x.id === 'huevo').kcal = '72';
  a.platos[0].items.push({ alimentoId: 'pan-integral', cantidad: 1, unidad: 'und', estado: null });
  await page.getByTestId('pegar-inicio').click();
  await page.getByTestId('pegar-texto').fill(JSON.stringify(a));
  await page.getByTestId('pegar-importar').click();
  await page.getByTestId('hoja-problemas').waitFor();
  assert.deepEqual(await page.getByTestId('problemas').locator('li').allInnerTexts(), ['alimento "huevo": "kcal" debe ser un número.', 'plato "desayuno-normal": usa "pan-integral", que no está en los alimentos.']);
  await page.getByTestId('problemas-copiar').click();
  await esperarAviso(page, 'Pégaselo a Claude');
  const texto = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(texto, /^Al cargar mi archivo en la app salieron estos problemas\. Corrígelos y entrégame el archivo completo otra vez:\n- alimento "huevo"/);
  // No cargarlo todavía: la app sigue vacía
  await page.getByTestId('problemas-cancelar').click();
  await page.getByTestId('hoja-problemas').waitFor({ state: 'detached' });
  await page.getByTestId('bienvenida').waitFor();
  assert.equal((await leerDB(page)).metas, undefined);
  // Cargarlo igual: queda cargado
  await page.getByTestId('pegar-inicio').click();
  await page.getByTestId('pegar-texto').fill(JSON.stringify(a));
  await page.getByTestId('pegar-importar').click();
  await page.getByTestId('problemas-cargar').click();
  await esperarAviso(page, 'tus datos quedaron cargados');
  assert.equal((await leerDB(page)).metas.pasos.meta, 10000);
  await captura(page, '33-cargado-igual');
  assert.deepEqual(errores, []);
  await contexto.close();
});
