// Comida: el día en 4 momentos, agregar alimentos y platos, producto nuevo, planear y cerrar el día.
import { S, guardar, getDia, uid, alimentoPorId, platoPorId, totalesDelDia, metaDelDia, tipoDelDia, frecuenciaAlimentos, recientes, invalidarIndice } from './estado.js';
import {
  MOMENTOS,
  NOMBRE_MOMENTO,
  macrosItem,
  macrosPlatoTotales,
  sumar,
  r1,
  num,
  fmtKcal,
  fmtG,
  unidadesDe,
  unidadPorDefecto,
  convertirEstado,
  estadoNutriente,
  falta,
  textoFalta,
  grasas,
  buscarAlimentos,
  sinTildes,
  metaDelTipo,
  omega3DelDia,
  toleranciaKcal,
  generoDe,
} from './calculos.js';
import { proponerCierre, textoCantidad, tablaFinal, planCierra, nombreEstado } from './cierre.js';
import { hoy, sumarDias, fechaCorta, horaLocal } from './fechas.js';
import { h, montar, enfocar, hoja, cerrarHojas, confirmar, elegir, aviso, stepper, chips, campo, inputNum, inputTexto, casilla, barraMacro, vacio, seccion } from './ui.js';

// ---------- Ayudas ----------

export function momentoPorHora(d = new Date()) {
  const x = d.getHours() + d.getMinutes() / 60;
  if (x < 10.5) return 'desayuno';
  if (x < 14.5) return 'almuerzo';
  if (x < 17.5) return 'merienda';
  return 'cena';
}

export function diaCerrado(fecha) {
  const d = getDia(fecha);
  if (d?.resumen?.cerrado) return true;
  const hoyF = hoy();
  if (fecha < hoyF) return true;
  return fecha === hoyF && new Date().getHours() >= 20;
}

function actualizarResumen(fecha) {
  const d = getDia(fecha);
  if (d?.resumen?.cerrado) {
    const t = totalesDelDia(fecha).conf;
    d.resumen = { ...d.resumen, kcal: t.kcal, p: t.p, g: t.g, c: t.c };
  }
}

export async function guardarDia(fecha) {
  actualizarResumen(fecha);
  await guardar('reg.dias');
}

/** Tipos de día para elegir. Los que el archivo marca `activo: false` no salen (salvo el que ya tiene el día). */
export function opcionesTipo(actual = null) {
  const tipos = S.metas?.tipos || {};
  const texto = { entreno: 'Sí, entreno', descanso: 'No, descanso' };
  return Object.keys(tipos)
    .filter((k) => tipos[k].activo !== false || k === actual)
    .map((k) => ({ valor: k, texto: texto[k] || tipos[k].nombre || k }));
}

export async function fijarTipo(fecha, tipo) {
  const d = getDia(fecha, true);
  d.tipo = tipo;
  await guardarDia(fecha);
}

export function elegirTipo(fecha, alElegir) {
  const hj = hoja({ titulo: fecha === hoy() ? '¿Hoy entrenas?' : `Tipo de día: ${fechaCorta(fecha)}`, testid: 'hoja-tipo' });
  montar(
    hj.cuerpo,
    chips({
      opciones: opcionesTipo(getDia(fecha)?.tipo),
      valor: getDia(fecha)?.tipo,
      clase: 'grandes',
      testid: 'tipo',
      alElegir: async (v) => {
        hj.cerrar();
        await fijarTipo(fecha, v);
        alElegir?.(v);
      },
    }),
  );
}

/** Etiqueta de los platos del día modelo para un tipo de día (o la del tipo que dice `diaModeloDe` en el archivo). */
function etiquetaDeTipo(tipo) {
  if (S.platos.some((p) => (p.etiquetas || []).includes(tipo))) return tipo;
  return S.metas?.tipos?.[tipo]?.diaModeloDe || tipo;
}

// ---------- Crear registros ----------

export function comidaDesdeAlimento(a, { cantidad, unidad, estado, recargo, estimado }, momento, planeado = false, platoId = null) {
  const m = macrosItem(a, { cantidad, unidad, estado, recargo }, S.metas);
  return {
    id: uid(),
    momento,
    alimentoId: a.id,
    platoId,
    nombre: a.nombre,
    cantidad: cantidad == null ? null : r1(cantidad),
    unidad: cantidad == null ? null : unidad || unidadPorDefecto(a),
    estado: a.coccion ? estado || a.coccion.estado : null,
    recargo: recargo || null,
    estimado: estimado ?? !!a.estimado,
    kcal: m.kcal,
    p: m.p,
    g: m.g,
    c: m.c,
    gVisible: m.gVisible,
    hora: planeado ? null : horaLocal(),
    planeado,
  };
}

/** Registros de un plato. Devuelve { comidas, faltantes }. */
export function comidasDesdePlato(p, escala, momento, planeado = false) {
  if (p.totales) {
    const m = macrosPlatoTotales(p, escala, S.metas);
    return {
      comidas: [
        {
          id: uid(),
          momento,
          alimentoId: null,
          platoId: p.id,
          nombre: p.nombre,
          cantidad: escala,
          unidad: 'porcion',
          estado: null,
          recargo: p.totales.incluyeRecargo ? p.restaurante?.recargo || null : null,
          estimado: !!p.estimado,
          ...m,
          hora: planeado ? null : horaLocal(),
          planeado,
        },
      ],
      faltantes: [],
    };
  }
  const comidas = [];
  const faltantes = [];
  for (const it of p.items || []) {
    const a = alimentoPorId(it.alimentoId);
    if (!a) {
      faltantes.push(it.alimentoId);
      continue;
    }
    const cant = it.cantidad == null ? null : it.cantidad * escala;
    comidas.push(comidaDesdeAlimento(a, { cantidad: cant, unidad: it.unidad, estado: it.estado, recargo: it.recargo || null }, momento, planeado, p.id));
  }
  return { comidas, faltantes };
}

function recalcularComida(c) {
  if (c.alimentoId) {
    const a = alimentoPorId(c.alimentoId);
    if (!a) return c;
    const m = macrosItem(a, c, S.metas);
    Object.assign(c, m);
  } else if (c.platoId) {
    const p = platoPorId(c.platoId);
    if (p?.totales) Object.assign(c, macrosPlatoTotales(p, c.cantidad || 1, S.metas));
  }
  return c;
}

/** Confirma lo planeado que cumple el filtro. Devuelve los ids confirmados (para poder deshacer). */
export async function confirmarComidas(fecha, filtro) {
  const d = getDia(fecha);
  if (!d) return [];
  const ids = [];
  for (const c of d.comidas) {
    if (c.planeado && filtro(c)) {
      c.planeado = false;
      c.hora = horaLocal();
      ids.push(c.id);
    }
  }
  await guardarDia(fecha);
  return ids;
}

/** Vuelve a dejar como planeado lo que se confirmó por error. */
export async function deshacerConfirmacion(fecha, ids) {
  const d = getDia(fecha);
  if (!d || !ids?.length) return;
  for (const c of d.comidas) {
    if (ids.includes(c.id)) {
      c.planeado = true;
      c.hora = null;
    }
  }
  await guardarDia(fecha);
}

/** Confirma y muestra "Deshacer" unos segundos. */
export async function confirmarConDeshacer(fecha, filtro, texto = 'Confirmado.') {
  const ids = await confirmarComidas(fecha, filtro);
  if (ids.length) aviso(texto, 6000, { texto: 'Deshacer', testid: 'deshacer-confirmar', fn: () => deshacerConfirmacion(fecha, ids) });
  return ids;
}

/**
 * Si se anota algo en un momento que tenía comida planeada, pregunta si la reemplaza
 * (por ejemplo, almorzar fuera en vez del almuerzo de casa). Por defecto sí.
 */
