// Lógica del entreno: semana del bloque, series del día, rotación, pesos de máquina,
// ajustes dentro de la sesión y doble progresión. Funciones puras.
// Las reglas propias de cada plan (lado que decide, umbral de dolor, recorridos, recorte, textos)
// vienen del archivo de datos; aquí solo hay valores genéricos.
import { difDias, sumarDias, fechaDeIso } from './fechas.js';

// ---------- Semana del bloque ----------

/** Número de semana del bloque, contando desde el lunes de inicio. Antes del inicio cuenta como la primera. */
export function semanaDelBloque(rutina, fecha) {
  if (!rutina?.inicio) return 1;
  const d = difDias(rutina.inicio, fecha);
  if (d < 0) return 1;
  return Math.floor(d / 7) + 1;
}

export function esSemanaSuave(rutina, semana) {
  return !!rutina?.semanaSuave && semana === rutina.semanaSuave;
}

export function bloqueTerminado(rutina, semana) {
  const ultima = rutina?.semanaSuave || rutina?.semanasTrabajo;
  return !!ultima && semana > ultima;
}

/** Valor mínimo de un RIR escrito como texto: "1-2" → 1, "2" → 2, "3-4" → 3. */
export function rirMin(rir) {
  if (rir == null || rir === '') return null;
  const m = String(rir).match(/\d+/);
  return m ? Number(m[0]) : null;
}

// ---------- Datos del plan con valores genéricos ----------

/** Umbral de dolor (0–10) del archivo: por encima no se sube. null si el plan no lo define. */
export function umbralDolor(ajustes) {
  const u = Number(ajustes?.umbralDolor);
  return ajustes?.umbralDolor != null && Number.isFinite(u) ? u : null;
}

/** Recorte: minutos y veces del archivo. null si el plan no lo define. */
export function reglaRecorte(rutina) {
  const min = Number(rutina?.minutosRecorte);
  if (rutina?.minutosRecorte == null || !Number.isFinite(min)) return null;
  const veces = Number(rutina?.vecesRecorte);
  return { minutos: min, veces: Number.isFinite(veces) && veces > 0 ? veces : 2 };
}

/** Descanso entre bloques (segundos): del archivo o 2 minutos. */
export function descansoEntreBloques(rutina) {
  const s = Number(rutina?.descansoEntreBloquesSeg);
  return Number.isFinite(s) && s > 0 ? s : 120;
}

// ---------- Lados (ejercicios a un lado) ----------

export const LADOS = ['izq', 'der'];

/** El lado que decide el peso y las repeticiones (del ejercicio o de la rutina; por defecto el primero). */
export function ladoQueDecide(rutina, ej) {
  const l = ej?.ladoQueDecide || rutina?.ladoQueDecide;
  return LADOS.includes(l) ? l : LADOS[0];
}

/** Orden de los lados en cada serie: primero el que decide. */
export function ordenLados(decide = LADOS[0]) {
  return [decide, ...LADOS.filter((x) => x !== decide)];
}

// ---------- Zonas ----------

/** Zonas (zona1, zona2…) que se preguntan en una sesión según su tipo. */
export function zonasDeSesion(ajustes, tipoSesion) {
  const z = ajustes?.zonas || {};
  return Object.keys(z).filter((k) => (z[k].sesiones || []).includes(tipoSesion));
}

/** Dolor de la mañana siguiente a una fecha para una zona. Devuelve el registro o null. */
export function dolorManana(dolor, zona, fecha) {
  const sig = sumarDias(fecha, 1);
  const lista = (dolor || []).filter((d) => d.zona === zona && d.momento === 'manana' && d.fecha === sig);
  return lista.length ? lista[lista.length - 1] : null;
}

/** ¿Ese dolor de la mañana cuenta para la progresión? (no cuenta si durmió sobre el lado y la zona lo anula) */
export function dolorMananaCuenta(ajustes, zona, reg) {
  if (!reg) return false;
  const z = ajustes?.zonas?.[zona];
  if (z?.dormirAnula && reg.durmioSobre) return false;
  return true;
}

/** ¿La zona cumplió (dolor ≤ umbral en los ejercicios y en la mañana siguiente) en las últimas n sesiones de su tipo? */
export function zonaCumplio({ rutina, ajustes, sesiones, dolor, zona, n = 2, limite = umbralDolor(ajustes) }) {
  if (limite == null) return false;
  const tipos = ajustes?.zonas?.[zona]?.sesiones || [];
  const tipoDe = new Map((rutina?.sesiones || []).map((s) => [s.id, s.tipo]));
  const ult = sesionesValidas(sesiones)
    .filter((s) => tipos.includes(tipoDe.get(s.sesionId)))
    .slice(-n);
  if (ult.length < n) return false;
  for (const s of ult) {
    if ((s.ejercicios || []).some((e) => e.dolor != null && e.dolor > limite)) return false;
    const m = dolorManana(dolor, zona, fechaSesion(s));
    if (!m) return false;
    if (dolorMananaCuenta(ajustes, zona, m) && m.valor > limite) return false;
  }
  return true;
}

