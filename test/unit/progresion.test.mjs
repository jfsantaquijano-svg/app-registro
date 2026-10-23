import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  semanaDelBloque,
  esSemanaSuave,
  seriesDelDia,
  llevaFallo,
  rirMin,
  siguienteSesion,
  pasosBloque,
  transicion,
  pesosMaquina,
  pesoSiguiente,
  pesoAnterior,
  pesoBajado,
  ajusteEnSesion,
  sugerirPeso,
  tocaRecorte,
  reglaRecorte,
  zonaCumplio,
  ladoQueDecide,
  ordenLados,
  umbralDolor,
  descansoEntreBloques,
  recorridoMenor,
  recorridoSiEmpeora,
  clavesMismoEquipo,
  repsEfectivas,
  noLlegoAlMinimo,
  textosAjusteSesion,
  textosSeriesDesdeSemana,
  textoDuracion,
  textoSemanaSuave,
  limiteSubidas,
  puertaSesionesOk,
  sesionesEsperando,
  unaSubidaPorSesion,
  ejerciciosConNombre,
} from '../../src/progresion.js';

// Datos inventados para las pruebas (no son de ningún plan real).
const rutina = {
  inicio: '2030-01-07',
  semanasTrabajo: 4,
  semanaSuave: 5,
  suave: { series: { 5: 3, 4: 2, 3: 2, 2: 1, 1: 1 }, rir: '4', sinFallo: true, sinSubir: true },
  rotacion: ['S1', 'S2', 'S3'],
  ladoQueDecide: 'der',
  minutosRecorte: 75,
  vecesRecorte: 2,
  sesiones: [
    { id: 'S1', tipo: 'a', bloques: [] },
    { id: 'S2', tipo: 'b', bloques: [] },
    { id: 'S3', tipo: 'a', bloques: [] },
  ],
};
const ajustes = {
  umbralDolor: 4,
  zonas: {
    zona1: { nombre: 'Zona A', sesiones: ['a'], siEmpeora: 'recorrido', dormirAnula: true },
    zona2: { nombre: 'Zona B', sesiones: ['b'] },
  },
  textos: { eventoZona1NoSubir: 'texto de ejemplo del registro' },
};

const ejSimple = { id: 'e1', clave: 'k1', series: 3, repMin: 6, repMax: 9, rir: '1', pesoInicial: 40, incremento: null, noSubirSi: [] };

let n = 0;
function sesion(fecha, sesionId, ejercicios, extra = {}) {
  n++;
  return { id: `s${n}`, fecha, sesionId, gimnasio: 'G1', inicio: `${fecha}T10:00:00Z`, fin: `${fecha}T10:50:00Z`, suave: false, ejercicios, ...extra };
}
function series(kg, reps, rir = 1, extra = {}) {
  return reps.map((r) => ({ kg, reps: r, rir, lado: null, fallo: false, tramos: [], tecnica: 'normal', ...extra }));
}
const ctx = (ej, sesiones, extra = {}) => ({ rutina, ej, sesiones, dolor: [], ajustes, gimnasio: 'G1', hoy: '2030-01-20', alEmpezar: true, ...extra });

test('semana del bloque desde el lunes de inicio y semana suave', () => {
  assert.equal(semanaDelBloque(rutina, '2030-01-07'), 1);
  assert.equal(semanaDelBloque(rutina, '2030-01-13'), 1);
  assert.equal(semanaDelBloque(rutina, '2030-01-14'), 2);
  assert.equal(semanaDelBloque(rutina, '2030-02-04'), 5);
  assert.equal(semanaDelBloque(rutina, '2030-01-01'), 1);
  assert.equal(esSemanaSuave(rutina, 5), true);
  assert.equal(esSemanaSuave(rutina, 4), false);
});

test('semana suave: series reducidas, sin fallo y RIR suave', () => {
  const ej = { ...ejSimple, series: 4, fallo: true };
  assert.equal(seriesDelDia({ rutina, ej, semana: 5, ajustes, sesiones: [], dolor: [] }), 2);
  assert.equal(seriesDelDia({ rutina, ej: { ...ej, series: 5 }, semana: 5, ajustes, sesiones: [], dolor: [] }), 3);
  assert.equal(seriesDelDia({ rutina, ej: { ...ej, series: 2 }, semana: 5, ajustes, sesiones: [], dolor: [] }), 1);
  assert.equal(llevaFallo(rutina, ej, 5), false);
  assert.equal(llevaFallo(rutina, ej, 2), true);
  assert.equal(rirMin('1-2'), 1);
  assert.equal(rirMin('4'), 4);
});

test('series desde una semana si la zona cumplió (umbral del archivo) en las dos últimas sesiones de su tipo', () => {
  const ej = { ...ejSimple, series: 2, seriesDesdeSemana: [{ semana: 2, series: 3, condicion: 'zona1-ok-2-sesiones' }] };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'x', dolor: 3, series: [] }]), sesion('2030-01-10', 'S3', [{ clave: 'x', dolor: 4, series: [] }])];
  const dolorOk = [
    { fecha: '2030-01-09', zona: 'zona1', momento: 'manana', valor: 1 },
    { fecha: '2030-01-11', zona: 'zona1', momento: 'manana', valor: 4 },
  ];
  assert.equal(seriesDelDia({ rutina, ej, semana: 1, ajustes, sesiones: ses, dolor: dolorOk }), 2);
  assert.equal(seriesDelDia({ rutina, ej, semana: 2, ajustes, sesiones: ses, dolor: dolorOk }), 3);
  const dolorMal = [dolorOk[0], { ...dolorOk[1], valor: 5 }];
  assert.equal(seriesDelDia({ rutina, ej, semana: 2, ajustes, sesiones: ses, dolor: dolorMal }), 2);
  assert.equal(zonaCumplio({ rutina, ajustes, sesiones: ses, dolor: [dolorOk[0]], zona: 'zona1' }), false);
  // Sin umbral en el archivo, la condición no se da por cumplida.
  assert.equal(seriesDelDia({ rutina, ej, semana: 2, ajustes: { ...ajustes, umbralDolor: null }, sesiones: ses, dolor: dolorOk }), 2);
  assert.equal(umbralDolor({}), null);
});

test('rotación: la que sigue, ignorando el bloque anterior; orden por la hora real aunque cambie el desfase', () => {
  assert.equal(siguienteSesion(rutina, []), 'S1');
  assert.equal(siguienteSesion(rutina, [sesion('2029-12-01', 'S2', [], { soloLectura: true })]), 'S1');
  assert.equal(siguienteSesion(rutina, [sesion('2030-01-08', 'S1', []), sesion('2030-01-09', 'S2', [])]), 'S3');
  assert.equal(siguienteSesion(rutina, [sesion('2030-01-08', 'S3', [])]), 'S1');
  assert.equal(siguienteSesion(rutina, [sesion('2030-01-08', 'S1', []), sesion('2030-01-09', 'S2', [], { fin: null })]), 'S2');
  // S1 a las 02:00 (hora de la casa) escrita con otro desfase; S2 a las 07:00: S2 es la última.
  const a = { sesionId: 'S1', fin: 'x', inicio: '2030-03-10T08:00:00+01:00' };
  const b = { sesionId: 'S2', fin: 'x', inicio: '2030-03-10T07:00:00-05:00' };
  assert.equal(siguienteSesion(rutina, [a, b]), 'S3');
});

