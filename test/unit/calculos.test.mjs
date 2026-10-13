import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertirEstado,
  factorAlimento,
  macrosItem,
  macrosPlatoTotales,
  aplicarRecargo,
  totalesDia,
  estadoNutriente,
  textoFalta,
  esDiaAlto,
  semanasPeso,
  bajadaRapida,
  resumenSemana,
  diasConTotales,
  proximaComidaLibre,
  fechaCoincide,
  buscarAlimentos,
  sinTildes,
  fmtKcal,
  grasas,
  omega3DelDia,
  toleranciaKcal,
  signo,
  plural,
  generoDe,
} from '../../src/calculos.js';
import { lunesDe, sumarDias, difDias } from '../../src/fechas.js';

// Metas inventadas para las pruebas.
const metas = {
  tipos: {
    entreno: { nombre: 'Entreno', kcal: 2000, p: 150, g: 60, c: 215, pMin: 140, pMax: 160, gMin: 55, gMax: 65 },
    descanso: { nombre: 'Descanso', kcal: 1900, p: 150, g: 58, c: 194, pMin: 140, pMax: 160, gMin: 52, gMax: 62 },
    viaje: { nombre: 'Viaje', kcal: 2500, pMin: 130, soloKcalYProteina: true, cuentaDiaAlto: false, promedioLimpio: false },
  },
  diaAltoKcal: 150,
  reglaDeOroP: 150,
  grasaMinima: 50,
  recargos: { salteado: 0.25, plancha: 0.15, medido: 0.05 },
  peorCasoAceite: { arroz: 4, frijol: 6, polloMarinado: 2 },
};

const pollo = { id: 'pollo', nombre: 'Pollo crudo', base: '100g', kcal: 110, p: 23, g: 1.5, c: 0, coccion: { tipo: 'carne', estado: 'crudo' } };
const arroz = { id: 'arroz', nombre: 'Arroz crudo', base: '100g', kcal: 360, p: 7, g: 0.6, c: 79, coccion: { tipo: 'arroz', estado: 'crudo' } };
const tortilla = { id: 'tortilla', nombre: 'Tortilla', base: 'unidad', unidadNombre: 'tortilla', gramosUnidad: 30, kcal: 90, p: 3, g: 2, c: 15 };
const aceite = { id: 'aceite', nombre: 'Aceite', base: '100g', unidadNombre: 'cucharadita', gramosUnidad: 5, kcal: 884, p: 0, g: 100, c: 0, grasaVisible: true };

test('conversión crudo/cocido: carne × 0.75 y × 1.33, arroz × 2.7', () => {
  assert.equal(convertirEstado(200, 'carne', 'crudo', 'cocido'), 150);
  assert.ok(Math.abs(convertirEstado(150, 'carne', 'cocido', 'crudo') - 199.5) < 1e-9);
  assert.ok(Math.abs(convertirEstado(100, 'arroz', 'crudo', 'cocido') - 270) < 1e-9);
  assert.ok(Math.abs(convertirEstado(270, 'arroz', 'cocido', 'crudo') - 100) < 1e-9);
  assert.equal(convertirEstado(100, 'carne', 'crudo', 'crudo'), 100);
  assert.equal(convertirEstado(100, null, 'crudo', 'cocido'), 100);
});

test('factor del alimento: gramos, unidades y estado', () => {
  assert.equal(factorAlimento(pollo, 200, 'g', 'crudo'), 2);
  assert.ok(Math.abs(factorAlimento(pollo, 150, 'g', 'cocido') - 1.995) < 1e-9);
  assert.equal(factorAlimento(tortilla, 2, 'und'), 2);
  assert.equal(factorAlimento(tortilla, 60, 'g'), 2);
  assert.equal(factorAlimento(aceite, 2, 'und'), 0.1);
});