// ---------- Series del día ----------

/** Series que tocan hoy para un ejercicio (semana suave y seriesDesdeSemana). */
export function seriesDelDia({ rutina, ej, semana, ajustes, sesiones, dolor }) {
  let series = ej.series;
  for (const r of ej.seriesDesdeSemana || []) {
    if (semana >= r.semana && condicionCumple(r.condicion, { rutina, ajustes, sesiones, dolor })) series = r.series;
  }
  if (esSemanaSuave(rutina, semana)) {
    const mapa = rutina.suave?.series || {};
    series = mapa[String(series)] ?? Math.max(1, Math.ceil(series / 2));
  }
  return series;
}

export function condicionCumple(condicion, ctx) {
  if (!condicion) return true;
  const m = String(condicion).match(/^(zona\d+)-ok-(\d+)-sesiones$/);
  if (m) return zonaCumplio({ ...ctx, zona: m[1], n: Number(m[2]) });
  return false;
}

/** ¿Este ejercicio lleva ⚡ (última serie al fallo) hoy? */
export function llevaFallo(rutina, ej, semana) {
  if (!ej.fallo) return false;
  if (esSemanaSuave(rutina, semana) && rutina.suave?.sinFallo !== false) return false;
  return true;
}

export function rirDelDia(rutina, ej, semana) {
  if (esSemanaSuave(rutina, semana)) return rutina.suave?.rir || ej.rir;
  return ej.rir;
}

// ---------- Rotación ----------

function tiempoDe(s) {
  const t = Date.parse(s?.inicio || '');
  if (Number.isFinite(t)) return t;
  const f = Date.parse(`${s?.fecha || ''}T00:00:00`);
  return Number.isFinite(f) ? f : 0;
}

/** Sesiones terminadas del bloque actual, en orden de tiempo real (sirve con cualquier desfase horario). */
export function sesionesValidas(sesiones) {
  return (sesiones || []).filter((s) => !s.soloLectura && s.fin).sort((a, b) => tiempoDe(a) - tiempoDe(b));
}

/** La sesión que sigue en la rotación. */
export function siguienteSesion(rutina, sesiones) {
  const rot = rutina?.rotacion?.length ? rutina.rotacion : (rutina?.sesiones || []).map((s) => s.id);
  if (!rot.length) return null;
  const validas = sesionesValidas(sesiones).filter((s) => rot.includes(s.sesionId));
  if (!validas.length) return rot[0];
  const ult = validas[validas.length - 1].sesionId;
  return rot[(rot.indexOf(ult) + 1) % rot.length];
}

// ---------- Pasos de un bloque ----------

/**
 * Orden de las series de un bloque. Superserie: A → B por ronda; las que sobran van solas.
 * A un lado: primero el lado que decide y luego el otro, sin descanso entre los dos.
 * `ladosPorEj[i]`: orden de los lados del ejercicio i (por defecto LADOS).
 */
export function pasosBloque(bloque, seriesPorEj, unilateralPorEj, ladosPorEj = []) {
  const pasos = [];
  const max = Math.max(0, ...seriesPorEj);
  for (let r = 0; r < max; r++) {
    bloque.ejercicios.forEach((ej, i) => {
      if (r >= seriesPorEj[i]) return;
      if (unilateralPorEj[i]) {
        for (const lado of ladosPorEj[i] || LADOS) pasos.push({ ej: i, serie: r, lado });
      } else {
        pasos.push({ ej: i, serie: r, lado: null });
      }
    });
  }
  return pasos;
}

/** Qué pasa después de un paso: 'lado' (sin descanso), 'cambio' (15 s), 'descanso' o 'fin'. */
export function transicion(pasos, k) {
  const a = pasos[k];
  const b = pasos[k + 1];
  if (!b) return 'fin';
  if (a.ej === b.ej && a.serie === b.serie) return 'lado';
  if (b.serie === a.serie && b.ej !== a.ej) return 'cambio';
  return 'descanso';
}

// ---------- Pesos de máquina ----------

/**
 * Claves que comparten los pesos con esta: las del mismo equipo (`rutina.equipos`), o solo ella.
 * Sirve para las mancuernas y las barras: los pesos que existen son los mismos en todos los ejercicios.
 */
export function clavesMismoEquipo(rutina, clave) {
  for (const lista of Object.values(rutina?.equipos || {})) {
    if (Array.isArray(lista) && lista.includes(clave)) return [...new Set(lista)];
  }
  return [clave];
}

/**
 * Pesos reales usados en esas claves y ese gimnasio (series y tramos), ordenados.
 * Incluye las sesiones de solo lectura: son pesos que existen en la máquina (no sugerencias).
 */
