// "Cerrar el día": propone una sola opción con alimentos que hay en casa. Funciones puras.
// Orden: proteína hasta la meta (sin pasar del máximo y nunca si ya se llegó a la regla de oro),
// grasa sin bajar del mínimo, y los carbos son lo que se sacrifica.
// Los gustos de cada persona (qué no se propone solo, qué se prefiere, porciones de lácteo)
// vienen del archivo de datos en `ajustes.cierre`.
import { macrosItem, sumar, r1, convertirEstado, estadoNutriente, sinTildes, toleranciaKcal, generoDe } from './calculos.js';

/** Proteína que se permite de más cuando ya se pasó del máximo (la que traen los carbos o la grasa). */
const P_INCIDENTAL = 8;

function contienePalabra(a, palabras) {
  const n = sinTildes(a.nombre);
  return (palabras || []).some((x) => new RegExp(`\\b${sinTildes(x)}(s|es)?\\b`).test(n));
}

function ratio(a) {
  const k = a.kcal || 1;
  return { p: (a.p * 4) / k, g: (a.g * 9) / k, c: (a.c * 4) / k };
}

/** Rol de un alimento en la propuesta. */
export function rolDe(a) {
  const r = ratio(a);
  if (a.categoria === 'lacteo' && r.p >= 0.35) return 'lacteo';
  if (r.p >= 0.5 || (['proteina', 'suplemento'].includes(a.categoria) && r.p >= 0.4)) return 'proteina';
  if (a.grasaVisible || r.g >= 0.5) return 'grasa';
  if (r.c >= 0.5) return 'carbo';
  return 'otro';
}

/**
 * Cantidades realistas por alimento. Cada opción: { cantidad, unidad, estado, mostrar }.
 * - unidades enteras (tortillas, huevos, porciones)
 * - lácteos por 100 g: las porciones del archivo (o 50, 100 y 150 g)
 * - carne: múltiplos de 10 g ya cocida
 * - grasas: múltiplos de 5 g
 * - lo demás: múltiplos de 10 g
 */
export function porciones(a, prefs = {}) {
  const ops = [];
  if (a.base === 'unidad') {
    const max = a.categoria === 'suplemento' ? 2 : 3;
    for (let u = 1; u <= max; u++) ops.push({ cantidad: u, unidad: 'und', estado: null });
    return ops;
  }
  const rol = rolDe(a);
  if (rol === 'lacteo') {
    const lista = Array.isArray(prefs.porcionesLacteo) && prefs.porcionesLacteo.length ? prefs.porcionesLacteo : [50, 100, 150];
    return lista.map((g) => ({ cantidad: Number(g), unidad: 'g', estado: null }));
  }
  if (a.coccion?.tipo === 'carne') {
    for (let g = 50; g <= 250; g += 10) {
      ops.push({ cantidad: g, unidad: 'g', estado: 'cocido' });
    }
    return ops;
  }
  if (rol === 'grasa') {
    if (a.gramosUnidad) return [1, 2].map((u) => ({ cantidad: u, unidad: 'und', estado: null }));
    for (let g = 5; g <= 30; g += 5) ops.push({ cantidad: g, unidad: 'g', estado: null });
    return ops;
  }
  const estado = a.coccion?.tipo === 'arroz' ? 'cocido' : null;
  const desde = rol === 'proteina' ? 50 : 30;
  const hasta = rol === 'proteina' || a.coccion ? 250 : 200;
  for (let g = desde; g <= hasta; g += 10) ops.push({ cantidad: g, unidad: 'g', estado });
  return ops;
}

function preferencia(frecuencia, a, prefs) {
  return -(frecuencia?.[a.id] || 0) - (a.favorito ? 3 : 0) - (contienePalabra(a, prefs?.preferir) ? 1000 : 0);
}

function candidatos(alimentos, excluir, rol, frecuencia, max, prefs = {}) {
  return alimentos
    .filter(
      (a) =>
        a.enCasa &&
        !a.libre &&
        !a.restaurante &&
        (a.kcal || 0) > 0 &&
        !excluir.includes(a.id) &&
        !contienePalabra(a, prefs.nuncaSolos) &&
        rolDe(a) === rol &&
        // Los suplementos solo entran como proteína (no cápsulas ni sobres como "grasa" o "carbos").
        (a.categoria !== 'suplemento' || rol === 'proteina'),
    )
    .sort((x, y) => preferencia(frecuencia, x, prefs) - preferencia(frecuencia, y, prefs))
    .slice(0, max);
}

function item(a, op, metas) {
  return { alimento: a, ...op, macros: macrosItem(a, op, metas) };
}

function total(base, items) {
  return sumar([base, ...items.map((i) => i.macros)]);
}

/**
 * Puntaje de un total contra la meta (menor es mejor). Infinity = no se puede.
 * paso: 'proteina' (acercarse a la meta de proteína), 'grasa' o 'carbos'.
 * pTope: la proteína máxima permitida (el máximo de la meta, o lo ya comido si ya se pasó).
 */