test('macros de un alimento pesado ya cocido', () => {
  const m = macrosItem(pollo, { cantidad: 150, unidad: 'g', estado: 'cocido' }, metas);
  // 150 g cocido = 199.5 g crudo
  assert.equal(m.kcal, 219.5);
  assert.equal(m.p, 45.9);
  assert.equal(m.gVisible, 0);
  const a = macrosItem(arroz, { cantidad: 270, unidad: 'g', estado: 'cocido' }, metas);
  assert.equal(a.kcal, 360);
  assert.equal(a.c, 79);
});

test('recargo de restaurante: el % de las calorías se suma como grasa visible; P y C no se inflan', () => {
  const base = macrosItem(pollo, { cantidad: 200, unidad: 'g', estado: 'crudo' }, metas);
  const con = macrosItem(pollo, { cantidad: 200, unidad: 'g', estado: 'crudo', recargo: 'salteado' }, metas);
  assert.equal(con.p, base.p);
  assert.equal(con.c, base.c);
  assert.equal(con.kcal, 275); // 220 × 1.25
  assert.equal(con.g, 3 + 6.1); // 55 kcal ÷ 9 = 6.11
  assert.equal(con.gVisible, 6.1);
  const pl = aplicarRecargo({ kcal: 100, p: 10, g: 0, c: 0, gVisible: 0 }, 0.2);
  assert.equal(pl.kcal, 120);
  assert.ok(Math.abs(pl.g - 20 / 9) < 1e-9);
});

test('peor caso por componente: g extra por cada 100 g', () => {
  const m = macrosItem(arroz, { cantidad: 200, unidad: 'g', estado: 'crudo', recargo: 'peor:arroz' }, metas);
  // 200 g → +8 g de grasa → +72 kcal
  assert.equal(m.g, 1.2 + 8);
  assert.equal(m.kcal, 720 + 72);
  assert.equal(m.gVisible, 8);
});

test('aceite cuenta como grasa visible', () => {
  const m = macrosItem(aceite, { cantidad: 1, unidad: 'und' }, metas);
  assert.equal(m.g, 5);
  assert.equal(m.gVisible, 5);
});

test('plato con totales fijos: escala y grasa visible del recargo incluido', () => {
  const p = { totales: { kcal: 650, p: 50, g: 25, c: 60, incluyeRecargo: true }, restaurante: { recargo: 'salteado' } };
  const m = macrosPlatoTotales(p, 1.5, metas);
  assert.equal(m.kcal, 975);
  assert.equal(m.p, 75);
  assert.equal(m.gVisible, 21.7); // 975 × 0.25 / 1.25 / 9
});

test('totales del día: lo planeado va aparte y el suplemento diario se suma', () => {
  const dia = {
    omega3: true,
    comidas: [
      { kcal: 100, p: 10, g: 2, c: 5, gVisible: 0, planeado: false },
      { kcal: 300, p: 20, g: 5, c: 30, gVisible: 1, planeado: true },
    ],
  };
  const t = totalesDia(dia, { omega3: { kcal: 20, p: 0, g: 2, c: 0, activo: true } });
  assert.equal(t.conf.kcal, 120);
  assert.equal(t.conf.g, 4);
  // El suplemento es aceite en cápsula: grasa que se ve.
  assert.equal(t.conf.gVisible, 2);
  assert.equal(totalesDia(dia, { omega3: { kcal: 20, g: 2, activo: true, grasaVisible: false } }).conf.gVisible, 0);
  assert.equal(t.plan.kcal, 300);
  assert.equal(t.nPlan, 1);
  const sinO3 = totalesDia({ ...dia, omega3: false }, { omega3: { kcal: 20, g: 2, activo: true } });
  assert.equal(sinO3.conf.kcal, 100);
});