test('superserie: A → B por ronda, la que sobra va sola; a un lado primero el lado que decide', () => {
  const b = { ejercicios: [{}, {}] };
  const p = pasosBloque(b, [3, 4], [false, false]);
  assert.deepEqual(
    p.map((x) => `${x.ej}${x.serie}`),
    ['00', '10', '01', '11', '02', '12', '13'],
  );
  assert.equal(transicion(p, 0), 'cambio');
  assert.equal(transicion(p, 1), 'descanso');
  assert.equal(transicion(p, 5), 'descanso');
  assert.equal(transicion(p, 6), 'fin');
  // El archivo dice qué lado decide: ese va primero.
  assert.equal(ladoQueDecide(rutina, {}), 'der');
  assert.equal(ladoQueDecide(rutina, { ladoQueDecide: 'izq' }), 'izq');
  assert.equal(ladoQueDecide({}, {}), 'izq'); // por defecto, el primero de la lista
  const u = pasosBloque({ ejercicios: [{}] }, [2], [true], [ordenLados('der')]);
  assert.deepEqual(u.map((x) => x.lado), ['der', 'izq', 'der', 'izq']);
  assert.equal(transicion(u, 0), 'lado');
  assert.equal(transicion(u, 1), 'descanso');
  assert.equal(descansoEntreBloques({ descansoEntreBloquesSeg: 90 }), 90);
  assert.equal(descansoEntreBloques({}), 120);
});

test('pesos de máquina aprendidos por gimnasio (también del bloque anterior) y placa siguiente', () => {
  const ses = [
    sesion('2030-01-08', 'S1', [{ clave: 'k1', series: [{ kg: 50, reps: 10, tramos: [{ kg: 41, reps: 6 }, { kg: 33.4, reps: null }] }] }]),
    sesion('2030-01-09', 'S1', [{ clave: 'k1', series: [{ kg: 55, reps: 10 }] }], { gimnasio: 'G2' }),
    sesion('2029-12-01', 'S1', [{ clave: 'k1', series: [{ kg: 46.2, reps: 12 }] }], { soloLectura: true }),
  ];
  assert.deepEqual(pesosMaquina(ses, 'k1', 'G1'), [33.4, 41, 46.2, 50]);
  // Varias claves: los pesos que existen son los mismos (mancuernas, barras).
  assert.deepEqual(pesosMaquina([...ses, sesion('2030-01-10', 'S1', [{ clave: 'k9', series: [{ kg: 22, reps: 10 }] }])], ['k1', 'k9'], 'G1'), [22, 33.4, 41, 46.2, 50]);
  assert.equal(pesoSiguiente(41, [33.4, 41, 50]), 50);
  // Sin un peso conocido más arriba no se inventa el salto de la máquina: null.
  assert.equal(pesoSiguiente(50, [33.4, 41, 50]), null);
  assert.equal(pesoSiguiente(50, [33.4, 41, 50], 2.5), 52.5); // con paso (los botones + y −) sí
  assert.equal(pesoSiguiente(20, [20, 40]), 40); // el siguiente que ya usó, aunque esté lejos
  assert.equal(pesoSiguiente(70, [70, 80], 2.5, [80]), 72.5); // donde no llegó al mínimo, no
  assert.equal(pesoAnterior(50, [33.4, 41, 50]), 41);
  assert.equal(pesoAnterior(20, []), null);
  assert.equal(pesoAnterior(20, [], 2.5), 17.5);
  assert.equal(pesoBajado(100, [90, 92.5, 95, 100]), 95);
  assert.equal(pesoBajado(40, []), 37);
});

test('ajuste dentro de la sesión: solo después de la primera serie y solo la primera vez (sumar/restar)', () => {
  const ej = { repMin: 8, repMax: 10, ajusteSesion: [{ si: 'sobranMas3', accion: 'sumar', kg: 5 }, { si: 'noLlegaMin', accion: 'restar', kg: 5 }] };
  assert.equal(ajusteEnSesion(ej, { kg: 30, reps: 10, rir: 4 }, true, []).kg, 35);
  assert.equal(ajusteEnSesion(ej, { kg: 30, reps: 6, rir: 0 }, true, []).kg, 25);
  assert.equal(ajusteEnSesion(ej, { kg: 30, reps: 9, rir: 2 }, true, []), null);
  // Segunda serie: no se ajusta (ni por cansancio ni por sobrar).
  assert.equal(ajusteEnSesion(ej, { kg: 30, reps: 6, rir: 0 }, false, []), null);
  assert.equal(ajusteEnSesion(ej, { kg: 35, reps: 10, rir: 4 }, false, []), null);
  // Con el peso ya encontrado (no es la primera vez), sumar/restar no aplica.
  assert.equal(ajusteEnSesion(ej, { kg: 30, reps: 10, rir: 4 }, true, [], { primeraVez: false }), null);
  const placa = { repMin: 12, repMax: 14, ajusteSesion: [{ si: 'sobranMas3', accion: 'sumar', kg: null }] };
  assert.equal(ajusteEnSesion(placa, { kg: 20, reps: 14, rir: 4 }, true, [20, 22.7, 25]).kg, 22.7);
  assert.equal(ajusteEnSesion(placa, { kg: 20, reps: 14, rir: 0, fallo: true }, true, []), null);
});

test('ajuste "fijar": solo desde su peso de partida y nunca en contra de la condición', () => {
  const ej = {
    repMin: 5,
    repMax: 7,
    pesoInicial: 80,
    ajusteSesion: [
      { si: 'sobranMas3', accion: 'fijar', kg: 90, siKg: 80 },
      { si: 'primeraNoLlegaMin', accion: 'fijar', kg: 70, siKg: 80 },
    ],
  };
  assert.equal(ajusteEnSesion(ej, { kg: 80, reps: 7, rir: 4 }, true, []).kg, 90);
  assert.equal(ajusteEnSesion(ej, { kg: 80, reps: 4, rir: 1 }, true, []).kg, 70);
  // Ya progresó: no se vuelve a los números de partida.
  assert.equal(ajusteEnSesion(ej, { kg: 95, reps: 7, rir: 4 }, true, []), null);
  assert.equal(ajusteEnSesion(ej, { kg: 85, reps: 4, rir: 1 }, true, []), null);
  // En la dirección contraria nunca: con 95 y sobrando no baja a 90; con 65 sin llegar no sube a 70.
  const sinDesde = { repMin: 5, repMax: 7, ajusteSesion: [{ si: 'sobranMas3', accion: 'fijar', kg: 90, siKg: 95 }, { si: 'noLlegaMin', accion: 'fijar', kg: 70, siKg: 65 }] };
  assert.equal(ajusteEnSesion(sinDesde, { kg: 95, reps: 7, rir: 4 }, true, []), null);
  assert.equal(ajusteEnSesion(sinDesde, { kg: 65, reps: 4, rir: 1 }, true, []), null);
  // Solo después de la primera serie.
  assert.equal(ajusteEnSesion(ej, { kg: 80, reps: 4, rir: 1 }, false, []), null);
});

