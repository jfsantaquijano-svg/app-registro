import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { iniciarServidor, abrirNavegador, nuevaPagina, importarArranque, importarArchivo, captura, esperarAviso, leerDB, DESCARGAS, ARRANQUE } from './ayuda.mjs';

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

async function exportar(page, nombre) {
  await page.locator('#btn-menu').click();
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByTestId('menu-exportar').click()]);
  assert.match(descarga.suggestedFilename(), /^copia-\d{4}-\d{2}-\d{2}\.txt$/);
  const ruta = path.join(DESCARGAS, nombre);
  await descarga.saveAs(ruta);
  return { ruta, datos: JSON.parse(readFileSync(ruta, 'utf8')), nombreArchivo: descarga.suggestedFilename() };
}

function sinMarcasDeTiempo(c) {
  const x = structuredClone(c);
  delete x.creado;
  delete x.registros.ultimaCopia;
  return x;
}

async function anotarPeso(page, kg) {
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  await page.getByTestId('btn-peso').click();
  await page.getByTestId('peso-kg').fill(String(kg));
  await page.getByTestId('peso-guardar').click();
  await esperarAviso(page, 'Promedio de la semana');
}

test('exportar e importar: restaurar deja los datos iguales y se puede deshacer', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.getByTestId('tipo-hoy-entreno').click();
  await page.getByTestId('btn-planear').click();
  await esperarAviso(page, 'Día planeado');
  await anotarPeso(page, 79.5);

  const a = await exportar(page, 'copia-a.txt');
  assert.equal(a.nombreArchivo, 'copia-2030-01-09.txt');
  assert.equal(a.datos.formato, 'app-registro');
  assert.equal(a.datos.version, 1);
  assert.equal(a.datos.tipo, 'copia');
  assert.ok(a.datos.registros.ultimaCopia);
  assert.equal(a.datos.registros.pesos.length, 8);
  assert.equal(a.datos.registros.dias['2030-01-09'].comidas.length, 6);
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  assert.match(await page.getByTestId('ultima-copia').innerText(), /hoy/);

  // Cambio algo después de la copia
  await anotarPeso(page, 70);

  // Restaurar copia completa
  await page.locator('#btn-menu').click();
  await importarArchivo(page, a.ruta, 'menu-importar');
  await page.getByTestId('hoja-modo').waitFor();
  await captura(page, '20-importar-modo');
  await page.getByTestId('modo-restaurar').click();
  await page.getByTestId('confirmar-si').click();
  await esperarAviso(page, 'Copia restaurada');
  const db = await leerDB(page);
  assert.equal(db['reg.pesos'].length, 8);
  assert.ok(!db['reg.pesos'].some((p) => p.kg === 70));
  assert.equal(db.respaldos?.length, 1);

  const b = await exportar(page, 'copia-b.txt');
  assert.deepEqual(sinMarcasDeTiempo(b.datos), sinMarcasDeTiempo(a.datos));

  // Deshacer la restauración: vuelve el pesaje de 70 (avisa que lo anotado después se pierde)
  await page.locator('#btn-menu').click();
  await page.getByTestId('menu-deshacer').click();
  await page.getByTestId('confirmar').getByText('Lo que anotaste después de esa restauración se pierde.', { exact: false }).waitFor();
  await page.getByTestId('confirmar-si').click();
  await esperarAviso(page, 'volviste a lo anterior');
  const db2 = await leerDB(page);
  assert.ok(db2['reg.pesos'].some((p) => p.kg === 70));
  assert.deepEqual(errores, []);
  await contexto.close();

  // En una app vacía la copia se carga sin preguntar y queda igual
  const otra = await nuevaPagina(nav, srv.url);
  await importarArchivo(otra.page, a.ruta);
  await esperarAviso(otra.page, 'tus datos quedaron cargados');
  const c = await exportar(otra.page, 'copia-c.txt');
  assert.deepEqual(sinMarcasDeTiempo(c.datos), sinMarcasDeTiempo(a.datos));
  assert.deepEqual(otra.errores, []);
  await otra.contexto.close();
});

