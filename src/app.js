// Arranque: carga los datos, dibuja la pestaña activa y registra el service worker.
import { cargar, alCambiar, estaVacia } from './estado.js';
import { pedirPersistencia } from './db.js';
import { registrarNavegacion } from './navegar.js';
import { h, aviso } from './ui.js';
import { hoy, fechaCorta, sumarDias } from './fechas.js';
import * as vistaHoy from './hoy.js';
import * as vistaComida from './comida.js';
import * as vistaEntreno from './entreno.js';
import * as vistaCuerpo from './cuerpo.js';
import * as vistaDatos from './datos.js';

const VISTAS = { hoy: vistaHoy, comida: vistaComida, entreno: vistaEntreno, cuerpo: vistaCuerpo, datos: vistaDatos };
const TITULOS = { hoy: 'Hoy', comida: 'Comida', entreno: 'Entreno', cuerpo: 'Cuerpo', datos: 'Datos' };

let ruta = leerRuta();
let fechaDibujada = null;

function leerRuta() {
  const [tab, sub] = (location.hash.slice(1) || 'hoy').split('/');
  return { tab: VISTAS[tab] ? tab : 'hoy', sub: sub || null };
}

function hashDeRuta() {
  return `#${ruta.tab}${ruta.sub ? `/${ruta.sub}` : ''}`;
}

function render() {
  const cont = document.getElementById('vista');
  fechaDibujada = hoy();
  try {
    VISTAS[ruta.tab].render(cont, ruta.sub);
  } catch (e) {
    console.error(e);
    cont.replaceChildren(h('div', { class: 'aviso peligro' }, h('p', {}, 'Algo falló al dibujar esta pantalla.'), h('p', { class: 'chico' }, String(e?.message || e))));
  }
  document.getElementById('titulo').textContent = ruta.tab === 'hoy' ? `Hoy · ${fechaCorta(fechaDibujada)}` : TITULOS[ruta.tab];
  const fab = document.getElementById('fab');
  const conFab = (ruta.tab === 'hoy' || ruta.tab === 'comida') && !estaVacia();
  fab.hidden = !conFab;
  document.body.classList.toggle('con-fab', conFab);
  vigilarFab(cont);
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    const activa = b.dataset.tab === ruta.tab;
    b.classList.toggle('activa', activa);
    if (activa) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

function ir(tab, sub = null) {
  if (tab === 'comida' && ruta.tab !== 'comida') vistaComida.irAFecha(null);
  ruta = { tab: VISTAS[tab] ? tab : 'hoy', sub };
  history.replaceState(history.state, '', hashDeRuta());
  window.scrollTo(0, 0);
  render();
}

registrarNavegacion(ir);

window.addEventListener('popstate', () => {
  // Cerrar una hoja hace "atrás" en el historial: se conserva la pestaña actual.
  if (location.hash !== hashDeRuta()) history.replaceState(history.state, '', hashDeRuta());
});

document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => ir(b.dataset.tab)));
document.getElementById('btn-menu').addEventListener('click', () => vistaDatos.abrirMenu());
/** Antes de las 4 de la mañana lo que se anota es todavía de ayer (la cena tarde). */
const HORA_CAMBIO_DIA = 4;
function fechaParaAgregar() {
  if (ruta.tab === 'comida') return vistaComida.fechaDeVista();
  return new Date().getHours() < HORA_CAMBIO_DIA ? sumarDias(hoy(), -1) : hoy();
}
document.getElementById('fab').addEventListener('click', () => vistaComida.abrirAgregar(fechaParaAgregar()));

// El botón flotante se esconde cuando hay botones de la pantalla debajo de él (no tapa "Cerrar el día").
let observador = null;
const visibles = new Set();
function vigilarFab(cont) {
  const fab = document.getElementById('fab');
  observador?.disconnect();
  visibles.clear();
  fab.classList.remove('fab-oculto');
  if (fab.hidden || !('IntersectionObserver' in window)) return;
  const alto = fab.offsetHeight || 60;
  observador = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) (e.isIntersecting ? visibles.add(e.target) : visibles.delete(e.target));
      fab.classList.toggle('fab-oculto', visibles.size > 0);
    },
    // Solo la franja de abajo, donde está el botón flotante.
    { rootMargin: `-${Math.max(0, window.innerHeight - alto - 100)}px 0px 0px 0px` },
  );
  cont.querySelectorAll('.rejilla-btns, [data-testid="copiar-claude"]').forEach((el) => observador.observe(el));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && fechaDibujada && fechaDibujada !== hoy()) render();
});

alCambiar(() => render());

window.addEventListener('error', (e) => console.error(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  aviso('Algo falló. Si se repite, exporta una copia.');
});

// ---------- Service worker y "Versión nueva" ----------

function mostrarBannerVersion(sw) {
  if (document.getElementById('banner-version')) return;
  const b = h(
    'button',
    {
      class: 'banner-version',
      id: 'banner-version',
      type: 'button',
      testid: 'banner-version',
      onclick: () => {
        recargarAlCambiar = true;
        sw.postMessage('saltar');
        b.textContent = 'Actualizando…';
      },
    },
    'Versión nueva: toca para actualizar',
  );
  document.body.append(b);
}

let recargarAlCambiar = false;

async function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    if (reg.waiting && navigator.serviceWorker.controller) mostrarBannerVersion(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrarBannerVersion(nuevo);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargarAlCambiar) location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (e) {
    console.warn('Sin service worker', e);
  }
}

async function iniciar() {
  await cargar();
  render();
  if (!estaVacia()) pedirPersistencia();
  registrarSW();
  document.body.dataset.listo = '1';
}

iniciar();
