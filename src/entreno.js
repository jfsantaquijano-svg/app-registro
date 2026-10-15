// Entreno: la sesión que sigue, el registro por serie, el cronómetro y el peso de la próxima vez.
import { S, guardar, guardarSinAviso, getDia, uid, sesionActiva } from './estado.js';
import { hoy, isoLocal, horaLocal, fechaCorta, fmtDuracion, fechaDeIso } from './fechas.js';
import { r1, num, fmtKg } from './calculos.js';
import {
  semanaDelBloque,
  esSemanaSuave,
  bloqueTerminado,
  rirMin,
  zonasDeSesion,
  seriesDelDia,
  llevaFallo,
  rirDelDia,
  siguienteSesion,
  sesionesValidas,
  pasosBloque,
  transicion,
  pesosMaquina,
  pesoSiguiente,
  pesoAnterior,
  ajusteEnSesion,
  sugerirPeso,
  duracionMin,
  clavesMismoEquipo,
  tocaRecorte,
  reglaRecorte,
  textosAjusteSesion,
  textosSeriesDesdeSemana,
  textoDuracion,
  umbralDolor,
  ladoQueDecide,
  ordenLados,
  descansoEntreBloques,
  unaSubidaPorSesion,
  ejerciciosConNombre,
} from './progresion.js';
import { h, montar, hoja, confirmar, aviso, stepper, chips, escala010, casilla, campo, inputNum, inputTexto, seccion, vacio } from './ui.js';

const CAMBIO_SEG = 15;
// Lo que mueven los botones + y − cuando no hay un peso conocido al lado: lo decide la persona
// mirando la máquina, no la app (la app nunca propone un salto que no haya visto antes).
const PASO_MANUAL = 2.5;
const NOMBRE_LADO = { izq: 'izquierda', der: 'derecha' };

/** Frase del archivo sobre entrenar una sola vez al día. */
function textoUnaPorDia() {
  return S.ajustes?.textos?.unaSesionPorDia || 'Esta sesión queda para el próximo día.';
}

/** ¿Ya hubo una sesión terminada hoy? */
function yaEntrenoHoy() {
  const ult = sesionesValidas(S.reg.sesiones).slice(-1)[0];
  return !!ult && (ult.fecha || fechaDeIso(ult.inicio)) === hoy();
}

function nombreLado(l) {
  const n = NOMBRE_LADO[l] || l || '';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Aviso de recorte (solo si el archivo define cuántos minutos y cuántas veces). */
function textoRecorte(rs, prefijo) {
  const regla = reglaRecorte(S.rutina);
  if (!regla || !rs?.recorte || !tocaRecorte(S.reg.sesiones, rs.id, regla)) return null;
  return h('div', { class: 'aviso alerta' }, h('p', {}, `${prefijo(regla)}${rs.recorte}`));
}

let sesionElegida = null;
let audioCtx = null;
let wakeLock = null;
let ticker = null;
let scrollPendiente = false;

// ---------- Audio, vibración y pantalla encendida ----------

function asegurarAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* sin sonido */
  }
}

function pitar() {
  if (!audioCtx || document.visibilityState !== 'visible') return;
  try {
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.25 + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.25);
      o.stop(t0 + i * 0.25 + 0.2);
    }
  } catch {
    /* sin sonido */
  }
}

async function pedirPantalla() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {
    wakeLock = null;
  }
}

function soltarPantalla() {
  try {
    wakeLock?.release();
  } catch {
    /* nada */
  }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sesionActiva()) {
    pedirPantalla();
    const t = S.ui.sesionActiva?.timer;
    if (t && !t.avisado && Date.now() >= t.fin) {
      // Terminó con la app oculta: no suena, solo se muestra "terminado hace X".
      t.avisado = true;
      guardarSinAviso('ui');
    }
  }
});

// ---------- Datos de la sesión ----------

function rutinaSesion(id) {
  return (S.rutina?.sesiones || []).find((s) => s.id === id) || null;
}

function todosLosEjercicios(rs) {
  return rs.bloques.flatMap((b) => b.ejercicios);
}

function gimnasioPorDefecto() {
  const val = sesionesValidas(S.reg.sesiones);
  return val.length ? val[val.length - 1].gimnasio : S.ajustes?.gimnasioPorDefecto || S.ajustes?.gimnasios?.[0] || 'Gimnasio';
}

// Van todas las sesiones, también las del bloque anterior: no cuentan para el historial de sugerencias
// (eso lo filtra sesionesValidas) pero sí enseñan las placas y los pares de mancuernas que existen.
function ctxSugerencia(ej, gimnasio, alEmpezar) {
  return { rutina: S.rutina, ej, sesiones: S.reg.sesiones, dolor: S.reg.dolor, ajustes: S.ajustes, gimnasio, hoy: hoy(), alEmpezar };
}

/**
 * Sugerencias de todos los ejercicios de una sesión, ya con la regla del plan de que
 * un solo ejercicio sube de peso por sesión. Devuelve un mapa por id de ejercicio.
 */
function sugerenciasDeSesion(rs, gimnasio, alEmpezar = false, soloConDatos = null) {
  const ejs = todosLosEjercicios(rs).filter((ej) => (soloConDatos ? !!soloConDatos(ej) : true));
  const lista = unaSubidaPorSesion({
    rutina: S.rutina,
    sesiones: S.reg.sesiones,
    gimnasio,
    lista: ejs.map((ej) => ({ ej, sug: sugerirPeso(ctxSugerencia(ej, gimnasio, alEmpezar)) })),
  });
  return new Map(lista.map(({ ej, sug }) => [ej.id, sug]));
}

/** Pesos que ya se registraron en esa máquina o en ese par de mancuernas, en ese gimnasio. */
function conocidosDe(ej, gimnasio) {
  return pesosMaquina(S.reg.sesiones, clavesMismoEquipo(S.rutina, ej.clave), gimnasio);
}

/** Nota del ejercicio: la del plan y, si hoy toca ese número de series, la que depende de las series. */
function notaEj(ej, series) {
  const extra = ej.notaSiSeries && (series == null || series >= Number(ej.notaSiSeries.min)) ? ej.notaSiSeries.texto : null;
  return [ej.nota, extra].filter(Boolean).join(' ') || null;
}

/** Bloques de hoy: sin los ejercicios que se dejaron para el final, y esos al final, cada uno solo. */
function bloquesDe(rs) {
  const alFinal = S.ui.sesionActiva?.alFinal || [];
  if (!alFinal.length) return rs.bloques;
  const base = rs.bloques.map((b) => (b.ejercicios.some((ej) => alFinal.includes(ej.id)) ? { ...b, ejercicios: b.ejercicios.filter((ej) => !alFinal.includes(ej.id)) } : b));
  const extras = alFinal.map((id) => {
    const b = rs.bloques.find((x) => x.ejercicios.some((ej) => ej.id === id));
    const ej = b?.ejercicios.find((x) => x.id === id);
    return { id: `${id}-final`, tipo: 'simple', descansoSeg: b?.descansoSeg || 90, ejercicios: ej ? [ej] : [], alFinal: true };
  });
  return [...base, ...extras];
}

export function planDelDia(rs, fecha) {
  const semana = semanaDelBloque(S.rutina, fecha);
  const plan = {};
  for (const ej of todosLosEjercicios(rs)) {
    plan[ej.id] = {
      series: seriesDelDia({ rutina: S.rutina, ej, semana, ajustes: S.ajustes, sesiones: S.reg.sesiones, dolor: S.reg.dolor }),
      fallo: llevaFallo(S.rutina, ej, semana),
      rir: rirDelDia(S.rutina, ej, semana),
    };
  }
  return { semana, plan, suave: esSemanaSuave(S.rutina, semana) };
}

function textoRepRango(ej) {
  return ej.repMin === ej.repMax ? `${ej.repMin}` : `${ej.repMin}–${ej.repMax}`;
}

function textoRir(rir) {
  if (rir == null || rir === '') return '';
  return `quedar a ${String(rir).replace('-', '–')}`;
}

function textoPlan(ej, p) {
  const partes = [`${p.series} × ${textoRepRango(ej)}${ej.unilateral ? ` ${ej.unilateralTexto || 'por lado'}` : ''}`];
  if (p.rir && !(p.fallo && p.series === 1)) partes.push(textoRir(p.rir));
  if (p.fallo) partes.push('⚡ la última al fallo');
  return partes.join(' · ');
}

