// Hoy: la pantalla que se abre siempre.
import { S, guardar, getDia, diasDesdeCopia, sesionActiva, estaVacia } from './estado.js';
import { hoy, horaLocal, diaMes, sumarDias, lunesDe } from './fechas.js';
import { fmtKcal, fmtG, metaDelTipo, MOMENTOS, NOMBRE_MOMENTO, sumar, signo, plural } from './calculos.js';
import { h, montar, chips, escala010, casilla, seccion, aviso, copiarTexto } from './ui.js';
import { calcularAvisos, resaltarPeso } from './avisos.js';
import { resumenDeSemana, textoParaClaude } from './resumen.js';
import { bloqueBarras, opcionesTipo, fijarTipo, elegirTipo, planearDia, abrirCerrarDia, confirmarConDeshacer } from './comida.js';
import { siguienteSesion } from './progresion.js';
import { abrirPeso } from './cuerpo.js';
import { exportarCopia, pantallaBienvenida } from './datos.js';
import { ir } from './navegar.js';

/** Semana que se ve en el resumen (0 = la actual, −1 = la anterior…). */
let semanaVista = 0;

function tarjetaDolor(av, fecha) {
  let valor = null;
  let durmio = false;
  const momento = av.tipo === 'dolorManana' ? 'manana' : 'noche';
  const fechaDolor = av.fechaDolor || fecha;
  return h(
    'div',
    { class: 'aviso', testid: `aviso-${av.id}` },
    h('p', {}, av.texto),
    escala010({ alElegir: (v) => (valor = v), testid: `dolor-${av.id}` }),
    av.preguntaDormir ? casilla(av.preguntaDormir, { alCambiar: (v) => (durmio = v), testid: `dormir-${av.id}` }) : null,
    h(
      'div',
      { class: 'acciones' },
      h(
        'button',
        {
          class: 'btn btn-primario btn-chico',
          type: 'button',
          testid: `guardar-${av.id}`,
          onclick: async () => {
            if (valor == null) return aviso('Toca un número de 0 a 10.');
            // Si es de una mañana anterior (no abrió la app ese día), queda con esa fecha y sin hora.
            S.reg.dolor.push({ fecha: fechaDolor, hora: fechaDolor === fecha ? horaLocal() : null, zona: av.zona, momento, valor, durmioSobre: av.preguntaDormir ? durmio : null, duracionMin: null, actividad: '' });
            await guardar('reg.dolor');
            aviso('Anotado.');
          },
        },
        'Guardar',
      ),
    ),
  );
}

function tarjetaAviso(av, fecha) {
  if (av.tipo === 'dolorManana' || av.tipo === 'dolorNoche') return tarjetaDolor(av, fecha);
  const acciones = [];
  if (av.tipo === 'cita') {
    acciones.push(
      h(
        'button',
        {
          class: 'btn btn-sec btn-chico',
          type: 'button',
          onclick: async () => {
            S.ajustes.cita.hecha = true;
            await guardar('ajustes');
          },
        },
        'Ya está hecho',
      ),
    );
  }
  if (av.tipo === 'copia') acciones.push(h('button', { class: 'btn btn-primario btn-chico', type: 'button', onclick: () => exportarCopia() }, 'Hacer la copia'));
  if (av.tipo === 'sesion') acciones.push(h('button', { class: 'btn btn-primario btn-chico', type: 'button', onclick: () => ir('entreno') }, 'Volver a la sesión'));
  return h(
    'div',
    { class: `aviso ${av.clase === 'alerta' ? 'alerta' : av.clase === 'peligro' ? 'peligro' : ''}`, testid: `aviso-${av.id}` },
    h('p', {}, av.texto),
    av.detalle ? h('details', {}, h('summary', { class: 'suave chico' }, 'Ver más'), h('p', { class: 'chico' }, av.detalle)) : null,
    acciones.length ? h('div', { class: 'acciones' }, acciones) : null,
  );
}