export function pesosMaquina(sesiones, claves, gimnasio) {
  const set = new Set();
  const cl = Array.isArray(claves) ? claves : [claves];
  for (const s of sesiones || []) {
    if (gimnasio && s.gimnasio !== gimnasio) continue;
    for (const e of s.ejercicios || []) {
      if (!cl.includes(e.clave)) continue;
      for (const se of e.series || []) {
        if (se.kg != null) set.add(Number(se.kg));
        for (const t of se.tramos || []) if (t.kg != null) set.add(Number(t.kg));
      }
    }
  }
  return [...set].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
}

/**
 * La placa siguiente: el siguiente peso real que ya se registró en esa máquina (o par de mancuernas).
 * El salto real de cada máquina no se supone: sin un peso conocido más arriba devuelve null
 * (con `paso` sí suma ese paso, solo para los botones + y − que mueve la persona).
 */
export function pesoSiguiente(kg, conocidos, paso = null, evitar = []) {
  const mayor = (conocidos || []).find((x) => x > kg + 1e-9 && !evitar.some((e) => Math.abs(e - x) < 1e-9));
  if (mayor != null) return mayor;
  return paso != null ? redondearKg(kg + paso) : null;
}

/** El peso conocido anterior. Sin ninguno más abajo: null (o − paso para los botones). */
export function pesoAnterior(kg, conocidos, paso = null) {
  const menores = (conocidos || []).filter((x) => x < kg - 1e-9);
  if (menores.length) return menores[menores.length - 1];
  return paso != null ? Math.max(0, redondearKg(kg - paso)) : null;
}

export function redondearKg(x) {
  return Math.round(x * 100) / 100;
}

/** Bajar 5–10 %: el peso conocido entre 90 y 95 %, o ~92.5 % redondeado a 0.5. */
export function pesoBajado(kg, conocidos) {
  const cand = (conocidos || []).filter((x) => x >= kg * 0.9 - 1e-9 && x <= kg * 0.95 + 1e-9);
  if (cand.length) return cand[cand.length - 1];
  const v = Math.round(kg * 0.925 * 2) / 2;
  return v < kg ? v : redondearKg(kg - 0.5);
}

// ---------- ¿Llegó al mínimo? ----------

/**
 * Repeticiones que valen: si el plan pide quedar a N y la serie terminó más cerca del fallo,
 * se descuenta la diferencia. "No llegas a 8 quedando a 2" es 8 × RIR 0 o 7 × RIR 1.
 */
export function repsEfectivas(ej, s) {
  if (s?.reps == null) return null;
  const reps = Number(s.reps);
  if (!Number.isFinite(reps)) return null;
  const rmin = rirMin(ej?.rir);
  if (s.fallo || rmin == null || s.rir == null) return reps;
  const falta = rmin - Number(s.rir);
  return falta > 0 ? reps - falta : reps;
}

/** ¿Esa serie se quedó por debajo del mínimo del rango (contando lo que le faltó de RIR)? */
export function noLlegoAlMinimo(ej, s) {
  const r = repsEfectivas(ej, s);
  return r != null && r < ej.repMin;
}

// ---------- Ajuste dentro de la sesión ----------

const iguales = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9;

/**
 * Después de la primera serie normal (en ejercicios a un lado, la del lado que decide):
 * ¿hay que cambiar el peso de las siguientes? Son reglas para encontrar el peso:
 * - sobranMas3 (RIR 4 o más), noLlegaMin / primeraNoLlegaMin (no llegó al mínimo).
 * - 'fijar' solo vale desde su peso (`siKg`, por defecto el peso de partida) y en la dirección de la
 *   condición (sobran → subir; no llega → bajar).
 * - 'sumar' / 'restar' solo valen la primera vez de ese ejercicio en ese gimnasio (`opciones.primeraVez`).
 * - Nunca sube si el dolor de antes de empezar ya pasa del umbral en un ejercicio con zona que lo frena.
 * - `sinSubir` (semana suave): no se aplican los ajustes que suben el peso.
 * - Si toca subir una placa y no se conoce ninguna más arriba, devuelve kg null: "sube una placa" y la persona la pone.
 * opciones: { primeraVez = true, dolorAntes = null, umbral = null, sinSubir = false }
 */