function textoSug(sug) {
  if (!sug) return '';
  if (sug.kg == null) return sug.motivo || 'Peso por encontrar';
  if (sug.subeUnaPlaca) return `${fmtKg(sug.kg)} kg + una placa`;
  return `${fmtKg(sug.kg)} kg`;
}

// ---------- Empezar ----------

function abrirEmpezar(rs) {
  const hj = hoja({ titulo: `Empezar: ${rs.nombre}`, testid: 'hoja-empezar' });
  const zonas = zonasDeSesion(S.ajustes, rs.tipo);
  const dolor = {};
  let gimnasio = gimnasioPorDefecto();
  const gyms = [...new Set([...(S.ajustes?.gimnasios || []), gimnasio])];
  const selGym = chips({ opciones: gyms.map((g) => ({ valor: g, texto: g })), valor: gimnasio, testid: 'gimnasio', alElegir: (v) => (gimnasio = v) });
  const fOtro = inputTexto({ placeholder: 'Otro gimnasio', etiqueta: 'Otro gimnasio', testid: 'otro-gym' });
  const { semana, suave } = planDelDia(rs, hoy());
  montar(
    hj.cuerpo,
    h('p', { class: 'suave' }, `Semana ${semana} del bloque${suave ? ' · semana suave' : ''} · ${textoDuracion(rs)}`),
    textoRecorte(rs, (r) => `Esta sesión ya pasó de ${r.minutos} min ${r.veces} veces. Recorte: `),
    zonas.map((z) =>
      h(
        'div',
        { class: 'mb' },
        h('div', { class: 'etq-linea' }, `Dolor de 0\u00a0a\u00a010 en ${(S.ajustes.zonas[z].nombre || z).toLowerCase()}, ahora`),
        escala010({ testid: `dolor-antes-${z}`, alElegir: (v) => (dolor[z] = v) }),
      ),
    ),
    h('div', { class: 'etq-linea' }, '¿Dónde entrenas?'),
    selGym,
    h('details', { class: 'mt' }, h('summary', { class: 'suave chico' }, 'Otro gimnasio'), fOtro),
    h(
      'div',
      { class: 'fila-btns fila-fija' },
      h(
        'button',
        {
          class: 'btn btn-primario btn-grande',
          type: 'button',
          testid: 'empezar-ya',
          onclick: async () => {
            asegurarAudio();
            if (yaEntrenoHoy() && !(await confirmar('¿Entrenar otra vez hoy?', { si: 'Sí, entrenar', titulo: 'Ya entrenaste hoy', detalle: textoUnaPorDia() }))) return;
            const faltan = zonas.filter((z) => dolor[z] == null);
            if (faltan.length) return aviso('Marca el dolor de ahora (0 a 10).');
            const otro = fOtro.value.trim();
            if (otro) {
              gimnasio = otro;
              S.ajustes.gimnasios = [...new Set([...(S.ajustes.gimnasios || []), otro])];
            }
            hj.cerrar();
            await empezarSesion(rs, gimnasio, dolor);
          },
        },
        'Empezar',
      ),
    ),
  );
}

export async function empezarSesion(rs, gimnasio, dolorAntes) {
  const fecha = hoy();
  const { semana, plan, suave } = planDelDia(rs, fecha);
  // Las sugerencias con las que arranca la sesión ya traen la regla de un solo ejercicio que sube.
  const sug = Object.fromEntries(sugerenciasDeSesion(rs, gimnasio, true));
  const reg = {
    id: uid(),
    fecha,
    sesionId: rs.id,
    nombre: rs.nombre,
    gimnasio,
    inicio: isoLocal(),
    fin: null,
    semanaBloque: semana,
    suave,
    dolorAntes: { ...dolorAntes },
    ejercicios: todosLosEjercicios(rs).map((ej) => ({
      ejercicioId: ej.id,
      clave: ej.clave,
      nombre: ej.nombre,
      seriesPlan: plan[ej.id]?.series ?? ej.series,
      falloPlan: !!plan[ej.id]?.fallo,
      series: [],
      dolor: null,
      recorrido: null,
      alarmas: [],
      nota: '',
    })),
    soloLectura: false,
    notas: '',
  };
  S.reg.sesiones.push(reg);
  S.ui.sesionActiva = { id: reg.id, orden: rs.bloques.map((_, i) => i), plan, sug, timer: null, calentamiento: [], preguntados: [], pesoAjustado: {}, alFinal: [] };
  const d = getDia(fecha, true);
  if (!d.tipo) d.tipo = 'entreno';
  sesionElegida = null;
  await pedirPantalla();
  await guardar('reg.sesiones', 'reg.dias', 'ui', 'ajustes');
}

// ---------- Pasos y estado ----------

function datosEj(reg, ejId) {
  return reg.ejercicios.find((e) => e.ejercicioId === ejId);
}

function infoBloque(reg, rs, bi) {
  const ui = S.ui.sesionActiva;
  const b = bloquesDe(rs)[bi];
  if (!b) return { b: { id: `b${bi}`, tipo: 'simple', descansoSeg: 0, ejercicios: [] }, pasos: [], hechos: [], siguiente: -1, completo: true };
  const series = b.ejercicios.map((ej) => ui.plan[ej.id]?.series ?? ej.series);
  const pasos = pasosBloque(
    b,
    series,
    b.ejercicios.map((ej) => !!ej.unilateral),
    b.ejercicios.map((ej) => ordenLados(ladoQueDecide(S.rutina, ej))),
  );
  const hechos = pasos.map((p) => {
    const e = datosEj(reg, b.ejercicios[p.ej].id);
    const lista = (e?.series || []).filter((s) => (p.lado ? s.lado === p.lado : true));
    return lista.length > p.serie;
  });
  const siguiente = hechos.indexOf(false);
  return { b, pasos, hechos, siguiente, completo: siguiente === -1 };
}

function bloqueActual(reg, rs) {
  for (const bi of S.ui.sesionActiva.orden) {
    if (!infoBloque(reg, rs, bi).completo) return bi;
  }
  return null;
}

function precargar(reg, ej, paso) {
  const ui = S.ui.sesionActiva;
  const e = datosEj(reg, ej.id);
  const lista = e.series;
  const decide = ladoQueDecide(S.rutina, ej);
  if (paso.lado && paso.lado !== decide) {
    // El otro lado copia el peso y las repeticiones del primero.
    const primero = lista.filter((s) => s.lado === decide)[paso.serie];
    if (primero) return { kg: primero.kg, reps: primero.reps, rir: primero.rir };
  }
  const previas = lista.filter((s) => s.lado == null || s.lado === decide);
  const ultima = previas[previas.length - 1];
  const rmin = rirMin(ui.plan[ej.id]?.rir);
  let kg = ui.pesoAjustado?.[ej.id] ?? ultima?.kg ?? ui.sug?.[ej.id]?.kg ?? null;
  let reps = ultima?.reps ?? null;
  if (reps == null) {
    const ant = sesionesValidas(S.reg.sesiones)
      .reverse()
      .map((s) => s.ejercicios.find((x) => x.clave === ej.clave))
      .find((x) => x?.series?.length);
    reps = ant?.series.filter((s) => !s.fallo && (s.lado == null || s.lado === decide))[paso.serie]?.reps ?? ej.repMin;
  }
  return { kg, reps, rir: rmin ?? 2 };
}

// ---------- Cronómetro ----------

async function iniciarTimer(seg, texto, sigue = '') {
  S.ui.sesionActiva.timer = { fin: Date.now() + seg * 1000, total: seg * 1000, texto, sigue, avisado: false };
  await guardarSinAviso('ui');
}

function cajaTimer() {
  const t = S.ui.sesionActiva?.timer;
  if (!t) return null;
  const num = h('div', { class: 'descanso-num', id: 'timer-num', testid: 'timer' });
  const txt = h('div', { class: 'descanso-txt', id: 'timer-txt' });
  const caja = h(
    'div',
    { class: 'descanso', id: 'timer-caja' },
    num,
    txt,
    h(
      'button',
      {
        class: 'btn btn-chico btn-sec',
        type: 'button',
        onclick: async () => {
          S.ui.sesionActiva.timer = null;
          await guardarSinAviso('ui');
          caja.remove();
        },
      },
      'Quitar',
    ),
  );
  actualizarTimer(caja);
  return caja;
}