test('suplemento diario: cada día guarda su marca; apagarlo en Ajustes no cambia los días pasados', () => {
  const o3 = { kcal: 20, p: 0, g: 2, c: 0 };
  const dia = { omega3: true, comidas: [{ kcal: 400, p: 30, g: 10, c: 40, planeado: false }] };
  const antes = totalesDia(dia, { omega3: { ...o3, activo: true } }).conf.kcal;
  const despues = totalesDia(dia, { omega3: { ...o3, activo: false } }).conf.kcal;
  assert.equal(antes, 420);
  assert.equal(despues, 420);
  assert.equal(omega3DelDia({ omega3: false }, { omega3: { ...o3, activo: true } }), false);
  // Días viejos sin marca: siguen el interruptor.
  assert.equal(omega3DelDia({}, { omega3: { ...o3, activo: true } }), true);
  assert.equal(omega3DelDia({}, { omega3: { ...o3, activo: false } }), false);
});

test('colores: gris durante el día, rojo solo por exceso o al cerrar', () => {
  const m = metas.tipos.entreno;
  assert.equal(estadoNutriente('p', 100, m), 'falta');
  assert.equal(estadoNutriente('p', 100, m, { cerrado: true }), 'mal');
  assert.equal(estadoNutriente('p', 150, m), 'ok');
  assert.equal(estadoNutriente('p', 165, m), 'cerca');
  assert.equal(estadoNutriente('g', 66, m), 'mal');
  assert.equal(estadoNutriente('g', 63, m), 'cerca');
  assert.equal(estadoNutriente('g', 40, m), 'falta');
  assert.equal(estadoNutriente('g', 40, m, { cerrado: true }), 'cerca');
  assert.equal(estadoNutriente('kcal', 2100, m), 'cerca');
  assert.equal(estadoNutriente('kcal', 2151, m), 'mal');
  // Una sola tolerancia de calorías en toda la app (por defecto 30, o la del archivo)
  assert.equal(estadoNutriente('kcal', 2001, m), 'ok');
  assert.equal(estadoNutriente('kcal', 2030, m), 'ok');
  assert.equal(estadoNutriente('kcal', 2031, m), 'cerca');
  assert.equal(estadoNutriente('kcal', 2011, m, { tolKcal: 10 }), 'cerca');
  assert.equal(toleranciaKcal({ toleranciaKcal: 10 }), 10);
  assert.equal(toleranciaKcal({}), 30);
  assert.equal(estadoNutriente('c', 50, m, { cerrado: true }), 'cerca');
  assert.notEqual(estadoNutriente('c', 0, m, { cerrado: true }), 'mal');
});

test('día alto: más de meta + 150, y el viaje no cuenta', () => {
  assert.equal(esDiaAlto(2151, metas.tipos.entreno, 150), true);
  assert.equal(esDiaAlto(2150, metas.tipos.entreno, 150), false);
  assert.equal(esDiaAlto(3000, metas.tipos.viaje, 150), false);
});

test('promedio semanal de peso, lunes a domingo, sin descartar pesajes', () => {
  const pesos = [
    { fecha: '2030-01-06', kg: 81, tipo: 'casa' }, // domingo: semana anterior
    { fecha: '2030-01-07', kg: 80, tipo: 'casa' },
    { fecha: '2030-01-09', kg: 79, tipo: 'casa' },
    { fecha: '2030-01-13', kg: 78, tipo: 'casa' }, // domingo
    { fecha: '2030-01-08', kg: 70, tipo: 'bio' }, // aparte
  ];
  const s = semanasPeso(pesos);
  assert.equal(s.length, 2);
  assert.equal(s[0].lunes, '2029-12-31');
  assert.equal(s[0].prom, 81);
  assert.equal(s[1].lunes, '2030-01-07');
  assert.equal(s[1].prom, 79);
  assert.equal(s[1].n, 3);
  assert.equal(s[1].cambio, -2);
  assert.equal(lunesDe('2030-01-13'), '2030-01-07');
  assert.equal(lunesDe('2030-01-07'), '2030-01-07');
});

test('aviso de bajada rápida: más de 1 kg por semana dos semanas seguidas', () => {
  const sem = [
    { lunes: '2030-01-07', prom: 80 },
    { lunes: '2030-01-14', prom: 78.8 },
    { lunes: '2030-01-21', prom: 77.7 },
  ];
  assert.ok(bajadaRapida(sem));
  assert.equal(bajadaRapida([sem[0], sem[1], { lunes: '2030-01-21', prom: 78.5 }]), null);
});

