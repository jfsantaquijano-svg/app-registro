// Estado en memoria y su guardado en IndexedDB.
import * as db from './db.js';
import { registrosVacios, CLAVES_REGISTROS, construirCopia, normalizarCopia } from './copia.js';
import { hoy, isoLocal, fechaDeIso, difDias } from './fechas.js';
import { metaDelTipo, tipoEfectivo, totalesDia } from './calculos.js';

export const S = {
  ajustes: {},
  metas: null,
  alimentos: [],
  platos: [],
  rutina: null,
  reg: registrosVacios(),
  ui: {},
};

const oyentes = new Set();
export function alCambiar(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}
export function emitir() {
  _indice = null;
  for (const fn of oyentes) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function cargar() {
  const t = (await db.leerTodo()) || {};
  S.ajustes = t.ajustes ?? {};
  S.metas = t.metas ?? null;
  S.alimentos = t.alimentos ?? [];
  S.platos = t.platos ?? [];
  S.rutina = t.rutina ?? null;
  const vacio = registrosVacios();
  for (const k of CLAVES_REGISTROS) S.reg[k] = t[`reg.${k}`] ?? vacio[k];
  S.ui = t.ui ?? {};
  _indice = null;
}

function valorDe(clave) {
  if (clave.startsWith('reg.')) return S.reg[clave.slice(4)];
  return S[clave];
}

/** Guarda las secciones indicadas: 'ajustes', 'metas', 'alimentos', 'platos', 'rutina', 'ui', 'reg.dias'… */
export async function guardar(...claves) {
  const obj = {};
  for (const k of claves) obj[k] = valorDe(k);
  await db.guardarVarias(obj);
  emitir();
}

export async function guardarSinAviso(...claves) {
  const obj = {};
  for (const k of claves) obj[k] = valorDe(k);
  await db.guardarVarias(obj);
}

export const TODAS = ['ajustes', 'metas', 'alimentos', 'platos', 'rutina', ...CLAVES_REGISTROS.map((k) => `reg.${k}`)];

export function estaVacia() {
  return (
    !S.rutina &&
    !S.metas &&
    !S.alimentos.length &&
    !S.platos.length &&
    !Object.keys(S.reg.dias).length &&
    !S.reg.sesiones.length &&
    !S.reg.pesos.length
  );
}

/** Reemplaza todo con una copia (ya validada). */
export async function cargarCopia(obj) {
  const c = normalizarCopia(obj);
  S.ajustes = c.ajustes;
  S.metas = c.metas;
  S.alimentos = c.alimentos;
  S.platos = c.platos;
  S.rutina = c.rutina;
  S.reg = c.registros;
  S.ui = { ...S.ui, sesionActiva: null };
  await guardar(...TODAS, 'ui');
}

export function copiaActual(tipo = 'copia') {
  return construirCopia({ ...S, registros: S.reg }, { tipo, creado: isoLocal() });
}

// ---------- Ayudas ----------

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let _indice = null;
function indice() {
  if (!_indice) {
    _indice = {
      alimentos: new Map(S.alimentos.map((a) => [a.id, a])),
      platos: new Map(S.platos.map((p) => [p.id, p])),
    };
  }
  return _indice;
}
export function alimentoPorId(id) {
  return indice().alimentos.get(id) || null;
}
export function platoPorId(id) {
  return indice().platos.get(id) || null;
}
export function invalidarIndice() {
  _indice = null;
}

export function getDia(fecha, crear = false) {
  let d = S.reg.dias[fecha];
  if (!d && crear) {
    d = { tipo: null, comidas: [], omega3: !!S.ajustes?.omega3?.activo, notas: '', resumen: null };
    S.reg.dias[fecha] = d;
  }
  return d || null;
}

export function fechasConSesion() {
  return new Set(S.reg.sesiones.filter((s) => !s.soloLectura).map((s) => s.fecha || fechaDeIso(s.inicio)));
}

export function tipoDelDia(fecha) {
  const d = getDia(fecha);
  return tipoEfectivo(d, fechasConSesion().has(fecha));
}

export function metaDelDia(fecha) {
  return metaDelTipo(S.metas, tipoDelDia(fecha));
}

export function totalesDelDia(fecha) {
  return totalesDia(getDia(fecha), S.ajustes);
}

export function diasDesdeCopia() {
  const u = S.reg.ultimaCopia;
  if (!u) return null;
  return Math.max(0, difDias(fechaDeIso(u), hoy()));
}

/** Veces que se ha registrado cada alimento (para ordenar y para "en casa"). */
export function frecuenciaAlimentos() {
  const f = {};
  for (const d of Object.values(S.reg.dias)) {
    for (const c of d.comidas || []) {
      if (c.planeado || !c.alimentoId) continue;
      f[c.alimentoId] = (f[c.alimentoId] || 0) + 1;
    }
  }
  return f;
}

/** Ids de alimentos registrados hace poco, del más reciente al más viejo. */
export function recientes(max = 15) {
  const out = [];
  const fechas = Object.keys(S.reg.dias).sort().reverse();
  for (const f of fechas) {
    const lista = [...(S.reg.dias[f].comidas || [])].reverse();
    for (const c of lista) {
      if (c.alimentoId && !c.planeado && !out.includes(c.alimentoId)) out.push(c.alimentoId);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export function sesionActiva() {
  const id = S.ui.sesionActiva?.id;
  if (!id) return null;
  return S.reg.sesiones.find((s) => s.id === id && !s.fin) || null;
}
