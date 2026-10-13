// Datos: exportar e importar la copia, metas, alimentos, platos, rutina y ajustes.
import { S, guardar, estaVacia, cargarCopia, copiaActual, invalidarIndice, uid } from './estado.js';
import * as db from './db.js';
import { leerTextoCopia, validarCopia, actualizarPlan, nombreArchivoCopia, normalizarCopia } from './copia.js';
import { hoy, isoLocal, fechaCorta, fechaDeIso, horaLocal, difDias, fmtDuracion } from './fechas.js';
import { num, fmtKcal, fmtG, sinTildes, buscarAlimentos } from './calculos.js';
import { h, montar, hoja, confirmar, aviso, chips, campo, inputNum, inputTexto, casilla, seccion, vacio, descargar } from './ui.js';
import { abrirProductoNuevo } from './comida.js';
import { abrirCalendario } from './cuerpo.js';
import { reglaRecorte, textosAjusteSesion, textosSeriesDesdeSemana, textoDuracion, textoSemanaSuave } from './progresion.js';
import { ir } from './navegar.js';

// ---------- Exportar ----------

export async function exportarCopia() {
  const antes = S.reg.ultimaCopia;
  S.reg.ultimaCopia = isoLocal();
  const texto = JSON.stringify(copiaActual('copia'), null, 1);
  const nombre = nombreArchivoCopia(hoy());
  let hecho = false;
  try {
    const archivo = new File([texto], nombre, { type: 'text/plain' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: nombre });
      hecho = true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') {
      S.reg.ultimaCopia = antes;
      return false;
    }
  }
  if (!hecho) descargar(nombre, texto);
  await guardar('reg.ultimaCopia');
  aviso(`Copia lista: ${nombre}`);
  return true;
}

// ---------- Importar ----------

export function abrirImportar() {
  let input = document.getElementById('archivo-importar');
  if (!input) {
    input = h('input', { type: 'file', id: 'archivo-importar', accept: '.txt,.json,text/plain,application/json', style: { display: 'none' } });
    document.body.append(input);
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      const texto = await f.text();
      await importarTexto(texto);
    });
  }
  input.click();
}

export async function importarTexto(texto) {
  let obj;
  try {
    obj = leerTextoCopia(texto);
  } catch (e) {
    aviso(e.message, 4000);
    return;
  }
  const v = validarCopia(obj);
  if (!v.ok) {
    aviso(v.error, 4000);
    return;
  }
  if (estaVacia()) {
    await cargarCopia(obj);
    await db.pedirPersistencia();
    aviso('Listo: tus datos quedaron cargados.');
    ir('hoy');
    return;
  }
  const hj = hoja({ titulo: '¿Qué hago con este archivo?', testid: 'hoja-modo' });
  montar(
    hj.cuerpo,
    h('p', { class: 'suave chico' }, `Archivo: ${obj.tipo === 'arranque' ? 'de arranque' : 'copia'}${obj.creado ? ` del ${fechaCorta(fechaDeIso(obj.creado))}` : ''}.`),
    h(
      'button',
      {
        class: 'btn btn-sec btn-grande mb',
        type: 'button',
        testid: 'modo-actualizar',
        onclick: async () => {
          hj.cerrar();
          const r = actualizarPlan(S, obj);
          Object.assign(S, r);
          invalidarIndice();
          await guardar('rutina', 'metas', 'ajustes', 'alimentos', 'platos');
          aviso('Plan actualizado. Tus registros no cambiaron.');
        },
      },
      'Actualizar plan',
    ),
    h('p', { class: 'suave chico' }, 'Cambia la rutina, las metas y los ajustes. Agrega y corrige alimentos y platos sin borrar los tuyos. No toca tus registros.'),
    h('hr', { class: 'sep' }),
    h(
      'button',
      {
        class: 'btn btn-peligro btn-grande mb',
        type: 'button',
        testid: 'modo-restaurar',
        onclick: async () => {
          const ok = await confirmar('Se reemplaza todo lo que hay en la app por esta copia.', { si: 'Restaurar', peligro: true, titulo: 'Restaurar copia completa', detalle: 'Antes guardo lo actual para que puedas deshacerlo.' });
          if (!ok) return;
          hj.cerrar();
          await restaurar(obj);
        },
      },
      'Restaurar copia completa',
    ),
    h('p', { class: 'suave chico' }, 'Reemplaza todo con la copia. Lo actual queda guardado y puedes deshacerlo.'),
  );
}