function actualizarTimer(caja = document.getElementById('timer-caja')) {
  const t = S.ui.sesionActiva?.timer;
  if (!caja || !t) return;
  const resta = t.fin - Date.now();
  const num = caja.querySelector('#timer-num');
  const txt = caja.querySelector('#timer-txt');
  const linea = (arriba, abajo) => {
    txt.replaceChildren(h('b', {}, arriba), ' ', h('span', { class: 'descanso-sigue' }, abajo || ''));
  };
  if (resta > 0) {
    caja.classList.remove('terminado');
    num.textContent = fmtDuracion(resta);
    const [arriba, ...resto] = String(t.texto).split('. ');
    linea(resto.length ? `${arriba}.` : arriba, resto.join('. '));
  } else {
    caja.classList.add('terminado');
    num.textContent = '✓';
    linea(`Descanso terminado hace ${fmtDuracion(-resta)}.`, t.sigue);
    if (!t.avisado && document.visibilityState === 'visible') {
      t.avisado = true;
      try {
        navigator.vibrate?.([300, 120, 300]);
      } catch {
        /* nada */
      }
      pitar();
      guardarSinAviso('ui');
    }
  }
}

function arrancarTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => {
    const reg = sesionActiva();
    if (!reg) return clearInterval(ticker);
    const reloj = document.getElementById('reloj-sesion');
    if (reloj) reloj.textContent = fmtDuracion(Date.now() - new Date(reg.inicio).getTime());
    actualizarTimer();
  }, 250);
}

// ---------- Guardar una serie ----------

async function guardarSerie(reg, rs, bi, k, datos) {
  asegurarAudio();
  const ui = S.ui.sesionActiva;
  const { b, pasos } = infoBloque(reg, rs, bi);
  const paso = pasos[k];
  const ej = b.ejercicios[paso.ej];
  const e = datosEj(reg, ej.id);
  const esUltima = paso.serie === (ui.plan[ej.id]?.series ?? ej.series) - 1;
  const fallo = !!(ui.plan[ej.id]?.fallo && esUltima);
  const serie = {
    kg: datos.kg,
    reps: datos.reps,
    rir: fallo ? 0 : datos.rir,
    lado: paso.lado,
    fallo,
    tramos: fallo ? datos.tramos || [] : [],
    tecnica: fallo ? datos.tecnica || 'normal' : 'normal',
  };
  e.series.push(serie);
  // Ajuste dentro de la sesión: solo después de la primera serie normal (a un lado, la del lado que decide).
  const decide = ladoQueDecide(S.rutina, ej);
  if (!fallo && (paso.lado == null || paso.lado === decide)) {
    const normalesPrevias = e.series.filter((s) => !s.fallo && (s.lado == null || s.lado === decide));
    const conocidos = conocidosDe(ej, reg.gimnasio);
    const aj = ajusteEnSesion(ej, serie, normalesPrevias.length === 1, conocidos, {
      primeraVez: ['inicial', 'buscar'].includes(ui.sug?.[ej.id]?.accion),
      dolorAntes: ej.zona ? reg.dolorAntes?.[ej.zona] ?? null : null,
      umbral: umbralDolor(S.ajustes),
      sinSubir: !!reg.suave && S.rutina?.suave?.sinSubir !== false,
    });
    if (aj) {
      ui.pesoAjustado = { ...(ui.pesoAjustado || {}), [ej.id]: aj.kg };
      ui.ajusteTexto = {
        ...(ui.ajusteTexto || {}),
        [ej.id]: aj.kg == null ? `${aj.motivo}: la siguiente con una placa ${aj.unaPlaca === 'abajo' ? 'menos' : 'más'}. No sé de cuánto es el salto: míralo en la máquina` : `${aj.motivo}: la siguiente con ${fmtKg(aj.kg)} kg`,
      };
    } else if (ui.pesoAjustado && ej.id in ui.pesoAjustado) {
      // Ya aplicó el ajuste (o lo puso a mano): el aviso no se queda pegado.
      ui.pesoAjustado[ej.id] = serie.kg;
      if (ui.ajusteTexto) delete ui.ajusteTexto[ej.id];
    }
  }
  // Cronómetro
  const tr = transicion(pasos, k);
  if (tr === 'lado') {
    S.ui.sesionActiva.timer = null;
  } else if (tr === 'cambio') {
    const sig = b.ejercicios[pasos[k + 1].ej];
    await iniciarTimer(CAMBIO_SEG, `Pasa a ${sig.nombre}.`, `Ahora: ${sig.nombre}.`);
  } else if (tr === 'descanso') {
    const sig = b.ejercicios[pasos[k + 1].ej];
    const ladoSig = pasos[k + 1].lado;
    const sigue = `Sigue: ${sig.nombre}${ladoSig ? ` (${NOMBRE_LADO[ladoSig] || ladoSig})` : ''}.`;
    await iniciarTimer(b.descansoSeg || 90, `Descanso. ${sigue}`, sigue);
  } else if (bloqueActual(reg, rs) != null) {
    const entre = descansoEntreBloques(S.rutina);
    await iniciarTimer(entre, `Bloque terminado: máximo ${fmtDuracion(entre * 1000)} y sigue con el siguiente bloque.`, 'Sigue con el siguiente bloque.');
  } else {
    // Era el último bloque: no hay descanso que esperar.
    S.ui.sesionActiva.timer = null;
  }
  scrollPendiente = true;
  await guardar('reg.sesiones', 'ui');
  // Preguntas al terminar el ejercicio (en el descanso, no entre A y B de la superserie)
  if (tr === 'descanso' || tr === 'fin') {
    const info = infoBloque(reg, rs, bi);
    const terminados = b.ejercicios.filter((x, i) => info.pasos.every((p, j) => p.ej !== i || info.hechos[j]) && !ui.preguntados.includes(x.id));
    const conPreguntas = terminados.filter((x) => x.zona || x.registraRecorrido);
    ui.preguntados.push(...terminados.map((x) => x.id));
    await guardarSinAviso('ui');
    if (conPreguntas.length) abrirPreguntasEjercicio(reg, conPreguntas);
  }
}

function abrirPreguntasEjercicio(reg, ejercicios) {
  const hj = hoja({ titulo: 'Al terminar el ejercicio', testid: 'hoja-post' });
  const resp = {};
  const alarmas = S.ajustes?.alarmas || [];
  montar(
    hj.cuerpo,
    ejercicios.map((ej) => {
      resp[ej.id] = { dolor: null, recorrido: null, alarmas: new Set(), nota: '' };
      const zona = ej.zona ? S.ajustes?.zonas?.[ej.zona] : null;
      const nota = inputTexto({ placeholder: 'Nota técnica (opcional)', etiqueta: 'Nota', testid: `nota-${ej.id}` });
      nota.addEventListener('change', () => (resp[ej.id].nota = nota.value.trim()));
      return h(
        'div',
        { class: 'tarjeta' },
        h('h3', { class: 'tarjeta-tit' }, ej.nombre),
        zona ? h('div', { class: 'etq-linea' }, `Dolor de 0\u00a0a\u00a010 en ${(zona.nombre || ej.zona).toLowerCase()}, durante el ejercicio`) : null,
        zona ? escala010({ testid: `dolor-ej-${ej.id}`, alElegir: (v) => (resp[ej.id].dolor = v) }) : null,
        ej.registraRecorrido && ej.recorridos?.length
          ? h(
              'div',
              {},
              h('div', { class: 'etq-linea' }, '¿Hasta dónde bajaste?'),
              chips({ opciones: ej.recorridos.map((r) => ({ valor: r, texto: `${r}°` })), testid: `recorrido-${ej.id}`, alElegir: (v) => (resp[ej.id].recorrido = v) }),
            )
          : null,
        zona && alarmas.length
          ? h(
              'details',
              { class: 'mt' },
              h('summary', { class: 'etq-linea' }, 'Alarmas (marca si pasó algo de esto)'),
              alarmas.map((a, i) =>
                casilla(a, {
                  testid: `alarma-${ej.id}-${i}`,
                  alCambiar: (v) => (v ? resp[ej.id].alarmas.add(a) : resp[ej.id].alarmas.delete(a)),
                }),
              ),
            )
          : null,
        nota,
      );
    }),
    h(
      'div',
      { class: 'fila-btns fila-fija' },
      h(
        'button',
        {
          class: 'btn btn-primario btn-grande',
          type: 'button',
          testid: 'guardar-post',
          onclick: async () => {
            let alarma = false;
            const consejos = [];
            const umbral = umbralDolor(S.ajustes);
            for (const ej of ejercicios) {
              const r = resp[ej.id];
              if (ej.zona && r.dolor == null) return aviso('Marca el dolor de 0 a 10.');
              const e = datosEj(reg, ej.id);
              e.dolor = ej.zona ? r.dolor : null;
              e.recorrido = r.recorrido;
              e.alarmas = [...r.alarmas];
              if (r.nota) e.nota = r.nota;
              if (r.alarmas.size) alarma = true;
              const cons = ej.zona ? S.ajustes?.zonas?.[ej.zona]?.consejoSiPasaUmbral : null;
              if (cons && umbral != null && r.dolor != null && r.dolor > umbral) consejos.push(`${ej.nombre}: ${cons}`);
            }
            hj.cerrar();
            scrollPendiente = true;
            await guardar('reg.sesiones');
            if (alarma) mostrarAlarma();
            else if (consejos.length) mostrarConsejo(consejos);
          },
        },
        'Guardar',
      ),
    ),
  );
}