export function ajusteEnSesion(ej, serie, esPrimera, conocidos, opciones = {}) {
  const { primeraVez = true, dolorAntes = null, umbral = null, sinSubir = false } = opciones;
  if (!esPrimera || !ej.ajusteSesion?.length || !serie || serie.fallo) return null;
  const kg = Number(serie.kg);
  if (!Number.isFinite(kg)) return null;
  const frenaSubir = !!ej.zona && (ej.noSubirSi || []).length > 0 && umbral != null && dolorAntes != null && dolorAntes > umbral;
  for (const a of ej.ajusteSesion) {
    let cumple = false;
    if (a.si === 'sobranMas3') cumple = serie.rir != null && serie.rir >= 4;
    else if (a.si === 'noLlegaMin' || a.si === 'primeraNoLlegaMin') cumple = noLlegoAlMinimo(ej, serie);
    if (!cumple) continue;
    const sube = a.si === 'sobranMas3';
    if (sube && sinSubir) continue;
    let nuevo = kg;
    if (a.accion === 'fijar') {
      const desde = a.siKg ?? ej.pesoInicial;
      if (desde == null || !iguales(kg, desde) || a.kg == null) continue;
      nuevo = Number(a.kg);
      if (sube && !(nuevo > kg)) continue;
      if (!sube && !(nuevo < kg)) continue;
    } else if (a.accion === 'sumar' || a.accion === 'restar') {
      if (!primeraVez) continue;
      if (a.accion === 'sumar') nuevo = a.kg != null ? redondearKg(kg + Number(a.kg)) : pesoSiguiente(kg, conocidos);
      else nuevo = a.kg != null ? redondearKg(kg - Number(a.kg)) : pesoAnterior(kg, conocidos);
      // Una placa, pero no se conoce ninguna más (arriba o abajo): se dice y la persona la pone.
      if (nuevo == null) {
        const motivo = sube ? 'Te sobraron más de 3' : 'La primera no llegó al mínimo';
        if (sube && frenaSubir) continue;
        return { kg: null, motivo, regla: a.si, unaPlaca: sube ? 'arriba' : 'abajo' };
      }
    } else continue;
    if (nuevo == null || iguales(nuevo, kg)) continue;
    if (nuevo > kg && frenaSubir) continue;
    const motivo = sube ? 'Te sobraron más de 3' : 'La primera no llegó al mínimo';
    return { kg: nuevo, motivo, regla: a.si };
  }
  return null;
}

// ---------- Doble progresión ----------

function datosEjercicio(sesion, clave) {
  return (sesion.ejercicios || []).find((e) => e.clave === clave) || null;
}

/** Series que deciden: las normales (sin ⚡) y, a un lado, solo las del lado que decide. */
export function seriesQueDeciden(e, lado = LADOS[0]) {
  return (e?.series || []).filter((s) => !s.fallo && (s.lado == null || s.lado === lado));
}

/** Peso de trabajo: el de la última serie normal (después de los ajustes de la sesión). */
export function kgDeTrabajo(e, lado = LADOS[0]) {
  const normales = seriesQueDeciden(e, lado);
  const lista = normales.length ? normales : (e?.series || []).filter((s) => s.lado == null || s.lado === lado);
  const kgs = lista.map((s) => Number(s.kg)).filter((x) => Number.isFinite(x));
  return kgs.length ? kgs[kgs.length - 1] : null;
}

/** Series normales hechas con el peso de trabajo. */
function seriesAlPeso(e, kg, lado) {
  return seriesQueDeciden(e, lado).filter((s) => iguales(s.kg, kg));
}

function bajoElMinimo(e, ej, lado) {
  const kg = kgDeTrabajo(e, lado);
  return seriesAlPeso(e, kg, lado).some((s) => noLlegoAlMinimo(ej, s));
}

/** ¿Esa sesión se cargó a mano y no se sabe cuántas series pedía? */
function sinDatoDeSeries(e) {
  return e?.seriesPlan == null;
}

/** Series normales que pedía el plan ese día (guardadas al empezar; si no, las de la rutina). */
function normalesDelPlan(e, ej) {
  const series = Number(e?.seriesPlan ?? ej.series) || 0;
  const fallo = e?.falloPlan ?? !!ej.fallo;
  return Math.max(1, series - (fallo ? 1 : 0));
}

function parsearCondicion(c) {
  let m = String(c).match(/^evento(Zona\d+)DesdeUltimaSesion$/i);
  if (m) return { tipo: 'evento', zona: m[1].toLowerCase() };
  m = String(c).match(/^dolor(Zona\d+)Mas(\d+)$/i);
  if (m) return { tipo: 'dolor', zona: m[1].toLowerCase(), limite: Number(m[2]) };
  return null;
}

/** Un registro de dolor cuenta si no tiene número o si es más de 0. */
function eventoCuenta(d) {
  return d.valor == null || Number(d.valor) > 0;
}

/** Momentos del día que cuentan como "ese dolor volvió a aparecer" (del archivo; por defecto solo el evento). */
function momentosEvento(ajustes, zona) {
  const m = ajustes?.zonas?.[zona]?.momentosEvento;
  return Array.isArray(m) && m.length ? m : ['evento'];
}

/**
 * ¿La zona quedó peor en esa sesión? (zonas con `siEmpeora` en el archivo)
 * Peor = dolor por encima del umbral mientras hacía ese ejercicio; y, solo donde el archivo pone
 * `empeoraPorManana`, también si la mañana siguiente quedó peor que antes de empezar.
 */
