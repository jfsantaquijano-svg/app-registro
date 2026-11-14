// Formato de la copia y del archivo de arranque (ver ESQUEMA-DATOS.md). Funciones puras.
export const FORMATO = 'app-registro';
export const VERSION_ESQUEMA = 1;

export const CLAVES_REGISTROS = ['dias', 'sesiones', 'dolor', 'pesos', 'pasos', 'medidas', 'cintura', 'fotos', 'bioimpedancias', 'historialDias', 'ultimaCopia'];

export function registrosVacios() {
  return { dias: {}, sesiones: [], dolor: [], pesos: [], pasos: [], medidas: [], cintura: [], fotos: [], bioimpedancias: [], historialDias: [], ultimaCopia: null };
}

/**
 * Lee el texto de un archivo .txt o .json, o el pegado del chat: si trae algo antes o después
 * (por ejemplo, las marcas de un bloque de código), se lee desde la primera { hasta la última }.
 */
export function leerTextoCopia(texto) {
  const limpio = String(texto || '').replace(/^﻿/, '').trim();
  try {
    return JSON.parse(limpio);
  } catch {
    const i = limpio.indexOf('{');
    const j = limpio.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(limpio.slice(i, j + 1));
      } catch {
        /* sigue abajo */
      }
    }
    throw new Error('El archivo no es una copia válida (no se pudo leer).');
  }
}

export function validarCopia(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'El archivo está vacío o no es una copia.' };
  if (obj.formato !== FORMATO) return { ok: false, error: 'Este archivo no es una copia de esta app.' };
  if (typeof obj.version !== 'number' || obj.version > VERSION_ESQUEMA) {
    return { ok: false, error: 'La copia es de una versión más nueva de la app. Actualiza la app primero.' };
  }
  if (obj.alimentos && !Array.isArray(obj.alimentos)) return { ok: false, error: 'La lista de alimentos no tiene el formato correcto.' };
  if (obj.platos && !Array.isArray(obj.platos)) return { ok: false, error: 'La lista de platos no tiene el formato correcto.' };
  return { ok: true };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
const esEntero = (x) => Number.isInteger(x) && x >= 0;

/**
 * Lo que en un archivo de arranque haría que la app calcule mal o deje algo por fuera.
 * No impide importarlo: son frases cortas, con el id de lo que hay que corregir,
 * para pegárselas a quien hizo el archivo. `idsAlimentosApp`: alimentos que ya están en la app
 * (un plan nuevo puede usar los que creó el usuario).
 */