test('ajuste: no sube en la sesión si el dolor de antes ya pasa del umbral en un ejercicio con zona', () => {
  const ej = { repMin: 8, repMax: 10, zona: 'zona1', noSubirSi: ['dolorZona1Mas4'], ajusteSesion: [{ si: 'sobranMas3', accion: 'sumar', kg: null }, { si: 'noLlegaMin', accion: 'restar', kg: null }] };
  assert.equal(ajusteEnSesion(ej, { kg: 20, reps: 10, rir: 4 }, true, [], { dolorAntes: 5, umbral: 4 }), null);
  // Una placa, pero no se conoce ninguna más arriba: se dice y la persona la pone.
  const sinPlaca = ajusteEnSesion(ej, { kg: 20, reps: 10, rir: 4 }, true, [], { dolorAntes: 2, umbral: 4 });
  assert.equal(sinPlaca.kg, null);
  assert.equal(sinPlaca.unaPlaca, 'arriba');
  assert.equal(ajusteEnSesion(ej, { kg: 20, reps: 10, rir: 4 }, true, [20, 22.7], { dolorAntes: 2, umbral: 4 }).kg, 22.7);
  assert.equal(ajusteEnSesion(ej, { kg: 20, reps: 6, rir: 0 }, true, [18, 20], { dolorAntes: 5, umbral: 4 }).kg, 18); // bajar sí
});

test('doble progresión: sube lo mínimo solo con el tope en TODAS las series del plan al RIR indicado', () => {
  const placas = [sesion('2029-12-01', 'S1', [{ clave: 'k1', series: series(42.5, [8]) }], { soloLectura: true })];
  const sube = [...placas, sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(40, [9, 9, 9]) }])];
  const r = sugerirPeso(ctx(ejSimple, sube));
  assert.equal(r.accion, 'subir');
  assert.equal(r.kg, 42.5); // la placa que ya usó, no un salto inventado
  // Sin ninguna placa conocida más arriba: sube una placa y lo dice.
  const sinPlacas = sugerirPeso(ctx(ejSimple, [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(40, [9, 9, 9]) }])]));
  assert.equal(sinPlacas.accion, 'subir');
  assert.equal(sinPlacas.kg, 40);
  assert.equal(sinPlacas.subeUnaPlaca, true);
  assert.match(sinPlacas.motivo, /sube una placa/i);
  // El párrafo del salto de la máquina va aparte, para no repetirlo en cada renglón de la hoja de fin.
  assert.match(sinPlacas.notaPlaca, /no sé de cuánto es el salto/i);
  const falta = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(40, [9, 9, 8]) }])];
  assert.equal(sugerirPeso(ctx(ejSimple, falta)).accion, 'mantener');
  const rirBajo = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(40, [9, 9, 9], 0) }])];
  assert.equal(sugerirPeso(ctx(ejSimple, rirBajo)).accion, 'mantener');
  // Una sola serie hecha (de 3): no sube aunque esa llegara al tope.
  const una = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 3, series: series(40, [9]) }])];
  const r1 = sugerirPeso(ctx(ejSimple, una));
  assert.equal(r1.accion, 'mantener');
  assert.match(r1.motivo, /Faltaron series/);
  // Las series del plan guardadas al empezar mandan (ej. 4 ese día).
  const cuatro = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 4, series: series(40, [9, 9, 9]) }])];
  assert.equal(sugerirPeso(ctx(ejSimple, cuatro)).accion, 'mantener');
  // Con ⚡, la última del plan no cuenta como normal.
  const conRayo = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 3, falloPlan: true, series: [...series(40, [9, 9]), { kg: 40, reps: 10, rir: 0, lado: null, fallo: true, tramos: [] }] }])];
  assert.equal(sugerirPeso(ctx(ejSimple, conRayo)).accion, 'subir');
  // Con incremento fijo del archivo
  assert.equal(sugerirPeso(ctx({ ...ejSimple, incremento: 5 }, sube)).kg, 45);
  // Sin historial: peso de partida
  assert.equal(sugerirPeso(ctx(ejSimple, [])).kg, 40);
  assert.equal(sugerirPeso(ctx({ ...ejSimple, pesoInicial: null, pesoTexto: 'Por encontrar' }, [])).accion, 'buscar');
});

test('la ⚡ no cuenta, salvo que su primer tramo pase el tope por 3 o más', () => {
  const ej = { ...ejSimple, repMax: 14, repMin: 12, fallo: true };
  const conRayoBajo = [
    sesion('2030-01-08', 'S1', [{ clave: 'k1', series: [...series(25, [14, 14]), { kg: 25, reps: 11, rir: 0, lado: null, fallo: true, tramos: [{ kg: 20, reps: 5 }] }] }]),
  ];
  assert.equal(sugerirPeso(ctx(ej, conRayoBajo)).accion, 'subir'); // la ⚡ baja no impide
  const rayoAlto = [
    sesion('2030-01-08', 'S1', [{ clave: 'k1', series: [...series(25, [13, 12]), { kg: 25, reps: 18, rir: 0, lado: null, fallo: true, tramos: [{ kg: 20, reps: null }] }] }]),
  ];
  const r = sugerirPeso(ctx(ej, rayoAlto));
  assert.equal(r.accion, 'subir');
  assert.match(r.motivo, /⚡/);
  const rayoMedio = [
    sesion('2030-01-08', 'S1', [{ clave: 'k1', series: [...series(25, [13, 12]), { kg: 25, reps: 16, rir: 0, lado: null, fallo: true, tramos: [] }] }]),
  ];
  assert.equal(sugerirPeso(ctx(ej, rayoMedio)).accion, 'mantener');
});

test('a un lado decide el lado que dice el archivo', () => {
  const ej = { ...ejSimple, unilateral: true };
  const lados = (decide, otro) => [
    sesion('2030-01-08', 'S1', [
      {
        clave: 'k1',
        series: [0, 1, 2].flatMap(() => [
          { kg: 40, reps: decide, rir: 1, lado: 'der' },
          { kg: 40, reps: otro, rir: 1, lado: 'izq' },
        ]),
      },
    ]),
  ];
  assert.equal(sugerirPeso(ctx(ej, lados(9, 7))).accion, 'subir'); // decide el derecho (archivo)
  assert.equal(sugerirPeso(ctx(ej, lados(7, 9))).accion, 'mantener');
  assert.equal(sugerirPeso(ctx({ ...ej, ladoQueDecide: 'izq' }, lados(7, 9))).accion, 'subir');
});

