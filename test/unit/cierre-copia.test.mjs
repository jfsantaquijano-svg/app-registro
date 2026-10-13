import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { proponerCierre, porciones, tablaFinal, planCierra, textoCantidad, rolDe, nombreEstado } from '../../src/cierre.js';
import { validarCopia, normalizarCopia, combinarPorId, actualizarPlan, construirCopia, leerTextoCopia } from '../../src/copia.js';

const arranque = JSON.parse(readFileSync(new URL('../arranque-prueba.json', import.meta.url), 'utf8'));
const { metas, alimentos } = arranque;
const prefs = arranque.ajustes.cierre;
const meta = metas.tipos.entreno;

test('porciones realistas: lácteo con las porciones del archivo, carne en múltiplos de 10 ya cocida, unidades enteras', () => {
  const kumis = alimentos.find((a) => a.id === 'kumis');
  assert.deepEqual(porciones(kumis, prefs).map((p) => p.cantidad), [125, 150]);
  assert.deepEqual(porciones(kumis).map((p) => p.cantidad), [50, 100, 150]); // sin preferencias: genéricas
  const lomo = alimentos.find((a) => a.id === 'lomo-cerdo');
  const pc = porciones(lomo);
  assert.ok(pc.every((p) => p.cantidad % 10 === 0 && p.estado === 'cocido'));
  const arepa = alimentos.find((a) => a.id === 'arepa');
  assert.deepEqual(porciones(arepa).map((p) => p.cantidad), [1, 2, 3]);
  assert.equal(rolDe(arepa), 'carbo');
  assert.equal(rolDe(alimentos.find((a) => a.id === 'muslo-pavo')), 'proteina');
});

test('cerrar el día: proteína hasta la meta sin pasar del máximo, grasa sin bajar del mínimo', () => {
  const consumido = { kcal: 1200, p: 95, g: 35, c: 140 };
  const r = proponerCierre({ meta, metas, consumido, alimentos, prefs });
  assert.ok(r.items.length > 0);
  assert.ok(r.final.p >= meta.pMin && r.final.p <= meta.pMax, `P ${r.final.p}`);
  assert.ok(r.final.g <= meta.gMax, `G ${r.final.g}`);
  assert.ok(r.final.g >= metas.grasaMinima, `G ${r.final.g}`);
  assert.ok(r.final.kcal <= meta.kcal + (metas.toleranciaKcal ?? 30), `kcal ${r.final.kcal}`);
  // Solo alimentos en casa
  assert.ok(r.items.every((i) => i.alimento.enCasa));
  // Carne en múltiplos de 10, lácteos con las porciones del archivo, unidades enteras
  for (const i of r.items) {
    if (i.alimento.coccion?.tipo === 'carne') assert.equal(i.cantidad % 10, 0);
    if (i.alimento.categoria === 'lacteo' && i.alimento.base === '100g') assert.ok(prefs.porcionesLacteo.includes(i.cantidad));
    if (i.unidad === 'und') assert.ok(Number.isInteger(i.cantidad));
  }
  // La tabla final de la propuesta queda sin alertas de calorías, proteína ni grasa
  const t = tablaFinal(r.final, meta, metas);
  assert.deepEqual(t.filter((x) => x.n !== 'c').map((x) => x.icono), ['✅', '✅', '✅'], JSON.stringify(r.final));
});

test('la propuesta nunca deja la proteína por encima del máximo ni las calorías fuera de la tolerancia', () => {
  for (const consumido of [
    { kcal: 1500, p: 138, g: 50, c: 120 },
    { kcal: 1300, p: 120, g: 30, c: 150 },
    { kcal: 1700, p: 145, g: 52, c: 160 },
  ]) {
    const r = proponerCierre({ meta, metas, consumido, alimentos, prefs });
    assert.ok(r.final.p <= meta.pMax, `p ${r.final.p} con ${JSON.stringify(consumido)}`);
    assert.ok(r.final.kcal <= meta.kcal + 30, `kcal ${r.final.kcal}`);
  }
});

test('regla de oro: si ya llegó a la proteína, solo grasa o carbos', () => {
  const consumido = { kcal: 1500, p: 152, g: 45, c: 100 };
  const r = proponerCierre({ meta, metas, consumido, alimentos, prefs });
  assert.equal(r.yaOro, true);
  assert.ok(r.items.every((i) => i.macros.p <= 8), JSON.stringify(r.items.map((i) => [i.alimento.id, i.macros.p])));
  assert.ok(r.final.p <= meta.pMax);
});