// Respaldos de antes de restaurar: una pila (los más nuevos al final). Nunca se pisa uno anterior.
const MAX_RESPALDOS = 5;
const DIAS_DESHACER = 7;

function sinMarcas(c) {
  const x = structuredClone(c || {});
  delete x.creado;
  delete x.tipo;
  if (x.registros) delete x.registros.ultimaCopia;
  return JSON.stringify(x);
}

export async function leerRespaldos() {
  const lista = (await db.leer('respaldos')) || [];
  const viejo = await db.leer('respaldo');
  return viejo?.copia ? [viejo, ...lista] : lista;
}

async function guardarRespaldos(lista) {
  await db.guardarVarias({ respaldos: lista.slice(-MAX_RESPALDOS), respaldo: undefined });
}

/** El respaldo más nuevo, si todavía se puede deshacer (menos de una semana). */
export async function respaldoVigente() {
  const lista = await leerRespaldos();
  const r = lista[lista.length - 1];
  if (!r?.copia) return null;
  return difDias(fechaDeIso(r.fecha), hoy()) <= DIAS_DESHACER ? r : null;
}

export async function restaurar(obj) {
  const actual = copiaActual('copia');
  const lista = await leerRespaldos();
  // Si se restaura dos veces lo mismo, lo de antes de la primera vez sigue siendo lo que se deshace.
  if (sinMarcas(normalizarCopia(actual)) !== sinMarcas(normalizarCopia(obj))) lista.push({ fecha: isoLocal(), copia: actual });
  await guardarRespaldos(lista);
  await cargarCopia(obj);
  aviso('Copia restaurada. Puedes deshacerlo en ⋮ (menú).', 4000);
}

export async function deshacerRestauracion() {
  const lista = await leerRespaldos();
  const r = lista[lista.length - 1];
  if (!r?.copia) return aviso('No hay nada para deshacer.');
  const cuando = `${fechaCorta(fechaDeIso(r.fecha))} a las ${horaLocal(new Date(r.fecha))}`;
  const ok = await confirmar(`¿Volver a como estaba antes de restaurar (${cuando})?`, {
    si: 'Deshacer',
    detalle: 'Lo que anotaste después de esa restauración se pierde. Si lo quieres guardar, exporta una copia antes.',
  });
  if (!ok) return;
  await cargarCopia(r.copia);
  await guardarRespaldos(lista.slice(0, -1));
  aviso('Listo: volviste a lo anterior.');
}

async function descargarRespaldo() {
  const lista = await leerRespaldos();
  const r = lista[lista.length - 1];
  if (!r?.copia) return aviso('No hay respaldo.');
  descargar(`antes-de-restaurar-${fechaDeIso(r.fecha)}.txt`, JSON.stringify(r.copia, null, 1));
}

// ---------- Bienvenida ----------

export function pantallaBienvenida() {
  return h(
    'div',
    { testid: 'bienvenida' },
    seccion(
      'Bienvenido',
      h('p', {}, 'Esta app registra tu comida, tu entreno y tu cuerpo. Funciona sin internet y tus datos viven en este teléfono.'),
      h('p', {}, 'Para empezar, importa tu archivo de arranque (el .txt que te mandaron).'),
      h('button', { class: 'btn btn-primario btn-grande', type: 'button', testid: 'importar-inicio', onclick: abrirImportar }, '📥 Importar archivo'),
      h('p', { class: 'suave chico mt' }, 'Para instalarla: en Chrome, ⋮ → "Instalar app" o "Agregar a la pantalla principal".'),
    ),
  );
}

// ---------- Menú ----------

