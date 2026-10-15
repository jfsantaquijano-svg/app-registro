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

async function titulo(page) {
  return (await page.getByTestId('titulo-serie').innerText()).trim();
}

/** Registra la serie que muestra el panel y espera a que avance. */
async function serie(page, { kg, reps, rir, esperar = true } = {}) {
  const antes = await titulo(page);
  if (kg != null) await page.getByTestId('kg').fill(String(kg));
  if (reps != null) await page.getByTestId('reps').fill(String(reps));
  if (rir != null) await page.getByTestId(`rir-${rir}`).click();
  await page.getByTestId('guardar-serie').click();
  if (esperar) {
    await page.waitForFunction(
      (t) => {
        const el = document.querySelector('[data-testid="titulo-serie"]');
        return !el || el.textContent.trim() !== t || document.querySelector('.hoja');
      },
      antes,
    );
  }
}

async function preguntas(page, valores, { recorrido, alarma } = {}) {
  await page.getByTestId('hoja-post').waitFor();
  for (const [id, v] of Object.entries(valores)) await page.getByTestId(`dolor-ej-${id}-${v}`).click();
  if (recorrido) await page.getByTestId(`recorrido-${recorrido[0]}-${recorrido[1]}`).click();
  if (alarma) {
    await page.getByTestId('hoja-post').getByText('Alarmas').click();
    await page.getByTestId(alarma).check();
  }
  await page.getByTestId('guardar-post').click();
  await page.getByTestId('hoja-post').waitFor({ state: 'detached' });
}

/** El nombre del ejercicio que sigue no queda tapado por lo fijo de arriba (cabecera, barra y cronómetro). */
async function nombreVisible(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.registro-serie');
    const ej = panel?.closest('.ej');
    const nombre = ej?.querySelector('.ej-nombre');
    if (!nombre) return false;
    const fijo = ['.cab', '.sesion-barra', '#timer-caja'].reduce((t, s) => t + (document.querySelector(s)?.offsetHeight || 0), 0);
    const r = nombre.getBoundingClientRect();
    return r.top >= fijo - 2 && r.bottom <= window.innerHeight;
  });
}