async function reemplazarPlaneado(fecha, momento) {
  const d = getDia(fecha);
  const planeado = (d?.comidas || []).filter((c) => c.planeado && c.momento === momento);
  if (!planeado.length) return;
  const ok = await confirmar(`¿Esto reemplaza lo planeado de ${NOMBRE_MOMENTO[momento].toLowerCase()}?`, {
    si: 'Sí, quitar lo planeado',
    no: 'No, también lo como',
    titulo: 'Lo planeado',
    detalle: planeado.map((c) => c.nombre).join(', '),
  });
  if (!ok) return;
  const dd = getDia(fecha);
  dd.comidas = dd.comidas.filter((c) => !(c.planeado && c.momento === momento));
  await guardarDia(fecha);
}

// ---------- Planear el día ----------

export async function planearDia(fecha) {
  let tipo = getDia(fecha)?.tipo;
  if (!tipo) {
    elegirTipo(fecha, () => planearDia(fecha));
    return;
  }
  const etq = etiquetaDeTipo(tipo);
  const platos = S.platos.filter((p) => (p.etiquetas || []).includes('diaModelo') && (p.etiquetas || []).includes(etq));
  if (!platos.length) {
    aviso(`No hay un día modelo para "${metaDelTipo(S.metas, tipo)?.nombre || tipo}".`);
    return;
  }
  const d = getDia(fecha, true);
  if (d.comidas.some((c) => c.planeado)) {
    const ok = await confirmar('Ya tienes comidas planeadas. ¿Las cambio por el día modelo?', { si: 'Sí, cambiar' });
    if (!ok) return;
    d.comidas = d.comidas.filter((c) => !c.planeado);
  }
  let n = 0;
  for (const p of platos) {
    const momento = MOMENTOS.includes(p.momento) ? p.momento : 'cena';
    if (d.comidas.some((c) => c.momento === momento && !c.planeado)) continue;
    const { comidas } = comidasDesdePlato(p, 1, momento, true);
    d.comidas.push(...comidas);
    n += comidas.length;
  }
  await guardarDia(fecha);
  aviso(n ? 'Día planeado: confirma cada comida cuando la comas.' : 'Esos momentos ya tienen comida confirmada.');
}

/** Opciones para cambiar lo planeado de un momento: variantes del tipo de día, platos y pedidos de restaurante. */
function variantesDe(momento, tipo) {
  const etq = etiquetaDeTipo(tipo);
  const otroTipo = ['entreno', 'descanso'].filter((t) => t !== etq);
  return S.platos
    .filter((p) => p.momento === momento || p.momento === 'cualquiera')
    .filter((p) => {
      const e = p.etiquetas || [];
      // Fuera las variantes que son solo del otro tipo de día.
      return !(otroTipo.some((t) => e.includes(t)) && !e.includes(etq));
    })
    .sort((a, b) => Number(!!a.restaurante) - Number(!!b.restaurante) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Platos incompletos: primero se pide el dato que falta; sumarlo sin él queda como segunda opción. */
async function pedirDatoQueFalta(p) {
  return elegir(`Este plato está incompleto: ${p.incompleto}`, {
    titulo: 'Falta un dato',
    testid: 'hoja-incompleto',
    opciones: [
      { valor: 'completar', texto: 'Agregar lo que falta', primario: true },
      { valor: 'sin', texto: 'Sumar sin el dato (queda "con estimados")' },
    ],
  });
}

/** Abre la búsqueda para agregar el dato que le falta a un plato. */
function buscarLoQueFalta(fecha, momento, p) {
  const ag = abrirAgregar(fecha, momento, p.incompletoBuscar || '');
  ag?.cuerpo.prepend(h('p', { class: 'aviso alerta' }, `Falta: ${p.incompleto} Búscalo o créalo con "+ Producto nuevo".`));
}

function cambiarPlanVariante(fecha, momento, platoIdViejo) {
  const tipo = tipoDelDia(fecha);
  const lista = variantesDe(momento, tipo).filter((p) => p.id !== platoIdViejo);
  const hj = hoja({ titulo: `Cambiar ${NOMBRE_MOMENTO[momento].toLowerCase()}` });
  if (!lista.length) {
    montar(hj.cuerpo, vacio('No hay otras opciones guardadas para este momento.'));
    return;
  }
  montar(
    hj.cuerpo,
    h(
      'ul',
      { class: 'lista' },
      lista.map((p) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: 'item',
              type: 'button',
              onclick: async () => {
                let completar = false;
                if (p.incompleto) {
                  const r = await pedirDatoQueFalta(p);
                  if (!r) return;
                  completar = r === 'completar';
                }
                const { comidas } = comidasDesdePlato(p, 1, momento, true);
                if (p.incompleto && !completar) comidas.forEach((c) => (c.estimado = true));
                const d = getDia(fecha, true);
                d.comidas = d.comidas.filter((c) => !(c.planeado && c.momento === momento && c.platoId === platoIdViejo));
                d.comidas.push(...comidas);
                hj.cerrar();
                await guardarDia(fecha);
                if (completar) buscarLoQueFalta(fecha, momento, p);
              },
            },
            h(
              'div',
              { class: 'item-txt' },
              h('div', { class: 'item-tit' }, p.nombre, p.incompleto ? h('span', { class: 'etiqueta roja' }, 'incompleto') : null, p.restaurante ? h('span', { class: 'etiqueta azul' }, 'fuera') : null),
              h('div', { class: 'item-sub' }, resumenPlato(p)),
            ),
          ),
        ),
      ),
    ),
  );
}

function resumenPlato(p) {
  let m;
  if (p.totales) m = macrosPlatoTotales(p, 1, S.metas);
  else m = sumar(comidasDesdePlato(p, 1, 'cena').comidas);
  return `${fmtKcal(m.kcal)} kcal · ${fmtG(m.p)} P · ${fmtG(m.g)} G · ${fmtG(m.c)} C`;
}

// ---------- Barras ----------

export function bloqueBarras(fecha, { compacto = false } = {}) {
  const meta = metaDelDia(fecha);
  const t = totalesDelDia(fecha);
  const cerrado = diaCerrado(fecha);
  if (!meta) return seccion(null, vacio('Faltan las metas: importa tu archivo de arranque.'));
  const ops = { cerrado, diaAltoKcal: S.metas?.diaAltoKcal ?? 150, tolKcal: toleranciaKcal(S.metas) };
  const nutr = meta.soloKcalYProteina ? ['kcal', 'p'] : ['kcal', 'p', 'g', 'c'];
  const estados = nutr.map((n) => estadoNutriente(n, t.conf[n], meta, ops));
  const barras = nutr.map((n, i) =>
    barraMacro({
      n,
      valor: t.conf[n],
      plan: t.plan[n],
      meta: n === 'p' ? meta.p ?? meta.pMin : meta[n],
      estado: estados[i],
    }),
  );
  const f = falta(t.conf, meta);
  const partes = [];
  if (f.kcal) partes.push(`${fmtKcal(f.kcal)} kcal`);
  if (f.p) partes.push(`${fmtG(f.p)} P`);
  if (f.g && !meta.soloKcalYProteina) partes.push(`${fmtG(f.g)} G`);
  if (f.c && !meta.soloKcalYProteina) partes.push(`${fmtG(f.c)} C`);
  const gr = grasas(t.conf, t.plan, meta);
  return seccion(
    null,
    h(
      'div',
      { class: 'tarjeta-tit', testid: 'meta-tit' },
      h('span', {}, getDia(fecha)?.tipo ? metaDelTipo(S.metas, tipoDelDia(fecha))?.nombre || '' : 'Elige el tipo de día'),
      t.estimados ? h('span', { class: 'etiqueta amarilla' }, 'con estimados') : null,
      getDia(fecha)?.resumen?.cerrado ? h('span', { class: 'etiqueta verde' }, 'día cerrado') : null,
    ),
    barras,
    h(
      'div',
      { class: 'te-falta', testid: 'te-falta' },
      textoFalta({ cerrado, estados, faltan: partes }) ?? h('span', {}, 'Te falta: ', h('b', {}, partes.join(' · '))),
    ),
    !compacto && !meta.soloKcalYProteina
      ? h(
          'div',
          { class: 'grasas', testid: 'grasas' },
          h('div', {}, h('b', {}, `${fmtG(gr.visible)} g`), 'grasa que se ve'),
          h('div', {}, h('b', {}, `${fmtG(gr.noVisible)} g`), 'grasa que no se ve'),
        )
      : null,
    gr.noCabe ? h('p', { class: 'amarillo chico negrita' }, `La grasa que se ve no cabe: el espacio es de ${fmtG(Math.max(0, gr.espacioVisible))} g. Quita otra cosa.`) : null,
  );
}