export async function abrirMenu() {
  const hayRespaldo = !!(await respaldoVigente());
  const hj = hoja({ titulo: 'Menú', testid: 'hoja-menu' });
  const op = (texto, fn, testid) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          class: 'item',
          type: 'button',
          testid,
          onclick: () => {
            hj.cerrar();
            setTimeout(fn, 0);
          },
        },
        h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, texto)),
      ),
    );
  montar(
    hj.cuerpo,
    h(
      'ul',
      { class: 'lista' },
      op('💾 Exportar copia', exportarCopia, 'menu-exportar'),
      op('📥 Importar', abrirImportar, 'menu-importar'),
      hayRespaldo ? op('↩️ Deshacer restauración', deshacerRestauracion, 'menu-deshacer') : null,
      hayRespaldo ? op('⬇️ Descargar lo de antes de restaurar', descargarRespaldo) : null,
      op('🎯 Metas', () => ir('datos', 'metas'), 'menu-metas'),
      op('🥗 Alimentos', () => ir('datos', 'alimentos'), 'menu-alimentos'),
      op('🍲 Platos', () => ir('datos', 'platos'), 'menu-platos'),
      op('🏋️ Rutina completa', () => ir('datos', 'rutina'), 'menu-rutina'),
      op('📅 Agregar al calendario', abrirCalendario, 'menu-calendario'),
      op('⚙️ Ajustes', () => ir('datos', 'ajustes'), 'menu-ajustes'),
    ),
  );
}

// ---------- Metas ----------

const CAMPOS_META = [
  ['kcal', 'Calorías'],
  ['p', 'Proteína (g)'],
  ['g', 'Grasa (g)'],
  ['c', 'Carbos (g)'],
  ['pMin', 'Proteína mínima'],
  ['pMax', 'Proteína máxima'],
  ['gMin', 'Grasa mínima'],
  ['gMax', 'Grasa máxima'],
];

function renderMetas(cont) {
  if (!S.metas?.tipos) return montar(cont, vacio('No hay metas. Importa tu archivo de arranque.'));
  const campos = {};
  const activos = {};
  const tarjetas = Object.entries(S.metas.tipos).map(([k, m]) => {
    campos[k] = {};
    if ('activo' in m) activos[k] = casilla('Se puede elegir en "¿Hoy entrenas?"', { checked: m.activo !== false, testid: `meta-${k}-activo` });
    return seccion(
      m.nombre || k,
      activos[k] || null,
      h(
        'div',
        { class: 'dos-col' },
        CAMPOS_META.filter(([c]) => m[c] !== undefined || ['kcal'].includes(c)).map(([c, n]) => {
          campos[k][c] = inputNum({ valor: m[c], etiqueta: `${m.nombre || k} ${n}`, testid: `meta-${k}-${c}` });
          return campo(n, campos[k][c]);
        }),
      ),
      m.nota ? h('p', { class: 'suave chico' }, m.nota) : null,
    );
  });
  const generales = [
    ['diaAltoKcal', 'Día alto: kcal por encima de la meta'],
    ['reglaDeOroP', 'Regla de oro: proteína (g)'],
    ['grasaMinima', 'Grasa mínima del día (g)'],
  ];
  const cg = {};
  montar(
    cont,
    h('h2', { class: 'mb' }, 'Metas'),
    tarjetas,
    seccion(
      'Reglas',
      generales.map(([k, n]) => {
        cg[k] = inputNum({ valor: S.metas[k], etiqueta: n, testid: `meta-${k}` });
        return campo(n, cg[k]);
      }),
    ),
    h(
      'button',
      {
        class: 'btn btn-primario btn-grande',
        type: 'button',
        testid: 'metas-guardar',
        onclick: async () => {
          for (const [k, m] of Object.entries(S.metas.tipos)) {
            for (const [c, inp] of Object.entries(campos[k])) {
              const v = num(inp.value);
              if (v != null) m[c] = v;
            }
          }
          for (const [k, inp] of Object.entries(cg)) {
            const v = num(inp.value);
            if (v != null) S.metas[k] = v;
          }
          for (const [k, c] of Object.entries(activos)) S.metas.tipos[k].activo = c.input.checked;
          await guardar('metas');
          aviso('Metas guardadas.');
        },
      },
      'Guardar metas',
    ),
  );
}