test('peso de regreso solo desde el peso de partida; si ya progresó, repite y baja 5–10 % tras dos sesiones', () => {
  const ej = { ...ejSimple, pesoInicial: 40, pesoRegreso: 36 };
  const desdePartida = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(40, [6, 5, 5]) }])];
  const r = sugerirPeso(ctx(ej, desdePartida));
  assert.equal(r.accion, 'regreso');
  assert.equal(r.kg, 36);
  // Progresó a 42.5 y no llegó al mínimo: no lo manda al de regreso.
  const progreso = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(40, [9, 9, 9]) }]), sesion('2030-01-12', 'S1', [{ clave: 'k1', series: series(42.5, [5, 5, 5]) }])];
  const r2 = sugerirPeso(ctx(ej, progreso));
  assert.equal(r2.accion, 'mantener');
  assert.equal(r2.kg, 42.5);
  const dos = [...progreso, sesion('2030-01-15', 'S1', [{ clave: 'k1', series: series(42.5, [5, 5, 4]) }])];
  const r3 = sugerirPeso(ctx(ej, dos));
  assert.equal(r3.accion, 'bajar');
  assert.ok(r3.kg >= 38.25 && r3.kg <= 40.4, `kg ${r3.kg}`);
});

test('zonas: solo sube con dolor ≤ umbral en el ejercicio y en la mañana siguiente; si falta el dato no sube', () => {
  const ej = { ...ejSimple, zona: 'zona2', noSubirSi: ['dolorZona2Mas4'] };
  const ses = (dolor) => [sesion('2030-01-09', 'S2', [{ clave: 'k1', dolor, series: series(40, [9, 9, 9]) }])];
  const manana = (valor, extra = {}) => [{ fecha: '2030-01-10', zona: 'zona2', momento: 'manana', valor, ...extra }];
  assert.equal(sugerirPeso(ctx(ej, ses(4), { dolor: manana(4) })).accion, 'subir');
  assert.equal(sugerirPeso(ctx(ej, ses(5), { dolor: manana(1) })).accion, 'mantener');
  assert.equal(sugerirPeso(ctx(ej, ses(2), { dolor: manana(5) })).accion, 'mantener');
  // Sin número de la zona en esa sesión: no sube aunque la mañana esté bien
  const sinDolor = sugerirPeso(ctx(ej, ses(null), { dolor: manana(0) }));
  assert.equal(sinDolor.accion, 'mantener');
  assert.match(sinDolor.motivo, /falta el dolor de ese día/);
  // Falta el dato del día siguiente: al empezar la próxima sesión, no sube
  const sinDato = sugerirPeso(ctx(ej, ses(2), { dolor: [] }));
  assert.equal(sinDato.accion, 'mantener');
  assert.match(sinDato.motivo, /falta el dato/);
  // Recién terminada (mismo día): provisional
  const prov = sugerirPeso(ctx(ej, ses(2), { dolor: [], hoy: '2030-01-09', alEmpezar: false }));
  assert.equal(prov.accion, 'subir');
  assert.equal(prov.provisional, true);
});

test('el dolor de la mañana no cuenta si durmió sobre ese lado (zonas que lo anulan)', () => {
  const ej = { ...ejSimple, zona: 'zona1', noSubirSi: ['dolorZona1Mas4'] };
  const aj = { ...ajustes, zonas: { ...ajustes.zonas, zona1: { ...ajustes.zonas.zona1, siEmpeora: null } } };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 1, series: series(40, [9, 9, 9]) }])];
  const dolor = [{ fecha: '2030-01-09', zona: 'zona1', momento: 'manana', valor: 6, durmioSobre: true }];
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor, ajustes: aj })).accion, 'subir');
  dolor[0].durmioSobre = false;
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor, ajustes: aj })).accion, 'mantener');
});

test('registro de dolor fuera del gimnasio: frena la subida si tiene dolor (o no tiene número); con 0 no', () => {
  const ej = { ...ejSimple, zona: 'zona2', noSubirSi: ['eventoZona2DesdeUltimaSesion'] };
  const ses = [sesion('2030-01-09', 'S2', [{ clave: 'k1', dolor: 1, series: series(40, [9, 9, 9]) }])];
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor: [] })).accion, 'subir');
  const ev = (valor) => [{ fecha: '2030-01-10', zona: 'zona2', momento: 'evento', valor }];
  const r = sugerirPeso(ctx(ej, ses, { dolor: ev(3) }));
  assert.equal(r.accion, 'mantener');
  assert.match(r.motivo, /dolor fuera del gimnasio/);
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor: ev(null) })).accion, 'mantener');
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor: ev(0) })).accion, 'subir');
  // El texto sale del archivo cuando lo trae
  const ej1 = { ...ej, zona: 'zona1', noSubirSi: ['eventoZona1DesdeUltimaSesion'] };
  const s1 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 1, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  const r1 = sugerirPeso(ctx(ej1, s1, { dolor: [{ fecha: '2030-01-09', zona: 'zona1', momento: 'manana', valor: 1 }, { fecha: '2030-01-09', zona: 'zona1', momento: 'evento', valor: 2 }] }));
  assert.match(r1.motivo, /texto de ejemplo del registro/);
});

test('si la zona empeora: la próxima vez menos recorrido; ya en el menor, menos peso', () => {
  const ej = { ...ejSimple, zona: 'zona1', recorridos: [100, 80], registraRecorrido: true, noSubirSi: ['dolorZona1Mas4'] };
  assert.equal(recorridoMenor(ej, 100), 80);
  assert.equal(recorridoMenor(ej, 80), null);
  assert.equal(recorridoMenor(ej, null), 80);
  // Dolor durante por encima del umbral
  const s1 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 6, recorrido: 100, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  const r = sugerirPeso(ctx(ej, s1, { dolor: [{ fecha: '2030-01-09', zona: 'zona1', momento: 'manana', valor: 1 }] }));
  assert.equal(r.recorrido, 80);
  assert.equal(r.kg, 40);
  assert.match(r.motivo, /hasta 80°/);
  // La mañana siguiente peor que antes de empezar: solo en los ejercicios con empeoraPorManana
  const s2 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 2, recorrido: 100, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  const manPeor = { dolor: [{ fecha: '2030-01-09', zona: 'zona1', momento: 'manana', valor: 3 }] };
  const r2 = sugerirPeso(ctx({ ...ej, empeoraPorManana: true }, s2, manPeor));
  assert.equal(r2.recorrido, 80);
  assert.match(r2.motivo, /amaneció en 3/);
  // Sin ese campo, amanecer peor no frena ese ejercicio (el plan solo condiciona algunos).
  assert.equal(sugerirPeso(ctx(ej, s2, manPeor)).accion, 'subir');
  // Sin empeorar: sigue y conserva el recorrido
  const r3 = sugerirPeso(ctx(ej, s2, { dolor: [{ fecha: '2030-01-09', zona: 'zona1', momento: 'manana', valor: 1 }] }));
  assert.equal(r3.accion, 'subir');
  assert.equal(r3.recorrido, 100);
  // Ya en el recorrido menor y vuelve a empeorar: baja el peso
  const s3 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 6, recorrido: 80, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  const r4 = sugerirPeso(ctx(ej, s3));
  assert.equal(r4.accion, 'bajar');
  assert.ok(r4.kg < 40);
  // Un ejercicio sin recorridos: la primera vez no sube; si sigue, baja. Y no se habla de recorrido.
  const sinRec = { ...ejSimple, zona: 'zona1' };
  const p1 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 6, series: series(40, [9, 9, 9]) }])];
  const rp1 = sugerirPeso(ctx(sinRec, p1));
  assert.equal(rp1.accion, 'mantener');
  assert.doesNotMatch(rp1.motivo, /recorrido/);
  const p2 = [...p1, sesion('2030-01-10', 'S3', [{ clave: 'k1', dolor: 5, series: series(40, [9, 9, 9]) }])];
  assert.equal(sugerirPeso(ctx(sinRec, p2)).accion, 'bajar');
});

