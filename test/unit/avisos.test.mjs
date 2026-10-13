// Avisos de Hoy con datos inventados (el archivo de prueba del repositorio).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S } from '../../src/estado.js';
import { normalizarCopia } from '../../src/copia.js';
import { calcularAvisos, mananaPendiente } from '../../src/avisos.js';

const arranque = JSON.parse(readFileSync(new URL('../arranque-prueba.json', import.meta.url), 'utf8'));

beforeEach(() => {
  const c = normalizarCopia(structuredClone(arranque));
  Object.assign(S, { ajustes: c.ajustes, metas: c.metas, alimentos: c.alimentos, platos: c.platos, rutina: c.rutina, reg: c.registros, ui: {} });
});

function sesion(fecha, sesionId) {
  return { id: `t-${fecha}-${sesionId}`, fecha, sesionId, nombre: sesionId, gimnasio: 'Gimnasio Norte', inicio: `${fecha}T17:00:00`, fin: `${fecha}T17:45:00`, suave: false, dolorAntes: {}, ejercicios: [], soloLectura: false };
}

const ids = (fecha, hora = 9) => calcularAvisos(fecha, new Date(`${fecha}T${String(hora).padStart(2, '0')}:00:00`)).map((a) => a.id);

test('la mañana siguiente a una sesión se pregunta aunque no haya abierto la app ese día (hasta 3 días)', () => {
  S.reg.sesiones.push(sesion('2030-01-09', 'S1'));
  assert.ok(ids('2030-01-10').includes('manana-zona1'));
  const z = S.ajustes.zonas.zona1;
  assert.equal(mananaPendiente('zona1', z, '2030-01-12'), '2030-01-10');
  const av = calcularAvisos('2030-01-12', new Date('2030-01-12T09:00:00')).find((a) => a.id === 'manana-zona1');
  assert.equal(av.fechaDolor, '2030-01-10');
  assert.match(av.texto, /\(jueves 10 ene\)$/);
  // Ya anotada: no se pregunta más
  S.reg.dolor.push({ fecha: '2030-01-10', zona: 'zona1', momento: 'manana', valor: 1 });
  assert.equal(mananaPendiente('zona1', z, '2030-01-12'), null);
  // Más de 3 días: ya no
  S.reg.dolor = [];
  assert.equal(mananaPendiente('zona1', z, '2030-01-14'), null);
  // La otra zona no se pregunta en una sesión de este tipo
  assert.ok(!ids('2030-01-10').includes('manana-zona2'));
});

test('la pregunta de la mañana no sale antes de las 4', () => {
  S.reg.sesiones.push(sesion('2030-01-09', 'S1'));
  assert.ok(!ids('2030-01-10', 0).includes('manana-zona1'));
  assert.ok(!ids('2030-01-10', 3).includes('manana-zona1'));
  assert.ok(ids('2030-01-10', 4).includes('manana-zona1'));
});

test('fechas solo de calendario no salen en Hoy; comida libre con el día de la semana', () => {
  // 2030-01-12 es la "copia semanal de ejemplo" (solo calendario)
  assert.ok(!ids('2030-01-12').some((x) => x.startsWith('fecha-Copia')));
  assert.ok(ids('2030-02-03').includes('fecha-Medidas de ejemplo'));
  const libre = calcularAvisos('2030-01-13', new Date('2030-01-13T09:00:00')).find((a) => a.id === 'libre');
  assert.equal(libre.texto, 'Comida libre: martes 15 ene');
});

test('ayer fue día alto: el texto sale del archivo', () => {
  S.reg.dias['2030-01-09'] = { tipo: 'entreno', omega3: false, comidas: [{ kcal: 2300, p: 150, g: 60, c: 260, planeado: false }] };
  const av = calcularAvisos('2030-01-10', new Date('2030-01-10T09:00:00')).find((a) => a.id === 'ayer-alto');
  assert.equal(av.texto, 'Ayer fue día alto (texto de ejemplo).');
});