// ---------- Alimentos ----------

let filtroAlimentos = '';

function editarAlimento(a) {
  const hj = hoja({ titulo: a.nombre, clase: 'alta', testid: 'hoja-editar-alimento' });
  const f = {
    nombre: inputTexto({ valor: a.nombre, etiqueta: 'Nombre' }),
    marca: inputTexto({ valor: a.marca, etiqueta: 'Marca' }),
    kcal: inputNum({ valor: a.kcal, etiqueta: 'kcal' }),
    p: inputNum({ valor: a.p, etiqueta: 'Proteína' }),
    g: inputNum({ valor: a.g, etiqueta: 'Grasa' }),
    c: inputNum({ valor: a.c, etiqueta: 'Carbos' }),
    unidadNombre: inputTexto({ valor: a.unidadNombre, etiqueta: 'Nombre de la unidad' }),
    gramosUnidad: inputNum({ valor: a.gramosUnidad, etiqueta: 'Gramos por unidad' }),
    notas: h('textarea', { class: 'input', value: a.notas || '', 'aria-label': 'Notas' }),
  };
  let base = a.base;
  const est = casilla('Dato estimado', { checked: a.estimado });
  const vis = casilla('Grasa que se ve', { checked: a.grasaVisible });
  const casa = casilla('Lo hay en casa (para "Cerrar el día")', { checked: a.enCasa });
  const fav = casilla('Favorito', { checked: a.favorito });
  const libre = casilla('Libre (no suma)', { checked: a.libre });
  montar(
    hj.cuerpo,
    h('p', { class: 'suave chico' }, `Origen: ${a.origen === 'usuario' ? 'creado por ti' : 'del plan'} · fuente: ${a.fuente || '—'}`),
    campo('Nombre', f.nombre),
    campo('Marca', f.marca),
    h('div', { class: 'etq-linea' }, 'Los valores son'),
    chips({
      opciones: [
        { valor: '100g', texto: 'Por 100 g' },
        { valor: 'unidad', texto: 'Por unidad' },
      ],
      valor: base,
      alElegir: (v) => (base = v),
    }),
    h('div', { class: 'cuatro-col mt' }, campo('kcal', f.kcal), campo('Prot.', f.p), campo('Grasa', f.g), campo('Carbos', f.c)),
    h('div', { class: 'dos-col' }, campo('Unidad', f.unidadNombre), campo('g por unidad', f.gramosUnidad)),
    a.coccion ? h('p', { class: 'suave chico' }, `Cocción: ${a.coccion.tipo}, valores en ${a.coccion.estado}.`) : null,
    est,
    vis,
    casa,
    fav,
    libre,
    campo('Notas', f.notas),
    h(
      'div',
      { class: 'fila-btns' },
      h(
        'button',
        {
          class: 'btn btn-peligro',
          type: 'button',
          onclick: async () => {
            const ok = await confirmar(`¿Borrar ${a.nombre}?`, { si: 'Borrar', peligro: true, detalle: a.origen === 'usuario' ? null : 'Es del plan: si actualizas el plan, vuelve a aparecer.' });
            if (!ok) return;
            S.alimentos = S.alimentos.filter((x) => x !== a);
            invalidarIndice();
            hj.cerrar();
            await guardar('alimentos');
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
            const antes = JSON.stringify([a.nombre, a.base, a.kcal, a.p, a.g, a.c, a.unidadNombre || null, a.gramosUnidad ?? null, !!a.estimado, !!a.grasaVisible, !!a.libre]);
            a.nombre = f.nombre.value.trim() || a.nombre;
            a.marca = f.marca.value.trim();
            a.base = base;
            for (const k of ['kcal', 'p', 'g', 'c']) {
              const v = num(f[k].value);
              if (v != null) a[k] = v;
            }
            a.unidadNombre = f.unidadNombre.value.trim() || null;
            a.gramosUnidad = num(f.gramosUnidad.value);
            a.estimado = est.input.checked;
            a.grasaVisible = vis.input.checked;
            a.enCasa = casa.input.checked;
            a.favorito = fav.input.checked;
            a.libre = libre.input.checked;
            a.notas = f.notas.value;
            const despues = JSON.stringify([a.nombre, a.base, a.kcal, a.p, a.g, a.c, a.unidadNombre || null, a.gramosUnidad ?? null, !!a.estimado, !!a.grasaVisible, !!a.libre]);
            // Si corrige un alimento del plan, "Actualizar plan" ya no lo pisa.
            if (a.origen !== 'usuario' && antes !== despues) a.editado = true;
            invalidarIndice();
            hj.cerrar();
            await guardar('alimentos');
          },
        },
        'Guardar',
      ),
    ),
  );
}

