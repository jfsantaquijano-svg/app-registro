// Pasos del día: se anotan a mano (el total que marca el celular o el reloj), uno por fecha.
import { S, guardar, pasosDe } from './estado.js';
import { hoy, sumarDias, lunesDe, diaMes, fechaCorta } from './fechas.js';
import { fmtKcal, numPasos, estadoPasos, semanasPasos, plural } from './calculos.js';
import { h, montar, hoja, confirmar, aviso, campo, inputNum, seccion, vacio } from './ui.js';

/** Tope para atajar un número mal escrito (un cero de más). */
const TOPE_PASOS = 100000;

export function metaPasos() {
  const m = S.metas?.pasos;
  return Number(m?.meta) > 0 ? m : null;
}

/** ¿La app muestra los pasos? Si el plan trae meta o si ya hay pasos anotados. */
export function hayPasos() {
  return !!metaPasos() || S.reg.pasos.length > 0;
}

/** Semana de `fecha` (lunes a domingo), sin contar días después de `hasta`. */
export function pasosDeSemana(fecha, hasta = null) {
  const lunes = lunesDe(fecha);
  return semanasPasos(S.reg.pasos, metaPasos(), hasta).find((x) => x.lunes === lunes) || { lunes, domingo: sumarDias(lunes, 6), dias: [], prom: null, n: 0, enMeta: null, bajoMinimo: null };
}

function textoFaltan(n) {
  const mp = metaPasos();
  if (!mp) return '';
  if (n >= mp.meta) return '✅ Llegaste a la meta.';
  const minimo = Number(mp.minimo) || null;
  if (minimo && n < minimo) return `Te faltan ${fmtKcal(minimo - n)} para el mínimo y ${fmtKcal(mp.meta - n)} para la meta.`;
  return `Te faltan ${fmtKcal(mp.meta - n)} para la meta.`;
}

export function abrirPasos(fecha = hoy()) {
  const hj = hoja({ titulo: 'Pasos', testid: 'hoja-pasos' });
  const fFecha = h('input', { type: 'date', class: 'input', value: fecha, max: hoy(), 'aria-label': 'Fecha', testid: 'pasos-fecha' });
  const fPasos = inputNum({ valor: pasosDe(fecha)?.pasos ?? '', decimal: false, placeholder: 'Ej. 8500', etiqueta: 'Pasos del día', testid: 'pasos-num' });
  const ayuda = h('p', { class: 'suave chico', testid: 'pasos-ayuda' });
  const pintarAyuda = () => {
    const a = pasosDe(fFecha.value || hoy());
    ayuda.textContent = a ? `Ese día ya tiene ${fmtKcal(a.pasos)}: el número nuevo lo reemplaza.` : 'Escribe el total del día que marca tu celular o tu reloj.';
  };
  fFecha.addEventListener('change', () => {
    fPasos.value = pasosDe(fFecha.value || hoy())?.pasos ?? '';
    pintarAyuda();
  });
  pintarAyuda();
  montar(
    hj.cuerpo,
    campo('Pasos del día', fPasos),
    ayuda,
    campo('Fecha', fFecha),
    h(
      'div',
      { class: 'fila-btns fila-fija' },
      h(
        'button',
        {
          class: 'btn btn-primario btn-grande',
          type: 'button',
          testid: 'pasos-guardar',
          onclick: async () => {
            const n = numPasos(fPasos.value);
            if (n == null) return aviso('Escribe los pasos, solo con números.');
            if (n > TOPE_PASOS) return aviso('Revisa el número: parece muy alto.');
            const f = fFecha.value || hoy();
            if (f > hoy()) return aviso('Esa fecha todavía no llega.');
            S.reg.pasos = S.reg.pasos.filter((p) => p.fecha !== f);
            S.reg.pasos.push({ fecha: f, pasos: n });
            S.reg.pasos.sort((a, b) => a.fecha.localeCompare(b.fecha));
            hj.cerrar();
            await guardar('reg.pasos');
            const sem = pasosDeSemana(f);
            aviso(`Guardado. Promedio de la semana: ${fmtKcal(sem.prom)} pasos (${plural(sem.n, 'día', 'días')}).`);
          },
        },
        'Guardar',
      ),
    ),
  );
  // Sin foco automático, como en el peso: el teclado taparía "Guardar".
}