function mostrarConsejo(lineas) {
  const hj = hoja({ titulo: 'Qué hacer con ese dolor', testid: 'hoja-consejo' });
  montar(
    hj.cuerpo,
    h('div', { class: 'aviso alerta' }, lineas.map((t) => h('p', { class: 'texto-grande' }, t))),
    h('button', { class: 'btn btn-sec btn-ancho', type: 'button', onclick: () => hj.cerrar() }, 'Entendido'),
  );
}

function mostrarAlarma() {
  const hj = hoja({ titulo: 'Atención', testid: 'hoja-alarma' });
  montar(hj.cuerpo, h('div', { class: 'aviso peligro' }, h('p', { class: 'texto-grande' }, S.ajustes?.avisoAlarma || 'Consulta al médico.')), h('button', { class: 'btn btn-sec btn-ancho', type: 'button', onclick: () => hj.cerrar() }, 'Entendido'));
}

// ---------- Panel de registro ----------

function panelSerie(reg, rs, bi, k) {
  const ui = S.ui.sesionActiva;
  const { b, pasos } = infoBloque(reg, rs, bi);
  const paso = pasos[k];
  const ej = b.ejercicios[paso.ej];
  const p = ui.plan[ej.id] || { series: ej.series, rir: ej.rir, fallo: ej.fallo };
  const esUltima = paso.serie === p.series - 1;
  const fallo = !!(p.fallo && esUltima);
  const pre = precargar(reg, ej, paso);
  const conocidos = conocidosDe(ej, reg.gimnasio);
  const decide = ladoQueDecide(S.rutina, ej);
  // Sin peso puesto, + y − parten del peso de referencia del archivo.
  const ref = ui.sug?.[ej.id]?.referencia ?? null;
  let rir = pre.rir;
  let tecnica = 'normal';
  const tramos = [];
  const kg = stepper({
    valor: pre.kg,
    sufijo: 'kg',
    testid: 'kg',
    etiqueta: 'Peso',
    menos: (v) => (v == null ? ref ?? conocidos[0] ?? 0 : pesoAnterior(v, conocidos, PASO_MANUAL)),
    mas: (v) => (v == null ? (ref != null ? pesoSiguiente(ref, conocidos, PASO_MANUAL) : conocidos[0] ?? PASO_MANUAL) : pesoSiguiente(v, conocidos, PASO_MANUAL)),
  });
  const reps = stepper({ valor: pre.reps, decimal: false, sufijo: 'reps', testid: 'reps', etiqueta: 'Repeticiones', menos: (v) => Math.max(0, (v ?? 1) - 1), mas: (v) => (v ?? 0) + 1 });
  const selRir = chips({
    opciones: [0, 1, 2, 3, 4].map((v) => ({ valor: v, texto: v === 4 ? '4+' : String(v) })),
    valor: rir,
    testid: 'rir',
    clase: 'rir',
    alElegir: (v) => (rir = v),
  });
  const contTramos = h('div', { testid: 'tramos' });
  function pintarTramos() {
    montar(
      contTramos,
      tramos.map((t, i) => {
        const sk = stepper({
          valor: t.kg,
          sufijo: 'kg',
          testid: `tramo-kg-${i}`,
          etiqueta: `Peso bajada ${i + 1}`,
          menos: (v) => pesoAnterior(v ?? 0, conocidos, PASO_MANUAL),
          mas: (v) => pesoSiguiente(v ?? 0, conocidos, PASO_MANUAL),
          alCambiar: (v) => (t.kg = v),
        });
        const sr = stepper({ valor: t.reps, decimal: false, sufijo: 'reps', testid: `tramo-reps-${i}`, etiqueta: `Repeticiones bajada ${i + 1}`, menos: (v) => Math.max(0, (v ?? 1) - 1), mas: (v) => (v ?? 0) + 1, alCambiar: (v) => (t.reps = v) });
        const nr = casilla('No lo recuerdo', {
          checked: t.reps === null && t.noRecuerda,
          testid: `tramo-norecuerdo-${i}`,
          alCambiar: (v) => {
            t.noRecuerda = v;
            sr.style.opacity = v ? 0.35 : 1;
          },
        });
        return h('div', { class: 'tramo' }, h('div', { class: 'etq-linea' }, `Bajada ${i + 1}`, h('button', { class: 'btn-texto', type: 'button', onclick: () => (tramos.splice(i, 1), pintarTramos()) }, 'Quitar')), sk, sr, nr);
      }),
    );
  }
  const selTecnica = chips({
    opciones: [
      { valor: 'normal', texto: 'Normal' },
      { valor: 'bajada', texto: 'Bajada' },
      { valor: 'pausa', texto: 'Pausa' },
      { valor: 'bombeo', texto: 'Bombeo' },
    ],
    valor: tecnica,
    testid: 'tecnica',
    alElegir: (v) => (tecnica = v),
  });
  const ladoTxt = paso.lado ? ` · ${nombreLado(paso.lado)}` : '';
  return h(
    'div',
    { class: 'registro-serie', testid: 'registro-serie' },
    h('h4', { testid: 'titulo-serie' }, `${ej.nombre}: serie ${paso.serie + 1} de ${p.series}${ladoTxt}${fallo ? ' ⚡ al fallo' : ''}`),
    ej.unilateral && paso.serie === 0 && paso.lado === decide && S.ajustes?.textos?.unaPierna ? h('p', { class: 'suave chico' }, S.ajustes.textos.unaPierna) : null,
    paso.serie === 0 && pre.kg == null ? h('p', { class: 'chico', testid: 'pista-peso' }, `${ui.sug?.[ej.id]?.motivo ? `${ui.sug[ej.id].motivo}. ` : ''}Escribe el peso de la máquina o tócalo con +`) : null,
    paso.serie === 0 && pre.kg != null && ui.sug?.[ej.id]?.porConfirmar ? h('p', { class: 'chico', testid: 'pista-confirmar' }, 'Confírmalo en la máquina: si hay una placa intermedia, ajústala con + y −') : null,
    ej.porEncontrar && paso.serie === 0 && S.ajustes?.textos?.porEncontrar ? h('p', { class: 'suave chico' }, S.ajustes.textos.porEncontrar) : null,
    ui.ajusteTexto?.[ej.id] ? h('div', { class: 'ajuste-sug', testid: 'ajuste' }, ui.ajusteTexto[ej.id]) : null,
    kg,
    h('div', { class: 'mt' }, reps),
    fallo
      ? h(
          'div',
          {},
          h('div', { class: 'etq-linea' }, 'Técnica que usó el entrenador'),
          selTecnica,
          contTramos,
          h(
            'button',
            {
              class: 'btn btn-sec btn-ancho mt',
              type: 'button',
              testid: 'mas-bajada',
              onclick: () => {
                const ultimo = tramos.length ? tramos[tramos.length - 1].kg : kg.valor();
                tramos.push({ kg: ultimo != null ? pesoAnterior(ultimo, conocidos, PASO_MANUAL) : null, reps: null, noRecuerda: false });
                if (tecnica === 'normal') {
                  tecnica = 'bajada';
                  selTecnica.fijar('bajada');
                }
                pintarTramos();
              },
            },
            '+ bajada',
          ),
        )
      : h('div', {}, h('div', { class: 'etq-linea' }, '¿Cuántas te quedaban?'), selRir),
    h(
      'button',
      {
        class: 'btn btn-primario btn-grande mt',
        type: 'button',
        testid: 'guardar-serie',
        onclick: () => {
          const vk = kg.valor();
          const vr = reps.valor();
          if (vk == null) return aviso('Escribe el peso.');
          if (vr == null) return aviso('Escribe las repeticiones.');
          guardarSerie(reg, rs, bi, k, {
            kg: vk,
            reps: vr,
            rir,
            tecnica,
            tramos: tramos.map((t) => ({ kg: t.kg, reps: t.noRecuerda ? null : t.reps })),
          });
        },
      },
      paso.lado && ej.unilateral ? `Guardar ${NOMBRE_LADO[paso.lado] || paso.lado}` : 'Guardar serie',
    ),
  );
}