test('resumen de la semana: promedio limpio sin viajes, días altos e historial', () => {
  const diasTot = diasConTotales(
    {
      dias: {
        '2030-01-08': { tipo: 'entreno', omega3: false, comidas: [{ kcal: 2200, p: 150, g: 60, c: 230, planeado: false }] },
        '2030-01-09': { tipo: 'viaje', omega3: false, comidas: [{ kcal: 2600, p: 130, g: 90, c: 250, planeado: false }] },
        '2030-01-10': { tipo: 'descanso', omega3: false, comidas: [{ kcal: 500, p: 50, g: 10, c: 50, planeado: true }] },
      },
      historialDias: [{ fecha: '2030-01-07', tipo: 'descanso', kcal: 1900, p: 148, g: 58, c: 190 }],
    },
    {},
  );
  assert.equal(diasTot.length, 3); // el día solo planeado no cuenta
  const r = resumenSemana({ lunes: '2030-01-07', diasTot, pesos: [], metas });
  assert.equal(r.dias.length, 3);
  assert.equal(r.diasAltos.length, 1);
  assert.equal(r.diasAltos[0], '2030-01-08');
  assert.equal(Math.round(r.kcalProm), Math.round((1900 + 2200 + 2600) / 3));
  assert.equal(r.kcalLimpio, (1900 + 2200) / 2);
  assert.equal(r.nViaje, 1);
});

test('comida libre cada 14 días y fechas que se repiten', () => {
  const cl = { desde: '2030-01-04', cadaDias: 14 };
  assert.equal(proximaComidaLibre(cl, '2030-01-04'), '2030-01-04');
  assert.equal(proximaComidaLibre(cl, '2030-01-05'), '2030-01-18');
  assert.equal(proximaComidaLibre(cl, '2030-01-18'), '2030-01-18');
  assert.equal(fechaCoincide({ fecha: '2030-02-01', repetir: 'mensual' }, '2030-03-01'), true);
  assert.equal(fechaCoincide({ fecha: '2030-02-01', repetir: 'mensual' }, '2030-01-01'), false);
  assert.equal(fechaCoincide({ fecha: '2030-01-13', repetir: 'semanal' }, '2030-01-20'), true);
  assert.equal(fechaCoincide({ fecha: '2030-01-13', repetir: 'ninguna' }, '2030-01-20'), false);
});

test('búsqueda sin tildes con favoritos y recientes primero', () => {
  const lista = [
    { id: 'a', nombre: 'Atún en agua' },
    { id: 'b', nombre: 'Arroz' },
    { id: 'c', nombre: 'Aguacate', favorito: true },
  ];
  assert.equal(sinTildes('Atún Ñ'), 'atun n');
  assert.deepEqual(buscarAlimentos(lista, 'atun').map((x) => x.id), ['a']);
  assert.deepEqual(buscarAlimentos(lista, '', { recientes: ['b'] }).map((x) => x.id), ['c', 'b', 'a']);
});

test('formato de números, signo y plural', () => {
  assert.equal(fmtKcal(2350), '2.350');
  assert.equal(fmtKcal(950.4), '950');
  assert.equal(signo(-0.3), '−0.30');
  assert.equal(signo(0.25), '+0.25');
  assert.equal(signo(0), '0.00');
  assert.equal(signo(null), '—');
  assert.equal(plural(1, 'pesaje', 'pesajes'), '1 pesaje');
  assert.equal(plural(3, 'pesaje', 'pesajes'), '3 pesajes');
  assert.equal(generoDe({ nombre: 'Pechuga de pavo' }), 'f');
  assert.equal(generoDe({ nombre: 'Carne de res' }), 'f');
  assert.equal(generoDe({ nombre: 'Lomo de cerdo' }), 'm');
  assert.equal(generoDe({ nombre: 'Lomo', genero: 'f' }), 'f');
});