export function revisarCopia(obj, idsAlimentosApp = []) {
  const out = [];
  const metas = obj?.metas;
  if (metas) {
    const tipos = metas.tipos && typeof metas.tipos === 'object' ? metas.tipos : {};
    if (!Object.keys(tipos).length) out.push('metas: falta "tipos" (al menos un tipo de día con sus calorías).');
    for (const [k, m] of Object.entries(tipos)) {
      if (!esNum(m?.kcal) || m.kcal <= 0) out.push(`metas.tipos.${k}: "kcal" debe ser un número.`);
      const campos = m?.soloKcalYProteina ? [] : ['p', 'g', 'c'];
      for (const n of campos) if (!esNum(m?.[n])) out.push(`metas.tipos.${k}: "${n}" debe ser un número.`);
      for (const n of ['pMin', 'pMax', 'gMin', 'gMax']) if (m?.[n] != null && !esNum(m[n])) out.push(`metas.tipos.${k}: "${n}" debe ser un número.`);
    }
    if (metas.pasos != null) {
      const { meta, minimo } = metas.pasos;
      if (!esEntero(meta) || meta === 0) out.push('metas.pasos: "meta" debe ser un número entero, por ejemplo 10000.');
      else if (minimo != null && (!esEntero(minimo) || minimo > meta)) out.push('metas.pasos: "minimo" debe ser un número entero, menor o igual que la meta.');
    }
  }
  const ids = new Set(idsAlimentosApp);
  const vistos = new Set();
  (Array.isArray(obj?.alimentos) ? obj.alimentos : []).forEach((a, i) => {
    const quien = a?.id ? `alimento "${a.id}"` : `alimento n.º ${i + 1}`;
    if (!a?.id || typeof a.id !== 'string') return out.push(`${quien}: falta "id".`);
    if (vistos.has(a.id)) out.push(`${quien}: el id está repetido.`);
    vistos.add(a.id);
    ids.add(a.id);
    if (!a.nombre) out.push(`${quien}: falta "nombre".`);
    if (a.base !== '100g' && a.base !== 'unidad') out.push(`${quien}: "base" debe ser "100g" o "unidad".`);
    for (const n of ['kcal', 'p', 'g', 'c']) if (!esNum(a[n]) || a[n] < 0) out.push(`${quien}: "${n}" debe ser un número.`);
    if (a.coccion && (!['carne', 'arroz'].includes(a.coccion.tipo) || !['crudo', 'cocido'].includes(a.coccion.estado))) {
      out.push(`${quien}: "coccion" debe ser { "tipo": "carne" o "arroz", "estado": "crudo" o "cocido" }.`);
    }
  });
  const platos = Array.isArray(obj?.platos) ? obj.platos : [];
  const vistosP = new Set();
  platos.forEach((p, i) => {
    const quien = p?.id ? `plato "${p.id}"` : `plato n.º ${i + 1}`;
    if (!p?.id) return out.push(`${quien}: falta "id".`);
    if (vistosP.has(p.id)) out.push(`${quien}: el id está repetido.`);
    vistosP.add(p.id);
    if (p.totales) return;
    if (!(p.items || []).length) out.push(`${quien}: no tiene "items" ni "totales".`);
    for (const it of p.items || []) if (!ids.has(it?.alimentoId)) out.push(`${quien}: usa "${it?.alimentoId}", que no está en los alimentos.`);
  });
  // Día modelo: cada tipo de día activo (salvo los de solo calorías y proteína) necesita sus platos.
  const conEtiqueta = (e) => platos.some((p) => (p?.etiquetas || []).includes('diaModelo') && (p?.etiquetas || []).includes(e));
  if (metas?.tipos && platos.some((p) => (p?.etiquetas || []).includes('diaModelo'))) {
    for (const [k, m] of Object.entries(metas.tipos)) {
      if (m?.activo === false || m?.soloKcalYProteina) continue;
      if (!conEtiqueta(k) && !(m?.diaModeloDe && conEtiqueta(m.diaModeloDe))) {
        out.push(`Día modelo: ningún plato con "diaModelo" tiene la etiqueta "${k}" (el tipo de día "${m?.nombre || k}"), así que "Planear" no tendría qué poner.`);
      }
    }
  }
  const reg = obj?.registros || {};
  (Array.isArray(reg.pesos) ? reg.pesos : []).forEach((x, i) => {
    if (!FECHA.test(x?.fecha || '') || !esNum(x?.kg)) out.push(`registros.pesos n.º ${i + 1}: necesita "fecha" (AAAA-MM-DD) y "kg" como número.`);
  });
  (Array.isArray(reg.pasos) ? reg.pasos : []).forEach((x, i) => {
    if (!FECHA.test(x?.fecha || '') || !esEntero(x?.pasos)) out.push(`registros.pasos n.º ${i + 1}: necesita "fecha" (AAAA-MM-DD) y "pasos" como número entero.`);
  });
  const aj = obj?.ajustes || {};
  (Array.isArray(aj.fechas) ? aj.fechas : []).forEach((f, i) => {
    if (!FECHA.test(f?.fecha || '')) out.push(`ajustes.fechas n.º ${i + 1}: "fecha" debe ir como AAAA-MM-DD.`);
  });
  if (aj.comidaLibre && (!FECHA.test(aj.comidaLibre.desde || '') || !esEntero(aj.comidaLibre.cadaDias) || !aj.comidaLibre.cadaDias)) {
    out.push('ajustes.comidaLibre: necesita "desde" (AAAA-MM-DD) y "cadaDias" como número entero.');
  }
  if (aj.diasPeso != null && (!Array.isArray(aj.diasPeso) || aj.diasPeso.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    out.push('ajustes.diasPeso: deben ser números de 0 (domingo) a 6 (sábado).');
  }
  if (obj?.rutina != null && !Array.isArray(obj.rutina.sesiones)) out.push('rutina: debe ser null o tener "sesiones".');
  return out;
}

/** Completa lo que falte para que la app pueda trabajar con la copia. */
export function normalizarCopia(obj) {
  const reg = { ...registrosVacios(), ...(obj.registros || {}) };
  for (const k of CLAVES_REGISTROS) {
    if (k === 'dias') reg.dias = reg.dias && typeof reg.dias === 'object' ? reg.dias : {};
    else if (k === 'ultimaCopia') reg.ultimaCopia = reg.ultimaCopia ?? null;
    else if (!Array.isArray(reg[k])) reg[k] = [];
  }
  for (const d of Object.values(reg.dias)) {
    if (!Array.isArray(d.comidas)) d.comidas = [];
  }
  return {
    formato: FORMATO,
    version: obj.version ?? VERSION_ESQUEMA,
    creado: obj.creado ?? null,
    tipo: obj.tipo ?? 'copia',
    ajustes: obj.ajustes ?? {},
    metas: obj.metas ?? null,
    alimentos: Array.isArray(obj.alimentos) ? obj.alimentos : [],
    platos: Array.isArray(obj.platos) ? obj.platos : [],
    rutina: obj.rutina ?? null,
    registros: reg,
  };
}

/** Construye la copia completa con el estado actual. */
export function construirCopia({ ajustes, metas, alimentos, platos, rutina, registros }, { tipo = 'copia', creado }) {
  return {
    formato: FORMATO,
    version: VERSION_ESQUEMA,
    creado,
    tipo,
    ajustes: ajustes ?? {},
    metas: metas ?? null,
    alimentos: alimentos ?? [],
    platos: platos ?? [],
    rutina: rutina ?? null,
    registros: registros ?? registrosVacios(),
  };
}

/**
 * Combina listas por id: agrega lo nuevo y corrige lo del plan; nunca borra
 * ni pisa lo que creó o corrigió el usuario (`origen: 'usuario'` o `editado: true`).
 * Conserva las marcas del usuario (favorito, en casa).
 */
export function combinarPorId(actuales, nuevos, conservar = ['favorito', 'enCasa']) {
  const mapa = new Map((actuales || []).map((x) => [x.id, x]));
  const orden = (actuales || []).map((x) => x.id);
  for (const n of nuevos || []) {
    if (!n?.id) continue;
    const viejo = mapa.get(n.id);
    if (!viejo) {
      mapa.set(n.id, n);
      orden.push(n.id);
    } else if (viejo.origen === 'usuario' || viejo.editado) {
      continue;
    } else {
      const combinado = { ...n };
      for (const k of conservar) if (k in viejo) combinado[k] = viejo[k];
      mapa.set(n.id, combinado);
    }
  }
  return orden.map((id) => mapa.get(id));
}

/** "Actualizar plan": reemplaza rutina, metas y ajustes; combina alimentos y platos. Nunca toca registros. */
export function actualizarPlan(actual, copia) {
  const nuevosAjustes = { ...(copia.ajustes || {}) };
  const viejos = actual.ajustes || {};
  if (viejos.cita?.hecha && nuevosAjustes.cita && nuevosAjustes.cita.texto === viejos.cita.texto) {
    nuevosAjustes.cita = { ...nuevosAjustes.cita, hecha: true };
  }
  if (Array.isArray(viejos.gimnasios)) {
    const set = new Set([...(nuevosAjustes.gimnasios || []), ...viejos.gimnasios]);
    nuevosAjustes.gimnasios = [...set];
  }
  // El interruptor del suplemento diario es decisión del usuario: no se cambia al actualizar el plan.
  if (viejos.omega3 && nuevosAjustes.omega3 && typeof viejos.omega3.activo === 'boolean') {
    nuevosAjustes.omega3 = { ...nuevosAjustes.omega3, activo: viejos.omega3.activo };
  }
  return {
    rutina: copia.rutina ?? actual.rutina,
    metas: copia.metas ?? actual.metas,
    ajustes: Object.keys(nuevosAjustes).length ? nuevosAjustes : viejos,
    alimentos: combinarPorId(actual.alimentos, copia.alimentos),
    platos: combinarPorId(actual.platos, copia.platos, []),
  };
}

export function nombreArchivoCopia(fecha) {
  return `copia-${fecha}.txt`;
}