test('actualizar plan: cambia metas y rutina, combina alimentos y no toca registros ni lo del usuario', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await anotarPeso(page, 79.4);
  // El usuario corrige un alimento del plan con su etiqueta
  await page.locator('#btn-menu').click();
  await page.getByTestId('menu-alimentos').click();
  await page.getByTestId('buscar-alimentos').fill('quinua');
  await page.locator('.item', { hasText: 'Quinua' }).first().click();
  await page.getByTestId('hoja-editar-alimento').getByLabel('kcal').fill('360');
  await page.getByTestId('hoja-editar-alimento').getByRole('button', { name: 'Guardar' }).click();
  await page.getByTestId('hoja-editar-alimento').waitFor({ state: 'detached' });
  // Un alimento creado por el usuario
  await page.getByRole('button', { name: '+ Agregar alimento' }).click();
  await page.getByTestId('p-nombre').fill('Mi alimento');
  await page.getByTestId('p-modo-100g').click();
  await page.getByTestId('p-kcal').fill('100');
  await page.getByTestId('p-p').fill('10');
  await page.getByTestId('p-g').fill('1');
  await page.getByTestId('p-c').fill('12');
  await page.getByTestId('p-guardar').click();
  await esperarAviso(page, 'Producto guardado');

  const plan = JSON.parse(readFileSync(ARRANQUE, 'utf8'));
  plan.metas.tipos.entreno.kcal = 2100;
  plan.rutina.nombre = 'Rutina de ejemplo 2';
  plan.alimentos.find((x) => x.id === 'mandarina').kcal = 55;
  plan.alimentos.find((x) => x.id === 'quinua').kcal = 300;
  plan.alimentos.push({ ...plan.alimentos[0], id: 'nuevo-del-plan', nombre: 'Nuevo del plan' });
  plan.registros = { pesos: [] };
  const ruta = path.join(DESCARGAS, 'plan-nuevo.txt');
  writeFileSync(ruta, JSON.stringify(plan));

  await page.locator('#btn-menu').click();
  await importarArchivo(page, ruta, 'menu-importar');
  await page.getByTestId('modo-actualizar').click();
  await esperarAviso(page, 'Plan actualizado');
  const db = await leerDB(page);
  assert.equal(db.metas.tipos.entreno.kcal, 2100);
  assert.equal(db.rutina.nombre, 'Rutina de ejemplo 2');
  assert.equal(db.alimentos.find((x) => x.id === 'mandarina').kcal, 55);
  // Lo que el usuario corrigió no se pisa
  assert.equal(db.alimentos.find((x) => x.id === 'quinua').kcal, 360);
  assert.equal(db.alimentos.find((x) => x.id === 'quinua').editado, true);
  assert.ok(db.alimentos.some((x) => x.id === 'nuevo-del-plan'));
  assert.ok(db.alimentos.some((x) => x.nombre === 'Mi alimento' && x.origen === 'usuario'));
  assert.equal(db['reg.pesos'].length, 8);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('funciona sin conexión después de la primera carga', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url, { ahora: null });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await importarArranque(page);
  await contexto.setOffline(true);
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  await page.getByTestId('btn-comida').waitFor();
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  await page.getByTestId('sesion-sigue').waitFor();
  await page.locator('nav.tabs [data-tab="cuerpo"]').click();
  await page.getByTestId('grafica-peso').waitFor();
  // Un registro sin internet
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  await page.getByTestId('btn-peso').click();
  await page.getByTestId('peso-kg').fill('79.1');
  await page.getByTestId('peso-guardar').click();
  await esperarAviso(page, /Guardado|Promedio/);
  await captura(page, '21-sin-conexion');
  await contexto.setOffline(false);
  assert.deepEqual(
    errores.filter((e) => !/net::ERR_INTERNET_DISCONNECTED/.test(e)),
    [],
  );
  await contexto.close();
});

