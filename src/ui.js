// Ayudas de interfaz: crear elementos, hojas (ventanas desde abajo), avisos y controles.
import { num, fmtKcal, fmtG } from './calculos.js';

/** Crea un elemento: h('button', { class: 'btn', onclick }, 'Texto') */
export function h(tag, props, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'testid') el.setAttribute('data-testid', v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const x of hijos.flat(Infinity)) {
    if (x == null || x === false || x === true) continue;
    el.append(x instanceof Node ? x : document.createTextNode(String(x)));
  }
}

export function montar(el, ...hijos) {
  el.replaceChildren();
  agregar(el, hijos);
  return el;
}

// ---------- Hojas ----------
// Con una o varias hojas abiertas hay una sola entrada extra en el historial ("guardia"):
// el botón atrás del teléfono cierra la hoja de arriba en vez de salir de la app.

const pila = [];
let ignorarPop = 0;

function hayGuardia() {
  return !!history.state?.hoja;
}

function ponerGuardia() {
  if (pila.length && !hayGuardia()) history.pushState({ ...(history.state || {}), hoja: true }, '');
}

window.addEventListener('popstate', () => {
  if (ignorarPop > 0) ignorarPop--;
  else {
    const top = pila.pop();
    if (top) top._quitar();
  }
  ponerGuardia();
});