// ---------- Agregar ----------

/** Hoja de búsqueda: alimentos y platos. */
export function abrirAgregar(fecha, momentoInicial, busqueda = '') {
  const hj = hoja({ titulo: fecha === hoy() ? 'Agregar comida' : `Agregar comida: ${fechaCorta(fecha)}`, clase: 'alta', testid: 'hoja-agregar' });
  let momento = momentoInicial || momentoPorHora();
  let modo = 'alimentos';
  const q = inputTexto({ valor: busqueda, placeholder: 'Buscar (ej. pollo, arroz)', testid: 'buscar', etiqueta: 'Buscar' });
  q.setAttribute('type', 'search');
  q.setAttribute('enterkeyhint', 'search');
  const resultados = h('div', { testid: 'resultados' });
  const selMomento = chips({ opciones: MOMENTOS.map((m) => ({ valor: m, texto: NOMBRE_MOMENTO[m] })), valor: momento, testid: 'momento', alElegir: (v) => (momento = v) });
  const selModo = chips({
    opciones: [
      { valor: 'alimentos', texto: 'Alimentos' },
      { valor: 'platos', texto: 'Platos' },
    ],
    valor: modo,
    testid: 'modo',
    alElegir: (v) => {
      modo = v;
      pintar();
    },
  });

  function filaAlimento(a) {
    const est = a.estimado ? h('span', { class: 'etiqueta amarilla' }, 'estimado') : null;
    const base = a.base === 'unidad' ? `por ${a.unidadNombre || 'unidad'}` : 'por 100 g';
    const estrella = h(
      'button',
      {
        class: `estrella ${a.favorito ? 'on' : ''}`,
        type: 'button',
        'aria-label': a.favorito ? 'Quitar de favoritos' : 'Marcar favorito',
        onclick: async (e) => {
          e.stopPropagation();
          a.favorito = !a.favorito;
          estrella.classList.toggle('on', a.favorito);
          await guardar('alimentos');
        },
      },
      '★',
    );
    return h(
      'li',
      { class: 'resultado' },
      h(
        'button',
        { class: 'item', type: 'button', onclick: () => abrirCantidad(hj, fecha, a, { momento }), testid: `alimento-${a.id}` },
        h(
          'div',
          { class: 'item-txt' },
          h('div', { class: 'item-tit' }, a.nombre, est, a.libre ? h('span', { class: 'etiqueta verde' }, 'libre') : null),
          h('div', { class: 'item-sub' }, `${a.marca ? `${a.marca} · ` : ''}${base}: ${fmtKcal(a.kcal)} kcal · ${fmtG(a.p)} P · ${fmtG(a.g)} G · ${fmtG(a.c)} C`),
        ),
      ),
      estrella,
    );
  }

  function filaPlato(p) {
    return h(
      'li',
      {},
      h(
        'button',
        { class: 'item', type: 'button', onclick: () => abrirPlato(hj, fecha, p, { momento }), testid: `plato-${p.id}` },
        h(
          'div',
          { class: 'item-txt' },
          h('div', { class: 'item-tit' }, p.nombre, p.incompleto ? h('span', { class: 'etiqueta roja' }, 'incompleto') : null, p.restaurante ? h('span', { class: 'etiqueta azul' }, 'fuera') : null),
          h('div', { class: 'item-sub' }, resumenPlato(p)),
        ),
      ),
    );
  }

  function pintar() {
    const texto = q.value.trim();
    const hijos = [];
    let hayPlatos = false;
    if (modo === 'alimentos' || texto) {
      const lista = buscarAlimentos(S.alimentos, texto, { recientes: recientes(), limite: texto ? 40 : 25 });
      if (texto) {
        // Como en los alimentos: todas las palabras, en cualquier orden.
        const palabras = sinTildes(texto).split(/\s+/).filter(Boolean);
        const pl = S.platos.filter((p) => {
          const t = sinTildes(`${p.nombre} ${p.restaurante?.nombre || ''}`);
          return palabras.every((w) => t.includes(w));
        });
        if (pl.length) hijos.push(h('h3', { class: 'etq-linea' }, 'Platos'), h('ul', { class: 'lista' }, pl.slice(0, 10).map(filaPlato)));
        hayPlatos = pl.length > 0;
      }
      if (lista.length) hijos.push(h('h3', { class: 'etq-linea' }, texto ? 'Alimentos' : 'Favoritos y recientes primero'), h('ul', { class: 'lista' }, lista.map(filaAlimento)));
      if (texto && !lista.length && hayPlatos) hijos.push(h('p', { class: 'suave chico', testid: 'sin-alimentos' }, 'Ningún alimento suelto con ese nombre.'));
      if (texto && !lista.length && !hayPlatos) {
        hijos.push(
          vacio(`No encontré "${texto}".`),
          h('div', { class: 'fila-btns' }, h('button', { class: 'btn btn-sec', type: 'button', onclick: () => abrirFatSecret(texto) }, 'Buscar en FatSecret')),
        );
      }
    } else {
      const orden = (p) => (p.momento === momento ? 0 : p.momento === 'cualquiera' ? 1 : 2);
      const pl = [...S.platos].sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre, 'es'));
      hijos.push(pl.length ? h('ul', { class: 'lista' }, pl.map(filaPlato)) : vacio('Todavía no hay platos guardados.'));
    }
    montar(resultados, hijos);
  }
  q.addEventListener('input', pintar);
  montar(
    hj.cuerpo,
    h(
      'div',
      { class: 'buscador' },
      q,
      h('div', { class: 'mt' }, selMomento),
      h('div', { class: 'fila-btns' }, selModo, h('button', { class: 'btn btn-chico btn-sec', type: 'button', testid: 'producto-nuevo', onclick: () => abrirProductoNuevo(hj, fecha, { momento, nombre: q.value.trim() }) }, '+ Producto nuevo')),
    ),
    resultados,
  );
  pintar();
  enfocar(hj, q);
  return hj;
}