test('si la zona empeora son dos pasos: directo al recorrido corto y, si sigue, menos peso', () => {
  const ej = { ...ejSimple, zona: 'zona1', recorridos: [90, 75, 60], recorridoSiEmpeora: 60, registraRecorrido: true };
  assert.equal(recorridoSiEmpeora(ej, 90), 60);
  assert.equal(recorridoSiEmpeora(ej, 75), 60);
  assert.equal(recorridoSiEmpeora(ej, 60), null);
  assert.equal(recorridoSiEmpeora(ej, null), 60);
  // Sin el dato en el archivo se usa el menor que sigue (un paso cada vez).
  assert.equal(recorridoSiEmpeora({ recorridos: [90, 75, 60] }, 90), 75);
  const conDolor = (recorrido, fecha, sesionId) => sesion(fecha, sesionId, [{ clave: 'k1', dolor: 6, recorrido, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } });
  // Paso 1: el recorrido corto, mismo peso (no pasa por 75°).
  const r1 = sugerirPeso(ctx(ej, [conDolor(90, '2030-01-08', 'S1')]));
  assert.equal(r1.recorrido, 60);
  assert.equal(r1.kg, 40);
  // Paso 2: ya en el corto y vuelve a empeorar, menos peso.
  const r2 = sugerirPeso(ctx(ej, [conDolor(90, '2030-01-08', 'S1'), conDolor(60, '2030-01-10', 'S3')]));
  assert.equal(r2.accion, 'bajar');
  assert.ok(r2.kg < 40);
  assert.match(r2.motivo, /recorrido corto/);
});

test('lo anotado en la noche también frena la subida si el archivo lo pide', () => {
  const ej = { ...ejSimple, zona: 'zona1', noSubirSi: ['eventoZona1DesdeUltimaSesion'] };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 1, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  const noche = (valor) => ({ dolor: [{ fecha: '2030-01-08', zona: 'zona1', momento: 'noche', valor }] });
  // Por defecto solo cuenta lo anotado fuera del gimnasio.
  assert.equal(sugerirPeso(ctx(ej, ses, noche(2))).accion, 'subir');
  const aj = { ...ajustes, zonas: { ...ajustes.zonas, zona1: { ...ajustes.zonas.zona1, momentosEvento: ['evento', 'noche'] } } };
  assert.equal(sugerirPeso(ctx(ej, ses, { ...noche(2), ajustes: aj })).accion, 'mantener');
  assert.equal(sugerirPeso(ctx(ej, ses, { ...noche(0), ajustes: aj })).accion, 'subir');
});

test('llegar al mínimo cuenta las que le quedaban: 8 quedando a 0 no es llegar a 8 quedando a 2', () => {
  const ej = { repMin: 8, repMax: 10, rir: '2' };
  assert.equal(repsEfectivas(ej, { reps: 8, rir: 2 }), 8);
  assert.equal(repsEfectivas(ej, { reps: 8, rir: 0 }), 6);
  assert.equal(repsEfectivas(ej, { reps: 9, rir: 1 }), 8);
  assert.equal(repsEfectivas(ej, { reps: 10, rir: 4 }), 10); // sobrar no suma
  assert.equal(repsEfectivas(ej, { reps: null, rir: 2 }), null); // sin dato
  assert.equal(repsEfectivas(ej, { reps: 8, rir: 0, fallo: true }), 8); // la ⚡ va al fallo
  assert.equal(noLlegoAlMinimo(ej, { reps: 8, rir: 0 }), true);
  assert.equal(noLlegoAlMinimo(ej, { reps: 8, rir: 2 }), false);
  assert.equal(noLlegoAlMinimo(ej, { reps: null, rir: null }), false);
  // El ajuste dentro de la sesión lo usa: 20 × 8 quedando a 0 baja a 18.
  const press = { repMin: 8, repMax: 10, rir: '2', pesoInicial: 20, ajusteSesion: [{ si: 'primeraNoLlegaMin', accion: 'fijar', kg: 18, siKg: 20 }] };
  assert.equal(ajusteEnSesion(press, { kg: 20, reps: 8, rir: 0 }, true, []).kg, 18);
  assert.equal(ajusteEnSesion(press, { kg: 20, reps: 7, rir: 2 }, true, []).kg, 18);
  assert.equal(ajusteEnSesion(press, { kg: 20, reps: 8, rir: 2 }, true, []), null);
  // Y la sugerencia de la próxima vez también.
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(20, [8, 8, 8], 0) }])];
  const ej2 = { ...ejSimple, repMin: 8, repMax: 10, rir: '2', pesoInicial: 20 };
  assert.match(sugerirPeso(ctx(ej2, ses)).motivo, /No llegaste al mínimo/);
});

test('con mancuernas, si con el par nuevo no llega al mínimo vuelve al par anterior', () => {
  const ej = { ...ejSimple, repMin: 8, repMax: 10, rir: '2', pesoInicial: 18, volverAlAnterior: true };
  const ses = [
    sesion('2029-12-20', 'S1', [{ clave: 'k1', series: series(18, [10]) }], { soloLectura: true }),
    sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(20, [7, 7, 7], 2) }]),
  ];
  const r = sugerirPeso(ctx(ej, ses));
  assert.equal(r.accion, 'regreso');
  assert.equal(r.kg, 18);
  // Sin el campo, se repite el peso (y baja 5–10 % tras dos sesiones seguidas).
  assert.equal(sugerirPeso(ctx({ ...ej, volverAlAnterior: false }, ses)).accion, 'mantener');
});

test('la serie de prueba de un peso por encontrar no es una serie que falte', () => {
  const ej = { ...ejSimple, repMin: 12, repMax: 15, rir: '2', series: 2, pesoInicial: null, porEncontrar: true, pesoTexto: 'Por encontrar' };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 2, series: [...series(20, [15], 4), ...series(22.5, [15], 2)] }])];
  const r = sugerirPeso(ctx(ej, ses));
  assert.equal(r.accion, 'mantener');
  assert.match(r.motivo, /fue de prueba/);
  assert.doesNotMatch(r.motivo, /Faltaron series/);
});

test('si en la sesión bajó de peso por la regla del plan, la próxima vez vuelve al peso que no le salió', () => {
  const ej = { ...ejSimple, repMin: 8, repMax: 10, rir: '1', pesoInicial: 60, series: 4 };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 4, series: [...series(60, [7], 1), ...series(56, [10, 10, 10], 1)] }])];
  const r = sugerirPeso(ctx(ej, ses));
  assert.equal(r.accion, 'subir');
  assert.equal(r.kg, 60);
  assert.match(r.motivo, /tope en las series de 56 kg/);
  assert.match(r.motivo, /vuelve a 60 kg/);
});