test('con la proteína ya por encima del máximo igual propone grasa y carbos (sin más proteína)', () => {
  const consumido = { kcal: 1200, p: 165, g: 38, c: 60 };
  const r = proponerCierre({ meta, metas, consumido, alimentos, prefs });
  assert.ok(r.items.length > 0, 'no propone nada aunque faltan calorías y grasa');
  assert.ok(r.items.every((i) => ['carbo', 'grasa', 'lacteo', 'otro'].includes(i.alimento.categoria) || i.macros.p <= 8));
  assert.ok(r.final.p <= consumido.p + 8);
});

test('"Otra" y "No hay" excluyen el alimento', () => {
  const consumido = { kcal: 1200, p: 95, g: 35, c: 140 };
  const r1 = proponerCierre({ meta, metas, consumido, alimentos, prefs });
  const id = r1.items[0].alimento.id;
  const r2 = proponerCierre({ meta, metas, consumido, alimentos, excluir: [id], prefs });
  assert.ok(r2.items.every((i) => i.alimento.id !== id));
});

test('gustos del archivo: lo que nunca se propone solo y lo que se prefiere', () => {
  const consumido = { kcal: 1000, p: 60, g: 30, c: 100 };
  const r = proponerCierre({ meta, metas, consumido, alimentos, frecuencia: { 'caldo-hueso': 99 }, prefs });
  assert.ok(r.items.every((i) => i.alimento.id !== 'caldo-hueso'));
  // Lo que el archivo dice que nunca va solo no se propone; sin esa preferencia sí puede salir.
  const conLomo = proponerCierre({ meta, metas, consumido, alimentos });
  assert.ok(conLomo.items.some((i) => i.alimento.id === 'lomo-cerdo'));
  const sinLomo = proponerCierre({ meta, metas, consumido, alimentos, prefs: { nuncaSolos: ['lomo'] } });
  assert.ok(sinLomo.items.every((i) => i.alimento.id !== 'lomo-cerdo'));
  // Carbos: la que se prefiere va primero
  const carbos = proponerCierre({ meta, metas, consumido: { kcal: 1500, p: 150, g: 56, c: 100 }, alimentos, frecuencia: { yuca: 50 }, prefs });
  assert.ok(carbos.items.some((i) => i.alimento.id === 'arepa'), JSON.stringify(carbos.items.map((i) => i.alimento.id)));
});

test('tabla final con ✅ ⚠️ ❌ y si lo planeado cierra la meta', () => {
  const t = tablaFinal({ kcal: 1990, p: 150, g: 60, c: 200 }, meta, metas);
  assert.deepEqual(t.map((x) => x.icono), ['✅', '✅', '✅', '✅']);
  assert.equal(tablaFinal({ kcal: 2001, p: 150, g: 60, c: 200 }, meta, metas)[0].icono, '✅'); // dentro de la tolerancia
  const mal = tablaFinal({ kcal: 2300, p: 120, g: 70, c: 100 }, meta, metas);
  assert.deepEqual(mal.map((x) => x.icono), ['❌', '❌', '❌', '⚠️']);
  assert.equal(planCierra({ kcal: 1990, p: 150, g: 60, c: 200 }, meta, metas), true);
  assert.equal(planCierra({ kcal: 1990, p: 120, g: 60, c: 200 }, meta, metas), false);
});

test('cantidades con cocción: siempre el estado elegido y su equivalente, con el género del alimento', () => {
  const lomo = alimentos.find((a) => a.id === 'lomo-cerdo');
  assert.equal(textoCantidad(lomo, 150, 'g', 'cocido'), '150 g ya cocido = 200 g crudo');
  assert.equal(textoCantidad(lomo, 200, 'g', 'crudo'), '200 g crudo = 150 g ya cocido');
  const pechuga = { nombre: 'Pechuga de pavo', base: '100g', coccion: { tipo: 'carne', estado: 'crudo' } };
  assert.equal(textoCantidad(pechuga, 120, 'g', 'cocido'), '120 g ya cocida = 160 g cruda');
  const quinua = alimentos.find((a) => a.id === 'quinua');
  assert.equal(textoCantidad(quinua, 135, 'g', 'cocido'), '135 g ya cocida = 50 g cruda');
  assert.equal(nombreEstado(lomo, 'crudo'), 'crudo');
  assert.equal(textoCantidad(alimentos.find((a) => a.id === 'arepa'), 2, 'und'), '2 arepas');
  assert.equal(textoCantidad(alimentos.find((a) => a.id === 'arepa'), 0.5, 'und'), '0.5 arepas');
});