export function abrirFatSecret(nombre) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(`fatsecret ${nombre || ''}`.trim())}`;
  window.open(url, '_blank', 'noopener');
}

const TEXTO_RECARGO = { salteado: 'Salteado, frito o con salsa', plancha: 'Plancha o parrilla', medido: 'Datos medidos' };
const NOMBRE_PEOR = { arroz: 'Arroz', frijol: 'Fríjol', polloMarinado: 'Pollo marinado' };

function textoOpcionRecargo(valor) {
  if (!valor) return 'No';
  if (String(valor).startsWith('peor:')) {
    const k = String(valor).slice(5);
    const v = S.metas?.peorCasoAceite?.[k];
    return `${NOMBRE_PEOR[k] || k} con aceite que no viste (+${v} g de grasa por cada 100 g)`;
  }
  const pct = S.metas?.recargos?.[valor];
  return `${TEXTO_RECARGO[valor] || valor} +${Math.round((pct || 0) * 100)}%`;
}

function opcionesRecargo() {
  const ops = [{ valor: '', texto: 'No' }];
  for (const k of Object.keys(S.metas?.recargos || {})) ops.push({ valor: k, texto: textoOpcionRecargo(k) });
  for (const k of Object.keys(S.metas?.peorCasoAceite || {})) ops.push({ valor: `peor:${k}`, texto: textoOpcionRecargo(`peor:${k}`) });
  return ops;
}

/**
 * Formulario de cantidad para un alimento. Si `editar` trae un registro, lo corrige.
 */
export function abrirCantidad(hjPadre, fecha, a, { momento, editar = null } = {}) {
  const hj = hoja({ titulo: a.nombre, testid: 'hoja-cantidad' });
  const unidades = unidadesDe(a);
  let unidad = editar?.unidad && unidades.includes(editar.unidad) ? editar.unidad : unidades[0];
  let estado = editar?.estado || (a.coccion ? ultimoEstado(a.id) || 'cocido' : null);
  let recargo = editar ? editar.recargo || '' : a.restaurante?.recargo || '';
  let mom = editar?.momento || momento || momentoPorHora();
  const cantidadInicial = editar?.cantidad ?? (a.libre ? null : unidad === 'und' ? 1 : ultimaCantidad(a.id) ?? 100);
  // En unidades, por debajo de 1 va de media en media (½ aderezo, ½ porción); en gramos, de 5 o de 10.
  const menos = (v0) => {
    const v = v0 ?? 0;
    if (unidad === 'und') return v > 1 ? Math.max(1, r1(v - 1)) : Math.max(0, r1(v - 0.5));
    return Math.max(0, r1(v - (v <= 30 ? 5 : 10)));
  };
  const mas = (v0) => {
    const v = v0 ?? 0;
    if (unidad === 'und') return v < 1 ? r1(v + 0.5) : r1(v + 1);
    return r1(v + (v < 30 ? 5 : 10));
  };
  const cant = stepper({
    valor: cantidadInicial,
    sufijo: unidad === 'und' ? a.unidadNombre || 'und' : 'g',
    testid: 'cantidad',
    etiqueta: 'Cantidad',
    menos,
    mas,
    alCambiar: () => pintarPreview(),
  });
  const est = casilla('Dato estimado (el día queda "con estimados")', { checked: editar ? editar.estimado : !!a.estimado, testid: 'estimado' });
  const preview = h('div', { class: 'preview-macros', testid: 'preview' });
  const conversion = h('p', { class: 'suave chico', testid: 'conversion' });

  function pintarPreview() {
    const q = cant.valor();
    const m = macrosItem(a, { cantidad: q, unidad, estado, recargo: recargo || null }, S.metas);
    montar(
      preview,
      h('div', {}, h('b', {}, fmtKcal(m.kcal)), h('span', {}, 'kcal')),
      h('div', {}, h('b', {}, fmtG(m.p)), h('span', {}, 'P')),
      h('div', {}, h('b', {}, fmtG(m.g)), h('span', {}, 'G')),
      h('div', {}, h('b', {}, fmtG(m.c)), h('span', {}, 'C')),
    );
    let txt = '';
    if (a.coccion && q != null && unidad === 'g' && estado) {
      const otro = estado === 'crudo' ? 'cocido' : 'crudo';
      const conv = convertirEstado(q, a.coccion.tipo, estado, otro);
      txt = `${fmtG(q)} g ${nombreEstado(a, estado)} = ${Math.round(conv)} g ${nombreEstado(a, otro)}.`;
    }
    if (m.gVisible > 0 && recargo) txt += ` Grasa escondida que se suma: ${fmtG(m.gVisible - (a.grasaVisible ? macrosItem(a, { cantidad: q, unidad, estado }, S.metas).g : 0))} g.`;
    conversion.textContent = txt.trim();
  }

  const selUnidad =
    unidades.length > 1
      ? chips({
          opciones: unidades.map((u) => ({ valor: u, texto: u === 'g' ? 'gramos' : a.unidadNombre || 'unidades' })),
          valor: unidad,
          testid: 'unidad',
          alElegir: (v) => {
            const q = cant.valor();
            if (q != null && a.gramosUnidad) cant.fijar(v === 'g' ? r1(q * a.gramosUnidad) : r1(q / a.gramosUnidad));
            unidad = v;
            cant.querySelector('.stepper-suf').textContent = v === 'und' ? a.unidadNombre || 'und' : 'g';
            pintarPreview();
          },
        })
      : null;
  const fem = generoDe(a) === 'f';
  const selEstado = a.coccion
    ? chips({
        opciones: [
          { valor: 'crudo', texto: fem ? 'Cruda' : 'Crudo' },
          { valor: 'cocido', texto: fem ? 'Ya cocida' : 'Ya cocido' },
        ],
        valor: estado,
        testid: 'estado',
        alElegir: (v) => {
          estado = v;
          pintarPreview();
        },
      })
    : null;
  const selRecargo = chips({
    opciones: opcionesRecargo(),
    valor: recargo,
    testid: 'recargo',
    alElegir: (v) => {
      recargo = v;
      pintarPreview();
    },
  });
  const selMomento = chips({ opciones: MOMENTOS.map((m) => ({ valor: m, texto: NOMBRE_MOMENTO[m] })), valor: mom, testid: 'momento-item', alElegir: (v) => (mom = v) });

  async function guardarItem() {
    const q = a.libre ? cant.valor() ?? null : cant.valor();
    if (!a.libre && (q == null || q <= 0)) {
      aviso('Escribe la cantidad.');
      return;
    }
    const d = getDia(fecha, true);
    const nuevo = comidaDesdeAlimento(a, { cantidad: q, unidad, estado, recargo: recargo || null, estimado: est.input.checked }, mom, false);
    if (editar) {
      const i = d.comidas.findIndex((c) => c.id === editar.id);
      nuevo.id = editar.id;
      nuevo.platoId = editar.platoId;
      nuevo.planeado = editar.planeado;
      nuevo.hora = editar.hora || nuevo.hora;
      if (i >= 0) d.comidas[i] = nuevo;
    } else {
      d.comidas.push(nuevo);
    }
    cerrarHojas(hj, hjPadre);
    await guardarDia(fecha);
    aviso(editar ? 'Guardado.' : `Agregado: ${a.nombre}`);
    if (!editar) await reemplazarPlaneado(fecha, mom);
  }

  const resumenRecargo = h('span', { testid: 'recargo-resumen' });
  const pintarResumenRecargo = () => {
    resumenRecargo.textContent = recargo ? `De restaurante: ${textoOpcionRecargo(recargo)} · Cambiar` : '¿De restaurante? (el extra se cuenta como grasa)';
  };
  selRecargo.addEventListener('click', () => setTimeout(pintarResumenRecargo, 0));
  pintarResumenRecargo();
  const ingredientes = (a.ingredientes || []).filter((x) => x && x.nombre);
  montar(
    hj.cuerpo,
    a.notas ? h('p', { class: 'suave chico' }, a.notas) : null,
    a.estimado ? h('p', { class: 'amarillo chico' }, 'Este alimento tiene datos estimados.') : null,
    a.libre ? h('p', { class: 'verde' }, 'Libre: no suma. Puedes agregarlo sin pesar.') : null,
    ingredientes.length
      ? h(
          'details',
          { class: 'mb', testid: 'que-trae' },
          h('summary', { class: 'etq-linea' }, `Qué trae (${ingredientes.length})`),
          h(
            'ul',
            { class: 'lista' },
            ingredientes.map((x) =>
              h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, x.nombre), h('div', { class: 'item-sub' }, `${x.gramos != null ? `${fmtG(x.gramos)} g · ` : ''}${fmtKcal(x.kcal)} kcal · ${fmtG(x.p)} P · ${fmtG(x.g)} G · ${fmtG(x.c)} C`)))),
            ),
          ),
        )
      : null,
    campo('Cantidad', cant),
    selUnidad,
    selEstado ? h('div', { class: 'mt' }, h('div', { class: 'etq-linea' }, '¿Cómo lo pesaste?'), selEstado) : null,
    conversion,
    preview,
    h('details', { class: 'mt', testid: 'recargo-detalle', open: (!!recargo && !a.restaurante) || null }, h('summary', { class: 'etq-linea' }, resumenRecargo), selRecargo),
    h('div', { class: 'mt' }, est),
    h('div', { class: 'etq-linea' }, 'Momento'),
    selMomento,
    h(
      'div',
      { class: 'fila-btns fila-fija' },
      editar
        ? h(
            'button',
            {
              class: 'btn btn-peligro',
              type: 'button',
              testid: 'borrar-item',
              onclick: async () => {
                if (!(await confirmar(`¿Borrar ${a.nombre}?`, { si: 'Borrar', peligro: true }))) return;
                const d = getDia(fecha, true);
                d.comidas = d.comidas.filter((c) => c.id !== editar.id);
                hj.cerrar();
                await guardarDia(fecha);
              },
            },
            'Borrar',
          )
        : null,
      h('button', { class: 'btn btn-primario', type: 'button', testid: 'guardar-item', onclick: guardarItem }, editar ? 'Guardar' : 'Agregar'),
    ),
  );
  pintarPreview();
  // Sin foco automático: el teclado taparía el botón. La cantidad se cambia con − y + o tocándola.
}

function ultimoEstado(id) {
  for (const f of Object.keys(S.reg.dias).sort().reverse()) {
    const c = [...S.reg.dias[f].comidas].reverse().find((x) => x.alimentoId === id && !x.planeado && x.estado);
    if (c) return c.estado;
  }
  return null;
}

function ultimaCantidad(id) {
  for (const f of Object.keys(S.reg.dias).sort().reverse()) {
    const c = [...S.reg.dias[f].comidas].reverse().find((x) => x.alimentoId === id && !x.planeado && x.unidad === 'g');
    if (c) return c.cantidad;
  }
  return null;
}

/** Plato guardado: ½, 1 o 1½ porción. */
export function abrirPlato(hjPadre, fecha, p, { momento } = {}) {
  const hj = hoja({ titulo: p.nombre, testid: 'hoja-plato' });
  let escala = 1;
  let mom = MOMENTOS.includes(p.momento) ? p.momento : momento || momentoPorHora();
  const detalle = h('div', { testid: 'detalle-plato' });
  function pintar() {
    const { comidas, faltantes } = comidasDesdePlato(p, escala, mom);
    const t = sumar(comidas);
    montar(
      detalle,
      p.totales
        ? h('p', { class: 'suave chico' }, p.totales.incluyeRecargo ? 'Totales fijos (ya traen el recargo).' : 'Totales fijos.')
        : h(
            'ul',
            { class: 'lista' },
            comidas.map((c) => {
              const a = alimentoPorId(c.alimentoId);
              return h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, c.nombre), h('div', { class: 'item-sub' }, `${textoCantidad(a, c.cantidad, c.unidad, c.estado)} · ${fmtKcal(c.kcal)} kcal · ${fmtG(c.p)} P`))));
            }),
          ),
      faltantes.length ? h('p', { class: 'rojo chico' }, `Faltan alimentos en tu base: ${faltantes.join(', ')}`) : null,
      h(
        'div',
        { class: 'preview-macros' },
        h('div', {}, h('b', {}, fmtKcal(t.kcal)), h('span', {}, 'kcal')),
        h('div', {}, h('b', {}, fmtG(t.p)), h('span', {}, 'P')),
        h('div', {}, h('b', {}, fmtG(t.g)), h('span', {}, 'G')),
        h('div', {}, h('b', {}, fmtG(t.c)), h('span', {}, 'C')),
      ),
    );
  }
  async function agregar() {
    let completar = false;
    if (p.incompleto) {
      const r = await pedirDatoQueFalta(p);
      if (!r) return;
      completar = r === 'completar';
    }
    const { comidas } = comidasDesdePlato(p, escala, mom);
    if (p.incompleto && !completar) comidas.forEach((c) => (c.estimado = true));
    const d = getDia(fecha, true);
    d.comidas.push(...comidas);
    cerrarHojas(hj, hjPadre);
    await guardarDia(fecha);
    aviso(`Agregado: ${p.nombre}`);
    if (completar) {
      buscarLoQueFalta(fecha, mom, p);
      return;
    }
    await reemplazarPlaneado(fecha, mom);
  }
  montar(
    hj.cuerpo,
    p.incompleto ? h('div', { class: 'aviso alerta' }, h('p', {}, `Incompleto: ${p.incompleto}`)) : null,
    p.notas ? h('p', { class: 'suave chico' }, p.notas) : null,
    h('div', { class: 'etq-linea' }, 'Porción'),
    chips({
      opciones: [
        { valor: 0.5, texto: '½' },
        { valor: 1, texto: '1' },
        { valor: 1.5, texto: '1½' },
      ],
      valor: 1,
      testid: 'escala',
      clase: 'grandes',
      alElegir: (v) => {
        escala = v;
        pintar();
      },
    }),
    detalle,
    h('div', { class: 'etq-linea' }, 'Momento'),
    chips({ opciones: MOMENTOS.map((m) => ({ valor: m, texto: NOMBRE_MOMENTO[m] })), valor: mom, testid: 'momento-plato', alElegir: (v) => (mom = v) }),
    h('div', { class: 'fila-btns fila-fija' }, h('button', { class: 'btn btn-primario', type: 'button', testid: 'agregar-plato', onclick: agregar }, 'Agregar')),
  );
  pintar();
}

// ---------- Producto nuevo ----------

const CATEGORIAS = ['proteina', 'lacteo', 'carbo', 'fruta', 'verdura', 'grasa', 'salsa', 'snack', 'suplemento', 'bebida', 'otro'];
const NOMBRE_CAT = { proteina: 'Proteína', lacteo: 'Lácteo', carbo: 'Carbo', fruta: 'Fruta', verdura: 'Verdura', grasa: 'Grasa', salsa: 'Salsa', snack: 'Snack', suplemento: 'Suplemento', bebida: 'Bebida', otro: 'Otro' };

export function abrirProductoNuevo(hjPadre, fecha, { momento, nombre = '', alGuardar } = {}) {
  const hj = hoja({ titulo: 'Producto nuevo (etiqueta)', clase: 'alta', testid: 'hoja-producto' });
  let modo = 'porcion';
  let categoria = 'otro';
  let codigo = null;
  const fNombre = inputTexto({ valor: nombre, placeholder: 'Nombre', testid: 'p-nombre', etiqueta: 'Nombre' });
  const fMarca = inputTexto({ placeholder: 'Marca', testid: 'p-marca', etiqueta: 'Marca' });
  const fPorcion = inputNum({ placeholder: 'g', testid: 'p-porcion', etiqueta: 'Porción en gramos' });
  const fK = inputNum({ placeholder: 'kcal', testid: 'p-kcal', etiqueta: 'Calorías' });
  const fP = inputNum({ placeholder: 'P', testid: 'p-p', etiqueta: 'Proteína' });
  const fG = inputNum({ placeholder: 'G', testid: 'p-g', etiqueta: 'Grasa' });
  const fC = inputNum({ placeholder: 'C', testid: 'p-c', etiqueta: 'Carbos' });
  const visible = casilla('Es grasa que se ve (aceite, mantequilla, mayonesa, aguacate, cremas, salsas cremosas)', { testid: 'p-visible' });
  const est = casilla('Dato estimado (sin etiqueta)', { testid: 'p-estimado' });
  const nota = h('p', { class: 'amarillo chico', testid: 'p-nota' });
  const selModo = chips({
    opciones: [
      { valor: 'porcion', texto: 'De la porción' },
      { valor: '100g', texto: 'Por 100 g' },
    ],
    valor: modo,
    testid: 'p-modo',
    alElegir: (v) => (modo = v),
  });
  const selCat = chips({ opciones: CATEGORIAS.map((c) => ({ valor: c, texto: NOMBRE_CAT[c] })), valor: categoria, testid: 'p-cat', alElegir: (v) => (categoria = v) });

  function precargar(prod) {
    fNombre.value = prod.nombre || fNombre.value;
    fMarca.value = prod.marca || fMarca.value;
    if (prod.porcion) fPorcion.value = prod.porcion;
    fK.value = prod.kcal ?? '';
    fP.value = prod.p ?? '';
    fG.value = prod.g ?? '';
    fC.value = prod.c ?? '';
    modo = '100g';
    selModo.fijar('100g');
    codigo = prod.codigo || codigo;
    nota.textContent = 'Datos precargados de Open Food Facts (por 100 g). Confírmalos con la etiqueta antes de guardar.';
  }

  async function guardarProducto() {
    const nom = fNombre.value.trim();
    const porcion = num(fPorcion.value);
    const vals = [num(fK.value), num(fP.value), num(fG.value), num(fC.value)];
    if (!nom) return aviso('Escribe el nombre.');
    if (vals.some((v) => v == null)) return aviso('Escribe calorías, proteína, grasa y carbos.');
    if (modo === 'porcion' && !porcion) return aviso('Escribe la porción en gramos.');
    const f = modo === 'porcion' ? 100 / porcion : 1;
    const [kcal, p, g, c] = vals.map((v) => Math.round(v * f * 1000) / 1000);
    const id = `u-${sinTildes(nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${uid().slice(0, 6)}`;
    const nuevo = {
      id,
      nombre: nom,
      marca: fMarca.value.trim(),
      categoria,
      base: '100g',
      unidadNombre: porcion ? 'porción' : null,
      gramosUnidad: porcion || null,
      kcal,
      p,
      g,
      c,
      estimado: est.input.checked,
      fuente: est.input.checked ? 'estimado' : 'etiqueta',
      grasaVisible: visible.input.checked,
      coccion: null,
      restaurante: null,
      ingredientes: null,
      enCasa: false,
      favorito: false,
      libre: false,
      origen: 'usuario',
      notas: codigo ? `Código de barras: ${codigo}` : '',
    };
    S.alimentos.push(nuevo);
    invalidarIndice();
    await guardar('alimentos');
    hj.cerrar();
    aviso('Producto guardado.');
    if (alGuardar) alGuardar(nuevo);
    else if (fecha) abrirCantidad(hjPadre, fecha, nuevo, { momento });
  }

  montar(
    hj.cuerpo,
    'BarcodeDetector' in window || true
      ? h('div', { class: 'fila-btns' }, h('button', { class: 'btn btn-sec', type: 'button', testid: 'escanear', onclick: () => abrirEscaner(precargar) }, '📷 Código de barras'), h('button', { class: 'btn btn-sec', type: 'button', onclick: () => abrirFatSecret(fNombre.value.trim()) }, 'Buscar en FatSecret'))
      : null,
    nota,
    campo('Nombre', fNombre),
    campo('Marca', fMarca),
    campo('Tamaño de la porción (g)', fPorcion, 'El de la etiqueta. Después solo escribes cuánto comiste.'),
    h('div', { class: 'etq-linea' }, 'Los valores son…'),
    selModo,
    h('div', { class: 'cuatro-col mt' }, campo('kcal', fK), campo('Prot.', fP), campo('Grasa', fG), campo('Carbos', fC)),
    h('div', { class: 'etq-linea' }, 'Tipo'),
    selCat,
    h('div', { class: 'mt' }, visible, est),
    h('div', { class: 'fila-btns fila-fija' }, h('button', { class: 'btn btn-primario', type: 'button', testid: 'p-guardar', onclick: guardarProducto }, 'Guardar')),
  );
}

/** Lee un código de barras con la cámara (si el navegador puede) o escrito a mano, y consulta Open Food Facts. */
export function abrirEscaner(alEncontrar) {
  let stream = null;
  let activo = true;
  const hj = hoja({
    titulo: 'Código de barras',
    testid: 'hoja-escaner',
    alCerrar: () => {
      activo = false;
      stream?.getTracks().forEach((t) => t.stop());
    },
  });
  const estado = h('p', { class: 'suave', testid: 'escaner-estado' });
  const video = h('video', { playsinline: true, muted: true, style: { width: '100%', borderRadius: '14px', background: '#000', maxHeight: '45vh' } });
  const fCodigo = inputNum({ placeholder: 'Escribe el número del código', testid: 'codigo', decimal: false, etiqueta: 'Código' });

  async function buscar(codigo) {
    codigo = String(codigo || '').replace(/\D/g, '');
    if (!codigo) return aviso('Escribe el código.');
    if (!navigator.onLine) {
      estado.textContent = 'Sin internet: llena los datos con la etiqueta.';
      return;
    }
    estado.textContent = 'Buscando…';
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${codigo}.json`);
      const j = await r.json();
      if (j.status !== 1 || !j.product) {
        estado.textContent = 'No está en Open Food Facts: llena los datos con la etiqueta.';
        return;
      }
      const pr = j.product;
      const n = pr.nutriments || {};
      const kcal = n['energy-kcal_100g'] ?? (n.energy_100g != null ? Math.round(n.energy_100g / 4.184) : null);
      alEncontrar({
        codigo,
        nombre: pr.product_name_es || pr.product_name || '',
        marca: (pr.brands || '').split(',')[0].trim(),
        porcion: pr.serving_quantity ? Number(pr.serving_quantity) : null,
        kcal: kcal != null ? r1(kcal) : null,
        p: n.proteins_100g != null ? r1(n.proteins_100g) : null,
        g: n.fat_100g != null ? r1(n.fat_100g) : null,
        c: n.carbohydrates_100g != null ? r1(n.carbohydrates_100g) : null,
      });
      hj.cerrar();
    } catch {
      estado.textContent = 'No se pudo consultar. Llena los datos con la etiqueta.';
    }
  }

  montar(
    hj.cuerpo,
    'BarcodeDetector' in window ? video : h('p', { class: 'suave' }, 'Este navegador no lee códigos con la cámara: escribe el número.'),
    estado,
    campo('Código', fCodigo),
    h('div', { class: 'fila-btns' }, h('button', { class: 'btn btn-primario', type: 'button', testid: 'buscar-codigo', onclick: () => buscar(fCodigo.value) }, 'Buscar')),
  );

  if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) {
    (async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!activo) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        estado.textContent = 'Apunta al código de barras.';
        const leer = async () => {
          if (!activo) return;
          try {
            const cods = await det.detect(video);
            if (cods.length) {
              fCodigo.value = cods[0].rawValue;
              stream.getTracks().forEach((t) => t.stop());
              buscar(cods[0].rawValue);
              return;
            }
          } catch {
            /* sigue intentando */
          }
          setTimeout(leer, 300);
        };
        leer();
      } catch {
        estado.textContent = 'No se pudo abrir la cámara: escribe el número.';
      }
    })();
  }
}

