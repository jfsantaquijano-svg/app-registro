import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidor, abrirNavegador, nuevaPagina, importarArranque, captura, esperarAviso, leerDB } from './ayuda.mjs';

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

/** ¿El elemento se ve completo en la pantalla (sin bajar)? */
async function aLaVista(page, loc) {
  const caja = await loc.boundingBox();
  const alto = page.viewportSize().height;
  return !!caja && caja.y >= 0 && caja.y + caja.height <= alto;
}

test('importar el arranque de prueba: la app queda cargada y los botones de Hoy se ven sin bajar', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await page.getByTestId('bienvenida').waitFor();
  await captura(page, '00-bienvenida');
  await importarArranque(page);
  await esperarAviso(page, 'tus datos quedaron cargados');
  await page.getByText('¿Hoy entrenas?').waitFor();
  assert.match(await page.getByTestId('btn-entrenar').innerText(), /^Entrenar\s+Cuerpo completo 1$/);
  // Antes de contestar "¿Hoy entrenas?" la app no decide el tipo de día por él
  assert.match(await page.getByTestId('meta-tit').innerText(), /Elige el tipo de día/);
  // Los tipos que el archivo deja apagados no salen en "¿Hoy entrenas?"
  assert.equal(await page.getByTestId('tipo-hoy-pausa').count(), 0);
  assert.equal(await page.getByTestId('tipo-hoy-viaje').count(), 1);
  // Miércoles: no es día de pesarse según el archivo (martes, jueves y sábado)
  assert.doesNotMatch(await page.getByTestId('btn-peso').getAttribute('class'), /btn-resaltado/);
  assert.match(await page.getByTestId('ultima-copia').innerText(), /nunca/);
  for (const id of ['btn-peso', 'btn-planear', 'btn-entrenar', 'btn-cerrar']) assert.ok(await aLaVista(page, page.getByTestId(id)), `${id} no se ve sin bajar`);
  const db = await leerDB(page);
  assert.equal(db.alimentos.length, 16);
  assert.equal(db.platos.length, 5);
  assert.equal(db.rutina.sesiones.length, 3);
  assert.equal(db['reg.pesos'].length, 7);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('un día de comida: planear, confirmar y deshacer, reemplazar lo planeado, restaurante, plato incompleto, cerrar el día, peso y copiar para Claude', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);

  // ¿Hoy entrenas? → sí
  await page.getByTestId('tipo-hoy-entreno').click();
  await page.getByTestId('tipo-actual').waitFor();
  assert.equal(await page.getByTestId('tipo-actual').innerText(), 'Entreno');
  await captura(page, '01-hoy');

  // Planear el día: lo planeado se ve aparte y no suma; sin grasa que se ve no hay aviso de "no cabe"
  await page.getByTestId('btn-planear').click();
  await esperarAviso(page, 'Día planeado');
  assert.equal(await page.getByTestId('valor-kcal').innerText(), '20'); // solo el suplemento diario
  assert.match(await page.getByTestId('barra-kcal').innerText(), /planeado/);
  assert.match(await page.getByTestId('hoy-confirmar-desayuno').innerText(), /Desayuno · 426 kcal · 33\.9 P/);
  assert.doesNotMatch(await page.locator('#vista').innerText(), /no cabe/);

  // Confirmar desde Hoy y deshacer
  await page.getByTestId('hoy-confirmar-desayuno').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="valor-kcal"]')?.textContent === '446');
  await page.getByTestId('deshacer-confirmar').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="valor-kcal"]')?.textContent === '20');
  await page.getByTestId('hoy-confirmar-desayuno').waitFor();

  await page.locator('nav.tabs [data-tab="comida"]').click();
  await page.getByTestId('lista-desayuno').waitFor();
  assert.equal(await page.locator('.item.planeado').count(), 6);
  await captura(page, '02-comida-planeada');

  // Confirmar el desayuno con un toque
  await page.getByTestId('confirmar-todo-desayuno').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="valor-kcal"]')?.textContent === '446');
  assert.equal(await page.locator('.item.planeado').count(), 3);

  // Alimento pesado ya cocido: la app lo convierte a crudo, con el género del alimento
  await page.getByTestId('agregar-almuerzo').click();
  await page.getByTestId('buscar').fill('muslo pavo');
  await page.getByTestId('alimento-muslo-pavo').click();
  // Sin foco automático: el teclado no tapa el botón
  assert.notEqual(await page.evaluate(() => document.activeElement?.dataset?.testid), 'cantidad');
  await page.getByTestId('cantidad').fill('150');
  await page.getByTestId('cantidad').press('Tab');
  await page.getByTestId('estado-cocido').click();
  assert.equal(await page.getByTestId('estado-cocido').innerText(), 'Ya cocido');
  assert.match(await page.getByTestId('conversion').innerText(), /150 g ya cocido = 200 g crudo/);
  assert.match(await page.getByTestId('preview').innerText(), /279/);
  await captura(page, '03-cantidad-cocido');
  await page.getByTestId('guardar-item').click();
  // Lo planeado del almuerzo: ¿lo reemplaza? Sí
  await page.getByTestId('confirmar').getByText('¿Esto reemplaza lo planeado de almuerzo?').waitFor();
  await page.getByTestId('confirmar-si').click();
  await page.waitForFunction(() => document.querySelectorAll('.item.planeado').length === 0);
  await page.getByText('150 g ya cocido = 200 g crudo').first().waitFor();

  // Restaurante con recargo: el extra va como grasa visible; el desglose está plegado y el botón se ve
  await page.getByTestId('agregar-almuerzo').click();
  await page.getByTestId('buscar').fill('bowl pavo');
  await page.getByTestId('alimento-bowl-restaurante').click();
  assert.match(await page.getByTestId('recargo-resumen').innerText(), /De restaurante: Plancha o parrilla \+15% · Cambiar/);
  assert.equal(await page.getByTestId('recargo-detalle').getAttribute('open'), null);
  assert.match(await page.getByTestId('que-trae').innerText(), /Qué trae \(3\)/);
  await page.getByTestId('que-trae').locator('summary').click();
  await page.getByText('Pavo a la plancha').waitFor();
  assert.match(await page.getByTestId('preview').innerText(), /575/);
  assert.ok(await aLaVista(page, page.getByTestId('guardar-item')), 'el botón Agregar debe verse sin bajar');
  // En unidades, el − baja de media en media
  await page.getByTestId('cantidad-menos').click();
  assert.equal(await page.getByTestId('cantidad').inputValue(), '0.5');
  await page.getByTestId('cantidad-mas').click();
  assert.equal(await page.getByTestId('cantidad').inputValue(), '1');
  await page.getByTestId('guardar-item').click();
  await esperarAviso(page, 'Agregado: Bowl de pavo');
  assert.match(await page.getByTestId('grasas').innerText(), /10\.3 g\s*grasa que se ve/);
  await page.getByText('+15%').first().waitFor();

  // Plato incompleto: primero pide el dato que falta
  await page.getByTestId('agregar-cena').click();
  // Los platos se buscan por palabras en cualquier orden
  await page.getByTestId('buscar').fill('incompleto plato');
  await page.getByTestId('plato-plato-incompleto').click();
  await page.getByText('Incompleto: Falta un dato de prueba.').waitFor();
  await page.getByTestId('agregar-plato').click();
  await page.getByTestId('hoja-incompleto-completar').click();
  await page.getByTestId('hoja-agregar').getByText('Falta: Falta un dato de prueba.').waitFor();
  assert.equal(await page.getByTestId('buscar').inputValue(), 'nueces');
  await page.getByTestId('alimento-nueces').click();
  await page.getByTestId('cantidad').fill('10');
  await page.getByTestId('guardar-item').click();
  await esperarAviso(page, 'Agregado: Nueces');
  let db = await leerDB(page);
  const cena = db['reg.dias']['2030-01-09'].comidas.filter((c) => c.momento === 'cena');
  assert.deepEqual(cena.map((c) => c.alimentoId).sort(), ['muslo-pavo', 'nueces', 'yuca']);
  assert.ok(cena.filter((c) => c.platoId === 'plato-incompleto').every((c) => c.estimado === false));
  // Para el cierre, quito la cena (la propuesta la arma la app)
  for (const id of cena.map((c) => c.id)) {
    await page.getByTestId(`comida-${id}`).click();
    await page.getByTestId('borrar-item').click();
    await page.getByTestId('confirmar-si').click();
    await page.getByTestId(`comida-${id}`).waitFor({ state: 'detached' });
  }

  // Cerrar el día con una propuesta de lo que hay en casa
  await page.getByTestId('cerrar-dia').click();
  await page.getByTestId('hoja-cerrar').waitFor();
  assert.match(await page.getByTestId('regla-oro').innerText(), /Regla de oro/);
  const filas = await page.getByTestId('propuesta').locator('li').count();
  assert.ok(filas >= 1);
  const tabla = await page.getByTestId('tabla-final').innerText();
  assert.match(tabla, /Proteína/);
  assert.match(tabla, /Calorías\s+[\d.]+\s+2\.000\s+✅/);
  await captura(page, '04-cerrar-dia');
  // "Otra" cambia el primer alimento
  const primero = await page.getByTestId('propuesta').locator('li').first().locator('.item-tit').innerText();
  await page.getByTestId('propuesta').locator('li').first().getByRole('button', { name: 'Otra' }).click();
  const nuevo = await page.getByTestId('propuesta').locator('li').first().locator('.item-tit').innerText();
  assert.notEqual(nuevo, primero);
  await page.getByTestId('usar-propuesta').click();
  await esperarAviso(page, 'Día cerrado');
  await page.getByText('día cerrado').first().waitFor();
  db = await leerDB(page);
  const dia = db['reg.dias']['2030-01-09'];
  assert.equal(dia.tipo, 'entreno');
  assert.equal(dia.resumen.cerrado, true);
  const p = dia.comidas.reduce((a, c) => a + c.p, 0);
  assert.ok(p >= 140 && p <= 160, `proteína ${p}`);
  const restaurante = dia.comidas.find((c) => c.alimentoId === 'bowl-restaurante');
  assert.equal(restaurante.recargo, 'plancha');
  assert.equal(restaurante.gVisible, 8.3);
  const cocido = dia.comidas.find((c) => c.alimentoId === 'muslo-pavo' && c.estado === 'cocido' && c.momento === 'almuerzo');
  assert.equal(cocido.cantidad, 150);
  assert.equal(cocido.kcal, 279.3);

  // Peso y promedio de la semana
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  await page.getByTestId('btn-peso').click();
  assert.notEqual(await page.evaluate(() => document.activeElement?.dataset?.testid), 'peso-kg');
  await page.getByTestId('peso-kg').fill('67.3');
  await page.getByTestId('peso-guardar').click();
  await esperarAviso(page, 'Promedio de la semana: 67.35 kg (2 pesajes)');
  await page.waitForFunction(() => /67\.35 kg \(2 pesajes\)/.test(document.querySelector('[data-testid="peso-promedio"]')?.textContent || ''));
  assert.match(await page.getByTestId('peso-cambio').innerText(), /−0\.28 contra la semana anterior \(67\.63\)/);

  // Copiar para Claude
  await page.getByTestId('copiar-claude').click();
  await esperarAviso(page, 'Copiado');
  const texto = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(texto, /Semana del 7 ene al 13 ene/);
  assert.match(texto, /Peso promedio: 67\.35 kg \(2 pesajes\)/);
  assert.match(texto, /mié 9 ene · Entreno/);
  await captura(page, '05-hoy-con-datos');

  // La semana anterior también se puede ver y copiar
  await page.getByTestId('semana-anterior').click();
  assert.match(await page.getByTestId('semana-titulo').innerText(), /Semana del 31 dic al 6 ene/);
  await page.getByTestId('copiar-claude').click();
  await esperarAviso(page, 'Copiado');
  const anterior = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(anterior, /Semana del 31 dic al 6 ene/);
  assert.match(anterior, /dom 6 ene · Entreno · 2\.010 kcal/);
  await page.getByTestId('semana-siguiente').click();

  // Cuerpo: gráfica de peso con promedio semanal y cambio con signo
  await page.locator('nav.tabs [data-tab="cuerpo"]').click();
  await page.getByTestId('grafica-peso').waitFor();
  assert.match(await page.getByTestId('tabla-semanas').innerText(), /67\.35\s+2\s+−0\.28/);
  await captura(page, '06-cuerpo');
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('el botón flotante se esconde sobre los botones de abajo y la comida de madrugada va al día anterior', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url, { ahora: new Date('2030-01-10T01:30:00') });
  await importarArranque(page);
  await page.getByTestId('tipo-hoy-descanso').click();
  await page.getByTestId('tipo-actual').waitFor();
  // Lleva "Copiar para Claude" a la franja de abajo, donde está el botón flotante
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="copiar-claude"]');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (window.innerHeight - 140));
  });
  await page.waitForFunction(() => document.getElementById('fab').classList.contains('fab-oculto'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => !document.getElementById('fab').classList.contains('fab-oculto'));
  await page.getByTestId('btn-comida').click();
  assert.match(await page.getByTestId('hoja-agregar').locator('h2').innerText(), /Agregar comida: mié 9 ene/);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('producto nuevo desde la etiqueta (porción), "dato estimado" desmarcable y editar/borrar un registro', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.getByTestId('btn-comida').click();
  await page.getByTestId('producto-nuevo').click();
  await page.getByTestId('p-nombre').fill('Galletas de prueba');
  await page.getByTestId('p-marca').fill('Marca X');
  await page.getByTestId('p-porcion').fill('25');
  await page.getByTestId('p-kcal').fill('100');
  await page.getByTestId('p-p').fill('2');
  await page.getByTestId('p-g').fill('4');
  await page.getByTestId('p-c').fill('15');
  await page.getByTestId('p-cat-snack').click();
  await captura(page, '07-producto-nuevo');
  await page.getByTestId('p-guardar').click();
  await esperarAviso(page, 'Producto guardado');
  // Ya abre la cantidad: 1 porción = 25 g
  await page.getByTestId('unidad-und').click();
  await page.getByTestId('cantidad').fill('2');
  await page.getByTestId('cantidad').press('Tab');
  assert.match(await page.getByTestId('preview').innerText(), /200/);
  await page.getByTestId('guardar-item').click();
  await esperarAviso(page, 'Agregado: Galletas de prueba');
  const db = await leerDB(page);
  const nuevo = db.alimentos.find((a) => a.nombre === 'Galletas de prueba');
  assert.equal(nuevo.origen, 'usuario');
  assert.equal(nuevo.kcal, 400); // por 100 g
  assert.equal(nuevo.gramosUnidad, 25);
  // Un alimento estimado se puede registrar como pesado (sin "con estimados")
  await page.getByTestId('btn-comida').click();
  await page.getByTestId('buscar').fill('bowl');
  await page.getByTestId('alimento-bowl-restaurante').click();
  assert.equal(await page.getByTestId('estimado').isChecked(), true);
  await page.getByTestId('estimado').uncheck();
  await page.getByTestId('guardar-item').click();
  await esperarAviso(page, 'Agregado: Bowl');
  const db2 = await leerDB(page);
  assert.equal(db2['reg.dias']['2030-01-09'].comidas.find((c) => c.alimentoId === 'bowl-restaurante').estimado, false);
  // Editar y borrar
  await page.locator('nav.tabs [data-tab="comida"]').click();
  await page.locator('.item', { hasText: 'Galletas de prueba' }).first().click();
  await page.getByTestId('borrar-item').click();
  await page.getByTestId('confirmar-si').click();
  await page.waitForFunction(() => !document.body.textContent.includes('Galletas de prueba'));
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('cambiar lo planeado ofrece los pedidos de restaurante', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.getByTestId('tipo-hoy-entreno').click();
  await page.getByTestId('btn-planear').click();
  await esperarAviso(page, 'Día planeado');
  await page.locator('nav.tabs [data-tab="comida"]').click();
  await page.getByTestId('lista-almuerzo').getByRole('button', { name: 'Cambiar' }).click();
  await page.locator('.hoja').last().getByText('Pedido de prueba').click();
  await page.waitForFunction(() => /Pedido de prueba/.test(document.querySelector('[data-testid="lista-almuerzo"]')?.textContent || ''));
  const db = await leerDB(page);
  const alm = db['reg.dias']['2030-01-09'].comidas.filter((c) => c.momento === 'almuerzo');
  assert.deepEqual(alm.map((c) => c.platoId), ['pedido-prueba']);
  assert.equal(alm[0].planeado, true);
  assert.equal(alm[0].estimado, true);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('cambiar lo planeado por un plato incompleto pide el dato, y la búsqueda no se contradice cuando hay platos', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.getByTestId('tipo-hoy-entreno').click();
  await page.getByTestId('btn-planear').click();
  await esperarAviso(page, 'Día planeado');
  await page.locator('nav.tabs [data-tab="comida"]').click();

  // Los pedidos con totales fijos también se pueden cambiar (antes no tenían "Cambiar")
  await page.getByTestId('lista-almuerzo').getByRole('button', { name: 'Cambiar' }).click();
  await page.locator('.hoja').last().locator('.item', { hasText: 'Pedido de prueba' }).click();
  await page.waitForFunction(() => /Pedido de prueba/.test(document.querySelector('[data-testid="lista-almuerzo"]')?.textContent || ''));
  assert.equal(await page.getByTestId('lista-almuerzo').getByRole('button', { name: 'Cambiar' }).count(), 1);

  // La lista de "Cambiar" marca los platos incompletos
  await page.getByTestId('lista-almuerzo').getByRole('button', { name: 'Cambiar' }).click();
  const hj = page.locator('.hoja').last();
  const fila = hj.locator('.item', { hasText: 'Almuerzo incompleto de prueba' });
  await fila.waitFor();
  assert.match(await fila.innerText(), /incompleto/);
  await fila.click();

  // Pide el dato que falta antes de sumarlo; si lo suma sin el dato, queda "con estimados"
  await page.getByTestId('hoja-incompleto').waitFor();
  assert.match(await page.getByTestId('hoja-incompleto').innerText(), /Falta otro dato de prueba/);
  await page.getByTestId('hoja-incompleto-sin').click();
  await page.waitForFunction(() => /Almuerzo incompleto de prueba/.test(document.querySelector('[data-testid="lista-almuerzo"]')?.textContent || ''));
  const db = await leerDB(page);
  const alm = db['reg.dias']['2030-01-09'].comidas.filter((c) => c.momento === 'almuerzo');
  assert.ok(alm.length > 0);
  assert.ok(
    alm.every((c) => c.estimado === true),
    'las comidas del plato incompleto quedan estimadas',
  );
  // Al confirmarlo, el día queda marcado "con estimados"
  await page.getByTestId('confirmar-todo-almuerzo').click();
  await esperarAviso(page, 'Confirmado');
  await page.getByTestId('meta-tit').getByText('con estimados').waitFor();

  // Buscar algo que solo existe como plato: no dice "No encontré"
  await page.getByTestId('agregar-cena').click();
  await page.getByTestId('buscar').fill('incompleto');
  await page.getByTestId('sin-alimentos').waitFor();
  assert.equal(await page.getByTestId('resultados').getByText(/No encontré/).count(), 0);
  assert.equal(await page.getByTestId('resultados').getByText('Buscar en FatSecret').count(), 0);
  await page.getByTestId('buscar').fill('zzz');
  await page.getByTestId('resultados').getByText('Buscar en FatSecret').waitFor();
  assert.deepEqual(errores, []);
  await contexto.close();
});