function renderAlimentos(cont) {
  const q = inputTexto({ valor: filtroAlimentos, placeholder: 'Buscar alimento', testid: 'buscar-alimentos', etiqueta: 'Buscar alimento' });
  q.setAttribute('type', 'search');
  const lista = h('ul', { class: 'lista' });
  function pintar() {
    filtroAlimentos = q.value;
    const res = buscarAlimentos(S.alimentos, q.value, { limite: 400 });
    montar(
      lista,
      res.map((a) =>
        h(
          'li',
          { class: 'resultado' },
          h(
            'button',
            { class: 'item', type: 'button', onclick: () => editarAlimento(a) },
            h(
              'div',
              { class: 'item-txt' },
              h('div', { class: 'item-tit' }, a.nombre, a.estimado ? h('span', { class: 'etiqueta amarilla' }, 'estimado') : null, a.origen === 'usuario' ? h('span', { class: 'etiqueta azul' }, 'tuyo') : null),
              h('div', { class: 'item-sub' }, `${a.base === 'unidad' ? `por ${a.unidadNombre || 'unidad'}` : 'por 100 g'}: ${fmtKcal(a.kcal)} kcal · ${fmtG(a.p)} P · ${fmtG(a.g)} G · ${fmtG(a.c)} C`),
            ),
          ),
          h(
            'button',
            {
              class: `estrella ${a.enCasa ? 'on' : ''}`,
              type: 'button',
              'aria-label': a.enCasa ? 'Quitar de en casa' : 'Marcar en casa',
              title: 'En casa',
              onclick: async (e) => {
                a.enCasa = !a.enCasa;
                e.currentTarget.classList.toggle('on', a.enCasa);
                await guardar('alimentos');
              },
            },
            '🏠',
          ),
          h(
            'button',
            {
              class: `estrella ${a.favorito ? 'on' : ''}`,
              type: 'button',
              'aria-label': a.favorito ? 'Quitar de favoritos' : 'Marcar favorito',
              onclick: async (e) => {
                a.favorito = !a.favorito;
                e.currentTarget.classList.toggle('on', a.favorito);
                await guardar('alimentos');
              },
            },
            '★',
          ),
        ),
      ),
    );
  }
  q.addEventListener('input', pintar);
  montar(
    cont,
    h('h2', { class: 'mb' }, `Alimentos (${S.alimentos.length})`),
    h('p', { class: 'suave chico' }, '🏠 = lo hay en casa (para "Cerrar el día") · ★ = favorito'),
    h('div', { class: 'fila-btns mb' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: () => abrirProductoNuevo(null, null, { alGuardar: () => {} }) }, '+ Agregar alimento')),
    q,
    seccion(null, lista),
  );
  pintar();
}

// ---------- Platos ----------

function renderPlatos(cont) {
  montar(
    cont,
    h('h2', { class: 'mb' }, `Platos (${S.platos.length})`),
    h('p', { class: 'suave chico' }, 'Para crear uno: en Comida, registra los alimentos de un momento y toca "Guardar como plato".'),
    seccion(
      null,
      S.platos.length
        ? h(
            'ul',
            { class: 'lista' },
            S.platos.map((p) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { class: 'item', type: 'button', onclick: () => verPlato(p) },
                  h(
                    'div',
                    { class: 'item-txt' },
                    h('div', { class: 'item-tit' }, p.nombre, p.incompleto ? h('span', { class: 'etiqueta roja' }, 'incompleto') : null, (p.etiquetas || []).includes('diaModelo') ? h('span', { class: 'etiqueta verde' }, 'día modelo') : null),
                    h('div', { class: 'item-sub' }, [p.momento, ...(p.etiquetas || []).filter((e) => e !== 'diaModelo')].join(' · ')),
                  ),
                ),
              ),
            ),
          )
        : vacio('Sin platos.'),
    ),
  );
}