// ---------- Editar una serie ----------

function editarSerie(reg, e, idx) {
  const s = e.series[idx];
  const hj = hoja({ titulo: `${e.nombre}: serie` });
  const kg = inputNum({ valor: s.kg, etiqueta: 'Peso' });
  const reps = inputNum({ valor: s.reps, decimal: false, etiqueta: 'Repeticiones' });
  let rir = s.rir;
  montar(
    hj.cuerpo,
    campo('Peso (kg)', kg),
    campo('Repeticiones', reps),
    s.fallo ? null : h('div', {}, h('div', { class: 'etq-linea' }, '¿Cuántas te quedaban?'), chips({ opciones: [0, 1, 2, 3, 4].map((v) => ({ valor: v, texto: v === 4 ? '4+' : String(v) })), valor: rir, clase: 'rir', alElegir: (v) => (rir = v) })),
    h(
      'div',
      { class: 'fila-btns' },
      h(
        'button',
        {
          class: 'btn btn-peligro',
          type: 'button',
          onclick: async () => {
            if (!(await confirmar('¿Borrar esta serie?', { si: 'Borrar', peligro: true }))) return;
            e.series.splice(idx, 1);
            hj.cerrar();
            await guardar('reg.sesiones');
          },
        },
        'Borrar',
      ),
      h(
        'button',
        {
          class: 'btn btn-primario',
          type: 'button',
          onclick: async () => {
            s.kg = num(kg.value);
            s.reps = num(reps.value);
            if (!s.fallo) s.rir = rir;
            hj.cerrar();
            await guardar('reg.sesiones');
          },
        },
        'Guardar',
      ),
    ),
  );
}

function chipSerie(s) {
  let t = `${s.lado === 'izq' ? 'I ' : s.lado === 'der' ? 'D ' : ''}${fmtKg(s.kg)}×${s.reps ?? '?'}`;
  if (!s.fallo && s.rir != null) t += ` · ${s.rir >= 4 ? '4+' : s.rir}`;
  if (s.fallo) t += ' ⚡';
  if (s.tramos?.length) t += ` ${s.tramos.map((x) => `→${fmtKg(x.kg)}×${x.reps ?? '?'}`).join(' ')}`;
  return t;
}

// ---------- Pantalla de la sesión ----------

function renderSesion(cont, reg) {
  const rs = rutinaSesion(reg.sesionId);
  if (!rs) {
    montar(cont, vacio('La sesión no está en la rutina actual.'), h('button', { class: 'btn btn-peligro', type: 'button', onclick: () => terminarSesion(reg, true) }, 'Cerrar la sesión'));
    return;
  }
  const ui = S.ui.sesionActiva;
  const actual = bloqueActual(reg, rs);
  const calent = rs.calentamiento || [];
  const pendientesTodos = actual == null;
  const bloques = ui.orden.map((bi) => {
    const info = infoBloque(reg, rs, bi);
    const esActual = bi === actual;
    const b = info.b;
    if (!b.ejercicios.length) return null;
    const saltado = (ui.saltados || []).includes(bi) && !info.completo;
    return h(
      'section',
      { class: `tarjeta bloque ${esActual ? 'actual' : ''} ${info.completo ? 'hecho' : ''}`, testid: `bloque-${b.id}` },
      h(
        'div',
        { class: 'bloque-cab' },
        h('h3', {}, `${b.tipo === 'superserie' ? 'Superserie' : b.alFinal ? 'Lo que dejaste para el final' : 'Bloque'} · descanso ${fmtDuracion((b.descansoSeg || 0) * 1000)}${info.completo ? ' · ✓' : ''}${saltado ? ' · lo saltaste' : ''}`),
        esActual && !info.completo
          ? h(
              'button',
              {
                class: 'btn btn-chico btn-sec',
                type: 'button',
                testid: 'saltar',
                onclick: async () => {
                  ui.orden = [...ui.orden.filter((x) => x !== bi), bi];
                  ui.saltados = [...new Set([...(ui.saltados || []), bi])];
                  await guardar('ui');
                },
              },
              'Saltar y volver',
            )
          : null,
        !esActual && !info.completo
          ? h(
              'button',
              {
                class: 'btn btn-chico btn-sec',
                type: 'button',
                onclick: async () => {
                  ui.orden = [bi, ...ui.orden.filter((x) => x !== bi)];
                  await guardar('ui');
                },
              },
              'Hacer ahora',
            )
          : null,
      ),
      b.ejercicios.map((ej, i) => {
        const p = ui.plan[ej.id] || { series: ej.series, rir: ej.rir, fallo: ej.fallo };
        const e = datosEj(reg, ej.id);
        const sug = ui.sug?.[ej.id];
        const pasoActual = esActual && info.siguiente >= 0 && info.pasos[info.siguiente].ej === i ? info.siguiente : -1;
        return h(
          'div',
          { class: 'ej', testid: `ej-${ej.id}` },
          h(
            'div',
            { class: 'ej-nombre' },
            `${b.tipo === 'superserie' ? `${String.fromCharCode(65 + i)}. ` : ''}${ej.nombre}${p.fallo ? ' ⚡' : ''}`,
            esActual && b.tipo === 'superserie' && b.ejercicios.length > 1 && !info.completo
              ? h(
                  'button',
                  {
                    class: 'btn btn-chico btn-sec',
                    type: 'button',
                    testid: `al-final-${ej.id}`,
                    onclick: async () => {
                      ui.alFinal = [...(ui.alFinal || []), ej.id];
                      ui.orden = [...ui.orden, rs.bloques.length + ui.alFinal.length - 1];
                      await guardar('ui');
                    },
                  },
                  'Dejar para el final',
                )
              : null,
          ),
          h('div', { class: 'ej-plan' }, textoPlan(ej, p)),
          h('div', { class: 'ej-sug' }, 'Peso: ', h('b', { testid: `sug-${ej.id}` }, textoSug(sug)), sug?.motivo && sug.kg != null ? h('span', { class: 'suave chico' }, ` · ${sug.motivo}`) : null),
          sug?.recorrido != null ? h('div', { class: 'ej-sug', testid: `recorrido-sug-${ej.id}` }, 'Recorrido: ', h('b', {}, `hasta ${sug.recorrido}°`)) : null,
          notaEj(ej, p.series) ? h('div', { class: 'ej-nota' }, notaEj(ej, p.series)) : null,
          e.series.length
            ? h(
                'div',
                { class: 'series-hechas' },
                e.series.map((s, idx) => h('button', { class: `serie-chip ${s.fallo ? 'fallo' : ''}`, type: 'button', onclick: () => editarSerie(reg, e, idx) }, chipSerie(s))),
              )
            : null,
          e.dolor != null || e.recorrido != null ? h('div', { class: 'suave chico' }, [e.dolor != null ? `Dolor ${e.dolor}` : '', e.recorrido != null ? `Recorrido ${e.recorrido}°` : ''].filter(Boolean).join(' · ')) : null,
          pasoActual >= 0 ? panelSerie(reg, rs, bi, pasoActual) : null,
        );
      }),
    );
  });
  montar(
    cont,
    h(
      'div',
      { class: 'sesion-barra' },
      h('div', { class: 'item-txt' }, h('div', { class: 'negrita' }, reg.nombre), h('div', { class: 'suave chico' }, `Semana ${reg.semanaBloque}${reg.suave ? ' · suave' : ''} · ${reg.gimnasio}`)),
      h('span', { class: 'reloj-sesion', id: 'reloj-sesion', testid: 'reloj-sesion' }, fmtDuracion(Date.now() - new Date(reg.inicio).getTime())),
      h('button', { class: 'btn btn-chico btn-peligro', type: 'button', testid: 'terminar', onclick: () => terminarSesion(reg) }, 'Terminar'),
    ),
    cajaTimer(),
    textoRecorte(rs, () => 'Recorte: '),
    reg.suave ? h('div', { class: 'aviso' }, h('p', {}, `Semana suave: menos series, ${S.rutina.suave?.rir ? `quedar a ${S.rutina.suave.rir}` : 'lejos del fallo'}, sin ⚡ y sin subir peso.`)) : null,
    calent.length
      ? h(
          'details',
          { class: 'tarjeta calentamiento', open: (ui.calentamiento || []).length < calent.length && !reg.ejercicios.some((e) => e.series.length) ? true : null },
          h('summary', { class: 'tarjeta-tit', id: 'calent-resumen' }, `Calentamiento (${(ui.calentamiento || []).length}/${calent.length})`),
          calent.map((c, i) =>
            casilla(c, {
              checked: (ui.calentamiento || []).includes(i),
              testid: `calent-${i}`,
              alCambiar: async (v) => {
                const set = new Set(ui.calentamiento || []);
                v ? set.add(i) : set.delete(i);
                ui.calentamiento = [...set];
                const sum = document.getElementById('calent-resumen');
                if (sum) sum.textContent = `Calentamiento (${set.size}/${calent.length})`;
                await guardarSinAviso('ui');
              },
            }),
          ),
        )
      : null,
    bloques,
    pendientesTodos ? h('div', { class: 'aviso' }, h('p', {}, 'Terminaste todos los bloques.')) : null,
    h('button', { class: `btn btn-grande ${pendientesTodos ? 'btn-primario' : 'btn-sec'}`, type: 'button', testid: 'terminar-abajo', onclick: () => terminarSesion(reg) }, 'Terminar sesión'),
  );
  arrancarTicker();
  if (!wakeLock) pedirPantalla();
  if (scrollPendiente) {
    scrollPendiente = false;
    requestAnimationFrame(() => irAlPanel(cont));
  }
}