// ---------- Cerrar el día ----------

export function abrirCerrarDia(fecha) {
  const meta = metaDelDia(fecha);
  if (!meta) return aviso('Faltan las metas.');
  const hj = hoja({ titulo: 'Cerrar el día', clase: 'alta', testid: 'hoja-cerrar' });
  const excluir = [...(S.ui.noHay?.[fecha] || [])];
  const cont = h('div');
  const momentoProp = 'cena';

  function lineaMacros(t, soloKP) {
    return soloKP ? `${fmtKcal(t.kcal)} kcal · ${fmtG(t.p)} P` : `${fmtKcal(t.kcal)} kcal · ${fmtG(t.p)} P · ${fmtG(t.g)} G · ${fmtG(t.c)} C`;
  }

  function pintar() {
    const t = totalesDelDia(fecha);
    const cons = t.conf;
    const soloKP = !!meta.soloKcalYProteina;
    const f = falta(cons, meta);
    const reglaOro = S.metas?.reglaDeOroP ?? meta.p;
    const conPlan = sumar([cons, t.plan]);
    const planOk = t.nPlan > 0 && planCierra(conPlan, meta, S.metas);
    const prop = proponerCierre({ meta, metas: S.metas, consumido: cons, alimentos: S.alimentos, frecuencia: frecuenciaAlimentos(), excluir, prefs: S.ajustes?.cierre || {} });
    const finalTabla = planOk ? conPlan : prop.final;
    const filas = tablaFinal(finalTabla, meta, S.metas);
    montar(
      cont,
      h('p', {}, h('b', {}, 'Llevas: '), lineaMacros(cons, soloKP)),
      h('p', {}, h('b', {}, `Meta (${meta.nombre || ''}): `), lineaMacros({ kcal: meta.kcal, p: meta.p ?? meta.pMin, g: meta.g, c: meta.c }, soloKP)),
      h('p', { testid: 'cierre-falta' }, h('b', {}, 'Te falta: '), lineaMacros({ kcal: f.kcal, p: f.p, g: f.g ?? 0, c: f.c ?? 0 }, soloKP)),
      h('p', { class: 'aviso', testid: 'regla-oro' }, cons.p >= reglaOro ? `Regla de oro: ya llegaste a ${reglaOro} g de proteína. Solo grasa o carbos.` : `Regla de oro: te faltan ${fmtG(reglaOro - cons.p)} g de proteína para ${reglaOro}. La propuesta empieza por ahí.`),
      planOk
        ? h(
            'div',
            { class: 'tarjeta', testid: 'cierre-plan' },
            h('h3', { class: 'tarjeta-tit' }, 'Lo que planeaste cierra la meta'),
            h('ul', { class: 'lista' }, getDia(fecha).comidas.filter((c) => c.planeado).map((c) => h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, c.nombre), h('div', { class: 'item-sub' }, `${textoCantidad(alimentoPorId(c.alimentoId) || {}, c.cantidad, c.unidad, c.estado)} · ${NOMBRE_MOMENTO[c.momento]}`)))))),
            h(
              'button',
              {
                class: 'btn btn-primario btn-ancho mt',
                type: 'button',
                testid: 'confirmar-plan-cierre',
                onclick: async () => {
                  const d = getDia(fecha);
                  d.comidas.forEach((c) => {
                    if (c.planeado) {
                      c.planeado = false;
                      c.hora = horaLocal();
                    }
                  });
                  await cerrarDia(fecha);
                  hj.cerrar();
                },
              },
              'Confirmar lo planeado y cerrar',
            ),
          )
        : null,
      h('h3', { class: 'tarjeta-tit mt' }, planOk ? 'O esta otra opción' : 'Propuesta'),
      prop.sinEnCasa
        ? vacio('Marca en Datos → Alimentos lo que tienes "en casa" para recibir propuestas.')
        : prop.items.length
          ? h(
              'ul',
              { class: 'lista', testid: 'propuesta' },
              prop.items.map((it) =>
                h(
                  'li',
                  {},
                  h(
                    'div',
                    { class: 'item' },
                    h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, it.alimento.nombre), h('div', { class: 'negrita' }, textoCantidad(it.alimento, it.cantidad, it.unidad, it.estado)), h('div', { class: 'item-sub' }, lineaMacros(it.macros))),
                    h(
                      'button',
                      {
                        class: 'btn btn-chico btn-sec',
                        type: 'button',
                        onclick: () => {
                          excluir.push(it.alimento.id);
                          pintar();
                        },
                      },
                      'Otra',
                    ),
                    h(
                      'button',
                      {
                        class: 'btn btn-chico btn-sec',
                        type: 'button',
                        onclick: async () => {
                          excluir.push(it.alimento.id);
                          S.ui.noHay = { [fecha]: [...new Set([...(S.ui.noHay?.[fecha] || []), it.alimento.id])] };
                          await guardar('ui');
                          pintar();
                        },
                      },
                      'No hay',
                    ),
                  ),
                ),
              ),
            )
          : vacio(cons.kcal >= meta.kcal ? 'Ya no queda espacio: no hace falta agregar nada.' : 'No encontré una combinación con lo que hay en casa.'),
      t.nPlan && !planOk && prop.items.length ? h('p', { class: 'suave chico' }, 'Lo planeado que no confirmaste se quita al usar la propuesta.') : null,
      h('h3', { class: 'tarjeta-tit mt' }, 'Así quedaría el día'),
      h(
        'table',
        { class: 'tabla', testid: 'tabla-final' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Total'), h('th', {}, 'Meta'), h('th', {}, ''))),
        h(
          'tbody',
          {},
          filas.map((r) => h('tr', {}, h('td', {}, r.nombre), h('td', {}, r.n === 'kcal' ? fmtKcal(r.valor) : fmtG(r.valor)), h('td', {}, r.n === 'kcal' ? fmtKcal(r.meta) : fmtG(r.meta)), h('td', {}, r.icono))),
        ),
      ),
      meta.c != null && finalTabla.c < meta.c && !soloKP ? h('p', { class: 'suave chico' }, `Los ${fmtG(meta.c - finalTabla.c)} g de carbos que faltan son lo que se sacrifica.`) : null,
      h(
        'div',
        { class: 'fila-btns fila-fija' },
        h(
          'button',
          {
            class: 'btn btn-sec',
            type: 'button',
            testid: 'cerrar-sin-agregar',
            onclick: async () => {
              await cerrarDia(fecha);
              hj.cerrar();
            },
          },
          'Cerrar sin agregar',
        ),
        prop.items.length
          ? h(
              'button',
              {
                class: 'btn btn-primario',
                type: 'button',
                testid: 'usar-propuesta',
                onclick: async () => {
                  const d = getDia(fecha, true);
                  d.comidas = d.comidas.filter((c) => !c.planeado);
                  for (const it of prop.items) d.comidas.push(comidaDesdeAlimento(it.alimento, it, momentoProp, false));
                  await cerrarDia(fecha);
                  hj.cerrar();
                },
              },
              'Usar la propuesta',
            )
          : null,
      ),
    );
  }
  montar(hj.cuerpo, cont);
  pintar();
}