test('menú, metas, rutina, calendario y bioimpedancias', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.locator('#btn-menu').click();
  await page.getByTestId('hoja-menu').waitFor();
  await captura(page, '22-menu');
  await page.getByTestId('menu-metas').click();
  await page.getByTestId('meta-entreno-kcal').fill('2050');
  // Un tipo de día apagado en el archivo se puede activar
  assert.equal(await page.getByTestId('meta-pausa-activo').isChecked(), false);
  await page.getByTestId('meta-pausa-activo').check();
  await page.getByTestId('metas-guardar').click();
  await esperarAviso(page, 'Metas guardadas');
  const m = (await leerDB(page)).metas;
  assert.equal(m.tipos.entreno.kcal, 2050);
  assert.equal(m.tipos.pausa.activo, true);
  await page.locator('#btn-menu').click();
  await page.getByTestId('menu-rutina').click();
  await page.getByText('Rutina de ejemplo').first().waitFor();
  await page.getByText('Si pasa de 75 min 2 veces: Se quita el press militar.').waitFor();
  await page.getByText('3 × 6–9 por pierna · quedar a 1 · 16 kg').first().waitFor();
  // La rutina completa trae todo lo que hay que poder leer antes de entrenar
  await page.getByText('Donde hay 5 series haces 3').first().waitFor();
  await page.getByText('Si la primera no llega a 5: 70 kg.').first().waitFor();
  await page.getByText('3 series desde la semana 2 si la zona B viene bien (ejemplo).').first().waitFor();
  await page.getByText('La tercera serie va sola (ejemplo).').first().waitFor();
  await page.getByText('Cuerpo completo 1 · ~50 min (~55 desde la semana 2)').first().waitFor();
  // Los descansos en minutos y segundos, no en segundos sueltos
  await page.getByText('3. descanso 1:20').first().waitFor();
  await page.locator('#btn-menu').click();
  await page.getByTestId('menu-calendario').click();
  const enlaces = page.getByTestId('enlace-calendario');
  assert.ok((await enlaces.count()) >= 3);
  const href = await enlaces.first().getAttribute('href');
  assert.match(href, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  await captura(page, '23-calendario');
  await page.locator('.hoja').last().getByRole('button', { name: 'Cerrar' }).click();

  // Bioimpedancias y comparación
  await page.locator('nav.tabs [data-tab="cuerpo"]').click();
  for (const [fecha, pct] of [
    ['2030-01-02', '25'],
    ['2030-01-09', '24'],
  ]) {
    await page.getByTestId('bio-abrir').click();
    await page.getByTestId('hoja-bio').locator('input[type="date"]').fill(fecha);
    await page.getByTestId('bio-grasaPct').fill(pct);
    await page.getByTestId('bio-pesoMaquina').fill('80');
    await page.getByTestId('bio-guardar').click();
    await page.getByTestId('hoja-bio').waitFor({ state: 'detached' });
  }
  await page.getByTestId('bio-comparar').click();
  assert.match(await page.getByTestId('tabla-bio').innerText(), /Grasa \(%\)\s+25\s+24\s+-1/);
  await page.locator('.hoja').last().getByRole('button', { name: 'Cerrar' }).click();
  // Cinta y fotos
  await page.getByTestId('cinta-abrir').click();
  await page.getByTestId('cinta-cintura').fill('85');
  await page.getByTestId('cinta-brazoDFuerza').fill('36');
  await page.getByTestId('cinta-guardar').click();
  await page.getByTestId('grafica-cinta').waitFor();
  await page.getByTestId('pose-frente').check();
  await page.getByTestId('pose-perfil').check();
  await page.getByTestId('fotos-guardar').click();
  await page.getByText('Últimas: mié 9 ene (2 de 4 poses)').waitFor();
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('restaurar dos veces seguidas: "Deshacer" vuelve a los datos de antes de la primera', async () => {
  const copiaCon = (kg, nombre) => {
    const c = JSON.parse(readFileSync(ARRANQUE, 'utf8'));
    c.tipo = 'copia';
    c.registros.pesos.push({ fecha: '2030-01-08', kg, tipo: 'casa', nota: 'marca' });
    const ruta = path.join(DESCARGAS, nombre);
    writeFileSync(ruta, JSON.stringify(c));
    return ruta;
  };
  const a = copiaCon(60, 'copia-uno.txt');
  const b = copiaCon(61, 'copia-dos.txt');
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArchivo(page, a);
  await esperarAviso(page, 'tus datos quedaron cargados');
  for (let i = 0; i < 2; i++) {
    await page.locator('#btn-menu').click();
    await importarArchivo(page, b, 'menu-importar');
    await page.getByTestId('modo-restaurar').click();
    await page.getByTestId('confirmar-si').click();
    await esperarAviso(page, 'Copia restaurada');
  }
  assert.equal((await leerDB(page)).respaldos.length, 1);
  await page.locator('#btn-menu').click();
  await page.getByTestId('menu-deshacer').click();
  await page.getByTestId('confirmar-si').click();
  await esperarAviso(page, 'volviste a lo anterior');
  const db = await leerDB(page);
  assert.ok(db['reg.pesos'].some((p) => p.kg === 60));
  assert.ok(!db['reg.pesos'].some((p) => p.kg === 61));
  // Ya no queda nada para deshacer: la opción sale del menú
  await page.locator('#btn-menu').click();
  await page.getByTestId('hoja-menu').waitFor();
  assert.equal(await page.getByTestId('menu-deshacer').count(), 0);
  assert.deepEqual(errores, []);
  await contexto.close();
});