test('sesión cargada a mano, sin el dato de las series: no sube y lo dice', () => {
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: null, series: [{ kg: 50, reps: null, rir: null, lado: null, fallo: false, tramos: [] }] }])];
  const r = sugerirPeso(ctx(ejSimple, ses));
  assert.equal(r.accion, 'mantener');
  assert.equal(r.kg, 50);
  assert.match(r.motivo, /Faltan datos/);
});

test('claves del mismo equipo y textos armados con los datos del plan', () => {
  const r = { equipos: { mancuernas: ['a', 'b', 'c'] } };
  assert.deepEqual(clavesMismoEquipo(r, 'b'), ['a', 'b', 'c']);
  assert.deepEqual(clavesMismoEquipo(r, 'z'), ['z']);
  assert.deepEqual(clavesMismoEquipo(null, 'z'), ['z']);
  const ej = { repMin: 8, ajusteSesion: [{ si: 'sobranMas3', accion: 'fijar', kg: 44 }, { si: 'primeraNoLlegaMin', accion: 'fijar', kg: 33 }, { si: 'noLlegaMin', accion: 'restar', kg: null }, { si: 'sobranMas3', accion: 'sumar', kg: 10 }] };
  assert.deepEqual(textosAjusteSesion(ej), ['Si te sobran más de 3: 44 kg.', 'Si la primera no llega a 8: 33 kg.', 'Si no llegas a 8: una placa menos.', 'Si te sobran más de 3: +10 kg.']);
  assert.deepEqual(textosSeriesDesdeSemana({ seriesDesdeSemana: [{ semana: 3, series: 3, texto: 'si la zona viene bien.' }] }), ['3 series desde la semana 3 si la zona viene bien.']);
  assert.equal(textoDuracion({ duracionMin: 67 }), '~67 min');
  assert.equal(textoDuracion({ duracionMin: 67, duracionDesdeSemana: { semana: 3, min: 70 } }), '~67 min (~70 desde la semana 3)');
  assert.match(textoSemanaSuave(rutina), /Donde hay 5 series haces 3/);
  assert.match(textoSemanaSuave(rutina), /quedando a 4/);
  assert.match(textoSemanaSuave(rutina), /no subes/);
  assert.equal(textoSemanaSuave({}), null);
});

test('en la semana suave no se sube el peso dentro de la sesión', () => {
  const ej = { repMin: 12, repMax: 15, rir: '1', pesoInicial: 180, ajusteSesion: [{ si: 'sobranMas3', accion: 'fijar', kg: 200, siKg: 180 }, { si: 'noLlegaMin', accion: 'fijar', kg: 160, siKg: 180 }] };
  assert.equal(ajusteEnSesion(ej, { kg: 180, reps: 13, rir: 4 }, true, []).kg, 200);
  assert.equal(ajusteEnSesion(ej, { kg: 180, reps: 13, rir: 4 }, true, [], { sinSubir: true }), null);
  // Bajar sí se puede en la semana suave.
  assert.equal(ajusteEnSesion(ej, { kg: 180, reps: 10, rir: 1 }, true, [], { sinSubir: true }).kg, 160);
});

test('peso de partida desde otro ejercicio y una placa arriba de un peso de referencia', () => {
  const de = { ...ejSimple, clave: 'k2', pesoInicial: null, pesoInicialDe: 'k1', pesoTexto: 'El del otro' };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: [...series(31.7, [9, 9]), { kg: 31.7, reps: 12, rir: 0, lado: null, fallo: true, tramos: [] }] }])];
  const r = sugerirPeso(ctx(de, ses));
  assert.equal(r.kg, 31.7);
  assert.equal(r.accion, 'inicial');
  assert.equal(sugerirPeso(ctx(de, [])).accion, 'buscar');
  const ref = { ...ejSimple, pesoInicial: null, pesoReferencia: 40, pesoTexto: 'Una placa arriba de 40 kg' };
  const sinPlacas = sugerirPeso(ctx(ref, []));
  assert.equal(sinPlacas.kg, null);
  assert.equal(sinPlacas.referencia, 40);
  assert.equal(sinPlacas.motivo, 'Una placa arriba de 40 kg');
  const conPlacas = [sesion('2029-12-01', 'S2', [{ clave: 'k1', series: series(43.6, [8]) }], { soloLectura: true })];
  assert.equal(sugerirPeso(ctx(ref, conPlacas)).kg, 43.6);
});

test('semana suave: no se sube; solo compara el mismo gimnasio; solo lectura no cuenta', () => {
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(40, [9, 9, 9]) }])];
  assert.equal(sugerirPeso(ctx(ejSimple, ses, { hoy: '2030-02-05' })).accion, 'mantener');
  const otroGym = sugerirPeso(ctx(ejSimple, ses, { gimnasio: 'G2' }));
  assert.equal(otroGym.accion, 'inicial');
  assert.equal(otroGym.kg, 40);
  const lectura = [sesion('2030-01-08', 'S1', [{ clave: 'k1', series: series(70, [10, 10, 10]) }], { soloLectura: true })];
  assert.equal(sugerirPeso(ctx(ejSimple, lectura)).kg, 40);
});

test('recorte con los minutos y las veces del archivo; sin regla en el archivo no hay aviso', () => {
  const larga = (f) => sesion(f, 'S1', [], { inicio: `${f}T10:00:00Z`, fin: `${f}T11:20:00Z` });
  const regla = reglaRecorte(rutina);
  assert.deepEqual(regla, { minutos: 75, veces: 2 });
  assert.equal(tocaRecorte([larga('2030-01-08')], 'S1', regla), false);
  assert.equal(tocaRecorte([larga('2030-01-08'), larga('2030-01-12')], 'S1', regla), true);
  assert.equal(tocaRecorte([larga('2030-01-08'), larga('2030-01-12')], 'S2', regla), false);
  assert.equal(reglaRecorte({}), null);
  assert.equal(tocaRecorte([larga('2030-01-08'), larga('2030-01-12')], 'S1', null), false);
});

test('el peso de trabajo es el de la última serie normal (después de ajustar en la sesión)', () => {
  const ej = { ...ejSimple, pesoInicial: 80, pesoRegreso: 70 };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 3, series: [...series(80, [4]), ...series(70, [9, 9, 9])] }])];
  const r = sugerirPeso(ctx(ej, ses));
  assert.equal(r.accion, 'subir');
  // Llegó al tope con 70 kg después de que 80 no le saliera: vuelve a 80 y busca el mínimo.
  assert.equal(r.kg, 80);
});

