// Cuerpo: peso con promedio semanal, cintura, cinta mensual, fotos, bioimpedancias y calendario.
import { S, guardar } from './estado.js';
import { hoy, sumarDias, difDias, diaMes, fechaCorta, parseFecha, fechaCalendario, diaSemana } from './fechas.js';
import { num, r1, semanasPeso, bajadaRapida, proximaComidaLibre, fechaCoincide, signo, plural } from './calculos.js';
import { h, montar, hoja, confirmar, aviso, stepper, chips, campo, inputNum, inputTexto, casilla, seccion, vacio } from './ui.js';

const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...hijos) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const x of hijos.flat()) if (x != null) el.append(x instanceof Node ? x : document.createTextNode(String(x)));
  return el;
}

/**
 * Gráfica simple: series de puntos y líneas sobre fechas.
 * series: [{ nombre, color, puntos: [{ fecha, y }], tipo: 'puntos' | 'linea' }]
 */
export function grafica(series, { alto = 190, ancho = 360, testid } = {}) {
  const todos = series.flatMap((x) => x.puntos);
  if (!todos.length) return vacio('Sin datos para la gráfica.');
  const fechas = todos.map((p) => p.fecha).sort();
  const f0 = fechas[0];
  const f1 = fechas[fechas.length - 1];
  const dias = Math.max(1, difDias(f0, f1));
  const ys = todos.map((p) => p.y);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const marg = Math.max(0.3, (y1 - y0) * 0.1);
  y0 -= marg;
  y1 += marg;
  const m = { izq: 40, der: 10, arr: 10, aba: 24 };
  const X = (f) => m.izq + (difDias(f0, f) / dias) * (ancho - m.izq - m.der);
  const Y = (y) => m.arr + (1 - (y - y0) / (y1 - y0)) * (alto - m.arr - m.aba);
  const hijos = [];
  for (let i = 0; i <= 3; i++) {
    const y = y0 + ((y1 - y0) * i) / 3;
    hijos.push(s('line', { x1: m.izq, x2: ancho - m.der, y1: Y(y), y2: Y(y), stroke: '#2f3442', 'stroke-width': 1 }));
    hijos.push(s('text', { x: 4, y: Y(y) + 4 }, y.toFixed(1)));
  }
  hijos.push(s('text', { x: m.izq, y: alto - 6 }, diaMes(f0)));
  if (f1 !== f0) hijos.push(s('text', { x: ancho - m.der, y: alto - 6, 'text-anchor': 'end' }, diaMes(f1)));
  for (const serie of series) {
    const pts = [...serie.puntos].sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (serie.tipo === 'linea' && pts.length) {
      hijos.push(s('polyline', { points: pts.map((p) => `${X(p.fecha).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' '), fill: 'none', stroke: serie.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      for (const p of pts) hijos.push(s('circle', { cx: X(p.fecha), cy: Y(p.y), r: 3, fill: serie.color }));
    } else {
      for (const p of pts) hijos.push(s('circle', { cx: X(p.fecha), cy: Y(p.y), r: 3.5, fill: serie.color, 'fill-opacity': 0.75 }));
    }
  }
  return s('svg', { class: 'grafica', viewBox: `0 0 ${ancho} ${alto}`, role: 'img', 'aria-label': series.map((x) => x.nombre).join(' y '), 'data-testid': testid }, ...hijos);
}

function leyenda(items) {
  return h('div', { class: 'leyenda' }, items.map(([color, txt]) => h('span', {}, h('i', { style: { background: color } }), txt)));
}

// ---------- Peso ----------

export function abrirPeso() {
  const hj = hoja({ titulo: 'Peso', testid: 'hoja-peso' });
  const casa = S.reg.pesos.filter((p) => (p.tipo || 'casa') === 'casa').sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ult = casa[casa.length - 1];
  let tipo = 'casa';
  const kg = stepper({ valor: ult?.kg ?? '', sufijo: 'kg', testid: 'peso-kg', etiqueta: 'Peso', menos: (v) => r1((v ?? 0) - 0.1), mas: (v) => r1((v ?? 0) + 0.1) });
  const fFecha = h('input', { type: 'date', class: 'input', value: hoy(), 'aria-label': 'Fecha', testid: 'peso-fecha' });
  const fNota = inputTexto({ placeholder: 'Nota (opcional)', etiqueta: 'Nota' });
  montar(
    hj.cuerpo,
    kg,
    h('div', { class: 'etq-linea' }, '¿Dónde?'),
    chips({
      opciones: [
        { valor: 'casa', texto: 'Báscula de casa' },
        { valor: 'bio', texto: 'Bioimpedancia' },
      ],
      valor: tipo,
      testid: 'peso-tipo',
      alElegir: (v) => (tipo = v),
    }),
    h('p', { class: 'suave chico' }, 'El de bioimpedancia va aparte: no entra al promedio.'),
    h('div', { class: 'dos-col' }, campo('Fecha', fFecha), campo('Nota', fNota)),
    h(
      'div',
      { class: 'fila-btns fila-fija' },
      h(
      'button',
      {
        class: 'btn btn-primario btn-grande',
        type: 'button',
        testid: 'peso-guardar',
        onclick: async () => {
          const v = kg.valor();
          if (v == null || v <= 0) return aviso('Escribe el peso.');
          const fecha = fFecha.value || hoy();
          S.reg.pesos.push({ fecha, kg: v, tipo, nota: fNota.value.trim() });
          S.reg.pesos.sort((a, b) => a.fecha.localeCompare(b.fecha));
          hj.cerrar();
          await guardar('reg.pesos');
          const sem = semanasPeso(S.reg.pesos).find((x) => x.lunes <= fecha && x.domingo >= fecha);
          aviso(tipo === 'casa' && sem ? `Promedio de la semana: ${sem.prom.toFixed(2)} kg (${plural(sem.n, 'pesaje', 'pesajes')})` : 'Guardado.');
        },
      },
      'Guardar',
    ),
    ),
  );
  // Sin foco automático: el teclado taparía "Guardar". El peso se cambia con − y + o tocándolo.
}

// ---------- Medidas ----------

const MEDIDAS = [
  ['cintura', 'Cintura'],
  ['cadera', 'Cadera'],
  ['musloD', 'Muslo derecho'],
  ['musloI', 'Muslo izquierdo'],
  ['brazoDRel', 'Brazo derecho relajado'],
  ['brazoIRel', 'Brazo izquierdo relajado'],
  ['brazoDFuerza', 'Brazo derecho en fuerza'],
  ['brazoIFuerza', 'Brazo izquierdo en fuerza'],
];

function abrirCinta() {
  const hj = hoja({ titulo: 'Cinta del mes', clase: 'alta', testid: 'hoja-cinta' });
  const fFecha = h('input', { type: 'date', class: 'input', value: hoy(), 'aria-label': 'Fecha' });
  const campos = Object.fromEntries(MEDIDAS.map(([k]) => [k, inputNum({ placeholder: 'cm', testid: `cinta-${k}`, etiqueta: k })]));
  montar(
    hj.cuerpo,
    campo('Fecha', fFecha),
    h('div', { class: 'dos-col' }, MEDIDAS.map(([k, n]) => campo(`${n} (cm)`, campos[k]))),
    h(
      'button',
      {
        class: 'btn btn-primario btn-grande',
        type: 'button',
        testid: 'cinta-guardar',
        onclick: async () => {
          const reg = { fecha: fFecha.value || hoy() };
          let alguna = false;
          for (const [k] of MEDIDAS) {
            reg[k] = num(campos[k].value);
            if (reg[k] != null) alguna = true;
          }
          if (!alguna) return aviso('Escribe al menos una medida.');
          S.reg.medidas.push(reg);
          S.reg.medidas.sort((a, b) => a.fecha.localeCompare(b.fecha));
          hj.cerrar();
          await guardar('reg.medidas');
        },
      },
      'Guardar',
    ),
  );
}

// ---------- Fotos ----------

const POSES = [
  ['frente', 'Frente'],
  ['perfil', 'Perfil'],
  ['espalda', 'Espalda'],
  ['brazosArriba', 'Frente con brazos arriba'],
];

function tarjetaFotos() {
  const marcadas = new Set();
  const ultimo = [...S.reg.fotos].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-1)[0];
  return seccion(
    'Fotos',
    S.ajustes?.textos?.fotos ? h('p', { class: 'suave chico' }, S.ajustes.textos.fotos) : h('p', { class: 'suave chico' }, 'Las fotos quedan en tu galería. Aquí solo marcas que las hiciste.'),
    POSES.map(([k, n]) => casilla(n, { testid: `pose-${k}`, alCambiar: (v) => (v ? marcadas.add(k) : marcadas.delete(k)) })),
    h(
      'button',
      {
        class: 'btn btn-sec btn-ancho',
        type: 'button',
        testid: 'fotos-guardar',
        onclick: async () => {
          if (!marcadas.size) return aviso('Marca las poses que hiciste.');
          S.reg.fotos.push({ fecha: hoy(), poses: POSES.map(([k]) => k).filter((k) => marcadas.has(k)) });
          await guardar('reg.fotos');
        },
      },
      'Marcar hechas hoy',
    ),
    ultimo ? h('p', { class: 'suave chico mt' }, `Últimas: ${fechaCorta(ultimo.fecha)} (${ultimo.poses.length} de 4 poses)`) : null,
  );
}

// ---------- Bioimpedancias ----------

const CAMPOS_BIO = [
  ['pesoMaquina', 'Peso de la máquina (kg)'],
  ['pesoCasa', 'Peso de casa ese día (kg)'],
  ['grasaPct', 'Grasa (%)'],
  ['grasaKg', 'Grasa (kg)'],
  ['masaLibreGrasa', 'Masa libre de grasa (kg)'],
  ['musculo', 'Músculo (kg)'],
  ['agua', 'Agua (kg o %)'],
  ['visceral', 'Grasa visceral'],
];

function abrirBio() {
  const hj = hoja({ titulo: 'Bioimpedancia', clase: 'alta', testid: 'hoja-bio' });
  const fFecha = h('input', { type: 'date', class: 'input', value: hoy(), 'aria-label': 'Fecha' });
  const campos = Object.fromEntries(CAMPOS_BIO.map(([k, n]) => [k, inputNum({ etiqueta: n, testid: `bio-${k}` })]));
  const cond = inputTexto({ placeholder: 'Condiciones (hora, comida, agua, ejercicio)', etiqueta: 'Condiciones' });
  montar(
    hj.cuerpo,
    campo('Fecha', fFecha),
    h('div', { class: 'dos-col' }, CAMPOS_BIO.map(([k, n]) => campo(n, campos[k]))),
    campo('Condiciones', cond),
    h(
      'button',
      {
        class: 'btn btn-primario btn-grande',
        type: 'button',
        testid: 'bio-guardar',
        onclick: async () => {
          const reg = { fecha: fFecha.value || hoy(), segmentos: {}, condiciones: cond.value.trim() };
          for (const [k] of CAMPOS_BIO) reg[k] = num(campos[k].value);
          S.reg.bioimpedancias.push(reg);
          S.reg.bioimpedancias.sort((a, b) => a.fecha.localeCompare(b.fecha));
          hj.cerrar();
          await guardar('reg.bioimpedancias');
        },
      },
      'Guardar',
    ),
  );
}

function abrirComparar() {
  const lista = [...S.reg.bioimpedancias].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const hj = hoja({ titulo: 'Comparar bioimpedancias', clase: 'alta', testid: 'hoja-comparar' });
  if (lista.length < 2) {
    montar(hj.cuerpo, vacio('Necesitas al menos dos.'));
    return;
  }
  let a = 0;
  let b = lista.length - 1;
  const cont = h('div');
  const ops = lista.map((x, i) => ({ valor: i, texto: fechaCorta(x.fecha) }));
  function pintar() {
    const A = lista[a];
    const B = lista[b];
    montar(
      cont,
      h(
        'table',
        { class: 'tabla', testid: 'tabla-bio' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, fechaCorta(A.fecha)), h('th', {}, fechaCorta(B.fecha)), h('th', {}, 'Cambio'))),
        h(
          'tbody',
          {},
          CAMPOS_BIO.map(([k, n]) => {
            const d = A[k] != null && B[k] != null ? r1(B[k] - A[k]) : null;
            return h('tr', {}, h('td', {}, n), h('td', {}, A[k] ?? '—'), h('td', {}, B[k] ?? '—'), h('td', {}, d == null ? '—' : d > 0 ? `+${d}` : String(d)));
          }),
        ),
      ),
    );
  }
  montar(hj.cuerpo, h('div', { class: 'etq-linea' }, 'Primera'), chips({ opciones: ops, valor: a, alElegir: (v) => ((a = v), pintar()) }), h('div', { class: 'etq-linea' }, 'Segunda'), chips({ opciones: ops, valor: b, alElegir: (v) => ((b = v), pintar()) }), cont);
  pintar();
}

// ---------- Calendario ----------

function siguienteOcurrencia(f, desde) {
  if (f.repetir === 'mensual') {
    if (f.fecha >= desde) return f.fecha;
    const d = parseFecha(desde);
    const dia = Number(f.fecha.slice(8, 10));
    let cand = new Date(d.getFullYear(), d.getMonth(), dia);
    if (cand < d) cand = new Date(d.getFullYear(), d.getMonth() + 1, dia);
    return `${cand.getFullYear()}-${String(cand.getMonth() + 1).padStart(2, '0')}-${String(cand.getDate()).padStart(2, '0')}`;
  }
  if (f.repetir === 'semanal') {
    if (f.fecha >= desde) return f.fecha;
    let x = desde;
    while (diaSemana(x) !== diaSemana(f.fecha)) x = sumarDias(x, 1);
    return x;
  }
  return f.fecha >= desde ? f.fecha : null;
}

export function enlaceCalendario({ titulo, fecha, recur, detalle }) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: titulo, dates: `${fechaCalendario(fecha)}/${fechaCalendario(sumarDias(fecha, 1))}` });
  if (detalle) p.set('details', detalle);
  if (recur) p.set('recur', recur);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function eventosCalendario(desde = hoy()) {
  const out = [];
  for (const f of S.ajustes?.fechas || []) {
    const fecha = siguienteOcurrencia(f, desde);
    if (!fecha) continue;
    const recur = f.repetir === 'mensual' ? 'RRULE:FREQ=MONTHLY' : f.repetir === 'semanal' ? 'RRULE:FREQ=WEEKLY' : null;
    out.push({ titulo: f.titulo, fecha, recur, detalle: recur ? `Se repite ${f.repetir === 'mensual' ? 'cada mes' : 'cada semana'}.` : '' });
  }
  const cl = S.ajustes?.comidaLibre;
  const libre = proximaComidaLibre(cl, desde);
  if (libre) out.push({ titulo: 'Comida libre', fecha: libre, recur: `RRULE:FREQ=DAILY;INTERVAL=${cl.cadaDias}`, detalle: `Cada ${cl.cadaDias} días.` });
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function abrirCalendario() {
  const hj = hoja({ titulo: 'Agregar al calendario', clase: 'alta', testid: 'hoja-calendario' });
  const ev = eventosCalendario();
  montar(
    hj.cuerpo,
    h('p', { class: 'suave chico' }, 'Cada botón abre Google Calendar con el recordatorio listo. Solo tocas "Guardar".'),
    ev.length
      ? h(
          'ul',
          { class: 'lista' },
          ev.map((e) =>
            h(
              'li',
              {},
              h(
                'a',
                { class: 'item', href: enlaceCalendario(e), target: '_blank', rel: 'noopener', testid: 'enlace-calendario' },
                h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, e.titulo), h('div', { class: 'item-sub' }, `${fechaCorta(e.fecha)}${e.recur ? ' · se repite' : ''}`)),
                h('span', { 'aria-hidden': 'true' }, '📅'),
              ),
            ),
          ),
        )
      : vacio('No hay fechas en tu plan.'),
  );
}

// ---------- Vista ----------

let medidaGrafica = 'cintura';
let pesoTodo = false;
const SEMANAS_GRAFICA = 8;

export function render(cont) {
  const casa = S.reg.pesos.filter((p) => (p.tipo || 'casa') === 'casa');
  const bio = S.reg.pesos.filter((p) => p.tipo === 'bio');
  const sem = semanasPeso(S.reg.pesos);
  const rapido = bajadaRapida(sem.slice(-3));
  // Por defecto, las últimas 8 semanas (la historia vieja aplana la gráfica); "Ver todo" la muestra completa.
  const desde = !pesoTodo && sem.length > SEMANAS_GRAFICA ? sem[sem.length - SEMANAS_GRAFICA].lunes : null;
  const casaGraf = desde ? casa.filter((p) => p.fecha >= desde) : casa;
  const semGraf = desde ? sem.filter((x) => x.lunes >= desde) : sem;
  const ultSem = sem.slice(-8).reverse();
  const medidas = [...S.reg.medidas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const cintura = [...S.reg.cintura].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const fCintura = inputNum({ placeholder: 'cm', testid: 'cintura-cm', etiqueta: 'Cintura en cm' });
  const hoyF = hoy();
  const esDiaCinta = (S.ajustes?.fechas || []).some((f) => fechaCoincide(f, hoyF) && f.repetir === 'mensual') || hoyF.endsWith('-01');
  montar(
    cont,
    seccion(
      h('span', {}, 'Peso de casa'),
      h('button', { class: 'btn btn-primario btn-grande mb', type: 'button', testid: 'cuerpo-peso', onclick: () => abrirPeso() }, '⚖️ Anotar peso'),
      rapido ? h('div', { class: 'aviso alerta' }, h('p', {}, S.ajustes?.textos?.bajadaRapida || 'Bajaste más de 1 kg por semana dos semanas seguidas.')) : null,
      grafica(
        [
          { nombre: 'Pesajes', color: '#5b9dff', tipo: 'puntos', puntos: casaGraf.map((p) => ({ fecha: p.fecha, y: Number(p.kg) })) },
          // El promedio se dibuja en el día del último pesaje de esa semana (nunca en una fecha futura).
          { nombre: 'Promedio semanal', color: '#3ecf8e', tipo: 'linea', puntos: semGraf.map((x) => ({ fecha: x.ultimo || x.lunes, y: x.prom })) },
        ],
        { testid: 'grafica-peso' },
      ),
      leyenda([
        ['#5b9dff', 'cada pesaje'],
        ['#3ecf8e', 'promedio lunes a domingo'],
      ]),
      sem.length > SEMANAS_GRAFICA
        ? h(
            'button',
            {
              class: 'btn-texto',
              type: 'button',
              testid: 'peso-ver-todo',
              onclick: () => {
                pesoTodo = !pesoTodo;
                render(cont);
              },
            },
            pesoTodo ? `Ver las últimas ${SEMANAS_GRAFICA} semanas` : 'Ver todo',
          )
        : null,
      ultSem.length
        ? h(
            'table',
            { class: 'tabla mt', testid: 'tabla-semanas' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Semana'), h('th', {}, 'Promedio'), h('th', {}, 'Pesajes'), h('th', {}, 'Cambio'))),
            h(
              'tbody',
              {},
              ultSem.map((x) => h('tr', {}, h('td', {}, `${diaMes(x.lunes)}`), h('td', {}, x.prom.toFixed(2)), h('td', {}, String(x.n)), h('td', {}, x.cambio == null ? '—' : signo(x.cambio)))),
            ),
          )
        : null,
      casa.length
        ? h(
            'details',
            { class: 'mt' },
            h('summary', { class: 'suave' }, 'Todos los pesajes'),
            h(
              'ul',
              { class: 'lista' },
              [...S.reg.pesos].reverse().map((p) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    {
                      class: 'item',
                      type: 'button',
                      onclick: async () => {
                        if (!(await confirmar(`¿Borrar el pesaje de ${p.kg} kg del ${fechaCorta(p.fecha)}?`, { si: 'Borrar', peligro: true }))) return;
                        S.reg.pesos = S.reg.pesos.filter((x) => x !== p);
                        await guardar('reg.pesos');
                      },
                    },
                    h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, `${p.kg} kg${p.tipo === 'bio' ? ' (bioimpedancia)' : ''}`), h('div', { class: 'item-sub' }, `${fechaCorta(p.fecha)}${p.nota ? ` · ${p.nota}` : ''}`)),
                  ),
                ),
              ),
            ),
          )
        : null,
      bio.length ? h('p', { class: 'suave chico' }, `Pesos de bioimpedancia (aparte): ${bio.map((p) => `${fechaCorta(p.fecha)} ${p.kg}`).join(', ')}`) : null,
    ),
    seccion(
      'Cintura de la semana (opcional)',
      h(
        'div',
        { class: 'fila-btns' },
        fCintura,
        h(
          'button',
          {
            class: 'btn btn-sec',
            type: 'button',
            testid: 'cintura-guardar',
            onclick: async () => {
              const v = num(fCintura.value);
              if (v == null) return aviso('Escribe los centímetros.');
              S.reg.cintura.push({ fecha: hoy(), cm: v });
              await guardar('reg.cintura');
            },
          },
          'Guardar',
        ),
      ),
      cintura.length > 1 ? grafica([{ nombre: 'Cintura', color: '#f5c542', tipo: 'linea', puntos: cintura.map((c) => ({ fecha: c.fecha, y: c.cm })) }], { alto: 140 }) : null,
      cintura.length ? h('p', { class: 'suave chico' }, cintura.slice(-4).map((c) => `${fechaCorta(c.fecha)}: ${c.cm} cm`).join(' · ')) : null,
    ),
    seccion(
      h('span', {}, 'Cinta del mes', esDiaCinta ? h('span', { class: 'etiqueta amarilla' }, 'hoy toca') : null),
      h('button', { class: 'btn btn-sec btn-ancho mb', type: 'button', testid: 'cinta-abrir', onclick: abrirCinta }, '📏 Anotar medidas'),
      medidas.length
        ? h(
            'div',
            {},
            chips({
              opciones: MEDIDAS.map(([k, n]) => ({ valor: k, texto: n })),
              valor: medidaGrafica,
              alElegir: (v) => {
                medidaGrafica = v;
                render(cont);
              },
            }),
            grafica([{ nombre: medidaGrafica, color: '#f5c542', tipo: 'linea', puntos: medidas.filter((m) => m[medidaGrafica] != null).map((m) => ({ fecha: m.fecha, y: m[medidaGrafica] })) }], { alto: 150, testid: 'grafica-cinta' }),
            h('p', { class: 'suave chico' }, `Última: ${fechaCorta(medidas[medidas.length - 1].fecha)} · ${MEDIDAS.filter(([k]) => medidas[medidas.length - 1][k] != null).map(([k, n]) => `${n.toLowerCase()} ${medidas[medidas.length - 1][k]}`).join(', ')}`),
          )
        : vacio('Todavía no hay medidas.'),
    ),
    tarjetaFotos(),
    seccion(
      'Bioimpedancias',
      S.reg.bioimpedancias.length
        ? h(
            'ul',
            { class: 'lista' },
            [...S.reg.bioimpedancias].reverse().map((b) => h('li', {}, h('div', { class: 'item' }, h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, fechaCorta(b.fecha)), h('div', { class: 'item-sub' }, [b.pesoMaquina != null ? `${b.pesoMaquina} kg` : '', b.grasaPct != null ? `${b.grasaPct}% grasa` : '', b.musculo != null ? `${b.musculo} kg músculo` : ''].filter(Boolean).join(' · ')))))),
          )
        : vacio('Sin bioimpedancias.'),
      h('div', { class: 'fila-btns' }, h('button', { class: 'btn btn-sec', type: 'button', testid: 'bio-abrir', onclick: abrirBio }, '+ Agregar'), h('button', { class: 'btn btn-sec', type: 'button', testid: 'bio-comparar', onclick: abrirComparar }, 'Comparar dos')),
    ),
    seccion('Fechas', h('button', { class: 'btn btn-sec btn-ancho', type: 'button', testid: 'calendario', onclick: abrirCalendario }, '📅 Agregar al calendario')),
  );
}