function puntaje(t, meta, metas, nItems, paso, pTope = meta.pMax ?? Infinity) {
  const pMin = meta.pMin ?? meta.p;
  const gMax = meta.gMax ?? Infinity;
  const gMin = Math.max(meta.gMin ?? 0, metas.grasaMinima ?? 0);
  if (t.p > pTope + 0.01) return Infinity;
  if (meta.g != null && t.g > gMax + 0.01) return Infinity;
  let s = 0;
  const wP = paso === 'proteina' ? 3 : 0.3;
  s += Math.abs(t.p - meta.p) * wP;
  if (t.p < pMin) s += 200 + (pMin - t.p) * 5;
  if (meta.g != null) {
    if (t.g < gMin) s += (gMin - t.g) * (paso === 'proteina' ? 2 : 12);
    s += Math.abs(t.g - meta.g) * (paso === 'grasa' ? 2 : 1);
    // Los últimos 3 g antes del tope ya se pintan en amarillo: se evitan.
    if (t.g > gMax - 3) s += (t.g - (gMax - 3)) * 6;
  }
  if (t.kcal > meta.kcal) s += (t.kcal - meta.kcal) * 0.6;
  else s += (meta.kcal - t.kcal) * (paso === 'carbos' ? 0.12 : 0.03);
  if (meta.c != null) {
    if (t.c > meta.c + 10) s += (t.c - meta.c - 10) * 0.5;
    else if (paso === 'carbos' && t.c < meta.c) s += (meta.c - t.c) * 0.1;
  }
  s += nItems * 8;
  return s;
}

/**
 * Propuesta para cerrar el día.
 * entrada: { meta, metas, consumido: {kcal,p,g,c}, alimentos, frecuencia: {id: veces}, excluir: [ids], prefs }
 * prefs (de `ajustes.cierre`): { nuncaSolos: [palabras], preferir: [palabras], porcionesLacteo: [g] }
 */
export function proponerCierre({ meta: metaEntrada, metas, consumido, alimentos, frecuencia = {}, excluir = [], prefs = {} }) {
  const meta = { ...metaEntrada, p: metaEntrada.p ?? metaEntrada.pMin ?? 0 };
  const base = { kcal: consumido.kcal || 0, p: consumido.p || 0, g: consumido.g || 0, c: consumido.c || 0, gVisible: consumido.gVisible || 0 };
  const reglaOro = metas?.reglaDeOroP ?? meta.p;
  const yaOro = base.p >= reglaOro;
  const tol = toleranciaKcal(metas);
  const pMax = meta.pMax ?? Infinity;
  // Si ya se pasó del máximo de proteína, no se agrega proteína, pero sí lo poco que traen carbos y grasa.
  const pTope = base.p >= pMax ? base.p + P_INCIDENTAL : pMax;
  const porc = (a) => porciones(a, prefs);
  const enCasa = alimentos.filter((a) => a.enCasa);
  if (!enCasa.length) return { items: [], final: base, yaOro, sinEnCasa: true };

  let elegidos = [];
  // 1. Proteína (una fuente principal y, si ayuda, un lácteo de porción fija)
  const pFalta = meta.p - base.p;
  if (!yaOro && pFalta > 4) {
    const prots = candidatos(alimentos, excluir, 'proteina', frecuencia, 4, prefs);
    const lacteos = candidatos(alimentos, excluir, 'lacteo', frecuencia, 2, prefs);
    const opsL = [null, ...lacteos.flatMap((a) => porc(a).map((op) => item(a, op, metas)))];
    let mejor = null;
    const probar = (items) => {
      const t = total(base, items);
      const s = puntaje(t, meta, metas, items.length, 'proteina', pMax);
      if (s < Infinity && (!mejor || s < mejor.s - 1e-9)) mejor = { s, items };
    };
    for (const a of prots) {
      for (const op of porc(a)) {
        const ip = item(a, op, metas);
        for (const il of opsL) probar(il ? [ip, il] : [ip]);
      }
    }
    for (const il of opsL) if (il) probar([il]);
    // Si una sola fuente no alcanza el mínimo, se prueban dos
    const pTot = (m) => total(base, m.items).p;
    if (!mejor || pTot(mejor) < (meta.pMin ?? meta.p)) {
      for (let i = 0; i < prots.length; i++) {
        for (let j = i + 1; j < prots.length; j++) {
          for (const opA of porc(prots[i])) {
            const ia = item(prots[i], opA, metas);
            for (const opB of porc(prots[j])) probar([ia, item(prots[j], opB, metas)]);
          }
        }
      }
    }
    if (mejor) elegidos = mejor.items;
  }

  // 2. Grasa: solo si queda por debajo del rango, con alimentos donde la grasa es lo principal
  let t = total(base, elegidos);
  const gMin = Math.max(meta.gMin ?? 0, metas?.grasaMinima ?? 0);
  if (meta.g != null && t.g < gMin) {
    const usados = elegidos.map((i) => i.alimento.id);
    const fuentes = ['grasa', 'lacteo', 'proteina', 'carbo', 'otro']
      .flatMap((rol) => candidatos(alimentos, [...excluir, ...usados], rol, frecuencia, 50, prefs))
      .filter((a) => ratio(a).g >= 0.5 && (!yaOro || ratio(a).p < 0.25))
      .slice(0, 5);
    let mejor = { s: puntaje(t, meta, metas, 0, 'grasa', pTope), ii: null };
    for (const a of fuentes) {
      for (const op of porc(a)) {
        const ii = item(a, op, metas);
        const tt = total(t, [ii]);
        if (tt.kcal > meta.kcal + tol) continue;
        const s = puntaje(tt, meta, metas, 1, 'grasa', pTope);
        if (s < mejor.s) mejor = { s, ii };
      }
    }
    if (mejor.ii) {
      elegidos = [...elegidos, mejor.ii];
      t = total(base, elegidos);
    }
  }

  // 3. Carbos con lo que quede de calorías (una o dos fuentes)
  const libres = meta.kcal - t.kcal;
  if (libres >= 40 && (meta.c == null || t.c < meta.c)) {
    const usados = elegidos.map((i) => i.alimento.id);
    const carbs = candidatos(alimentos, [...excluir, ...usados], 'carbo', frecuencia, 4, prefs);
    const ops = carbs.flatMap((a) => porc(a).map((op) => item(a, op, metas)));
    let mejor = { s: puntaje(t, meta, metas, 0, 'carbos', pTope), items: [] };
    const probar = (items) => {
      const tt = total(t, items);
      if (tt.kcal > meta.kcal + tol) return;
      const s = puntaje(tt, meta, metas, items.length, 'carbos', pTope);
      if (s < mejor.s - 1e-9) mejor = { s, items };
    };
    for (let i = 0; i < ops.length; i++) {
      probar([ops[i]]);
      for (let j = i + 1; j < ops.length; j++) {
        if (ops[j].alimento.id === ops[i].alimento.id) continue;
        probar([ops[i], ops[j]]);
      }
    }
    elegidos = [...elegidos, ...mejor.items];
    t = total(base, elegidos);
  }

  return { items: elegidos, final: t, yaOro };
}