export async function cerrarDia(fecha) {
  const d = getDia(fecha, true);
  const t = totalesDelDia(fecha).conf;
  d.resumen = { cerrado: true, kcal: t.kcal, p: t.p, g: t.g, c: t.c };
  await guardar('reg.dias');
  aviso('Día cerrado.');
}

// ---------- Guardar como plato ----------

async function guardarComoPlato(fecha, momento) {
  const d = getDia(fecha);
  const items = (d?.comidas || []).filter((c) => c.momento === momento && !c.planeado && c.alimentoId);
  if (!items.length) return aviso('No hay alimentos para guardar.');
  const hj = hoja({ titulo: 'Guardar como plato' });
  const fNombre = inputTexto({ placeholder: 'Nombre del plato', testid: 'plato-nombre', etiqueta: 'Nombre' });
  montar(
    hj.cuerpo,
    campo('Nombre', fNombre),
    h('p', { class: 'suave chico' }, items.map((c) => c.nombre).join(', ')),
    h(
      'div',
      { class: 'fila-btns' },
      h(
        'button',
        {
          class: 'btn btn-primario',
          type: 'button',
          testid: 'plato-guardar',
          onclick: async () => {
            const nombre = fNombre.value.trim();
            if (!nombre) return aviso('Escribe el nombre.');
            S.platos.push({
              id: `u-plato-${uid().slice(0, 8)}`,
              nombre,
              momento,
              items: items.map((c) => ({ alimentoId: c.alimentoId, cantidad: c.cantidad, unidad: c.unidad, estado: c.estado, recargo: c.recargo || undefined })),
              totales: null,
              incompleto: null,
              etiquetas: [],
              restaurante: null,
              origen: 'usuario',
              notas: '',
            });
            invalidarIndice();
            await guardar('platos');
            hj.cerrar();
            aviso('Plato guardado.');
          },
        },
        'Guardar',
      ),
    ),
  );
  enfocar(hj, fNombre);
}