/** Tarjeta de Hoy: los pasos de hoy contra la meta, y un atajo si ayer quedó sin anotar. */
export function tarjetaPasos(fecha) {
  if (!hayPasos()) return null;
  const mp = metaPasos();
  const reg = pasosDe(fecha);
  const n = reg ? Number(reg.pasos) : null;
  const est = (n != null && estadoPasos(n, mp, { terminado: false })) || 'falta';
  const tope = mp ? Number(mp.meta) : n || 1;
  const escala = Math.max(tope * 1.15, n || 0, 1);
  const ayer = sumarDias(fecha, -1);
  // Solo si ya venía anotando: a quien nunca ha anotado no se le reclama el día de ayer.
  const faltaAyer = !pasosDe(ayer) && S.reg.pasos.some((p) => p.fecha < ayer);
  return h(
    'section',
    { class: 'tarjeta', testid: 'tarjeta-pasos' },
    h(
      'button',
      { class: 'pasos-toque', type: 'button', testid: 'btn-pasos', onclick: () => abrirPasos(fecha) },
      h(
        'div',
        { class: `barra est-${est}` },
        h('div', { class: 'barra-cab' }, h('span', { class: 'barra-nombre' }, '👣 Pasos de hoy'), h('span', { class: 'barra-num' }, h('b', { testid: 'pasos-hoy' }, n == null ? '—' : fmtKcal(n)), mp ? ` / ${fmtKcal(mp.meta)}` : '')),
        h(
          'div',
          { class: 'barra-pista' },
          h('div', { class: 'barra-lleno', style: { width: `${Math.min(100, ((n || 0) / escala) * 100)}%` } }),
          mp ? h('div', { class: 'barra-meta', style: { left: `${(tope / escala) * 100}%` } }) : null,
        ),
      ),
      h('div', { class: 'te-falta', testid: 'pasos-texto' }, n == null ? 'Toca aquí para anotar los pasos de hoy.' : textoFaltan(n) || 'Toca aquí para cambiarlos.'),
    ),
    faltaAyer
      ? h(
          'div',
          { class: 'acciones' },
          h('span', { class: 'suave chico' }, 'Los de ayer quedaron sin anotar.'),
          h('button', { class: 'btn btn-sec btn-chico', type: 'button', testid: 'pasos-ayer', onclick: () => abrirPasos(ayer) }, 'Anotar los de ayer'),
        )
      : null,
  );
}

/** Sección de Cuerpo: promedio por semana y todos los días (tocar uno lo borra). */
export function seccionPasos() {
  if (!hayPasos()) return null;
  const mp = metaPasos();
  const sem = semanasPasos(S.reg.pasos, mp).slice(-8).reverse();
  const lista = [...S.reg.pasos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  return seccion(
    'Pasos',
    h('button', { class: 'btn btn-primario btn-ancho mb', type: 'button', testid: 'cuerpo-pasos', onclick: () => abrirPasos() }, '👣 Anotar pasos'),
    mp ? h('p', { class: 'suave chico', testid: 'pasos-meta' }, `Meta: ${fmtKcal(mp.meta)} al día${Number(mp.minimo) > 0 ? ` · mínimo ${fmtKcal(mp.minimo)}` : ''}.`) : null,
    sem.length
      ? h(
          'table',
          { class: 'tabla', testid: 'tabla-pasos' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Semana'), h('th', {}, 'Promedio'), h('th', {}, 'Días'), h('th', {}, 'En la meta'))),
          h(
            'tbody',
            {},
            sem.map((x) => h('tr', {}, h('td', {}, diaMes(x.lunes)), h('td', {}, fmtKcal(x.prom)), h('td', {}, String(x.n)), h('td', {}, x.enMeta == null ? '—' : `${x.enMeta} de ${x.n}`))),
          ),
        )
      : vacio('Todavía no hay pasos anotados.'),
    lista.length
      ? h(
          'details',
          { class: 'mt' },
          h('summary', { class: 'suave' }, 'Todos los días'),
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
                      if (!(await confirmar(`¿Borrar los ${fmtKcal(p.pasos)} pasos del ${fechaCorta(p.fecha)}?`, { si: 'Borrar', peligro: true }))) return;
                      S.reg.pasos = S.reg.pasos.filter((x) => x !== p);
                      await guardar('reg.pasos');
                    },
                  },
                  h('div', { class: 'item-txt' }, h('div', { class: 'item-tit' }, `${fmtKcal(p.pasos)} pasos${estadoPasos(Number(p.pasos), mp) === 'ok' ? ' ✅' : ''}`), h('div', { class: 'item-sub' }, fechaCorta(p.fecha))),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}