function tarjetaResumen(fecha, cont) {
  const ref = sumarDias(lunesDe(fecha), 7 * semanaVista);
  const r = resumenDeSemana(ref, fecha);
  const cambio = r.pesoCambio == null ? '' : ` · ${signo(r.pesoCambio)} contra la semana anterior (${r.pesoAnterior.toFixed(2)})`;
  const mover = (n) => () => {
    semanaVista = Math.min(0, semanaVista + n);
    render(cont);
  };
  return seccion(
    h(
      'span',
      { class: 'semana-nav' },
      h('button', { class: 'btn btn-chico btn-sec', type: 'button', 'aria-label': 'Semana anterior', testid: 'semana-anterior', onclick: mover(-1) }, '‹'),
      h('span', { testid: 'semana-titulo' }, `Semana del ${diaMes(r.lunes)} al ${diaMes(r.domingo)}`),
      semanaVista < 0 ? h('button', { class: 'btn btn-chico btn-sec', type: 'button', 'aria-label': 'Semana siguiente', testid: 'semana-siguiente', onclick: mover(1) }, '›') : null,
    ),
    h(
      'div',
      { class: 'resumen-sem', testid: 'resumen-semana' },
      h(
        'dl',
        {},
        h('dt', {}, 'Peso promedio'),
        h('dd', { testid: 'peso-promedio' }, r.pesoProm != null ? `${r.pesoProm.toFixed(2)} kg (${plural(r.pesajes, 'pesaje', 'pesajes')})` : '—'),
        cambio ? h('dd', { class: 'resumen-ancho suave chico', testid: 'peso-cambio' }, cambio.slice(3)) : null,
        h('dt', {}, 'Calorías promedio'),
        h('dd', {}, r.kcalProm != null ? `${fmtKcal(r.kcalProm)} / ${fmtKcal(r.kcalMeta)}` : '—'),
        r.nViaje ? h('dt', {}, 'Promedio sin viajes') : null,
        r.nViaje ? h('dd', {}, r.kcalLimpio != null ? fmtKcal(r.kcalLimpio) : '—') : null,
        h('dt', {}, 'Proteína promedio'),
        h('dd', {}, r.pProm != null ? `${fmtG(Math.round(r.pProm))} g` : '—'),
        h('dt', {}, 'Días altos'),
        h('dd', { class: r.diasAltos.length > 1 ? 'rojo' : '' }, String(r.diasAltos.length)),
        h('dt', {}, 'Días con registro'),
        h('dd', {}, String(r.dias.length)),
      ),
      r.hoyFuera ? h('p', { class: 'suave chico mt', testid: 'hoy-fuera' }, 'Hoy entra a los promedios al cerrar el día.') : null,
    ),
    h(
      'div',
      { class: 'rejilla-btns mt' },
      h(
        'button',
        {
          class: 'btn btn-sec',
          type: 'button',
          testid: 'copiar-claude',
          onclick: async () => {
            const ok = await copiarTexto(textoParaClaude(ref));
            aviso(ok ? 'Copiado. Pégalo en el chat.' : 'No se pudo copiar.');
          },
        },
        '📋 Copiar para Claude',
      ),
      h('button', { class: 'btn btn-sec', type: 'button', testid: 'hacer-copia-resumen', onclick: () => exportarCopia() }, '💾 Hacer copia'),
    ),
  );
}

/** Lo planeado del día: un toque por momento para confirmarlo (con "Deshacer"). */
function tarjetaPlaneado(fecha) {
  const comidas = getDia(fecha)?.comidas || [];
  const momentos = MOMENTOS.filter((m) => comidas.some((c) => c.planeado && c.momento === m));
  if (!momentos.length) return null;
  return seccion(
    'Lo planeado: toca cuando lo comas',
    momentos.map((m) => {
      const t = sumar(comidas.filter((c) => c.planeado && c.momento === m));
      return h(
        'button',
        {
          class: 'btn btn-sec btn-ancho mb',
          type: 'button',
          testid: `hoy-confirmar-${m}`,
          onclick: () => confirmarConDeshacer(fecha, (x) => x.planeado && x.momento === m, `Confirmado: ${NOMBRE_MOMENTO[m].toLowerCase()}`),
        },
        `✓ ${NOMBRE_MOMENTO[m]} · ${fmtKcal(t.kcal)} kcal · ${fmtG(t.p)} P`,
      );
    }),
  );
}