// ---------- Vista ----------

let fechaVista = null;

export function fechaDeVista() {
  return fechaVista || hoy();
}

export function irAFecha(f) {
  fechaVista = f;
}

function editarComida(fecha, c) {
  const a = c.alimentoId ? alimentoPorId(c.alimentoId) : null;
  if (a) return abrirCantidad(null, fecha, a, { editar: c });
  const p = c.platoId ? platoPorId(c.platoId) : null;
  const hj = hoja({ titulo: c.nombre });
  let escala = c.cantidad || 1;
  montar(
    hj.cuerpo,
    h('p', {}, `${fmtKcal(c.kcal)} kcal · ${fmtG(c.p)} P · ${fmtG(c.g)} G · ${fmtG(c.c)} C`),
    p?.totales
      ? chips({
          opciones: [
            { valor: 0.5, texto: '½' },
            { valor: 1, texto: '1' },
            { valor: 1.5, texto: '1½' },
          ],
          valor: escala,
          clase: 'grandes',
          alElegir: (v) => (escala = v),
        })
      : h('p', { class: 'suave' }, 'Este registro ya no está en tu base de alimentos.'),
    h(
      'div',
      { class: 'fila-btns' },
      h(
        'button',
        {
          class: 'btn btn-peligro',
          type: 'button',
          testid: 'borrar-item',
          onclick: async () => {
            if (!(await confirmar(`¿Borrar ${c.nombre}?`, { si: 'Borrar', peligro: true }))) return;
            const d = getDia(fecha);
            d.comidas = d.comidas.filter((x) => x.id !== c.id);
            hj.cerrar();
            await guardarDia(fecha);
          },
        },
        'Borrar',
      ),
      p?.totales
        ? h(
            'button',
            {
              class: 'btn btn-primario',
              type: 'button',
              onclick: async () => {
                c.cantidad = escala;
                recalcularComida(c);
                hj.cerrar();
                await guardarDia(fecha);
              },
            },
            'Guardar',
          )
        : null,
    ),
  );
}