function zonaEmpeoro(ctx, sesion, e, ej) {
  const { ajustes, dolor } = ctx;
  const z = ajustes?.zonas?.[ej.zona];
  if (!ej.zona || !z?.siEmpeora || !e) return null;
  const umbral = umbralDolor(ajustes);
  const motivos = [];
  if (umbral != null && e.dolor != null && e.dolor > umbral) motivos.push(`dolor de ${e.dolor} durante el ejercicio`);
  if (ej.empeoraPorManana) {
    const man = dolorManana(dolor, ej.zona, fechaSesion(sesion));
    const antes = sesion.dolorAntes?.[ej.zona];
    if (man && dolorMananaCuenta(ajustes, ej.zona, man) && antes != null && man.valor > antes) {
      motivos.push(`al día siguiente amaneció en ${man.valor} (antes de entrenar estaba en ${antes})`);
    }
  }
  return motivos.length ? motivos.join(' y ') : null;
}

/** Recorrido menor que sigue en la lista del ejercicio (ej. 90 → 75). null si ya está en el menor. */
export function recorridoMenor(ej, actual) {
  const lista = [...(ej.recorridos || [])].map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  if (!lista.length) return null;
  const desde = actual ?? lista[0];
  return lista.find((r) => r < desde) ?? null;
}

/**
 * Recorrido para la próxima vez cuando la zona empeora. Son dos pasos, no tres:
 * `recorridoSiEmpeora` del archivo (el recorrido corto) y, si ya estaba ahí, null = toca bajar el peso.
 * Sin ese dato se usa el recorrido menor que sigue en la lista.
 */
export function recorridoSiEmpeora(ej, actual) {
  const objetivo = Number(ej?.recorridoSiEmpeora);
  if (!Number.isFinite(objetivo)) return recorridoMenor(ej, actual);
  const desde = actual ?? Math.max(...[...(ej.recorridos || [])].map(Number).filter(Number.isFinite), objetivo);
  return desde > objetivo ? objetivo : null;
}

/** Peso de partida sin historial: el del archivo, el de otro ejercicio o la placa conocida siguiente. */
function pesoSinHistorial(ctx, conocidos) {
  const { ej, sesiones, gimnasio, rutina } = ctx;
  if (ej.pesoInicialDe) {
    const lado = ladoQueDecide(rutina, ej);
    const otras = sesionesValidas(sesiones).filter((s) => (!gimnasio || s.gimnasio === gimnasio) && datosEjercicio(s, ej.pesoInicialDe)?.series?.length);
    if (otras.length) {
      const kg = kgDeTrabajo(datosEjercicio(otras[otras.length - 1], ej.pesoInicialDe), lado);
      if (kg != null) return { kg, motivo: ej.pesoTexto || 'Peso de partida' };
    }
  }
  if (ej.pesoInicial != null) return { kg: ej.pesoInicial, motivo: ej.pesoTexto || 'Peso de partida' };
  if (ej.pesoReferencia != null) {
    const sig = pesoSiguiente(Number(ej.pesoReferencia), conocidos);
    if (sig != null) return { kg: sig, motivo: ej.pesoTexto || 'La placa siguiente', porConfirmar: true };
  }
  return null;
}

/**
 * Peso sugerido para la próxima vez.
 * ctx: { rutina, ej, sesiones, dolor, ajustes, gimnasio, hoy, alEmpezar }
 * - Sube lo mínimo si llegó al tope en todas las series normales que pedía el plan, al RIR indicado.
 * - La ⚡ no cuenta, salvo que su primer tramo pase el tope por 3 o más.
 * - A un lado decide el lado que dice el archivo (por defecto el primero).
 * - Con zona: solo sube con dolor ≤ umbral en el ejercicio; con noSubirSi dolorZonaNMasX, también en la mañana siguiente.
 * - Si falta el dato del día siguiente, no sube (provisional mientras no empiece la próxima sesión).
 * - Si la zona empeoró (zonas con siEmpeora): la próxima vez el recorrido más corto del archivo; si se repite, 5–10 % menos.
 * - No llegó al mínimo: peso de regreso solo desde el peso de partida; dos sesiones seguidas: baja 5–10 %.
 * - Semana suave: no se sube nada.
 * - Solo compara sesiones del mismo gimnasio.
 */