/**
 * Lleva la pantalla al ejercicio que sigue, debajo de lo que está fijo arriba (cabecera, barra de la
 * sesión y cronómetro), para que el nombre del ejercicio nunca quede tapado.
 */
function irAlPanel(cont) {
  const panel = cont.querySelector('.registro-serie');
  const destino = panel?.closest('.ej') || panel || cont.querySelector('.bloque.actual');
  if (!destino) return;
  const fijo = ['.cab', '.sesion-barra', '#timer-caja'].reduce((t, sel) => t + (document.querySelector(sel)?.offsetHeight || 0), 0);
  const y = destino.getBoundingClientRect().top + window.scrollY - fijo - 8;
  window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
}

async function terminarSesion(reg, forzar = false) {
  const min = Math.round((Date.now() - new Date(reg.inicio).getTime()) / 60000);
  if (!forzar) {
    const pend = reg.ejercicios.filter((e) => !e.series.length).length;
    const ok = await confirmar('¿Terminar la sesión?', { si: 'Sí, terminar', titulo: 'Terminar sesión', detalle: `Llevas ${min} min.${pend ? ` Quedan ${pend} ejercicios sin series.` : ''}` });
    if (!ok) return;
  }
  reg.fin = isoLocal();
  S.ui.sesionActiva = null;
  soltarPantalla();
  clearInterval(ticker);
  await guardar('reg.sesiones', 'ui');
  mostrarResumenSesion(reg);
}

function mostrarResumenSesion(reg) {
  const rs = rutinaSesion(reg.sesionId);
  const hj = hoja({ titulo: 'Sesión terminada', testid: 'hoja-fin' });
  const dur = duracionMin(reg);
  const regla = reglaRecorte(S.rutina);
  const sugs = rs ? sugerenciasDeSesion(rs, reg.gimnasio, false, (ej) => datosEj(reg, ej.id)?.series.length) : new Map();
  // El párrafo del salto de la máquina se dice una sola vez al final, no en cada renglón.
  let notaPlaca = null;
  const filas = rs
    ? todosLosEjercicios(rs)
        .filter((ej) => sugs.has(ej.id))
        .map((ej) => {
          const s = sugs.get(ej.id);
          if (s.notaPlaca) notaPlaca = s.notaPlaca;
          return h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, ej.nombre), h('div', { class: 'item-sub' }, `Próxima vez: ${textoSug(s)}${s.recorrido != null ? ` · hasta ${s.recorrido}°` : ''}${s.provisional ? ' (provisional)' : ''} · ${s.motivo}`))));
        })
    : [];
  montar(
    hj.cuerpo,
    h('p', { class: 'texto-grande', testid: 'duracion' }, `Duración: ${dur} min`),
    regla && dur > regla.minutos ? h('p', { class: 'amarillo' }, `Pasaste de ${regla.minutos} min.`) : null,
    textoRecorte(rs, (r) => `Ya van ${r.veces} veces de más de ${r.minutos} min. Recorte para la próxima: `),
    h('h3', { class: 'tarjeta-tit mt' }, 'Peso de la próxima vez'),
    h('ul', { class: 'lista', testid: 'proxima-vez' }, filas),
    notaPlaca ? h('p', { class: 'suave chico', testid: 'nota-placa' }, `Donde dice "sube una placa": ${notaPlaca}`) : null,
    h('p', { class: 'suave chico' }, 'Queda en firme al empezar la próxima sesión de ese ejercicio, cuando ya se sabe cómo amaneciste.'),
    h('div', { class: 'fila-btns fila-fija' }, h('button', { class: 'btn btn-primario btn-grande', type: 'button', testid: 'fin-listo', onclick: () => hj.cerrar() }, 'Listo')),
  );
}

// ---------- Dolor fuera del gimnasio ----------

/**
 * Horas entre el final de la última sesión que trabaja esa zona y el momento del registro.
 * Lo calcula la app: es un dato que nadie tiene por qué llevar de memoria.
 */
export function horasDesdeUltimoEntreno(zona, fecha, hora) {
  const tipos = S.ajustes?.zonas?.[zona]?.sesiones || [];
  if (!tipos.length) return null;
  const tipoDe = new Map((S.rutina?.sesiones || []).map((s) => [s.id, s.tipo]));
  const ult = sesionesValidas(S.reg.sesiones)
    .filter((s) => tipos.includes(tipoDe.get(s.sesionId)))
    .slice(-1)[0];
  if (!ult) return null;
  const fin = Date.parse(ult.fin || ult.inicio || `${ult.fecha}T12:00:00`);
  const cuando = Date.parse(`${fecha}T${hora || '12:00'}:00`);
  if (!Number.isFinite(fin) || !Number.isFinite(cuando) || cuando < fin) return null;
  return Math.round((cuando - fin) / 3600000);
}