function verPlato(p) {
  const hj = hoja({ titulo: p.nombre, clase: 'alta' });
  const ali = new Map(S.alimentos.map((a) => [a.id, a]));
  montar(
    hj.cuerpo,
    p.incompleto ? h('div', { class: 'aviso alerta' }, h('p', {}, `Incompleto: ${p.incompleto}`)) : null,
    p.totales ? h('p', {}, `Totales fijos: ${fmtKcal(p.totales.kcal)} kcal · ${fmtG(p.totales.p)} P · ${fmtG(p.totales.g)} G · ${fmtG(p.totales.c)} C`) : null,
    p.items?.length
      ? h(
          'ul',
          { class: 'lista' },
          p.items.map((it) => h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, ali.get(it.alimentoId)?.nombre || `(falta ${it.alimentoId})`), h('div', { class: 'item-sub' }, it.cantidad == null ? 'libre' : `${it.cantidad} ${it.unidad === 'und' ? ali.get(it.alimentoId)?.unidadNombre || 'und' : 'g'}${it.estado ? ` ${it.estado}` : ''}`))))),
        )
      : null,
    p.notas ? h('p', { class: 'suave chico' }, p.notas) : null,
    h(
      'button',
      {
        class: 'btn btn-peligro btn-ancho mt',
        type: 'button',
        onclick: async () => {
          if (!(await confirmar(`¿Borrar el plato ${p.nombre}?`, { si: 'Borrar', peligro: true }))) return;
          S.platos = S.platos.filter((x) => x !== p);
          invalidarIndice();
          hj.cerrar();
          await guardar('platos');
        },
      },
      'Borrar plato',
    ),
  );
}

// ---------- Rutina ----------

function textoEjercicio(ej) {
  const partes = [`${ej.series} × ${ej.repMin === ej.repMax ? ej.repMin : `${ej.repMin}–${ej.repMax}`}${ej.unilateral ? ` ${ej.unilateralTexto || 'por lado'}` : ''}`];
  if (ej.rir) partes.push(`quedar a ${String(ej.rir).replace('-', '–')}`);
  if (ej.fallo) partes.push('⚡ la última al fallo');
  partes.push(ej.pesoTexto || (ej.pesoInicial != null ? `${ej.pesoInicial} kg` : 'por encontrar'));
  return partes.join(' · ');
}

/** Todo lo que el plan dice de ese ejercicio y hay que poder leer antes de entrenar. */
function lineasEjercicio(ej) {
  return [...textosSeriesDesdeSemana(ej), ...textosAjusteSesion(ej), ej.nota, ej.notaSiSeries?.texto].filter(Boolean);
}