test('grasa que se ve: espacio contra el tope, con lo ya registrado; sin grasa que se ve no hay aviso', () => {
  const meta = { g: 50, gMax: 55 };
  // Lo no visible ya llena casi todo, pero no hay nada visible: no se avisa.
  const sinVisible = grasas({ g: 54, gVisible: 0 }, { g: 0, gVisible: 0 }, meta);
  assert.equal(sinVisible.noCabe, false);
  assert.equal(sinVisible.espacioVisible, 1);
  // Lo planeado (comida de casa sin grasa visible) no dispara el aviso.
  const conPlan = grasas({ g: 2, gVisible: 2 }, { g: 50, gVisible: 0 }, meta);
  assert.equal(conPlan.noCabe, false);
  assert.equal(conPlan.noCabePlan, false);
  // Visible que no cabe en el tope menos lo no visible registrado
  const g = grasas({ g: 60, gVisible: 15 }, { g: 0, gVisible: 0 }, meta);
  assert.equal(g.visible, 15);
  assert.equal(g.noVisible, 45);
  assert.equal(g.espacioVisible, 10); // 55 − 45
  assert.equal(g.noCabe, true);
  // Lo planeado con grasa visible que no cabe: aviso aparte
  const p = grasas({ g: 40, gVisible: 5 }, { g: 20, gVisible: 10 }, meta);
  assert.equal(p.noCabe, false);
  assert.equal(p.noCabePlan, true);
});

test('resumen de la semana: el día de hoy a medio registrar no entra al promedio hasta cerrarlo', () => {
  const dias = {
    '2030-01-07': { tipo: 'entreno', omega3: false, comidas: [{ kcal: 2000, p: 150, g: 60, c: 210, planeado: false }], resumen: { cerrado: true } },
    '2030-01-08': { tipo: 'descanso', omega3: false, comidas: [{ kcal: 400, p: 40, g: 10, c: 40, planeado: false }] },
  };
  const diasTot = diasConTotales({ dias, historialDias: [] }, {});
  const r = resumenSemana({ lunes: '2030-01-07', diasTot, pesos: [], metas, hasta: '2030-01-08' });
  assert.equal(r.kcalProm, 2000);
  assert.equal(r.hoyFuera, true);
  dias['2030-01-08'].resumen = { cerrado: true };
  const r2 = resumenSemana({ lunes: '2030-01-07', diasTot: diasConTotales({ dias, historialDias: [] }, {}), pesos: [], metas, hasta: '2030-01-08' });
  assert.equal(r2.kcalProm, 1200);
  assert.equal(r2.hoyFuera, false);
  // Una semana pasada entra completa
  const r3 = resumenSemana({ lunes: '2030-01-07', diasTot, pesos: [], metas, hasta: null });
  assert.equal(r3.dias.length, 2);
});

test('fechas: sumar días y diferencia', () => {
  assert.equal(sumarDias('2030-01-31', 1), '2030-02-01');
  assert.equal(difDias('2030-01-07', '2030-01-21'), 14);
});

test('con el día cerrado y todo dentro de la meta no dice "te falta"', () => {
  const todoOk = ['ok', 'ok', 'ok', 'ok'];
  assert.equal(textoFalta({ cerrado: true, estados: todoOk, faltan: ['1.2 G', '2.2 C'] }), 'Día cerrado: quedaste dentro de la meta.');
  // Sin cerrar, lo que falte sigue saliendo (null = mostrar "Te falta: …")
  assert.equal(textoFalta({ cerrado: false, estados: todoOk, faltan: ['1.2 G'] }), null);
  // Cerrado pero con algo mal: se sigue viendo lo que faltó
  assert.equal(textoFalta({ cerrado: true, estados: ['ok', 'mal', 'ok', 'ok'], faltan: ['30 P'] }), null);
  assert.equal(textoFalta({ cerrado: false, estados: todoOk, faltan: [] }), 'Llegaste a la meta.');
});