test('si la primera serie bajó de peso en la sesión, igual cuenta para completar las series del plan', () => {
  const ej = { ...ejSimple, series: 4, pesoInicial: 80 };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 4, series: [...series(80, [5]), ...series(72.5, [9, 9, 9])] }])];
  const r = sugerirPeso(ctx(ej, ses));
  assert.equal(r.accion, 'subir');
  assert.equal(r.kg, 80);
  // Una serie más liviana (la de prueba) no cuenta: faltó una al peso de trabajo.
  const prueba = [sesion('2030-01-08', 'S1', [{ clave: 'k1', seriesPlan: 2, series: [...series(20, [9], 4), ...series(22.5, [9])] }])];
  const r2 = sugerirPeso(ctx({ ...ej, series: 2 }, prueba));
  assert.equal(r2.accion, 'mantener');
  assert.match(r2.motivo, /Faltaron series/);
});

test('subirTrasSesionesOk: el peso no sube con una sola vez, sino con N sesiones seguidas cumpliéndolo todo', () => {
  // Peso quieto con salida: sube el incremento del plan solo tras dos sesiones seguidas al tope,
  // con el valor de dolor registrado por debajo del umbral y la respuesta posterior no mayor que antes.
  const ej = {
    ...ejSimple,
    zona: 'zona1',
    incremento: 2.5,
    subirTrasSesionesOk: 2,
    empeoraPorManana: true,
    noSubirSi: ['dolorZona1Mas4'],
  };
  const ok = (fecha, id) => sesion(fecha, id, [{ clave: 'k1', dolor: 2, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } });
  const man = (fecha, valor = 1) => ({ fecha, zona: 'zona1', momento: 'manana', valor });

  const una = sugerirPeso(ctx(ej, [ok('2030-01-08', 'S1')], { dolor: [man('2030-01-09')] }));
  assert.equal(una.accion, 'mantener');
  assert.equal(una.kg, 40);
  assert.deepEqual(una.espera, { n: 2, ok: 1, falta: 1 });
  assert.match(una.motivo, /2 sesiones seguidas/);

  const dos = sugerirPeso(ctx(ej, [ok('2030-01-08', 'S1'), ok('2030-01-10', 'S3')], { dolor: [man('2030-01-09'), man('2030-01-11')] }));
  assert.equal(dos.accion, 'subir');
  assert.equal(dos.kg, 42.5);

  // Falta el dato de la mañana de una de las dos: la cuenta no llega y el peso se queda.
  const sinMan = sugerirPeso(ctx(ej, [ok('2030-01-08', 'S1'), ok('2030-01-10', 'S3')], { dolor: [man('2030-01-11')] }));
  assert.equal(sinMan.accion, 'mantener');
  assert.equal(sinMan.espera.ok, 1);

  // Una sesión que no cumple vuelve la cuenta a cero, aunque las de antes cumplieran.
  const corta = [ok('2030-01-08', 'S1'), sesion('2030-01-10', 'S3', [{ clave: 'k1', dolor: 2, series: series(40, [9, 9, 8]) }], { dolorAntes: { zona1: 1 } }), ok('2030-01-13', 'S1')];
  const tras = sugerirPeso(ctx(ej, corta, { dolor: [man('2030-01-09'), man('2030-01-11'), man('2030-01-14')] }));
  assert.equal(tras.accion, 'mantener');
  assert.equal(tras.espera.ok, 1);

  // Sin el campo, una sola sesión al tope sí sube: la puerta es opcional.
  assert.equal(sugerirPeso(ctx({ ...ej, subirTrasSesionesOk: null }, [ok('2030-01-08', 'S1')], { dolor: [man('2030-01-09')] })).accion, 'subir');
});

test('bajarSoloSiManana: una molestia puntual acorta el recorrido pero no quita kilos', () => {
  const ej = { ...ejSimple, zona: 'zona1', recorridos: [90, 60], recorridoSiEmpeora: 60, registraRecorrido: true, empeoraPorManana: true, bajarSoloSiManana: true };
  const man = (fecha, valor) => ({ fecha, zona: 'zona1', momento: 'manana', valor });
  // Primer dolor por encima del umbral: al recorrido corto, mismo peso (igual que la regla general).
  const s1 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 6, recorrido: 90, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  assert.equal(sugerirPeso(ctx(ej, s1, { dolor: [man('2030-01-09', 1)] })).recorrido, 60);
  // Ya en el recorrido corto y vuelve la molestia puntual: con la regla general bajaría; aquí repite el peso.
  const s2 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 6, recorrido: 60, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  const r = sugerirPeso(ctx(ej, s2, { dolor: [man('2030-01-09', 1)] }));
  assert.equal(r.accion, 'mantener');
  assert.equal(r.kg, 40);
  assert.match(r.motivo, /los kilos bajan solo si la mañana siguiente queda peor/);
  // Sin el campo, el mismo caso sí baja el peso.
  assert.equal(sugerirPeso(ctx({ ...ej, bajarSoloSiManana: false }, s2, { dolor: [man('2030-01-09', 1)] })).accion, 'bajar');
  // Amaneció peor: ahí sí baja.
  const s3 = [sesion('2030-01-08', 'S1', [{ clave: 'k1', dolor: 2, recorrido: 60, series: series(40, [9, 9, 9]) }], { dolorAntes: { zona1: 1 } })];
  const peor = sugerirPeso(ctx(ej, s3, { dolor: [man('2030-01-09', 3)] }));
  assert.equal(peor.accion, 'bajar');
  assert.ok(peor.kg < 40);
});

test('tope de subidas: una sesión puede quitarlo con su propio subidasPorSesion', () => {
  const rut = { ...rutina, subidasPorSesion: 1 };
  assert.equal(limiteSubidas(rut, { id: 'S2' }), 1);
  assert.equal(limiteSubidas(rut, { id: 'S2', subidasPorSesion: 0 }), null);
  const a = { ...ejSimple, id: 'a', clave: 'ka', nombre: 'Ejercicio A' };
  const b = { ...ejSimple, id: 'b', clave: 'kb', nombre: 'Ejercicio B' };
  const ses = [sesion('2030-01-08', 'S1', [{ clave: 'ka', series: series(40, [9, 9, 9]) }, { clave: 'kb', series: series(30, [9, 9, 9]) }])];
  const lista = [a, b].map((ej) => ({ ej, sug: sugerirPeso({ ...ctx(ej, ses), rutina: rut }) }));
  const libre = unaSubidaPorSesion({ rutina: rut, sesiones: ses, gimnasio: 'G1', lista, sesion: { id: 'S2', subidasPorSesion: 0 } });
  assert.deepEqual(libre.map((x) => x.sug.accion), ['subir', 'subir']);
  const conTope = unaSubidaPorSesion({ rutina: rut, sesiones: ses, gimnasio: 'G1', lista, sesion: { id: 'S1' } });
  assert.deepEqual(conTope.map((x) => x.sug.accion), ['subir', 'mantener']);
});