export function sugerirPeso(ctx) {
  const { rutina, ej, sesiones, dolor, ajustes, gimnasio, hoy, alEmpezar = false } = ctx;
  const lado = ladoQueDecide(rutina, ej);
  const hist = sesionesValidas(sesiones).filter((s) => (!gimnasio || s.gimnasio === gimnasio) && datosEjercicio(s, ej.clave)?.series?.length);
  // Los pesos que existen: los de esa máquina y los de las demás claves del mismo equipo (mancuernas, barras).
  const conocidos = pesosMaquina(sesiones, clavesMismoEquipo(rutina, ej.clave), gimnasio);
  const referencia = ej.pesoReferencia != null ? Number(ej.pesoReferencia) : null;
  if (!hist.length) {
    const otroGym = sesionesValidas(sesiones).some((s) => datosEjercicio(s, ej.clave)?.series?.length);
    const p = pesoSinHistorial(ctx, conocidos);
    if (!p) return { kg: null, accion: 'buscar', motivo: ej.pesoTexto || 'Peso por encontrar', provisional: false, conocidos, referencia };
    return { kg: p.kg, accion: 'inicial', motivo: otroGym ? 'Primera vez en este gimnasio: peso de partida' : p.motivo, porConfirmar: !!p.porConfirmar, provisional: false, conocidos, referencia };
  }
  const ultima = hist[hist.length - 1];
  const previa = hist.length > 1 ? hist[hist.length - 2] : null;
  const e = datosEjercicio(ultima, ej.clave);
  const kg = kgDeTrabajo(e, lado);
  const base = { kg, conocidos, desde: ultima.fecha, referencia };
  if (kg == null) return { ...base, accion: 'buscar', motivo: 'Sin peso registrado', provisional: false };
  const recorridoActual = e.recorrido ?? null;
  const conRecorrido = (extra = {}) => (recorridoActual != null && (ej.recorridos || []).length ? { recorrido: recorridoActual, ...extra } : extra);

  const semanaHoy = semanaDelBloque(rutina, hoy);
  if (esSemanaSuave(rutina, semanaHoy) && rutina.suave?.sinSubir !== false) {
    return { ...base, ...conRecorrido(), accion: 'mantener', motivo: 'Semana suave: mismo peso, sin subir', provisional: false };
  }
  if (ultima.suave) {
    return { ...base, ...conRecorrido(), accion: 'mantener', motivo: 'Venías de la semana suave: mismo peso', provisional: false };
  }

  // Zona peor: primero el recorrido más corto del archivo; si se repite, 5–10 % menos (dos pasos).
  const empeoro = zonaEmpeoro(ctx, ultima, e, ej);
  if (empeoro) {
    const ep = previa ? datosEjercicio(previa, ej.clave) : null;
    const siguio = !!ep && !previa.suave && !!zonaEmpeoro(ctx, previa, ep, ej);
    const tieneRecorridos = (ej.recorridos || []).length > 0;
    const menor = tieneRecorridos ? recorridoSiEmpeora(ej, recorridoActual) : null;
    if (menor != null) {
      return { ...base, recorrido: menor, accion: 'mantener', motivo: `${mayuscula(empeoro)}: la próxima vez hasta ${menor}°, mismo peso`, provisional: false };
    }
    if (siguio || tieneRecorridos) {
      return {
        ...base,
        ...conRecorrido(),
        kg: pesoBajado(kg, conocidos),
        anterior: kg,
        accion: 'bajar',
        motivo: `${mayuscula(empeoro)}${tieneRecorridos ? ', ya con el recorrido corto' : ' otra vez'}: baja 5–10 %`,
        provisional: false,
      };
    }
    return { ...base, accion: 'mantener', motivo: `${mayuscula(empeoro)}: no sube. Si vuelve a pasar, baja el peso`, provisional: false };
  }

  const consejo = ej.zona ? ajustes?.zonas?.[ej.zona]?.consejoSiPasaUmbral || null : null;
  const rmin = rirMin(ej.rir) ?? 0;
  const normales = seriesAlPeso(e, kg, lado);
  // Para completar las series del plan valen las hechas con el peso de trabajo o uno mayor (la primera que bajó en la sesión, también).
  const hechas = seriesQueDeciden(e, lado).filter((s) => Number(s.kg) >= kg - 1e-9).length;
  const completas = hechas >= normalesDelPlan(e, ej);
  const alTope = normales.length > 0 && normales.every((s) => s.reps != null && s.reps >= ej.repMax && (s.rir == null || s.rir >= rmin));
  const topeOK = completas && alTope;
  const rayo = (e.series || []).find((s) => s.fallo && (s.lado == null || s.lado === lado));
  const rayoOK = !!rayo && Number(rayo.kg) >= kg - 1e-9 && rayo.reps != null && rayo.reps >= ej.repMax + 3;

  if (topeOK || rayoOK) {
    const soloParte = topeOK && normales.length < hechas;
    const porque = topeOK ? (soloParte ? `Llegaste al tope en las series de ${kg} kg` : 'Llegaste al tope en todas las series') : `La ⚡ pasó el tope por ${rayo.reps - ej.repMax}`;
    // Bloqueos por zona y por noSubirSi
    const bloqueos = [];
    let provisional = false;
    const umbral = umbralDolor(ajustes);
    if (ej.zona && umbral != null && e.dolor != null && e.dolor > umbral) bloqueos.push(`dolor de ${e.dolor} durante el ejercicio`);
    for (const c of ej.noSubirSi || []) {
      const p = parsearCondicion(c);
      if (!p) continue;
      if (p.tipo === 'evento') {
        const momentos = momentosEvento(ajustes, p.zona);
        const hay = (dolor || []).some((d) => d.zona === p.zona && momentos.includes(d.momento) && d.fecha >= ultima.fecha && eventoCuenta(d));
        if (hay) bloqueos.push(textoEvento(ajustes, p.zona));
      } else if (p.tipo === 'dolor') {
        if (e.dolor != null && e.dolor > p.limite && !bloqueos.some((b) => b.startsWith('dolor de'))) bloqueos.push(`dolor de ${e.dolor} durante el ejercicio`);
        const reg = dolorManana(dolor, p.zona, ultima.fecha);
        if (!reg) {
          const yaPaso = hoy > sumarDias(ultima.fecha, 1);
          if (alEmpezar || yaPaso) bloqueos.push('falta el dato de cómo amaneció al día siguiente');
          else provisional = true;
        } else if (dolorMananaCuenta(ajustes, p.zona, reg) && reg.valor > p.limite) {
          bloqueos.push(`al día siguiente amaneció en ${reg.valor}`);
        }
      }
    }
    if (bloqueos.length) {
      const dolorEnZona = bloqueos.some((b) => b.startsWith('dolor de'));
      return {
        ...base,
        ...conRecorrido(),
        accion: 'mantener',
        motivo: `${porque}, pero no sube: ${bloqueos.join('; ')}${consejo && dolorEnZona ? `. ${consejo}` : ''}`,
        provisional: false,
      };
    }
    // Si en esa misma sesión intentó un peso más alto y no llegó al mínimo, la próxima vez vuelve a ese.
    const fallidosArriba = seriesQueDeciden(e, lado)
      .filter((x) => noLlegoAlMinimo(ej, x) && Number(x.kg) > kg + 1e-9)
      .map((x) => Number(x.kg))
      .sort((a, b) => a - b);
    const nuevo = ej.incremento != null ? redondearKg(kg + Number(ej.incremento)) : fallidosArriba[0] ?? pesoSiguiente(kg, conocidos);
    const comoSube = provisional
      ? `sube si al día siguiente amaneces con ${umbral ?? 'poco dolor'} o menos`
      : fallidosArriba.length
        ? `vuelve a ${fallidosArriba[0]} kg y busca ${ej.repMin}`
        : 'sube lo mínimo';
    if (nuevo == null) {
      // Toca subir, pero no se conoce ninguna placa (ni par de mancuernas) más arriba de esta máquina.
      return {
        ...base,
        ...conRecorrido(),
        accion: 'subir',
        subeUnaPlaca: true,
        porConfirmar: true,
        motivo: `${porque}: sube una placa. No sé de cuánto es el salto de esta máquina: míralo y ajústalo con + y −`,
        provisional,
      };
    }
    return {
      ...base,
      ...conRecorrido(),
      kg: nuevo,
      anterior: kg,
      accion: 'subir',
      porConfirmar: !fallidosArriba.length && nuevo > kg * 1.1 + 1e-9,
      motivo: `${porque}: ${comoSube}`,
      provisional,
    };
  }

  if (bajoElMinimo(e, ej, lado)) {
    const desdeRegreso = ej.pesoRegresoDesde ?? ej.pesoInicial;
    if (ej.pesoRegreso != null && ej.pesoRegreso < kg && iguales(kg, desdeRegreso)) {
      return { ...base, ...conRecorrido(), kg: ej.pesoRegreso, anterior: kg, accion: 'regreso', motivo: 'No llegaste al mínimo con el peso de partida: vuelve al peso de regreso', provisional: false };
    }
    // Ejercicios con `volverAlAnterior` (los de mancuernas): si con este peso no llega al mínimo, vuelve al anterior.
    if (ej.volverAlAnterior) {
      const ant = pesoAnterior(kg, conocidos);
      if (ant != null) {
        return { ...base, ...conRecorrido(), kg: ant, anterior: kg, accion: 'regreso', motivo: `No llegaste al mínimo con ${kg} kg: vuelve a ${ant} kg y busca más repeticiones`, provisional: false };
      }
    }
    const ep = previa ? datosEjercicio(previa, ej.clave) : null;
    if (ep && !previa.suave && bajoElMinimo(ep, ej, lado) && iguales(kgDeTrabajo(ep, lado), kg)) {
      return { ...base, ...conRecorrido(), kg: pesoBajado(kg, conocidos), anterior: kg, accion: 'bajar', motivo: 'Dos sesiones seguidas sin llegar al mínimo: baja 5–10 %', provisional: false };
    }
    return { ...base, ...conRecorrido(), accion: 'mantener', motivo: 'No llegaste al mínimo: repite el peso', provisional: false };
  }
  if (!completas && alTope) {
    // La primera serie de un peso por encontrar es de prueba: no es que le hayan faltado series.
    const primera = seriesQueDeciden(e, lado)[0];
    const huboPrueba = primera && Number(primera.kg) < kg - 1e-9 && (ej.porEncontrar || (ej.ajusteSesion || []).length > 0);
    const motivo = huboPrueba
      ? `La primera serie fue de prueba: repite ${kg} kg y haz todas las series`
      : sinDatoDeSeries(e)
        ? 'Faltan datos de esa sesión (cuántas series): repite el peso'
        : 'Faltaron series: repite el peso y haz todas';
    return { ...base, ...conRecorrido(), accion: 'mantener', motivo, provisional: false };
  }
  return {
    ...base,
    ...conRecorrido(),
    accion: 'mantener',
    motivo: sinDatoDeSeries(e) ? 'Faltan datos de esa sesión: repite el peso' : 'Repite el peso y busca más repeticiones',
    provisional: false,
  };
}