export function abrirEventoDolor() {
  const hj = hoja({ titulo: 'Dolor fuera del gimnasio', testid: 'hoja-evento' });
  const zonas = Object.keys(S.ajustes?.zonas || {});
  let zona = zonas[0] || null;
  let valor = null;
  let alApretar = false;
  let hormigueo = false;
  const fFecha = h('input', { type: 'date', class: 'input', value: hoy(), 'aria-label': 'Fecha' });
  const fHora = h('input', { type: 'time', class: 'input', value: horaLocal(), 'aria-label': 'Hora' });
  const fDur = inputNum({ placeholder: 'minutos', testid: 'evento-duracion', etiqueta: 'Cuánto duró', decimal: false });
  const fAct = inputTexto({ placeholder: 'Qué estabas haciendo', testid: 'evento-actividad', etiqueta: 'Qué estabas haciendo' });
  const fDesde = inputTexto({ placeholder: 'Desde cuándo venías en eso', testid: 'evento-hace-cuanto', etiqueta: 'Desde cuándo venías en eso' });
  const fParte = inputTexto({ placeholder: 'En qué parte', testid: 'evento-parte', etiqueta: 'En qué parte' });
  const fQuito = inputTexto({ placeholder: 'Qué lo quitó', testid: 'evento-quito', etiqueta: 'Qué lo quitó' });
  const ayuda = h('p', { class: 'suave chico' });
  const horas = h('p', { class: 'suave chico', testid: 'evento-horas' });
  const pintarHoras = () => {
    const n = zona ? horasDesdeUltimoEntreno(zona, fFecha.value || hoy(), fHora.value || horaLocal()) : null;
    horas.textContent = n == null ? '' : `Pasaron ${n} ${n === 1 ? 'hora' : 'horas'} entre el final de tu entreno anterior de esa zona y esta hora. La app lo calcula sola.`;
  };
  fFecha.addEventListener('change', pintarHoras);
  fHora.addEventListener('change', pintarHoras);
  // Dónde duele, con las palabras del archivo: sirve para confirmar que es el mismo sitio.
  const donde = h('p', { class: 'suave chico', testid: 'evento-donde' });
  const pintarAyuda = () => {
    const k = zona ? `evento${zona.charAt(0).toUpperCase()}${zona.slice(1)}` : null;
    ayuda.textContent = (k && S.ajustes?.textos?.[k]) || '';
    donde.textContent = (zona && S.ajustes?.zonas?.[zona]?.donde) || '';
    pintarHoras();
  };
  montar(
    hj.cuerpo,
    donde,
    zonas.length > 1
      ? chips({
          opciones: zonas.map((z) => ({ valor: z, texto: S.ajustes.zonas[z].nombre || z })),
          valor: zona,
          testid: 'evento-zona',
          alElegir: (v) => {
            zona = v;
            pintarAyuda();
          },
        })
      : null,
    ayuda,
    h('div', { class: 'dos-col mt' }, campo('Fecha', fFecha), campo('Hora', fHora)),
    h('div', { class: 'etq-linea' }, 'Dolor (0–10)'),
    escala010({ testid: 'evento-valor', alElegir: (v) => (valor = v) }),
    h('div', { class: 'mt' }, campo('Cuánto duró (min)', fDur), campo('Qué estabas haciendo', fAct), campo('Desde cuándo venías en eso', fDesde)),
    h('div', { class: 'mt' }, campo('En qué parte', fParte), campo('Qué lo quitó', fQuito)),
    casilla('¿Si haces presión ahí, duele ahora?', { alCambiar: (v) => (alApretar = v), testid: 'evento-apretar' }),
    casilla('¿Hubo hormigueo?', { alCambiar: (v) => (hormigueo = v), testid: 'evento-hormigueo' }),
    horas,
    h(
      'button',
      {
        class: 'btn btn-primario btn-grande',
        type: 'button',
        testid: 'evento-guardar',
        onclick: async () => {
          if (valor == null) return aviso('Toca un número de 0 a 10.');
          const fecha = fFecha.value || hoy();
          const hora = fHora.value || horaLocal();
          S.reg.dolor.push({
            fecha,
            hora,
            zona,
            momento: 'evento',
            valor,
            durmioSobre: null,
            duracionMin: num(fDur.value),
            actividad: fAct.value.trim(),
            haceCuanto: fDesde.value.trim() || null,
            parte: fParte.value.trim() || null,
            queLoQuito: fQuito.value.trim() || null,
            alApretar,
            hormigueo,
            horasDesdeEntreno: horasDesdeUltimoEntreno(zona, fecha, hora),
          });
          hj.cerrar();
          await guardar('reg.dolor');
          aviso('Anotado.');
        },
      },
      'Guardar',
    ),
  );
  pintarAyuda();
  pintarHoras();
}

// ---------- Historial y revisión ----------

function claves() {
  return ejerciciosConNombre(S.rutina, S.reg.sesiones);
}

export function abrirHistorial() {
  const hj = hoja({ titulo: 'Historial por ejercicio', clase: 'alta', testid: 'hoja-historial' });
  montar(
    hj.cuerpo,
    h(
      'ul',
      { class: 'lista' },
      [...claves().entries()].map(([clave, { nombre, sub }]) =>
        h(
          'li',
          {},
          h(
            'button',
            { class: 'item', type: 'button', onclick: () => abrirHistorialClave(clave, sub ? `${nombre} · ${sub}` : nombre) },
            h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, nombre), sub ? h('div', { class: 'item-sub' }, sub) : null),
          ),
        ),
      ),
    ),
  );
}

function abrirHistorialClave(clave, nombre) {
  const hj = hoja({ titulo: nombre, clase: 'alta' });
  const lista = [...S.reg.sesiones]
    .filter((s) => s.ejercicios?.some((e) => e.clave === clave && e.series?.length))
    .sort((a, b) => String(b.inicio || b.fecha).localeCompare(String(a.inicio || a.fecha)));
  montar(
    hj.cuerpo,
    lista.length
      ? h(
          'ul',
          { class: 'lista' },
          lista.map((s) => {
            const e = s.ejercicios.find((x) => x.clave === clave);
            return h(
              'li',
              {},
              h(
                'div',
                { class: 'item' },
                h(
                  'div',
                  { class: 'item-txt' },
                  h('div', { class: 'item-tit' }, `${fechaCorta(s.fecha || fechaDeIso(s.inicio))} · ${s.nombre}`, s.soloLectura ? h('span', { class: 'etiqueta' }, 'bloque anterior') : null),
                  h('div', { class: 'item-sub' }, `${s.gimnasio || ''} · ${e.series.map(chipSerie).join(', ')}${e.dolor != null ? ` · dolor ${e.dolor}` : ''}${e.recorrido != null ? ` · ${e.recorrido}°` : ''}`),
                ),
              ),
            );
          }),
        )
      : vacio('Sin registros todavía.'),
  );
}

export function resumenSemanaEjercicio(clave, semana) {
  const ses = S.reg.sesiones.filter((s) => !s.soloLectura && s.fin && s.semanaBloque === semana && s.ejercicios?.some((e) => e.clave === clave && e.series?.length));
  if (!ses.length) return null;
  const s = ses[ses.length - 1];
  const e = s.ejercicios.find((x) => x.clave === clave);
  return { fecha: s.fecha, texto: e.series.map(chipSerie).join(', ') };
}

export function abrirRevision() {
  const hj = hoja({ titulo: 'Revisión del bloque', clase: 'alta', testid: 'hoja-revision' });
  const maxSem = Math.max(1, ...S.reg.sesiones.filter((s) => !s.soloLectura).map((s) => s.semanaBloque || 1));
  let a = 1;
  let b = Math.min(S.rutina?.semanasTrabajo || maxSem, Math.max(maxSem, 1));
  const cont = h('div');
  const ops = Array.from({ length: Math.max(S.rutina?.semanaSuave || 6, maxSem) }, (_, i) => ({ valor: i + 1, texto: String(i + 1) }));
  function pintar() {
    montar(
      cont,
      h(
        'ul',
        { class: 'lista', testid: 'revision' },
        [...claves().entries()].map(([clave, { nombre, sub }]) => {
          const ra = resumenSemanaEjercicio(clave, a);
          const rb = resumenSemanaEjercicio(clave, b);
          return h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, sub ? `${nombre} · ${sub}` : nombre), h('div', { class: 'item-sub' }, `Semana ${a}: ${ra ? ra.texto : '—'}`), h('div', { class: 'item-sub' }, `Semana ${b}: ${rb ? rb.texto : '—'}`))));
        }),
      ),
    );
  }
  montar(
    hj.cuerpo,
    h('div', { class: 'etq-linea' }, 'Comparar la semana'),
    chips({ opciones: ops, valor: a, alElegir: (v) => ((a = v), pintar()) }),
    h('div', { class: 'etq-linea' }, 'contra la semana'),
    chips({ opciones: ops, valor: b, alElegir: (v) => ((b = v), pintar()) }),
    h('p', { class: 'suave chico' }, 'Cada serie: peso × repeticiones · las que quedaban (RIR).'),
    cont,
  );
  pintar();
}

export function abrirSesionesAnteriores() {
  const hj = hoja({ titulo: 'Sesiones anteriores', clase: 'alta', testid: 'hoja-sesiones' });
  const lista = [...S.reg.sesiones].filter((s) => s.fin || s.soloLectura).sort((a, b) => String(b.inicio || b.fecha).localeCompare(String(a.inicio || a.fecha)));
  montar(
    hj.cuerpo,
    lista.length
      ? h(
          'ul',
          { class: 'lista' },
          lista.map((s) =>
            h(
              'li',
              {},
              h(
                'button',
                { class: 'item', type: 'button', onclick: () => abrirDetalleSesion(s) },
                h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, `${fechaCorta(s.fecha || fechaDeIso(s.inicio))} · ${s.nombre}`, s.soloLectura ? h('span', { class: 'etiqueta' }, 'solo lectura') : null), h('div', { class: 'item-sub' }, `${s.gimnasio || ''}${duracionMin(s) ? ` · ${duracionMin(s)} min` : ''}`)),
              ),
            ),
          ),
        )
      : vacio('Todavía no hay sesiones.'),
  );
}

