// Formato de la copia y del archivo de arranque (ver ESQUEMA-DATOS.md). Funciones puras.
export const FORMATO = 'app-registro';
export const VERSION_ESQUEMA = 1;

export const CLAVES_REGISTROS = ['dias', 'sesiones', 'dolor', 'pesos', 'medidas', 'cintura', 'fotos', 'bioimpedancias', 'historialDias', 'ultimaCopia'];

export function registrosVacios() {
  return { dias: {}, sesiones: [], dolor: [], pesos: [], medidas: [], cintura: [], fotos: [], bioimpedancias: [], historialDias: [], ultimaCopia: null };
}

/** Lee el texto de un archivo .txt o .json. */
export function leerTextoCopia(texto) {
  const limpio = String(texto || '').replace(/^﻿/, '').trim();
  try {
    return JSON.parse(limpio);
  } catch {
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