function mayuscula(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Texto cuando un registro de dolor fuera del gimnasio frena la subida (del archivo, o uno genérico). */
function textoEvento(ajustes, zona) {
  const k = `evento${zona.charAt(0).toUpperCase()}${zona.slice(1)}NoSubir`;
  return ajustes?.textos?.[k] || 'hubo dolor fuera del gimnasio desde la última sesión: sube repeticiones, no peso';
}

/** Duración en minutos de una sesión. */
export function duracionMin(s) {
  if (!s?.inicio || !s?.fin) return null;
  return Math.round((new Date(s.fin) - new Date(s.inicio)) / 60000);
}

/** ¿Ese tipo de sesión ya pasó del límite de minutos las veces que dice el archivo? */
export function tocaRecorte(sesiones, sesionId, regla) {
  if (!regla) return false;
  return sesionesValidas(sesiones).filter((s) => s.sesionId === sesionId && duracionMin(s) > regla.minutos).length >= regla.veces;
}

// ---------- Textos del plan (armados con los datos, sin frases propias en el código) ----------

/** Qué cambia dentro de la sesión, en palabras: "Si te sobran más de 3: 200 kg." */
export function textosAjusteSesion(ej) {
  return (ej?.ajusteSesion || []).map((a) => {
    const cond = a.si === 'sobranMas3' ? 'Si te sobran más de 3' : a.si === 'primeraNoLlegaMin' ? `Si la primera no llega a ${ej.repMin}` : `Si no llegas a ${ej.repMin}`;
    let dest;
    if (a.accion === 'fijar') dest = `${a.kg} kg`;
    else if (a.kg != null) dest = `${a.accion === 'sumar' ? '+' : '−'}${a.kg} kg`;
    else dest = a.accion === 'sumar' ? 'una placa más' : 'una placa menos';
    return `${cond}: ${dest}.`;
  });
}

/** Series que cambian desde una semana: "3 series desde la semana 3 (si la zona viene bien)." */
export function textosSeriesDesdeSemana(ej) {
  return (ej?.seriesDesdeSemana || []).map((r) => `${r.series} series desde la semana ${r.semana}${r.texto ? ` ${r.texto}` : '.'}`);
}

/** Duración de la sesión, con el cambio que trae el plan más adelante. */
export function textoDuracion(s) {
  if (!s?.duracionMin) return '~? min';
  const d = s.duracionDesdeSemana;
  return `~${s.duracionMin} min${d?.min ? ` (~${d.min} desde la semana ${d.semana})` : ''}`;
}

/** Qué hace la semana suave, serie por serie, con los datos de la rutina. */
export function textoSemanaSuave(rutina) {
  const sv = rutina?.suave;
  if (!sv) return null;
  const pares = Object.entries(sv.series || {})
    .map(([de, a]) => [Number(de), Number(a)])
    .filter(([de, a]) => Number.isFinite(de) && Number.isFinite(a) && de > a)
    .sort((x, y) => y[0] - x[0]);
  const partes = [];
  if (pares.length) partes.push(`Donde hay ${pares.map(([de, a]) => `${de} series haces ${a}`).join('; donde hay ')}.`);
  if (sv.rir) partes.push(`Paras cada serie quedando a ${String(sv.rir).replace('-', '–')}.`);
  if (sv.sinFallo !== false) partes.push('Nada al fallo.');
  if (sv.sinSubir !== false) partes.push('Los mismos pesos de la semana anterior: no subes.');
  return partes.join(' ');
}

/** Fecha local de una sesión (por su inicio). */
export function fechaSesion(s) {
  return s.fecha || fechaDeIso(s.inicio);
}
