// Cálculos de comida y cuerpo. Funciones puras: no tocan el DOM ni la base de datos.
import { lunesDe, sumarDias, difDias, diaSemana } from './fechas.js';

export const MOMENTOS = ['desayuno', 'almuerzo', 'merienda', 'cena'];
export const NOMBRE_MOMENTO = { desayuno: 'Desayuno', almuerzo: 'Almuerzo', merienda: 'Merienda', cena: 'Cena' };

export function r1(x) {
  return Math.round((Number(x) || 0) * 10) / 10;
}

export function num(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** 2350 → "2.350"; 80.5 → "80.5" */
export function fmtKcal(x) {
  const n = Math.round(Number(x) || 0);
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `−${s}` : s;
}

export function fmtG(x) {
  const n = r1(x);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Cambio con signo: +0.25, −0.30 (signo menos tipográfico). */
export function signo(x, dec = 2) {
  if (x == null || !Number.isFinite(Number(x))) return '—';
  const n = Number(x);
  const v = Math.abs(n).toFixed(dec);
  if (Number(v) === 0) return Number(0).toFixed(dec);
  return n > 0 ? `+${v}` : `−${v}`;
}

/** "1 pesaje", "3 pesajes" */
export function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function fmtKg(x) {
  if (x === null || x === undefined) return '—';
  const n = Math.round(Number(x) * 100) / 100;
  return String(n);
}

export function sinTildes(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ---------- Crudo y cocido ----------

/**
 * Convierte gramos entre crudo y cocido.
 * Carne: cocido = crudo × 0.75; crudo = cocido × 1.33. Arroz: cocido = crudo × 2.7.
 */
export function convertirEstado(gramos, tipo, de, a) {
  if (gramos == null || !tipo || !de || !a || de === a) return gramos;
  if (tipo === 'carne') return de === 'crudo' ? gramos * 0.75 : gramos * 1.33;
  if (tipo === 'arroz') return de === 'crudo' ? gramos * 2.7 : gramos / 2.7;
  return gramos;
}

/**
 * Género gramatical del alimento para escribir "cocida/cocido" y "cruda/crudo".
 * Del archivo (`genero: 'f' | 'm'`) o por la primera palabra del nombre.
 */
export function generoDe(a) {
  if (a?.genero === 'f' || a?.genero === 'm') return a.genero;
  const primera = sinTildes(a?.nombre || '').split(/[^a-zñ]+/).filter(Boolean)[0] || '';
  if (['carne', 'leche', 'base', 'parte', 'clase'].includes(primera)) return 'f';
  return /a$/.test(primera) ? 'f' : 'm';
}

/** Unidades que admite un alimento para escribir la cantidad. */
export function unidadesDe(alimento) {
  if (alimento.base === 'unidad') return alimento.gramosUnidad ? ['und', 'g'] : ['und'];
  return alimento.gramosUnidad ? ['g', 'und'] : ['g'];
}

export function unidadPorDefecto(alimento) {
  return alimento.base === 'unidad' ? 'und' : 'g';
}

/** Multiplicador de los valores base del alimento para la cantidad escrita. */
export function factorAlimento(alimento, cantidad, unidad, estado) {
  const q = Number(cantidad) || 0;
  if (alimento.base === 'unidad') {
    if (unidad === 'g' && alimento.gramosUnidad) return q / alimento.gramosUnidad;
    return q;
  }
  let gramos = unidad === 'und' ? q * (alimento.gramosUnidad || 0) : q;
  if (alimento.coccion && estado) gramos = convertirEstado(gramos, alimento.coccion.tipo, estado, alimento.coccion.estado);
  return gramos / 100;
}

/** Gramos (en el estado del alimento) que representa la cantidad. null si no se puede saber. */
export function gramosEnEstadoDelAlimento(alimento, cantidad, unidad, estado) {
  const q = Number(cantidad) || 0;
  if (alimento.base === 'unidad') {
    if (unidad === 'g') return q;
    return alimento.gramosUnidad ? q * alimento.gramosUnidad : null;
  }
  let gramos = unidad === 'und' ? q * (alimento.gramosUnidad || 0) : q;
  if (alimento.coccion && estado) gramos = convertirEstado(gramos, alimento.coccion.tipo, estado, alimento.coccion.estado);
  return gramos;
}

/** Porcentaje del recargo de restaurante (0.3, 0.2, 0.1) o 0. */
export function pctRecargo(recargo, metas) {
  if (!recargo || String(recargo).startsWith('peor:')) return 0;
  return Number(metas?.recargos?.[recargo]) || 0;
}

/**
 * Recargo de restaurante: el % de las calorías se suma como grasa escondida (kcal ÷ 9).
 * La proteína y los carbos no se inflan.
 */
export function aplicarRecargo(m, pct) {
  const extraKcal = m.kcal * pct;
  const extraG = extraKcal / 9;
  return { ...m, kcal: m.kcal + extraKcal, g: m.g + extraG, gVisible: (m.gVisible || 0) + extraG };
}

/** Peor caso por componente: gramos extra de grasa por cada 100 g del componente. */
export function aplicarPeorCaso(m, gramos, gPor100) {
  const extraG = ((Number(gramos) || 0) * (Number(gPor100) || 0)) / 100;
  return { ...m, kcal: m.kcal + extraG * 9, g: m.g + extraG, gVisible: (m.gVisible || 0) + extraG };
}

/** Macros de un registro hecho con un alimento. */
export function macrosItem(alimento, { cantidad, unidad, estado, recargo }, metas) {
  if (!alimento || alimento.libre || cantidad == null) {
    return { kcal: 0, p: 0, g: 0, c: 0, gVisible: 0 };
  }
  const f = factorAlimento(alimento, cantidad, unidad || unidadPorDefecto(alimento), estado);
  let m = {
    kcal: (alimento.kcal || 0) * f,
    p: (alimento.p || 0) * f,
    g: (alimento.g || 0) * f,
    c: (alimento.c || 0) * f,
  };
  m.gVisible = alimento.grasaVisible ? m.g : 0;
  if (recargo && String(recargo).startsWith('peor:')) {
    const tipo = String(recargo).slice(5);
    const gramos = gramosEnEstadoDelAlimento(alimento, cantidad, unidad, estado) ?? 0;
    m = aplicarPeorCaso(m, gramos, metas?.peorCasoAceite?.[tipo]);
  } else {
    const pct = pctRecargo(recargo, metas);
    if (pct) m = aplicarRecargo(m, pct);
  }
  return redondearMacros(m);
}

export function redondearMacros(m) {
  return { kcal: r1(m.kcal), p: r1(m.p), g: r1(m.g), c: r1(m.c), gVisible: r1(m.gVisible || 0) };
}

/** Macros de un plato con totales fijos, escalado (½, 1, 1½). */
export function macrosPlatoTotales(plato, escala, metas) {
  const t = plato.totales;
  const m = { kcal: t.kcal * escala, p: t.p * escala, g: t.g * escala, c: t.c * escala, gVisible: 0 };
  const pct = pctRecargo(plato.restaurante?.recargo, metas);
  if (t.incluyeRecargo && pct) {
    // La parte del recargo ya incluida se cuenta como grasa visible.
    m.gVisible = (m.kcal * pct) / (1 + pct) / 9;
  }
  return redondearMacros(m);
}

export function sumar(lista) {
  const t = { kcal: 0, p: 0, g: 0, c: 0, gVisible: 0 };
  for (const x of lista) {
    t.kcal += Number(x.kcal) || 0;
    t.p += Number(x.p) || 0;
    t.g += Number(x.g) || 0;
    t.c += Number(x.c) || 0;
    t.gVisible += Number(x.gVisible) || 0;
  }
  return redondearMacros(t);
}

/**
 * ¿El suplemento diario cuenta en este día? Lo decide la marca del día (se fija al crearlo);
 * el interruptor de Ajustes solo vale para días viejos que no tienen marca.
 */
export function omega3DelDia(dia, ajustes) {
  const o3 = ajustes?.omega3;
  if (!dia || !o3) return false;
  if (dia.omega3 === true) return true;
  if (dia.omega3 === false) return false;
  return !!o3.activo;
}

/** Totales de un día: lo confirmado (con el suplemento diario) y lo planeado aparte. */
export function totalesDia(dia, ajustes) {
  const comidas = dia?.comidas || [];
  const conf = comidas.filter((x) => !x.planeado);
  const plan = comidas.filter((x) => x.planeado);
  const extra = [];
  const o3 = ajustes?.omega3;
  if (omega3DelDia(dia, ajustes)) {
    // Es aceite en cápsula: cuenta como grasa que se ve (salvo que el archivo diga lo contrario).
    const g = Number(o3.g) || 0;
    extra.push({ kcal: o3.kcal, p: o3.p, g, c: o3.c, gVisible: o3.grasaVisible === false ? 0 : g });
  }
  return {
    conf: sumar([...conf, ...extra]),
    plan: sumar(plan),
    estimados: conf.some((x) => x.estimado),
    nConf: conf.length,
    nPlan: plan.length,
  };
}

// ---------- Metas y colores ----------

/** Margen de calorías sobre la meta que todavía cuenta como ✅ (una sola tolerancia en toda la app). */
export const TOLERANCIA_KCAL = 30;

export function toleranciaKcal(metas) {
  const t = Number(metas?.toleranciaKcal);
  return Number.isFinite(t) && t >= 0 ? t : TOLERANCIA_KCAL;
}

export function metaDelTipo(metas, tipo) {
  return metas?.tipos?.[tipo] || metas?.tipos?.descanso || metas?.tipos?.entreno || null;
}

export function cuentaDiaAlto(meta) {
  return meta && meta.cuentaDiaAlto !== false;
}

export function esDiaAlto(kcal, meta, diaAltoKcal) {
  if (!meta || !cuentaDiaAlto(meta) || kcal == null) return false;
  return kcal > meta.kcal + (diaAltoKcal ?? 150);
}

/**
 * Estado de cada nutriente según las reglas de color.
 * Devuelve 'ok' (verde), 'cerca' (amarillo), 'mal' (rojo) o 'falta' (gris, todavía falta).
 * `cerrado`: el día se cerró o ya pasó la hora de cierre.
 */
export function estadoNutriente(n, valor, meta, { cerrado = false, diaAltoKcal = 150, tolKcal = TOLERANCIA_KCAL } = {}) {
  if (!meta) return 'ok';
  const v = Number(valor) || 0;
  if (n === 'kcal') {
    if (meta.kcal == null) return 'ok';
    if (v > meta.kcal + diaAltoKcal) return 'mal';
    if (v > meta.kcal + tolKcal) return 'cerca';
    if (!cerrado && v < meta.kcal - 30) return 'falta';
    return 'ok';
  }
  if (n === 'p') {
    const min = meta.pMin ?? meta.p;
    const max = meta.pMax ?? Infinity;
    if (v > max) return 'cerca';
    if (v >= min) return 'ok';
    return cerrado ? 'mal' : 'falta';
  }
  if (n === 'g') {
    if (meta.g == null) return 'ok';
    const min = meta.gMin ?? meta.g;
    const max = meta.gMax ?? meta.g;
    if (v > max) return 'mal';
    if (v > max - 3) return 'cerca';
    if (v >= min) return 'ok';
    return cerrado ? 'cerca' : 'falta';
  }
  if (n === 'c') {
    if (meta.c == null) return 'ok';
    if (v > meta.c + 15) return 'cerca';
    if (v >= meta.c - 30) return 'ok';
    return cerrado ? 'cerca' : 'falta';
  }
  return 'ok';
}

export const ICONO_ESTADO = { ok: '✅', cerca: '⚠️', mal: '❌', falta: '⚠️' };

/** Lo que falta para la meta (solo lo positivo). */
export function falta(tot, meta) {
  if (!meta) return null;
  const f = (a, b) => (a == null ? null : Math.max(0, r1(a - b)));
  return { kcal: f(meta.kcal, tot.kcal), p: f(meta.p ?? meta.pMin, tot.p), g: f(meta.g, tot.g), c: f(meta.c, tot.c) };
}

/**
 * Qué decir debajo de las barras. Con el día cerrado y todo dentro de la tolerancia no se pide
 * nada más: decir "te falta" haría pensar que todavía tiene que comer algo.
 * `faltan`: las partes ya escritas ("12 g P"…). `estados`: el de cada barra.
 */
export function textoFalta({ cerrado = false, estados = [], faltan = [] } = {}) {
  if (cerrado && estados.every((x) => x === 'ok')) return 'Día cerrado: quedaste dentro de la meta.';
  if (!faltan.length) return 'Llegaste a la meta.';
  return null; // null = mostrar "Te falta: …" con las partes
}

/**
 * Grasa que se ve y la que no se ve (de lo ya registrado), con el espacio que queda para la visible:
 * el tope de grasa del día menos lo no visible ya registrado. Solo avisa si hay grasa visible que no cabe.
 * Lo planeado solo avisa si trae grasa visible y, junto con lo registrado, pasa del tope.
 */
export function grasas(totConf, totPlan, meta) {
  const vis = r1(totConf.gVisible || 0);
  const noVis = r1((totConf.g || 0) - (totConf.gVisible || 0));
  const tope = meta?.gMax ?? meta?.g ?? null;
  const espacio = tope != null ? r1(tope - noVis) : null;
  const visPlan = r1(totPlan?.gVisible || 0);
  const noVisPlan = r1((totPlan?.g || 0) - visPlan);
  const espacioConPlan = tope != null ? r1(tope - noVis - noVisPlan) : null;
  return {
    visible: vis,
    noVisible: noVis,
    espacioVisible: espacio,
    noCabe: espacio != null && vis > 0 && vis > espacio + 0.05,
    noCabePlan: espacioConPlan != null && visPlan > 0 && vis + visPlan > espacioConPlan + 0.05,
  };
}

// ---------- Búsqueda ----------

export function buscarAlimentos(alimentos, q, { recientes = [], limite = 40 } = {}) {
  const t = sinTildes(q).trim();
  const palabras = t.split(/\s+/).filter(Boolean);
  const pos = new Map(recientes.map((id, i) => [id, i]));
  const res = alimentos.filter((a) => {
    if (!palabras.length) return true;
    const texto = sinTildes(`${a.nombre} ${a.marca || ''} ${a.restaurante?.nombre || ''}`);
    return palabras.every((p) => texto.includes(p));
  });
  const puntaje = (a) => {
    let s = 0;
    if (a.favorito) s -= 1000;
    if (pos.has(a.id)) s -= 500 - pos.get(a.id);
    if (palabras.length && sinTildes(a.nombre).startsWith(palabras[0])) s -= 50;
    return s;
  };
  res.sort((a, b) => puntaje(a) - puntaje(b) || a.nombre.localeCompare(b.nombre, 'es'));
  return res.slice(0, limite);
}

// ---------- Días, semanas y promedios ----------

export function promedio(arr) {
  const v = arr.filter((x) => x != null && Number.isFinite(Number(x))).map(Number);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Tipo efectivo del día: el elegido, o entreno si hubo sesión, o descanso. */
export function tipoEfectivo(dia, huboSesion) {
  return dia?.tipo || (huboSesion ? 'entreno' : 'descanso');
}

/**
 * Totales por día para promedios: días de la app (solo los que tienen comida confirmada)
 * más el historial anterior a la app.
 */
export function diasConTotales({ dias = {}, historialDias = [] }, ajustes, fechasSesion = new Set()) {
  const mapa = new Map();
  for (const h of historialDias) {
    if (!h?.fecha) continue;
    mapa.set(h.fecha, { fecha: h.fecha, tipo: h.tipo || 'descanso', kcal: h.kcal, p: h.p, g: h.g, c: h.c, historial: true, nota: h.nota || '' });
  }
  for (const [fecha, dia] of Object.entries(dias)) {
    const t = totalesDia(dia, ajustes);
    if (!t.nConf) continue;
    mapa.set(fecha, { fecha, tipo: tipoEfectivo(dia, fechasSesion.has(fecha)), ...t.conf, estimados: t.estimados, cerrado: !!dia.resumen?.cerrado });
  }
  return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Promedio de peso de casa por semana (lunes a domingo). Nunca se descarta un pesaje. */
export function semanasPeso(pesos) {
  const grupos = new Map();
  const ultimo = new Map();
  for (const x of pesos || []) {
    if (x.tipo && x.tipo !== 'casa') continue;
    if (!x.fecha || x.kg == null) continue;
    const l = lunesDe(x.fecha);
    if (!grupos.has(l)) grupos.set(l, []);
    grupos.get(l).push(Number(x.kg));
    if (!ultimo.has(l) || x.fecha > ultimo.get(l)) ultimo.set(l, x.fecha);
  }
  const semanas = [...grupos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lunes, kgs]) => ({ lunes, domingo: sumarDias(lunes, 6), prom: promedio(kgs), n: kgs.length, ultimo: ultimo.get(lunes) }));
  for (let i = 0; i < semanas.length; i++) {
    const prev = semanas[i - 1];
    semanas[i].cambio = prev && difDias(prev.lunes, semanas[i].lunes) === 7 ? semanas[i].prom - prev.prom : null;
  }
  return semanas;
}

/** true si el promedio bajó más de 1 kg por semana dos semanas seguidas. */
export function bajadaRapida(semanas) {
  for (let i = 2; i < semanas.length; i++) {
    const a = semanas[i - 2];
    const b = semanas[i - 1];
    const c = semanas[i];
    if (difDias(a.lunes, b.lunes) === 7 && difDias(b.lunes, c.lunes) === 7 && a.prom - b.prom > 1 && b.prom - c.prom > 1) {
      return { desde: a.lunes, hasta: c.domingo };
    }
  }
  return null;
}

/**
 * Resumen de una semana (lunes a domingo).
 * `hasta`: el día de hoy en la semana en curso. Ese día solo entra a los promedios si ya se cerró
 * (`incluirHasta`, o el día viene marcado cerrado): un día a medio registrar bajaría el promedio.
 */
export function resumenSemana({ lunes, diasTot, pesos, metas, hasta, incluirHasta = false }) {
  const domingo = sumarDias(lunes, 6);
  const fin = hasta && hasta < domingo ? hasta : domingo;
  const enSemana = diasTot.filter((d) => d.fecha >= lunes && d.fecha <= fin && (!hasta || d.fecha !== hasta || incluirHasta || d.cerrado || d.historial));
  const sem = semanasPeso(pesos);
  const actual = sem.find((s) => s.lunes === lunes);
  const anterior = sem.find((s) => s.lunes === sumarDias(lunes, -7));
  const diaAltoKcal = metas?.diaAltoKcal ?? 150;
  const conMeta = enSemana.map((d) => ({ ...d, meta: metaDelTipo(metas, d.tipo) }));
  const limpios = conMeta.filter((d) => d.meta?.promedioLimpio !== false);
  const altos = conMeta.filter((d) => esDiaAlto(d.kcal, d.meta, diaAltoKcal));
  return {
    lunes,
    domingo,
    dias: conMeta,
    pesoProm: actual?.prom ?? null,
    pesajes: actual?.n ?? 0,
    pesoCambio: actual && anterior ? actual.prom - anterior.prom : null,
    pesoAnterior: anterior?.prom ?? null,
    hoyFuera: !!hasta && hasta <= domingo && diasTot.some((d) => d.fecha === hasta && !(incluirHasta || d.cerrado || d.historial)),
    kcalProm: promedio(conMeta.map((d) => d.kcal)),
    kcalMeta: promedio(conMeta.map((d) => d.meta?.kcal)),
    kcalLimpio: promedio(limpios.map((d) => d.kcal)),
    kcalMetaLimpio: promedio(limpios.map((d) => d.meta?.kcal)),
    pProm: promedio(conMeta.map((d) => d.p)),
    diasAltos: altos.map((d) => d.fecha),
    nViaje: conMeta.length - limpios.length,
  };
}

/** Fechas de comida libre: desde + n × cadaDias. Devuelve la de hoy o la próxima. */
export function proximaComidaLibre(comidaLibre, fecha) {
  if (!comidaLibre?.desde || !comidaLibre?.cadaDias) return null;
  const d = difDias(comidaLibre.desde, fecha);
  if (d <= 0) return comidaLibre.desde;
  const n = Math.ceil(d / comidaLibre.cadaDias);
  return sumarDias(comidaLibre.desde, n * comidaLibre.cadaDias);
}

/** ¿La fecha del plan cae en este día? (repetir: mensual, semanal o ninguna) */
export function fechaCoincide(f, fecha) {
  if (!f?.fecha) return false;
  if (fecha < f.fecha) return false;
  if (f.repetir === 'mensual') return fecha.slice(8, 10) === f.fecha.slice(8, 10);
  if (f.repetir === 'semanal') return diaSemana(fecha) === diaSemana(f.fecha);
  return fecha === f.fecha;
}