/** "ya cocida", "cruda", "ya cocido"… según el género del alimento. */
export function nombreEstado(a, estado) {
  const f = generoDe(a) === 'f';
  if (estado === 'cocido') return f ? 'ya cocida' : 'ya cocido';
  if (estado === 'crudo') return f ? 'cruda' : 'crudo';
  return '';
}

/**
 * Texto de una cantidad: "135 g ya cocida = 50 g cruda", "3 arepas".
 * Con cocción, siempre el estado elegido y su equivalente.
 */
export function textoCantidad(a, cantidad, unidad, estado) {
  if (cantidad == null) return 'libre';
  if (unidad === 'und') {
    const n = r1(cantidad);
    const nom = a.unidadNombre || 'und';
    return `${n} ${n === 1 ? nom : plural(nom)}`;
  }
  let txt = `${r1(cantidad)} g`;
  if (a.coccion && (estado === 'crudo' || estado === 'cocido')) {
    const otro = estado === 'crudo' ? 'cocido' : 'crudo';
    const conv = Math.round(convertirEstado(cantidad, a.coccion.tipo, estado, otro));
    txt += ` ${nombreEstado(a, estado)} = ${conv} g ${nombreEstado(a, otro)}`;
  }
  return txt;
}

function plural(s) {
  if (!s) return s;
  if (/[aeiouáéó]$/i.test(s)) return `${s}s`;
  if (/[^s]$/i.test(s) && !s.includes(' ')) return `${s}es`;
  return s;
}

/** Tabla final ✅ ⚠️ ❌ al cierre. */
export function tablaFinal(final, meta, metas) {
  const filas = [
    ['kcal', 'Calorías', final.kcal, meta.kcal],
    ['p', 'Proteína', final.p, meta.p ?? meta.pMin],
    ['g', 'Grasa', final.g, meta.g],
    ['c', 'Carbos', final.c, meta.c],
  ].filter((f) => f[3] != null && !(meta.soloKcalYProteina && (f[0] === 'g' || f[0] === 'c')));
  return filas.map(([n, nombre, valor, m]) => {
    const est = estadoNutriente(n, valor, meta, { cerrado: true, diaAltoKcal: metas?.diaAltoKcal ?? 150, tolKcal: toleranciaKcal(metas) });
    return { n, nombre, valor: r1(valor), meta: m, estado: est, icono: est === 'ok' ? '✅' : est === 'mal' ? '❌' : '⚠️' };
  });
}

/** ¿Lo planeado cierra la meta? (proteína y grasa en rango y sin pasar las calorías) */
export function planCierra(conPlan, meta, metas) {
  if (!meta) return false;
  const pOk = conPlan.p >= (meta.pMin ?? meta.p ?? 0) && conPlan.p <= (meta.pMax ?? Infinity);
  const gMin = Math.max(meta.gMin ?? 0, metas?.grasaMinima ?? 0);
  const gOk = meta.g == null || (conPlan.g >= gMin && conPlan.g <= (meta.gMax ?? Infinity));
  const kOk = conPlan.kcal <= meta.kcal + toleranciaKcal(metas);
  return pOk && gOk && kOk;
}