export function render(cont) {
  if (estaVacia()) {
    montar(cont, pantallaBienvenida());
    return;
  }
  const fecha = hoy();
  const d = getDia(fecha);
  const dc = diasDesdeCopia();
  const activa = sesionActiva();
  const sig = S.rutina ? siguienteSesion(S.rutina, S.reg.sesiones) : null;
  // Ya entrenó hoy: el botón lo dice, sin tener que entrar a Entreno para saberlo.
  const entrenoHecho = !activa && S.reg.sesiones.some((s) => s.fin && !s.soloLectura && s.fecha === fecha);
  const nomSig = (S.rutina?.sesiones || []).find((s) => s.id === sig)?.nombre;
  const avisos = calcularAvisos(fecha, new Date());
  // La tarjeta roja de copia ya avisa: la franja de arriba no se pinta de rojo también.
  const avisoCopia = avisos.some((a) => a.tipo === 'copia');
  const pesoResaltado = resaltarPeso(fecha);
  montar(
    cont,
    h(
      'div',
      { class: `copia-linea ${!avisoCopia && (dc == null || dc > 7) ? 'vieja' : ''}`, testid: 'ultima-copia' },
      h('span', {}, dc == null ? 'Última copia: nunca' : dc === 0 ? 'Última copia: hoy' : `Última copia: hace ${dc} ${dc === 1 ? 'día' : 'días'}`),
      h('button', { class: 'btn-texto', type: 'button', testid: 'hacer-copia', onclick: () => exportarCopia() }, 'Hacer copia'),
    ),
    !d?.tipo
      ? seccion(
          '¿Hoy entrenas?',
          chips({
            opciones: opcionesTipo(),
            clase: 'grandes',
            testid: 'tipo-hoy',
            alElegir: (v) => fijarTipo(fecha, v),
          }),
        )
      : h(
          'div',
          { class: 'tipo-dia' },
          h('span', { class: 'suave' }, 'Hoy:'),
          h('button', { class: 'chip sel', type: 'button', testid: 'tipo-actual', onclick: () => elegirTipo(fecha) }, metaDelTipo(S.metas, d.tipo)?.nombre || d.tipo),
        ),
    // Los botones de todos los días van arriba, a la vista sin bajar la pantalla.
    h(
      'div',
      { class: 'rejilla-btns mb', testid: 'botones-hoy' },
      h('button', { class: `btn btn-grande ${pesoResaltado ? 'btn-resaltado' : 'btn-sec'}`, type: 'button', testid: 'btn-peso', onclick: () => abrirPeso() }, pesoResaltado ? '⚖️ Peso (hoy toca)' : '⚖️ Peso'),
      !(d?.comidas || []).length
        ? h('button', { class: 'btn btn-sec btn-grande', type: 'button', testid: 'btn-planear', onclick: () => planearDia(fecha) }, '📋 Planear')
        : h('button', { class: 'btn btn-sec btn-grande', type: 'button', testid: 'btn-ver-comida', onclick: () => ir('comida') }, '🍽️ Ver el día'),
      h(
        'button',
        { class: `btn btn-sec btn-grande${activa || nomSig ? ' btn-dos' : ''}`, type: 'button', testid: 'btn-entrenar', onclick: () => ir('entreno') },
        h('span', {}, activa ? 'Volver a la sesión' : entrenoHecho ? 'Ya entrenaste hoy' : 'Entrenar'),
        activa || nomSig ? h('span', { class: 'btn-sub' }, activa ? activa.nombre : entrenoHecho ? `La próxima: ${nomSig}` : nomSig) : null,
      ),
      h('button', { class: 'btn btn-sec btn-grande', type: 'button', testid: 'btn-cerrar', onclick: () => abrirCerrarDia(fecha) }, '✅ Cerrar el día'),
    ),
    tarjetaPlaneado(fecha),
    avisos.map((a) => tarjetaAviso(a, fecha)),
    bloqueBarras(fecha),
    tarjetaResumen(fecha, cont),
  );
}