function filaComida(fecha, c) {
  const a = c.alimentoId ? alimentoPorId(c.alimentoId) : null;
  const cantTxt = c.unidad === 'porcion' ? `${c.cantidad === 0.5 ? '½' : c.cantidad === 1.5 ? '1½' : c.cantidad} porción` : a ? textoCantidad(a, c.cantidad, c.unidad, c.estado) : '';
  return h(
    'li',
    { class: 'resultado' },
    h(
      'button',
      { class: `item ${c.planeado ? 'planeado' : ''}`, type: 'button', onclick: () => editarComida(fecha, c), testid: `comida-${c.id}` },
      h(
        'div',
        { class: 'item-txt' },
        h('div', { class: 'item-tit' }, c.nombre, c.estimado ? h('span', { class: 'etiqueta amarilla' }, 'est.') : null, c.recargo ? h('span', { class: 'etiqueta azul' }, c.recargo.startsWith('peor:') ? 'peor caso' : `+${Math.round((S.metas?.recargos?.[c.recargo] || 0) * 100)}%`) : null),
        h('div', { class: 'item-sub' }, `${cantTxt}${cantTxt ? ' · ' : ''}${fmtKcal(c.kcal)} kcal · ${fmtG(c.p)} P · ${fmtG(c.g)} G · ${fmtG(c.c)} C`),
      ),
    ),
    c.planeado
      ? h(
          'button',
          {
            class: 'btn btn-chico btn-ok',
            type: 'button',
            'aria-label': `Confirmar ${c.nombre}`,
            testid: `confirmar-${c.id}`,
            onclick: () => confirmarConDeshacer(fecha, (x) => x.id === c.id, `Confirmado: ${c.nombre}`),
          },
          '✓',
        )
      : null,
  );
}

export function render(cont) {
  const fecha = fechaDeVista();
  const d = getDia(fecha);
  const comidas = d?.comidas || [];
  const o3 = S.ajustes?.omega3;
  const esHoy = fecha === hoy();
  montar(
    cont,
    h(
      'div',
      { class: 'tipo-dia' },
      h('button', { class: 'btn btn-chico btn-sec', type: 'button', 'aria-label': 'Día anterior', testid: 'dia-anterior', onclick: () => ((fechaVista = sumarDias(fecha, -1)), render(cont)) }, '‹'),
      h('div', { class: 'item-txt centro' }, h('div', { class: 'negrita', testid: 'fecha-vista' }, esHoy ? `Hoy, ${fechaCorta(fecha)}` : fechaCorta(fecha))),
      h('button', { class: 'btn btn-chico btn-sec', type: 'button', 'aria-label': 'Día siguiente', testid: 'dia-siguiente', onclick: () => ((fechaVista = sumarDias(fecha, 1)), render(cont)) }, '›'),
    ),
    h(
      'div',
      { class: 'tipo-dia' },
      h('span', { class: 'suave' }, 'Tipo de día:'),
      h('button', { class: 'chip sel', type: 'button', testid: 'cambiar-tipo', onclick: () => elegirTipo(fecha) }, d?.tipo ? metaDelTipo(S.metas, d.tipo)?.nombre || d.tipo : 'Elegir'),
    ),
    bloqueBarras(fecha),
    h(
      'div',
      { class: 'rejilla-btns mb' },
      h('button', { class: 'btn btn-sec', type: 'button', testid: 'planear', onclick: () => planearDia(fecha) }, '📋 Planear el día'),
      h('button', { class: 'btn btn-sec', type: 'button', testid: 'cerrar-dia', onclick: () => abrirCerrarDia(fecha) }, '✅ Cerrar el día'),
    ),
    MOMENTOS.map((m) => {
      const lista = comidas.filter((c) => c.momento === m);
      const conf = sumar(lista.filter((c) => !c.planeado));
      const hayPlan = lista.some((c) => c.planeado);
      const hijos = [];
      let ultimoPlato = undefined;
      for (const c of lista) {
        if (c.platoId && c.platoId !== ultimoPlato) {
          const p = platoPorId(c.platoId);
          hijos.push(
            h(
              'li',
              { class: 'grupo-plato' },
              h('span', {}, p?.nombre || 'Plato'),
              c.planeado ? h('button', { class: 'btn-texto', type: 'button', onclick: () => cambiarPlanVariante(fecha, m, c.platoId) }, 'Cambiar') : null,
            ),
          );
        }
        ultimoPlato = c.platoId || null;
        hijos.push(filaComida(fecha, c));
      }
      return seccion(
        null,
        h(
          'div',
          { class: 'momento-cab' },
          h('h3', {}, NOMBRE_MOMENTO[m]),
          h('span', { class: 'momento-tot' }, conf.kcal ? `${fmtKcal(conf.kcal)} kcal · ${fmtG(conf.p)} P` : ''),
        ),
        lista.length ? h('ul', { class: 'lista', testid: `lista-${m}` }, hijos) : null,
        h(
          'div',
          { class: 'fila-btns' },
          hayPlan ? h('button', { class: 'btn btn-ok btn-chico', type: 'button', testid: `confirmar-todo-${m}`, onclick: () => confirmarConDeshacer(fecha, (x) => x.momento === m, `Confirmado: ${NOMBRE_MOMENTO[m].toLowerCase()}`) }, '✓ Confirmar todo') : null,
          h('button', { class: 'btn btn-sec btn-chico', type: 'button', testid: `agregar-${m}`, onclick: () => abrirAgregar(fecha, m) }, '+ Agregar'),
          lista.filter((c) => !c.planeado && c.alimentoId).length >= 2 ? h('button', { class: 'btn-texto', type: 'button', onclick: () => guardarComoPlato(fecha, m) }, 'Guardar como plato') : null,
        ),
      );
    }),
    o3
      ? seccion(
          null,
          casilla(`${o3.nombre || 'Suplemento diario'} (se suma solo: ${fmtKcal(o3.kcal)} kcal · ${fmtG(o3.g)} G)`, {
            checked: d ? omega3DelDia(d, S.ajustes) : !!o3.activo,
            testid: 'omega3',
            alCambiar: async (v) => {
              const dd = getDia(fecha, true);
              dd.omega3 = v;
              await guardarDia(fecha);
            },
          }),
        )
      : null,
    seccion(
      'Nota del día',
      (() => {
        const ta = h('textarea', { class: 'input', placeholder: 'Opcional', 'aria-label': 'Nota del día', value: d?.notas || '' });
        ta.addEventListener('change', async () => {
          const dd = getDia(fecha, true);
          dd.notas = ta.value;
          await guardar('reg.dias');
        });
        return ta;
      })(),
    ),
  );
}