test('registro fuerte en las horas siguientes a una sesión: esa sesión queda fuera de la subida', () => {
  const ej = { ...ejSimple, zona: 'zona1', noSubirSi: ['dolorZona1Mas4', 'eventoZona1Mas3o30minEn48h'] };
  const ses = [sesion('2030-01-09', 'S1', [{ clave: 'k1', dolor: 2, series: series(40, [9, 9, 9]) }])];
  const man1 = { fecha: '2030-01-10', zona: 'zona1', momento: 'manana', valor: 0 };
  const ev = (fecha, valor, duracionMin = null) => ({ fecha, zona: 'zona1', momento: 'evento', valor, duracionMin });
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor: [man1] })).accion, 'subir');
  const fuerte = sugerirPeso(ctx(ej, ses, { dolor: [man1, ev('2030-01-10', 5)] }));
  assert.equal(fuerte.accion, 'mantener');
  assert.match(fuerte.motivo, /episodio fuerte/);
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor: [man1, ev('2030-01-11', 2, 45)] })).accion, 'mantener');
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor: [man1, ev('2030-01-10', 2, 10)] })).accion, 'subir');
  assert.equal(sugerirPeso(ctx(ej, ses, { dolor: [man1, ev('2030-01-13', 6)] })).accion, 'subir');
  // Con puerta de varias sesiones, la sesión seguida de un registro fuerte no cuenta.
  const ejP = { ...ej, subirTrasSesionesOk: 2 };
  const dos = [ses[0], sesion('2030-01-12', 'S1', [{ clave: 'k1', dolor: 2, series: series(40, [9, 9, 9]) }])];
  const man2 = { fecha: '2030-01-13', zona: 'zona1', momento: 'manana', valor: 0 };
  assert.deepEqual(puertaSesionesOk(ctx(ejP, dos, { dolor: [man1, man2] })), { n: 2, ok: 2, falta: 0 });
  assert.deepEqual(puertaSesionesOk(ctx(ejP, dos, { dolor: [man1, man2, ev('2030-01-13', 5)] })), { n: 2, ok: 0, falta: 2 });
});

test('tope de subidas por sesión: el turno es del que más tiempo lleva sin subir', () => {
  const rut = { ...rutina, subidasPorSesion: 1 };
  assert.equal(limiteSubidas(rut), 1);
  assert.equal(limiteSubidas(rutina), null);
  const a = { ...ejSimple, id: 'a', clave: 'ka', nombre: 'Ejercicio A' };
  const b = { ...ejSimple, id: 'b', clave: 'kb', nombre: 'Ejercicio B' };
  // A lleva dos sesiones con el mismo peso; B subió en la última, así que espera menos.
  const ses = [
    sesion('2030-01-08', 'S1', [{ clave: 'ka', series: series(40, [9, 9, 9]) }, { clave: 'kb', series: series(30, [9, 9, 9]) }]),
    sesion('2030-01-10', 'S3', [{ clave: 'ka', series: series(40, [9, 9, 9]) }, { clave: 'kb', series: series(35, [9, 9, 9]) }]),
  ];
  assert.equal(sesionesEsperando({ rutina: rut, ej: a, sesiones: ses, gimnasio: 'G1' }), 2);
  assert.equal(sesionesEsperando({ rutina: rut, ej: b, sesiones: ses, gimnasio: 'G1' }), 0);
  const lista = [a, b].map((ej) => ({ ej, sug: sugerirPeso({ ...ctx(ej, ses), rutina: rut }) }));
  assert.deepEqual(lista.map((x) => x.sug.accion), ['subir', 'subir']);
  const conRegla = unaSubidaPorSesion({ rutina: rut, sesiones: ses, gimnasio: 'G1', lista });
  assert.deepEqual(conRegla.map((x) => x.sug.accion), ['subir', 'mantener']);
  // El que cede repite el peso que ya hacía y dice a quién le toca.
  assert.equal(conRegla[1].sug.kg, 35);
  assert.equal(conRegla[1].sug.cedeA, 'Ejercicio A');
  assert.match(conRegla[1].sug.motivo, /el turno de subir es de Ejercicio A/);
  // Sin el límite en la rutina, no se toca nada.
  assert.deepEqual(unaSubidaPorSesion({ rutina, sesiones: ses, gimnasio: 'G1', lista }).map((x) => x.sug.accion), ['subir', 'subir']);
});

test('los textos del ajuste de sesión solo salen con el peso al que ese ajuste se aplica', () => {
  const ej = {
    ...ejSimple,
    pesoInicial: 80,
    ajusteSesion: [
      { si: 'sobranMas3', accion: 'fijar', kg: 100, siKg: 80 },
      { si: 'primeraNoLlegaMin', accion: 'fijar', kg: 70 },
      { si: 'sobranMas3', accion: 'sumar', kg: 10 },
    ],
  };
  // Sin peso: todos (la rutina completa, donde no hay un peso de hoy).
  assert.equal(textosAjusteSesion(ej).length, 3);
  // Con el peso de partida y siendo la primera vez: los tres se pueden aplicar.
  assert.equal(textosAjusteSesion(ej, 80, true).length, 3);
  // Ya no es la primera vez: el de "sumar" no aplica.
  assert.deepEqual(textosAjusteSesion(ej, 80, false), ['Si te sobran más de 3: 100 kg.', 'Si la primera no llega a 6: 70 kg.']);
  // Con otro peso, los de "fijar" tampoco: no se imprime una regla que no va a pasar.
  assert.deepEqual(textosAjusteSesion(ej, 95, false), []);
});

test('lista de ejercicios: el nombre repetido en dos claves distintas dice de qué sesión es cada uno', () => {
  const rut = {
    sesiones: [
      {
        id: 'S1',
        nombre: 'Sesión uno',
        bloques: [{ ejercicios: [{ clave: 'laterales-1', nombre: 'Elevaciones laterales' }, { clave: 'sentadilla', nombre: 'Sentadilla' }] }],
      },
      { id: 'S2', nombre: 'Sesión dos', bloques: [{ ejercicios: [{ clave: 'laterales-2', nombre: 'Elevaciones laterales' }] }] },
    ],
  };
  const m = ejerciciosConNombre(rut, []);
  // El nombre está en dos claves distintas: cada uno dice su sesión.
  assert.deepEqual(m.get('laterales-1'), { nombre: 'Elevaciones laterales', sub: 'Sesión uno' });
  assert.deepEqual(m.get('laterales-2'), { nombre: 'Elevaciones laterales', sub: 'Sesión dos' });
  // El que no se repite queda limpio.
  assert.deepEqual(m.get('sentadilla'), { nombre: 'Sentadilla', sub: null });
  // El mismo ejercicio en dos sesiones es una sola clave: tampoco hace falta aclarar nada.
  const unaClave = ejerciciosConNombre(
    { sesiones: [{ nombre: 'A', bloques: [{ ejercicios: [{ clave: 'k', nombre: 'Remo en máquina' }] }] }, { nombre: 'B', bloques: [{ ejercicios: [{ clave: 'k', nombre: 'Remo en máquina' }] }] }] },
    [],
  );
  assert.deepEqual(unaClave.get('k'), { nombre: 'Remo en máquina', sub: null });
  // Un ejercicio que solo está en el historial (ya no está en la rutina) también sale.
  const viejo = ejerciciosConNombre(rut, [{ ejercicios: [{ clave: 'viejo', nombre: 'Ejercicio de antes' }] }]);
  assert.deepEqual(viejo.get('viejo'), { nombre: 'Ejercicio de antes', sub: null });
});