test('copia: validar, normalizar y leer .txt con BOM', () => {
  assert.equal(validarCopia(arranque).ok, true);
  assert.equal(validarCopia({ formato: 'otro' }).ok, false);
  assert.equal(validarCopia({ formato: 'app-registro', version: 99 }).ok, false);
  const n = normalizarCopia({ formato: 'app-registro', version: 1 });
  assert.deepEqual(n.registros.sesiones, []);
  assert.deepEqual(n.registros.dias, {});
  assert.equal(leerTextoCopia('﻿{"a":1}').a, 1);
  assert.throws(() => leerTextoCopia('no es json'));
  const c = construirCopia({ ...n, registros: n.registros }, { creado: 'x' });
  assert.equal(c.formato, 'app-registro');
  assert.equal(c.version, 1);
});

test('actualizar plan: combina por id, corrige lo del plan, nunca borra ni pisa lo del usuario', () => {
  const actuales = [
    { id: 'a', nombre: 'A viejo', origen: 'plan', favorito: true, enCasa: false },
    { id: 'u', nombre: 'Mío', origen: 'usuario' },
    { id: 'solo-viejo', nombre: 'Se queda', origen: 'plan' },
  ];
  const nuevos = [
    { id: 'a', nombre: 'A nuevo', origen: 'plan', favorito: false, enCasa: true },
    { id: 'u', nombre: 'Intento de pisar', origen: 'plan' },
    { id: 'b', nombre: 'B', origen: 'plan' },
  ];
  const r = combinarPorId(actuales, nuevos);
  assert.deepEqual(r.map((x) => x.id), ['a', 'u', 'solo-viejo', 'b']);
  assert.equal(r[0].nombre, 'A nuevo');
  assert.equal(r[0].favorito, true); // conserva la marca del usuario
  assert.equal(r[0].enCasa, false);
  assert.equal(r[1].nombre, 'Mío');
  // Lo del plan que el usuario corrigió (editado) tampoco se pisa
  const corregido = combinarPorId([{ id: 'x', nombre: 'Etiqueta corregida', kcal: 130, origen: 'plan', editado: true }], [{ id: 'x', nombre: 'Del plan', kcal: 120, origen: 'plan' }]);
  assert.equal(corregido[0].kcal, 130);
  const actual = { rutina: { nombre: 'vieja' }, metas: { m: 1 }, ajustes: { cita: { texto: 'c', hecha: true }, gimnasios: ['G9'] }, alimentos: actuales, platos: [], reg: { dias: { x: 1 } } };
  actual.ajustes.omega3 = { kcal: 20, activo: false };
  const up = actualizarPlan(actual, { rutina: { nombre: 'nueva' }, metas: { m: 2 }, ajustes: { cita: { texto: 'c', hecha: false }, gimnasios: ['G1'], omega3: { kcal: 20, activo: true } }, alimentos: nuevos, platos: [{ id: 'p' }] });
  assert.equal(up.ajustes.omega3.activo, false); // el interruptor del usuario se respeta
  assert.equal(up.rutina.nombre, 'nueva');
  assert.equal(up.metas.m, 2);
  assert.equal(up.ajustes.cita.hecha, true);
  assert.deepEqual(up.ajustes.gimnasios.sort(), ['G1', 'G9']);
  assert.equal(up.platos.length, 1);
  assert.equal('reg' in up, false);
});

test('el service worker guarda todos los archivos de la app', () => {
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const src = readdirSync(new URL('../../src/', import.meta.url)).filter((f) => f.endsWith('.js'));
  for (const f of src) assert.ok(sw.includes(`'./src/${f}'`), `falta ./src/${f} en sw.js`);
  for (const f of ['./index.html', './estilos.css', './manifest.webmanifest', './iconos/icono-192.png', './iconos/icono-512.png']) assert.ok(sw.includes(`'${f}'`), f);
});

test('no propone suplementos como grasa ni platos de restaurante', () => {
  const capsula = { id: 'capsula', nombre: 'Cápsula de prueba', categoria: 'suplemento', base: 'unidad', unidadNombre: 'cápsula', kcal: 10, p: 0, g: 1, c: 0, enCasa: true };
  const fuera = { id: 'fuera', nombre: 'Plato de fuera', categoria: 'restaurante', base: 'unidad', kcal: 500, p: 40, g: 20, c: 40, enCasa: true, restaurante: { nombre: 'x', recargo: 'plancha' } };
  const r = proponerCierre({ meta, metas, consumido: { kcal: 1000, p: 80, g: 20, c: 100 }, alimentos: [capsula, fuera, ...alimentos], frecuencia: { capsula: 50, fuera: 50 }, prefs });
  assert.ok(r.items.every((i) => !['capsula', 'fuera'].includes(i.alimento.id)));
});