function renderRutina(cont) {
  const r = S.rutina;
  if (!r) return montar(cont, vacio('No hay rutina. Importa tu archivo de arranque.'));
  const regla = reglaRecorte(r);
  montar(
    cont,
    h('h2', { class: 'mb' }, r.nombre || 'Rutina'),
    h('p', { class: 'suave' }, `Desde el ${r.inicio ? fechaCorta(r.inicio) : '—'} · ${r.semanasTrabajo || '?'} semanas de trabajo${r.semanaSuave ? ` · semana ${r.semanaSuave} suave` : ''}`),
    r.semanaSuave && textoSemanaSuave(r) ? seccion(`Semana ${r.semanaSuave}, suave`, h('p', { class: 'chico' }, textoSemanaSuave(r))) : null,
    r.reglas?.length ? seccion('Reglas', h('ul', {}, r.reglas.map((x) => h('li', { class: 'mb' }, x)))) : null,
    r.palabras?.length ? seccion('Palabras', h('dl', {}, r.palabras.map((p) => [h('dt', { class: 'negrita' }, p.palabra), h('dd', { class: 'mb suave' }, p.significa)]))) : null,
    (r.sesiones || []).map((s) =>
      seccion(
        `${s.nombre} · ${textoDuracion(s)}`,
        s.calentamiento?.length ? h('details', {}, h('summary', { class: 'suave' }, 'Calentamiento'), h('ul', {}, s.calentamiento.map((c) => h('li', {}, c)))) : null,
        s.bloques.map((b, i) =>
          h(
            'div',
            { class: 'ej' },
            h('div', { class: 'suave chico' }, `${i + 1}. ${b.tipo === 'superserie' ? 'Superserie · ' : ''}descanso ${fmtDuracion((b.descansoSeg || 0) * 1000)}`),
            b.ejercicios.map((ej) =>
              h(
                'div',
                { class: 'mb' },
                h('div', { class: 'negrita' }, `${ej.nombre}${ej.fallo ? ' ⚡' : ''}`),
                h('div', { class: 'chico' }, textoEjercicio(ej)),
                lineasEjercicio(ej).map((t) => h('div', { class: 'chico suave' }, t)),
              ),
            ),
          ),
        ),
        s.recorte && regla ? h('p', { class: 'chico amarillo' }, `Si pasa de ${regla.minutos} min ${regla.veces} veces: ${s.recorte}`) : null,
      ),
    ),
  );
}

// ---------- Ajustes ----------

function renderAjustes(cont) {
  const a = S.ajustes || {};
  const fGym = inputTexto({ placeholder: 'Nombre del gimnasio', etiqueta: 'Nuevo gimnasio' });
  montar(
    cont,
    h('h2', { class: 'mb' }, 'Ajustes'),
    a.cita
      ? seccion(
          'Recordatorio',
          casilla(a.cita.texto || 'Recordatorio', {
            checked: !!a.cita.hecha,
            alCambiar: async (v) => {
              a.cita.hecha = v;
              await guardar('ajustes');
            },
          }),
          h('p', { class: 'suave chico' }, 'Márcalo cuando ya esté hecho: el aviso deja de salir.'),
        )
      : null,
    seccion(
      'Gimnasios',
      h('ul', { class: 'lista' }, (a.gimnasios || []).map((g) => h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, g, g === a.gimnasioPorDefecto ? h('span', { class: 'etiqueta verde' }, 'por defecto') : null)))))),
      h(
        'div',
        { class: 'fila-btns' },
        fGym,
        h(
          'button',
          {
            class: 'btn btn-sec',
            type: 'button',
            onclick: async () => {
              const v = fGym.value.trim();
              if (!v) return;
              a.gimnasios = [...new Set([...(a.gimnasios || []), v])];
              S.ajustes = a;
              await guardar('ajustes');
            },
          },
          'Agregar',
        ),
      ),
      h('p', { class: 'suave chico' }, 'Los pesos de las máquinas se aprenden por gimnasio y no se mezclan.'),
    ),
    a.omega3
      ? seccion(
          'Suplemento diario',
          h('p', { class: 'suave chico' }, 'Vale para los días nuevos. Para quitarlo de un día, desmárcalo en Comida ese día.'),
          casilla(`${a.omega3.nombre || 'Suplemento'}: se suma solo cada día`, {
            checked: !!a.omega3.activo,
            alCambiar: async (v) => {
              a.omega3.activo = v;
              await guardar('ajustes');
            },
          }),
        )
      : null,
    seccion('Copias', h('p', { class: 'chico' }, `Última copia: ${S.reg.ultimaCopia ? fechaCorta(fechaDeIso(S.reg.ultimaCopia)) : 'nunca'}`), h('button', { class: 'btn btn-primario btn-ancho', type: 'button', onclick: exportarCopia }, '💾 Exportar copia ahora')),
  );
}

export function render(cont, sub) {
  if (sub === 'metas') return renderMetas(cont);
  if (sub === 'alimentos') return renderAlimentos(cont);
  if (sub === 'platos') return renderPlatos(cont);
  if (sub === 'rutina') return renderRutina(cont);
  if (sub === 'ajustes') return renderAjustes(cont);
  return renderAjustes(cont);
}

export { uid, sinTildes };