/** Abre una hoja desde abajo. Devuelve { cuerpo, cerrar }. */
export function hoja({ titulo, alCerrar, clase = '', testid } = {}) {
  let cerrada = false;
  const cuerpo = h('div', { class: 'hoja-cuerpo' });
  const api = {
    cuerpo,
    cerrar() {
      cerrarHojas(api);
    },
    _quitar: () => quitar(),
    get abierta() {
      return !cerrada;
    },
  };
  const panel = h(
    'div',
    { class: `hoja ${clase}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo || 'Ventana', testid },
    h('div', { class: 'hoja-cab' }, h('h2', {}, titulo || ''), h('button', { class: 'btn-x', type: 'button', 'aria-label': 'Cerrar', onclick: () => api.cerrar() }, '✕')),
    cuerpo,
  );
  const fondo = h('div', { class: 'hoja-fondo' }, panel);
  fondo.addEventListener('click', (e) => {
    if (e.target === fondo) api.cerrar();
  });
  function quitar() {
    if (cerrada) return;
    cerrada = true;
    fondo.remove();
    if (!pila.length) document.body.classList.remove('con-hoja');
    alCerrar?.();
  }
  document.body.append(fondo);
  document.body.classList.add('con-hoja');
  pila.push(api);
  ponerGuardia();
  return api;
}

/** Cierra una o varias hojas. Al cerrar la última se quita la guardia del historial. */
export function cerrarHojas(...hojas) {
  const abiertas = hojas.filter((x) => x && x.abierta);
  if (!abiertas.length) return;
  for (const x of abiertas) {
    const i = pila.indexOf(x);
    if (i >= 0) pila.splice(i, 1);
    x._quitar();
  }
  if (!pila.length && hayGuardia()) {
    ignorarPop++;
    history.back();
  }
}

export function cerrarTodasLasHojas() {
  cerrarHojas(...pila);
}

/** Enfoca un campo solo si su hoja sigue arriba (evita robar el foco a otra hoja). */
export function enfocar(hj, el, ms = 60) {
  setTimeout(() => {
    if (pila[pila.length - 1] === hj && document.activeElement !== el) el.focus();
  }, ms);
}

export function hayHojaAbierta() {
  return pila.length > 0;
}

/** Pregunta sí o no. */
export function confirmar(texto, { si = 'Sí', no = 'Cancelar', peligro = false, titulo = 'Confirmar', detalle } = {}) {
  return new Promise((resolve) => {
    let respondio = false;
    const hj = hoja({
      titulo,
      testid: 'confirmar',
      alCerrar: () => {
        if (!respondio) resolve(false);
      },
    });
    montar(
      hj.cuerpo,
      h('p', { class: 'texto-grande' }, texto),
      detalle ? h('p', { class: 'suave' }, detalle) : null,
      h(
        'div',
        { class: 'fila-btns' },
        h('button', { class: 'btn btn-sec', type: 'button', onclick: () => hj.cerrar() }, no),
        h(
          'button',
          {
            class: `btn ${peligro ? 'btn-peligro' : 'btn-primario'}`,
            type: 'button',
            testid: 'confirmar-si',
            onclick: () => {
              respondio = true;
              hj.cerrar();
              resolve(true);
            },
          },
          si,
        ),
      ),
    );
  });
}

/** Aviso corto arriba de la pantalla. `accion`: { texto, fn, testid } muestra un botón (ej. "Deshacer"). */
export function aviso(texto, ms = 2600, accion = null) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h(
    'div',
    { class: `toast ${accion ? 'con-accion' : ''}`, role: 'status' },
    h('span', {}, texto),
    accion
      ? h(
          'button',
          {
            class: 'toast-btn',
            type: 'button',
            testid: accion.testid || null,
            onclick: () => {
              el.remove();
              accion.fn?.();
            },
          },
          accion.texto,
        )
      : null,
  );
  document.body.append(el);
  setTimeout(() => el.classList.add('saliendo'), ms - 300);
  setTimeout(() => el.remove(), ms);
}

/** Pregunta con varias opciones. Devuelve el valor elegido, o null si cierra sin elegir. */
export function elegir(texto, { titulo = 'Elige', opciones = [], testid, detalle } = {}) {
  return new Promise((resolve) => {
    let valor = null;
    const hj = hoja({ titulo, testid, alCerrar: () => resolve(valor) });
    montar(
      hj.cuerpo,
      h('p', { class: 'texto-grande' }, texto),
      detalle ? h('p', { class: 'suave' }, detalle) : null,
      opciones.map((o) =>
        h(
          'button',
          {
            class: `btn btn-ancho mb ${o.primario ? 'btn-primario' : 'btn-sec'}`,
            type: 'button',
            testid: testid ? `${testid}-${o.valor}` : null,
            onclick: () => {
              valor = o.valor;
              hj.cerrar();
            },
          },
          o.texto,
        ),
      ),
      h('button', { class: 'btn btn-sec btn-ancho', type: 'button', onclick: () => hj.cerrar() }, 'Cancelar'),
    );
  });
}

// ---------- Controles ----------

/** Número con − y +. menos/mas reciben el valor actual y devuelven el nuevo. */
export function stepper({ valor, menos, mas, alCambiar, decimal = true, sufijo, testid, etiqueta, ancho }) {
  const input = h('input', {
    type: 'text',
    inputmode: decimal ? 'decimal' : 'numeric',
    class: 'stepper-valor',
    value: valor ?? '',
    testid,
    'aria-label': etiqueta || sufijo || 'Valor',
    autocomplete: 'off',
    style: ancho ? { width: ancho } : null,
  });
  const fijar = (v) => {
    input.value = v == null ? '' : String(v);
    alCambiar?.(v);
  };
  input.addEventListener('change', () => alCambiar?.(num(input.value)));
  input.addEventListener('focus', () => input.select());
  const el = h(
    'div',
    { class: 'stepper' },
    h('button', { class: 'stepper-btn', type: 'button', 'aria-label': `Menos ${etiqueta || ''}`.trim(), testid: testid ? `${testid}-menos` : null, onclick: () => fijar(menos(num(input.value))) }, '−'),
    h('div', { class: 'stepper-centro' }, input, sufijo ? h('span', { class: 'stepper-suf' }, sufijo) : null),
    h('button', { class: 'stepper-btn', type: 'button', 'aria-label': `Más ${etiqueta || ''}`.trim(), testid: testid ? `${testid}-mas` : null, onclick: () => fijar(mas(num(input.value))) }, '+'),
  );
  el.valor = () => num(input.value);
  el.fijar = (v) => {
    input.value = v == null ? '' : String(v);
  };
  el.input = input;
  return el;
}

/** Botones de 0 a 10 para el dolor. */
export function escala010({ valor = null, alElegir, testid, max = 10 }) {
  const cont = h('div', { class: 'escala', role: 'group', testid });
  const pintar = (v) => {
    montar(
      cont,
      Array.from({ length: max + 1 }, (_, i) =>
        h(
          'button',
          {
            type: 'button',
            class: `escala-btn ${v === i ? 'sel' : ''} ${i <= 3 ? 'bajo' : i <= 6 ? 'medio' : 'alto'}`,
            'aria-pressed': v === i ? 'true' : 'false',
            testid: testid ? `${testid}-${i}` : null,
            onclick: () => {
              pintar(i);
              cont.valor = i;
              alElegir?.(i);
            },
          },
          String(i),
        ),
      ),
    );
  };
  cont.valor = valor;
  pintar(valor);
  return cont;
}

/** Botones para elegir una opción. */
export function chips({ opciones, valor, alElegir, testid, clase = '' }) {
  const cont = h('div', { class: `chips ${clase}`, role: 'group', testid });
  const pintar = (v) => {
    montar(
      cont,
      opciones.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: `chip ${o.valor === v ? 'sel' : ''}`,
            'aria-pressed': o.valor === v ? 'true' : 'false',
            testid: testid ? `${testid}-${o.valor}` : null,
            onclick: () => {
              cont.valor = o.valor;
              pintar(o.valor);
              alElegir?.(o.valor);
            },
          },
          o.texto,
        ),
      ),
    );
  };
  cont.valor = valor;
  cont.fijar = (v) => {
    cont.valor = v;
    pintar(v);
  };
  pintar(valor);
  return cont;
}

export function campo(etiqueta, control, ayuda) {
  return h('label', { class: 'campo' }, h('span', { class: 'campo-etq' }, etiqueta), control, ayuda ? h('span', { class: 'campo-ayuda' }, ayuda) : null);
}

export function inputNum({ valor, testid, placeholder, decimal = true, etiqueta }) {
  return h('input', {
    type: 'text',
    inputmode: decimal ? 'decimal' : 'numeric',
    class: 'input',
    value: valor ?? '',
    testid,
    placeholder,
    autocomplete: 'off',
    'aria-label': etiqueta || placeholder || null,
  });
}

export function inputTexto({ valor, testid, placeholder, etiqueta, tipo = 'text' }) {
  return h('input', { type: tipo, class: 'input', value: valor ?? '', testid, placeholder, autocomplete: 'off', 'aria-label': etiqueta || placeholder || null });
}

export function casilla(texto, { checked = false, alCambiar, testid } = {}) {
  const inp = h('input', { type: 'checkbox', checked, testid });
  inp.addEventListener('change', () => alCambiar?.(inp.checked));
  const el = h('label', { class: 'casilla' }, inp, h('span', {}, texto));
  el.input = inp;
  return el;
}

// ---------- Barras de macros ----------

const NOMBRES = { kcal: 'Calorías', p: 'Proteína', g: 'Grasa', c: 'Carbos' };

/**
 * Barra de un nutriente: lo comido (color según estado), lo planeado aparte (rayado)
 * y lo que falta en gris.
 */
export function barraMacro({ n, valor, plan = 0, meta, estado }) {
  const tope = meta || 1;
  const escala = Math.max(tope * 1.15, valor + plan, 1);
  const pc = Math.min(100, (valor / escala) * 100);
  const pp = Math.min(100 - pc, (plan / escala) * 100);
  const marca = (tope / escala) * 100;
  const txtValor = n === 'kcal' ? fmtKcal(valor) : fmtG(valor);
  const txtMeta = meta == null ? '' : n === 'kcal' ? fmtKcal(meta) : fmtG(meta);
  return h(
    'div',
    { class: `barra est-${estado}`, testid: `barra-${n}` },
    h(
      'div',
      { class: 'barra-cab' },
      h('span', { class: 'barra-nombre' }, NOMBRES[n]),
      h('span', { class: 'barra-num' }, h('b', { testid: `valor-${n}` }, txtValor), meta != null ? ` / ${txtMeta}${n === 'kcal' ? '' : ' g'}` : '', plan > 0 ? h('span', { class: 'barra-plan-txt' }, ` +${n === 'kcal' ? fmtKcal(plan) : fmtG(plan)} planeado`) : null),
    ),
    h(
      'div',
      { class: 'barra-pista' },
      h('div', { class: 'barra-lleno', style: { width: `${pc}%` } }),
      h('div', { class: 'barra-planeado', style: { left: `${pc}%`, width: `${pp}%` } }),
      meta != null ? h('div', { class: 'barra-meta', style: { left: `${marca}%` } }) : null,
    ),
  );
}

export function vacio(texto) {
  return h('p', { class: 'vacio' }, texto);
}

export function seccion(titulo, ...hijos) {
  return h('section', { class: 'tarjeta' }, titulo ? h('h3', { class: 'tarjeta-tit' }, titulo) : null, ...hijos);
}

/** Descarga un archivo de texto. */
export function descargar(nombre, texto, tipo = 'text/plain') {
  const blob = new Blob([texto], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

/** Copia texto al portapapeles (con plan B si no hay permiso). */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', top: '-1000px' } });
    ta.value = texto;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