function abrirDetalleSesion(s) {
  const hj = hoja({ titulo: `${s.nombre} · ${fechaCorta(s.fecha || fechaDeIso(s.inicio))}`, clase: 'alta' });
  montar(
    hj.cuerpo,
    h('p', { class: 'suave' }, `${s.gimnasio || ''}${duracionMin(s) ? ` · ${duracionMin(s)} min` : ''}${s.semanaBloque ? ` · semana ${s.semanaBloque}` : ''}`),
    Object.keys(s.dolorAntes || {}).length ? h('p', { class: 'chico' }, `Dolor antes: ${Object.entries(s.dolorAntes).map(([z, v]) => `${S.ajustes?.zonas?.[z]?.nombre || z} ${v}`).join(', ')}`) : null,
    h(
      'ul',
      { class: 'lista' },
      (s.ejercicios || [])
        .filter((e) => e.series?.length)
        .map((e) => h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, e.nombre), h('div', { class: 'item-sub' }, `${e.series.map(chipSerie).join(', ')}${e.dolor != null ? ` · dolor ${e.dolor}` : ''}${e.recorrido != null ? ` · ${e.recorrido}°` : ''}${e.alarmas?.length ? ` · alarma: ${e.alarmas.join(', ')}` : ''}${e.nota ? ` · ${e.nota}` : ''}`))))),
    ),
    s.soloLectura
      ? null
      : h(
          'button',
          {
            class: 'btn btn-peligro btn-ancho mt',
            type: 'button',
            onclick: async () => {
              if (!(await confirmar('¿Borrar esta sesión?', { si: 'Borrar', peligro: true }))) return;
              S.reg.sesiones = S.reg.sesiones.filter((x) => x !== s);
              hj.cerrar();
              await guardar('reg.sesiones');
            },
          },
          'Borrar sesión',
        ),
  );
}

// ---------- Vista principal ----------

export function render(cont) {
  const reg = sesionActiva();
  if (reg) return renderSesion(cont, reg);
  clearInterval(ticker);
  if (!S.rutina?.sesiones?.length) {
    montar(cont, seccion('Entreno', vacio('Todavía no hay rutina: importa tu archivo de arranque desde el menú ⋮.')));
    return;
  }
  const sigId = sesionElegida || siguienteSesion(S.rutina, S.reg.sesiones);
  const rs = rutinaSesion(sigId) || S.rutina.sesiones[0];
  const fecha = hoy();
  const { semana, plan, suave } = planDelDia(rs, fecha);
  const gym = gimnasioPorDefecto();
  const ultima = sesionesValidas(S.reg.sesiones).slice(-1)[0];
  const hoyYa = yaEntrenoHoy();
  const regla = reglaRecorte(S.rutina);
  const calent = rs.calentamiento || [];
  const sugs = sugerenciasDeSesion(rs, gym, false);
  montar(
    cont,
    seccion(
      null,
      h('div', { class: 'suave chico' }, sesionElegida ? 'Elegiste' : 'Sigue en la rotación'),
      h('h2', { class: 'mb', testid: 'sesion-sigue' }, rs.nombre),
      h(
        'p',
        { class: 'suave', testid: 'semana-bloque' },
        `Semana ${semana} del bloque${S.rutina.semanaSuave ? ` (de ${S.rutina.semanaSuave})` : ''}${suave ? ' · semana suave' : ''}${bloqueTerminado(S.rutina, semana) ? ' · el bloque ya terminó' : ''} · ${textoDuracion(rs)}`,
      ),
      suave ? h('div', { class: 'aviso' }, h('p', {}, 'Semana suave: menos series, sin fallo y sin subir peso.')) : null,
      hoyYa ? h('div', { class: 'aviso alerta', testid: 'aviso-ya-entreno' }, h('p', {}, `Ya entrenaste hoy. ${textoUnaPorDia()}`)) : null,
      textoRecorte(rs, () => 'Recorte: '),
      h('button', { class: 'btn btn-primario btn-grande', type: 'button', testid: 'empezar', onclick: () => abrirEmpezar(rs) }, `Empezar ${rs.nombre}`),
      h('div', { class: 'etq-linea' }, 'O elige otra'),
      chips({
        opciones: S.rutina.sesiones.map((s) => ({ valor: s.id, texto: s.nombre })),
        valor: rs.id,
        testid: 'elegir-sesion',
        alElegir: (v) => {
          sesionElegida = v === siguienteSesion(S.rutina, S.reg.sesiones) ? null : v;
          render(cont);
        },
      }),
    ),
    seccion(
      `${hoyYa ? 'Próxima sesión' : 'Plan de hoy'} · ${gym}`,
      calent.length ? h('details', { class: 'mb', testid: 'plan-calentamiento' }, h('summary', { class: 'suave' }, `Calentamiento (${calent.length})`), h('ul', {}, calent.map((c) => h('li', {}, c)))) : null,
      rs.bloques.map((b, bi) =>
        h(
          'div',
          { class: 'ej' },
          h('div', { class: 'suave chico' }, `${bi + 1}. ${b.tipo === 'superserie' ? 'Superserie · ' : ''}descanso ${fmtDuracion((b.descansoSeg || 0) * 1000)}`),
          b.ejercicios.map((ej) => {
            const s = sugs.get(ej.id);
            return h(
              'div',
              { class: 'mb' },
              h('div', { class: 'negrita' }, `${ej.nombre}${plan[ej.id].fallo ? ' ⚡' : ''}`),
              h('div', { class: 'suave chico', testid: `plan-${ej.id}` }, `${textoPlan(ej, plan[ej.id])} · ${textoSug(s)}${s.recorrido != null ? ` · hasta ${s.recorrido}°` : ''}${s.provisional ? ' (provisional)' : ''}`),
              // El motivo no se repite si ya lo dijo el peso (los pesos por encontrar muestran ahí el texto del plan).
              s.motivo && s.motivo !== textoSug(s) ? h('div', { class: 'chico suave', testid: `motivo-${ej.id}` }, s.motivo) : null,
              s.notaPlaca ? h('div', { class: 'chico suave' }, s.notaPlaca) : null,
              [...textosSeriesDesdeSemana(ej), ...textosAjusteSesion(ej, s.kg, ['inicial', 'buscar'].includes(s.accion))].map((t) => h('div', { class: 'chico suave' }, t)),
              notaEj(ej, plan[ej.id].series) ? h('div', { class: 'ej-nota', testid: `nota-plan-${ej.id}` }, notaEj(ej, plan[ej.id].series)) : null,
            );
          }),
        ),
      ),
    ),
    rs.recorte && regla ? seccion(null, h('p', { class: 'chico suave', testid: 'plan-recorte' }, `Si esta sesión pasa de ${regla.minutos} min ${regla.veces} veces: ${rs.recorte}`)) : null,
    ultima ? seccion('Última sesión', h('p', { class: 'chico' }, `${fechaCorta(ultima.fecha)} · ${ultima.nombre}${duracionMin(ultima) != null ? ` · ${duracionMin(ultima)} min` : ''}${ultima.gimnasio ? ` · ${ultima.gimnasio}` : ''}`)) : null,
    seccion(
      null,
      h(
        'div',
        { class: 'rejilla-btns' },
        h('button', { class: 'btn btn-sec', type: 'button', testid: 'btn-evento', onclick: abrirEventoDolor }, 'Dolor fuera del gimnasio'),
        h('button', { class: 'btn btn-sec', type: 'button', testid: 'btn-historial', onclick: abrirHistorial }, 'Historial'),
        h('button', { class: 'btn btn-sec', type: 'button', testid: 'btn-revision', onclick: abrirRevision }, `Semana ${S.rutina?.semanasTrabajo || 'final'} contra 1`),
        h('button', { class: 'btn btn-sec', type: 'button', testid: 'btn-sesiones', onclick: abrirSesionesAnteriores }, 'Sesiones anteriores'),
      ),
    ),
  );
}

export { r1 };