test('sesión completa: superserie con ⚡ y bajada, primer lado del archivo, ajuste desde el peso de partida, saltar y volver, alarmas y peso de la próxima vez', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  assert.equal(await page.getByTestId('sesion-sigue').innerText(), 'Cuerpo completo 1');
  assert.match(await page.getByTestId('semana-bloque').innerText(), /Semana 1 del bloque \(de 5\)/);
  // El plan muestra notas, calentamiento y la regla de recorte del archivo
  assert.equal(await page.getByTestId('nota-plan-s1-stepup').innerText(), 'Paso largo y controlado.');
  assert.match(await page.getByTestId('plan-calentamiento').innerText(), /Calentamiento \(2\)/);
  assert.equal(await page.getByTestId('plan-recorte').innerText(), 'Si esta sesión pasa de 75 min 2 veces: Se quita el press militar.');
  assert.match(await page.getByTestId('plan-s1-stepup').innerText(), /3 × 6–9 por pierna · quedar a 1 · 16 kg/);
  assert.match(await page.getByTestId('btn-revision').innerText(), /Semana 4 contra 1/);
  await captura(page, '10-entreno');

  // Empezar: dolor de ahora y gimnasio
  await page.getByTestId('empezar').click();
  await page.getByTestId('hoja-empezar').waitFor();
  assert.equal(await page.getByTestId('gimnasio-Gimnasio Norte').getAttribute('aria-pressed'), 'true');
  await page.getByTestId('empezar-ya').click();
  await esperarAviso(page, 'Marca el dolor');
  await page.getByTestId('dolor-antes-zona1-2').click();
  await page.getByTestId('empezar-ya').click();
  await page.getByTestId('reloj-sesion').waitFor();
  await page.getByTestId('calent-0').check();

  // Primer bloque: superserie A → 15 s → B → descanso; las dos con ⚡ en la última
  assert.equal(await titulo(page), 'Elevación de talones sentado: serie 1 de 3');
  assert.equal(await page.getByTestId('kg').inputValue(), '30');
  await captura(page, '11-serie');
  await serie(page, { reps: 18, rir: 2 });
  assert.match(await page.locator('#timer-txt').innerText(), /Pasa a Encogimientos en polea/);
  assert.match(await page.getByTestId('timer').innerText(), /^0:1[45]$/);
  assert.match(await titulo(page), /Encogimientos en polea: serie 1 de 3/);
  await serie(page, { reps: 16, rir: 2 });
  assert.match(await page.locator('#timer-txt').innerText(), /Descanso\.\s+Sigue: Elevación de talones sentado\./);
  await serie(page, { reps: 18 });
  await serie(page, { reps: 16 });
  // El cronómetro usa la hora real: al pasar el tiempo dice "terminado hace"
  await page.clock.fastForward(50000);
  await page.waitForFunction(() => /terminado hace/.test(document.getElementById('timer-txt')?.textContent || ''));
  await captura(page, '12-descanso-terminado');
  assert.match(await titulo(page), /Elevación de talones sentado: serie 3 de 3 ⚡ al fallo/);
  await page.getByTestId('reps').fill('20');
  await page.getByTestId('mas-bajada').click();
  // La bajada propone un peso real de esa máquina (aprendido también del bloque anterior)
  assert.equal(await page.getByTestId('tramo-kg-0').inputValue(), '27.5');
  await page.getByTestId('tramo-reps-0').fill('8');
  await page.getByTestId('tramo-reps-0').press('Tab');
  await page.getByTestId('mas-bajada').click();
  await page.getByTestId('tramo-norecuerdo-1').check();
  assert.equal(await page.getByTestId('tecnica-bajada').getAttribute('aria-pressed'), 'true');
  await captura(page, '13-bajada');
  await serie(page);
  assert.match(await titulo(page), /Encogimientos en polea: serie 3 de 3 ⚡ al fallo/);
  await page.getByTestId('reps').fill('18');
  await page.getByTestId('tecnica-pausa').click();
  await serie(page);
  await preguntas(page, { 's1-talones': 0, 's1-encogimientos': 0 });

  // Segundo bloque: a un lado, primero el lado que dice el archivo (derecho) y el otro copia peso y repeticiones
  assert.equal(await titulo(page), 'Subida al cajón con mancuerna: serie 1 de 3 · Derecha');
  assert.ok(await nombreVisible(page), 'el nombre del ejercicio queda tapado');
  await page.getByText('Texto de ejemplo para los ejercicios a un lado.').waitFor();
  assert.equal(await page.getByTestId('kg').inputValue(), '16');
  assert.equal(await page.getByTestId('guardar-serie').innerText(), 'Guardar derecha');
  await serie(page, { reps: 9, rir: 1 });
  assert.equal(await titulo(page), 'Subida al cajón con mancuerna: serie 1 de 3 · Izquierda');
  assert.equal(await page.getByTestId('reps').inputValue(), '9');
  await serie(page);
  assert.match(await page.locator('#timer-txt').innerText(), /Descanso\.\s+Sigue: Subida al cajón con mancuerna \(derecha\)/);
  for (let i = 0; i < 4; i++) await serie(page);
  // Recorridos: solo los del archivo
  await page.getByTestId('hoja-post').waitFor();
  assert.deepEqual(await page.getByTestId('recorrido-s1-stepup').locator('button').allInnerTexts(), ['100°', '80°']);
  await preguntas(page, { 's1-stepup': 2 }, { recorrido: ['s1-stepup', 100] });
  // Al cerrar un bloque arranca el descanso que dice el archivo
  assert.match(await page.locator('#timer-txt').innerText(), /Bloque terminado: máximo 1:30/);

  // Tercer bloque: la primera no llega al mínimo con el peso de partida → la siguiente con 70 (ajuste del archivo)
  assert.match(await titulo(page), /Peso muerto con barra hexagonal: serie 1 de 3/);
  assert.ok(await nombreVisible(page), 'el nombre del ejercicio queda tapado después de las preguntas');
  assert.equal(await page.getByTestId('kg').inputValue(), '80');
  await serie(page, { reps: 4, rir: 1 });
  assert.match(await page.getByTestId('ajuste').innerText(), /La primera no llegó al mínimo: la siguiente con 70 kg/);
  assert.equal(await page.getByTestId('kg').inputValue(), '70');
  // La segunda serie no vuelve a ajustar aunque sobren
  await serie(page, { reps: 7, rir: 4 });
  assert.equal(await page.getByTestId('kg').inputValue(), '70');
  await serie(page, { reps: 7, rir: 2 });
  await preguntas(page, { 's1-hexagonal': 1 });

  // Cuarto bloque: máquina ocupada → "Saltar y volver"
  assert.match(await titulo(page), /Curl de bíceps con barra/);
  await page.getByTestId('saltar').click();
  await page.waitForFunction(() => /Press militar/.test(document.querySelector('[data-testid="titulo-serie"]')?.textContent || ''));

  // Quinto bloque: press ⚡ con pausa y una alarma marcada
  assert.match(await titulo(page), /Press militar con mancuernas: serie 1 de 3/);
  await serie(page, { reps: 14, rir: 1 });
  await serie(page, { reps: 14, rir: 1 });
  await page.getByTestId('reps').fill('15');
  await page.getByTestId('tecnica-pausa').click();
  await serie(page);
  await preguntas(page, { 's1-militar': 0 }, { alarma: 'alarma-s1-militar-0' });
  await page.getByTestId('hoja-alarma').getByText('Aviso de ejemplo: consulta sin esperar.').waitFor();
  await page.getByRole('button', { name: 'Entendido' }).click();

  // Vuelve al bloque saltado: peso por encontrar, con su pista; te sobraron más de 3 → sube una placa
  assert.match(await titulo(page), /Curl de bíceps con barra: serie 1 de 2/);
  assert.equal(await page.getByTestId('kg').inputValue(), '');
  assert.match(await page.getByTestId('pista-peso').innerText(), /Por encontrar\. Escribe el peso de la máquina o tócalo con \+/);
  await page.getByText('Texto de ejemplo del peso por encontrar.').waitFor();
  await serie(page, { kg: 20, reps: 14, rir: 4 });
  assert.match(await page.getByTestId('ajuste').innerText(), /Te sobraron más de 3: la siguiente con 22\.7 kg/);
  assert.equal(await page.getByTestId('kg').inputValue(), '22.7');
  await serie(page, { reps: 12, rir: 2 });

  // Era el último bloque: no arranca el descanso "sigue con el siguiente bloque"
  await page.getByText('Terminaste todos los bloques.').waitFor();
  assert.equal(await page.getByTestId('timer').count(), 0);
  await page.getByTestId('terminar-abajo').click();
  await page.getByTestId('confirmar-si').click();
  await page.getByTestId('hoja-fin').waitFor();
  assert.match(await page.getByTestId('duracion').innerText(), /Duración: \d+ min/);
  const prox = await page.getByTestId('proxima-vez').innerText();
  assert.match(prox, /Elevación de talones sentado\s+Próxima vez: 32\.5 kg/);
  assert.match(prox, /Encogimientos en polea\s+Próxima vez: 27\.5 kg/);
  // Las mancuernas de 18 kg que ya están registradas (no 16 + 2.5)
  assert.match(prox, /Subida al cajón con mancuerna\s+Próxima vez: 18 kg · hasta 100° \(provisional\)/);
  // La primera no llegó al mínimo con 80 y con 70 llegó al tope: vuelve a 80 y busca el mínimo
  assert.match(prox, /Peso muerto con barra hexagonal\s+Próxima vez: 80 kg/);
  assert.match(prox, /vuelve a 80 kg/);
  assert.match(prox, /Press militar con mancuernas\s+Próxima vez: 16 kg/);
  assert.match(prox, /Curl de bíceps con barra\s+Próxima vez: 22\.7 kg/);
  await captura(page, '14-fin-sesion');
  await page.getByTestId('hoja-fin').getByRole('button', { name: 'Listo' }).click();

  // Lo guardado
  const db = await leerDB(page);
  const s = db['reg.sesiones'].find((x) => !x.soloLectura);
  assert.ok(s.fin);
  assert.equal(s.gimnasio, 'Gimnasio Norte');
  assert.deepEqual(s.dolorAntes, { zona1: 2 });
  assert.equal(s.semanaBloque, 1);
  const ej = (id) => s.ejercicios.find((e) => e.ejercicioId === id);
  assert.deepEqual(
    ej('s1-stepup').series.map((x) => x.lado),
    ['der', 'izq', 'der', 'izq', 'der', 'izq'],
  );
  assert.equal(ej('s1-stepup').recorrido, 100);
  assert.equal(ej('s1-stepup').dolor, 2);
  assert.equal(ej('s1-stepup').seriesPlan, 3);
  assert.equal(ej('s1-talones').falloPlan, true);
  const rayo = ej('s1-talones').series[2];
  assert.equal(rayo.fallo, true);
  assert.equal(rayo.tecnica, 'bajada');
  assert.deepEqual(rayo.tramos, [
    { kg: 27.5, reps: 8 },
    { kg: 25, reps: null },
  ]);
  assert.equal(ej('s1-encogimientos').series[2].tecnica, 'pausa');
  assert.deepEqual(ej('s1-militar').alarmas, ['Alarma de ejemplo 1']);
  assert.deepEqual(
    ej('s1-hexagonal').series.map((x) => x.kg),
    [80, 70, 70],
  );
  assert.equal(db['reg.dias']['2030-01-09'].tipo, 'entreno');

  // Hoy lo dice sin entrar a Entreno: ya entrenó y abajo cuál es la próxima
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  const btnEntrenar = await page.getByTestId('btn-entrenar').innerText();
  assert.match(btnEntrenar, /Ya entrenaste hoy/);
  assert.match(btnEntrenar, /La próxima: Cuerpo completo 2/);
  // Una sola alarma roja de copia: si está la tarjeta, la franja de arriba no se pinta de rojo
  assert.equal(await page.getByTestId('aviso-copia').count(), 1);
  assert.equal(await page.locator('[data-testid="ultima-copia"].vieja').count(), 0);

  // La misma noche, la pestaña dice "Próxima sesión"
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  await page.getByText('Próxima sesión · Gimnasio Norte').waitFor();

  // Al día siguiente: "¿Cómo amaneció?" (con la casilla de dormir de esa zona) y el peso queda en firme
  await page.clock.setSystemTime(new Date('2030-01-10T08:00:00'));
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  await page.getByTestId('aviso-manana-zona1').waitFor();
  await captura(page, '16-hoy-dia-siguiente');
  assert.match(await page.getByTestId('aviso-manana-zona1').innerText(), /^¿Cómo amaneció la zona A\?/);
  await page.getByTestId('dormir-manana-zona1').waitFor();
  await page.getByTestId('dolor-manana-zona1-1').click();
  await page.getByTestId('guardar-manana-zona1').click();
  await esperarAviso(page, 'Anotado');
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  assert.equal(await page.getByTestId('sesion-sigue').innerText(), 'Cuerpo completo 2');
  await page.getByTestId('elegir-sesion-S3').click();
  assert.match(await page.getByTestId('motivo-s3-stepup').innerText(), /sube lo mínimo/);
  // Peso de partida tomado de otro ejercicio (el de talones sentado)
  assert.match(await page.getByTestId('plan-s3-talones-pie').innerText(), /4 × 12–15 · quedar a 2 · 30 kg/);
  assert.equal(await page.getByTestId('motivo-s3-talones-pie').innerText(), 'El de los talones sentado');

  // Dolor fuera del gimnasio: con eso la subida queda frenada (texto del archivo)
  await page.getByTestId('btn-evento').click();
  await page.getByText('Anota lo que pasó.').waitFor();
  assert.match(await page.getByTestId('evento-donde').innerText(), /Dónde de ejemplo: arriba y por dentro/);
  await page.getByTestId('evento-valor-2').click();
  await page.getByTestId('evento-duracion').fill('10');
  await page.getByTestId('evento-actividad').fill('Caminando');
  // Todo lo que pide el plan por cada aparición, no solo la hora y el 0 a 10
  await page.getByTestId('evento-hace-cuanto').fill('Media hora');
  await page.getByTestId('evento-parte').fill('Por dentro');
  await page.getByTestId('evento-quito').fill('Cambiar de posición');
  await page.getByTestId('evento-apretar').click();
  await page.getByTestId('evento-hormigueo').click();
  // El hueco contra la sesión anterior de esa zona lo calcula la app
  assert.match(await page.getByTestId('evento-horas').innerText(), /entre el final de tu entreno anterior/);
  await page.getByTestId('evento-guardar').click();
  await esperarAviso(page, 'Anotado');
  const ev = (await leerDB(page))['reg.dolor'].find((d) => d.momento === 'evento');
  assert.equal(ev.haceCuanto, 'Media hora');
  assert.equal(ev.parte, 'Por dentro');
  assert.equal(ev.queLoQuito, 'Cambiar de posición');
  assert.equal(ev.alApretar, true);
  assert.equal(ev.hormigueo, true);
  assert.equal(ev.duracionMin, 10);
  assert.ok(ev.horasDesdeEntreno > 0, `horasDesdeEntreno: ${ev.horasDesdeEntreno}`);
  await page.getByTestId('elegir-sesion-S3').click();
  assert.match(await page.getByTestId('motivo-s3-stepup').innerText(), /no sube: Texto de ejemplo: no sube por el registro de la zona A/);

  // Historial y revisión
  await page.getByTestId('btn-historial').click();
  await page.getByTestId('hoja-historial').getByText('Elevación de talones sentado').click();
  await page.getByText('bloque anterior').waitFor();
  await captura(page, '15-historial');
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('si no abrió la app el día siguiente, igual pregunta cómo amaneció ese día y lo guarda con esa fecha', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  // Una sesión terminada el miércoles 9 (hecha directo en los datos)
  await page.evaluate(async () => {
    const abrir = () => new Promise((res) => (indexedDB.open('app-registro').onsuccess = (e) => res(e.target.result)));
    const db = await abrir();
    const leer = () => new Promise((res) => (db.transaction('datos').objectStore('datos').get('reg.sesiones').onsuccess = (e) => res(e.target.result)));
    const ses = await leer();
    ses.push({ id: 'x1', fecha: '2030-01-09', sesionId: 'S1', nombre: 'Cuerpo completo 1', gimnasio: 'Gimnasio Norte', inicio: '2030-01-09T17:00:00', fin: '2030-01-09T17:50:00', semanaBloque: 1, suave: false, dolorAntes: { zona1: 1 }, ejercicios: [], soloLectura: false, notas: '' });
    await new Promise((res) => {
      const tx = db.transaction('datos', 'readwrite');
      tx.objectStore('datos').put(ses, 'reg.sesiones');
      tx.oncomplete = res;
    });
  });
  // Abre el viernes 11: la mañana del jueves 10 quedó sin anotar
  await page.clock.setSystemTime(new Date('2030-01-11T09:00:00'));
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  await page.getByTestId('aviso-manana-zona1').waitFor();
  assert.match(await page.getByTestId('aviso-manana-zona1').innerText(), /¿Cómo amaneció la zona A\? \(jueves 10 ene\)/);
  await page.getByTestId('dolor-manana-zona1-0').click();
  await page.getByTestId('guardar-manana-zona1').click();
  await page.getByTestId('aviso-manana-zona1').waitFor({ state: 'detached' });
  const db = await leerDB(page);
  const d = db['reg.dolor'].find((x) => x.momento === 'manana');
  assert.equal(d.fecha, '2030-01-10');
  assert.equal(d.hora, null);
  assert.equal(d.valor, 0);
  // A medianoche la pregunta de la mañana todavía no sale
  await page.clock.setSystemTime(new Date('2030-01-12T00:30:00'));
  await page.evaluate(async () => {
    const abrir = () => new Promise((res) => (indexedDB.open('app-registro').onsuccess = (e) => res(e.target.result)));
    const db = await abrir();
    const leer = () => new Promise((res) => (db.transaction('datos').objectStore('datos').get('reg.sesiones').onsuccess = (e) => res(e.target.result)));
    const ses = await leer();
    ses.push({ id: 'x2', fecha: '2030-01-11', sesionId: 'S3', nombre: 'Cuerpo completo 3', gimnasio: 'Gimnasio Norte', inicio: '2030-01-11T17:00:00', fin: '2030-01-11T17:40:00', semanaBloque: 1, suave: false, dolorAntes: { zona1: 1 }, ejercicios: [], soloLectura: false, notas: '' });
    await new Promise((res) => {
      const tx = db.transaction('datos', 'readwrite');
      tx.objectStore('datos').put(ses, 'reg.sesiones');
      tx.oncomplete = res;
    });
  });
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  assert.equal(await page.getByTestId('aviso-manana-zona1').count(), 0);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('sesión de la otra zona: placa arriba de un peso de referencia, pregunta de la noche y de la mañana; viaje muestra solo calorías y proteína', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  await page.getByTestId('elegir-sesion-S2').click();
  assert.equal(await page.getByTestId('sesion-sigue').innerText(), 'Cuerpo completo 2');
  await page.getByTestId('empezar').click();
  await page.getByTestId('dolor-antes-zona2-1').click();
  await page.getByTestId('empezar-ya').click();
  await page.getByTestId('reloj-sesion').waitFor();
  let vioReferencia = false;
  for (let i = 0; i < 60; i++) {
    if (await page.getByText('Terminaste todos los bloques.').count()) break;
    if (await page.getByTestId('hoja-post').count()) {
      const botones = page.getByTestId('hoja-post').locator('[data-testid^="dolor-ej-"][data-testid$="-0"]');
      for (let j = 0; j < (await botones.count()); j++) await botones.nth(j).click();
      await page.getByTestId('guardar-post').click();
      await page.getByTestId('hoja-post').waitFor({ state: 'detached' });
      continue;
    }
    if ((await page.getByTestId('kg').inputValue()) === '') {
      // "Una placa arriba de 40 kg": sin peso puesto, + parte del peso de referencia
      assert.match(await page.getByTestId('pista-peso').innerText(), /^Una placa arriba de 40 kg\. Escribe el peso/);
      await page.getByTestId('kg-mas').click();
      assert.equal(await page.getByTestId('kg').inputValue(), '42.5');
      vioReferencia = true;
    }
    await serie(page);
  }
  assert.ok(vioReferencia);
  await page.getByTestId('terminar').click();
  await page.getByTestId('confirmar-si').click();
  await page.getByTestId('hoja-fin').getByRole('button', { name: 'Listo' }).click();
  let db = await leerDB(page);
  const s = db['reg.sesiones'].find((x) => x.sesionId === 'S2');
  assert.equal(s.ejercicios.find((e) => e.ejercicioId === 's2-banca').series.length, 5);
  assert.equal(s.ejercicios.find((e) => e.ejercicioId === 's2-fondos').series.length, 4);
  assert.equal(s.ejercicios.find((e) => e.ejercicioId === 's2-jalon').series.length, 3);

  // En la noche, "¿Te molestó la zona B hoy?"
  await page.clock.setSystemTime(new Date('2030-01-09T20:00:00'));
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  await page.getByTestId('aviso-noche-zona2').waitFor();
  await page.getByTestId('dolor-noche-zona2-1').click();
  await page.getByTestId('guardar-noche-zona2').click();
  await page.getByTestId('aviso-noche-zona2').waitFor({ state: 'detached' });

  await page.clock.setSystemTime(new Date('2030-01-10T07:00:00'));
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  await page.locator('nav.tabs [data-tab="hoy"]').click();
  await page.getByTestId('aviso-manana-zona2').waitFor();
  assert.equal(await page.getByTestId('aviso-manana-zona1').count(), 0);
  assert.equal(await page.getByTestId('dormir-manana-zona2').count(), 0);
  await page.getByTestId('dolor-manana-zona2-5').click();
  await page.getByTestId('guardar-manana-zona2').click();
  await page.getByTestId('aviso-manana-zona2').waitFor({ state: 'detached' });
  db = await leerDB(page);
  const d = db['reg.dolor'].find((x) => x.zona === 'zona2' && x.momento === 'manana');
  assert.equal(d.valor, 5);
  assert.equal(d.fecha, '2030-01-10');

  // Viaje: solo calorías y proteína
  await page.getByTestId('tipo-hoy-viaje').click();
  await page.getByTestId('tipo-actual').filter({ hasText: 'Viaje' }).waitFor();
  assert.equal(await page.getByTestId('barra-g').count(), 0);
  assert.equal(await page.getByTestId('barra-c').count(), 0);
  assert.equal(await page.getByTestId('barra-p').count(), 1);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('superserie: dejar un ejercicio para el final, consejo cuando el dolor pasa del umbral y aviso de no entrenar dos veces en un día', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  await page.locator('nav.tabs [data-tab="entreno"]').click();

  // El plan de hoy trae los textos del archivo: duración con el cambio, "por pierna",
  // lo que cambia dentro de la sesión y la nota que depende de las series de hoy.
  assert.match(await page.getByTestId('semana-bloque').innerText(), /~50 min \(~55 desde la semana 2\)/);
  assert.match(await page.getByTestId('plan-s1-stepup').innerText(), /3 × 6–9 por pierna/);
  assert.match(await page.getByTestId('plan-s1-hexagonal').locator('..').innerText(), /Si la primera no llega a 5: 70 kg\./);
  assert.match(await page.getByTestId('nota-plan-s1-militar').innerText(), /La tercera serie va sola \(ejemplo\)/);

  await page.getByTestId('empezar').click();
  await page.getByTestId('dolor-antes-zona1-1').click();
  await page.getByTestId('empezar-ya').click();
  await page.getByTestId('reloj-sesion').waitFor();

  assert.match(await titulo(page), /Elevación de talones sentado: serie 1 de 3/);
  await serie(page, { reps: 18, rir: 2 });
  assert.match(await titulo(page), /Encogimientos en polea: serie 1 de 3/);
  // La polea está ocupada: ese ejercicio se deja para el final y el otro sigue solo
  await page.getByTestId('al-final-s1-encogimientos').click();
  await page.waitForFunction(() => /Elevación de talones sentado: serie 2 de 3/.test(document.querySelector('[data-testid="titulo-serie"]')?.textContent || ''));
  assert.equal(await page.getByTestId('bloque-s1-encogimientos-final').count(), 1);
  assert.equal(await page.getByTestId('bloque-S1-1').getByTestId('ej-s1-encogimientos').count(), 0);
  await serie(page, { reps: 18, rir: 2 });
  assert.match(await titulo(page), /Elevación de talones sentado: serie 3 de 3 ⚡ al fallo/);
  await serie(page, { reps: 20 });

  // Dolor por encima del umbral: sale el consejo del archivo para esa zona
  await page.getByTestId('hoja-post').waitFor();
  assert.match(await page.getByTestId('hoja-post').innerText(), /Dolor de 0.a.10 en zona a, durante el ejercicio/i);
  await page.getByTestId('dolor-ej-s1-talones-5').click();
  await page.getByTestId('guardar-post').click();
  await page.getByTestId('hoja-consejo').waitFor();
  assert.match(await page.getByTestId('hoja-consejo').innerText(), /Consejo de ejemplo: acorta el recorrido/);
  await page.getByTestId('hoja-consejo').getByRole('button', { name: 'Entendido' }).click();

  // Terminar: el botón Listo del resumen se ve sin bajar la pantalla
  await page.getByTestId('terminar').click();
  await page.getByTestId('confirmar-si').click();
  await page.getByTestId('hoja-fin').waitFor();
  const caja = await page.getByTestId('fin-listo').boundingBox();
  assert.ok(caja && caja.y + caja.height <= page.viewportSize().height, 'el botón Listo no se ve sin bajar');
  await page.getByTestId('fin-listo').click();

  // Ya entrenó hoy: lo avisa con el texto del archivo y pide confirmación antes de empezar otra
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  assert.match(await page.getByTestId('aviso-ya-entreno').innerText(), /Texto de ejemplo: una sola sesión por día/);
  await page.getByTestId('empezar').click();
  await page.getByTestId('hoja-empezar').waitFor();
  await page.getByTestId('dolor-antes-zona2-0').click();
  await page.getByTestId('empezar-ya').click();
  await page.getByRole('heading', { name: 'Ya entrenaste hoy' }).waitFor();
  await page.locator('.hoja').last().getByRole('button', { name: 'Cancelar' }).click();
  assert.equal(await page.getByTestId('reloj-sesion').count(), 0);

  const db = await leerDB(page);
  const s = db['reg.sesiones'].find((x) => !x.soloLectura);
  assert.equal(s.ejercicios.find((e) => e.ejercicioId === 's1-talones').series.length, 3);
  // Lo que se dejó para el final quedó pendiente en su propio bloque (la sesión se terminó antes)
  assert.equal(s.ejercicios.find((e) => e.ejercicioId === 's1-encogimientos').series.length, 0);
  assert.deepEqual(errores, []);
  await contexto.close();
});

test('reglas del plan en pantalla: un solo ejercicio sube por sesión y el peso con puerta de dos sesiones', async () => {
  const { page, contexto, errores } = await nuevaPagina(nav, srv.url);
  await importarArranque(page);
  // La rutina con las dos reglas puestas, y una sesión al tope en los tres ejercicios de ese bloque.
  await page.evaluate(async () => {
    const abrir = () => new Promise((res) => (indexedDB.open('app-registro').onsuccess = (e) => res(e.target.result)));
    const db = await abrir();
    const leer = (k) => new Promise((res) => (db.transaction('datos').objectStore('datos').get(k).onsuccess = (e) => res(e.target.result)));
    const rutina = await leer('rutina');
    rutina.subidasPorSesion = 1;
    const s1 = rutina.sesiones.find((s) => s.id === 'S1');
    const ejs = s1.bloques.flatMap((b) => b.ejercicios);
    // El de la zona con recorrido queda con la puerta de dos sesiones y un incremento fijo.
    const conPuerta = ejs.find((e) => e.id === 's1-stepup');
    conPuerta.subirTrasSesionesOk = 2;
    conPuerta.incremento = 2;
    conPuerta.empeoraPorManana = true;
    conPuerta.noSubirSi = ['dolorZona1Mas4'];
    const alTope = (ej, kg) => ({
      ejercicioId: ej.id,
      clave: ej.clave,
      nombre: ej.nombre,
      dolor: 2,
      recorrido: ej.registraRecorrido ? 100 : null,
      seriesPlan: ej.series,
      falloPlan: false,
      series: (ej.unilateral ? ['der', 'izq'] : [null]).flatMap((lado) =>
        Array.from({ length: ej.series }, () => ({ kg, reps: ej.repMax, rir: 2, lado, fallo: false, tramos: [], tecnica: 'normal' })),
      ),
    });
    const ses = await leer('reg.sesiones');
    ses.push({
      id: 'tope1', fecha: '2030-01-08', sesionId: 'S1', nombre: 'Cuerpo completo 1', gimnasio: 'Gimnasio Norte',
      inicio: '2030-01-08T17:00:00', fin: '2030-01-08T17:50:00', semanaBloque: 1, suave: false, dolorAntes: { zona1: 1 },
      ejercicios: [alTope(ejs.find((e) => e.id === 's1-talones'), 30), alTope(ejs.find((e) => e.id === 's1-encogimientos'), 25), alTope(conPuerta, 16)],
      soloLectura: false, notas: '',
    });
    const dol = await leer('reg.dolor');
    dol.push({ fecha: '2030-01-09', hora: null, zona: 'zona1', momento: 'manana', valor: 1, durmioSobre: false, duracionMin: null, actividad: '' });
    await new Promise((res) => {
      const tx = db.transaction('datos', 'readwrite');
      tx.objectStore('datos').put(rutina, 'rutina');
      tx.objectStore('datos').put(ses, 'reg.sesiones');
      tx.objectStore('datos').put(dol, 'reg.dolor');
      tx.oncomplete = res;
    });
  });
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  await page.getByTestId('elegir-sesion-S1').click();

  // Los dos primeros llegaron al tope, pero solo uno sube: el otro repite el peso y dice a quién le toca.
  const talones = await page.getByTestId('motivo-s1-talones').innerText();
  const encog = await page.getByTestId('motivo-s1-encogimientos').innerText();
  const suben = [talones, encog].filter((x) => /sube lo mínimo|sube una placa/.test(x));
  const ceden = [talones, encog].filter((x) => /el turno de subir es de/.test(x));
  assert.equal(suben.length, 1, `subieron: ${suben.length}`);
  assert.equal(ceden.length, 1, `cedieron: ${ceden.length}`);
  assert.match(ceden[0], /repite el peso/);

  // El de la puerta llegó al tope una sola vez: no sube todavía y lo dice con la cuenta.
  const puerta = await page.getByTestId('motivo-s1-stepup').innerText();
  assert.match(puerta, /el plan pide 2 sesiones seguidas/);
  assert.match(puerta, /llevas 1/);
  assert.match(await page.getByTestId('plan-s1-stepup').innerText(), /16 kg/);

  // La segunda vez seguida cumpliendo: ahí sí sube, y sube el incremento del plan (16 + 2).
  // Aquí se suelta el límite de una subida por sesión, para mirar solo la puerta de las dos sesiones.
  await page.evaluate(async () => {
    const abrir = () => new Promise((res) => (indexedDB.open('app-registro').onsuccess = (e) => res(e.target.result)));
    const db = await abrir();
    const leer = (k) => new Promise((res) => (db.transaction('datos').objectStore('datos').get(k).onsuccess = (e) => res(e.target.result)));
    const rutina = await leer('rutina');
    delete rutina.subidasPorSesion;
    const ses = await leer('reg.sesiones');
    const prim = ses.find((s) => s.id === 'tope1');
    ses.push({ ...prim, id: 'tope2', fecha: '2030-01-10', inicio: '2030-01-10T17:00:00', fin: '2030-01-10T17:50:00', ejercicios: prim.ejercicios.map((e) => ({ ...e })) });
    const dol = await leer('reg.dolor');
    dol.push({ fecha: '2030-01-11', hora: null, zona: 'zona1', momento: 'manana', valor: 1, durmioSobre: false, duracionMin: null, actividad: '' });
    await new Promise((res) => {
      const tx = db.transaction('datos', 'readwrite');
      tx.objectStore('datos').put(rutina, 'rutina');
      tx.objectStore('datos').put(ses, 'reg.sesiones');
      tx.objectStore('datos').put(dol, 'reg.dolor');
      tx.oncomplete = res;
    });
  });
  await page.clock.setSystemTime(new Date('2030-01-12T08:00:00'));
  await page.reload();
  await page.waitForSelector('body[data-listo="1"]');
  await page.locator('nav.tabs [data-tab="entreno"]').click();
  await page.getByTestId('elegir-sesion-S1').click();
  assert.match(await page.getByTestId('plan-s1-stepup').innerText(), /18 kg/);
  assert.doesNotMatch(await page.getByTestId('motivo-s1-stepup').innerText(), /sesiones seguidas/);
  assert.deepEqual(errores, []);
  await contexto.close();
});
