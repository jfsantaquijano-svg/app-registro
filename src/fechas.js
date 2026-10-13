// Fechas locales en formato AAAA-MM-DD. Sin dependencias del DOM.

export const pad = (n) => String(n).padStart(2, '0');

export function isoFecha(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hoy() {
  return isoFecha(new Date());
}

export function parseFecha(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function sumarDias(s, n) {
  const d = parseFecha(s);
  d.setDate(d.getDate() + n);
  return isoFecha(d);
}

/** Días de a hasta b (b − a). */
export function difDias(a, b) {
  return Math.round((parseFecha(b) - parseFecha(a)) / 86400000);
}

/** 0 = domingo … 6 = sábado */
export function diaSemana(s) {
  return parseFecha(s).getDay();
}

export function lunesDe(s) {
  const dow = diaSemana(s);
  return sumarDias(s, dow === 0 ? -6 : 1 - dow);
}

export function horaLocal(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO con el desfase local, ej. 2030-01-01T12:00:00-03:00 */
export function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const signo = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${isoFecha(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${signo}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function fechaDeIso(iso) {
  if (!iso) return null;
  return isoFecha(new Date(iso));
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function fechaCorta(s) {
  const d = parseFecha(s);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

export function diaMes(s) {
  const d = parseFecha(s);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** "jueves 3 ene" */
export function fechaMedia(s) {
  const d = parseFecha(s);
  return `${DIAS_LARGOS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

export function fechaLarga(s) {
  const d = parseFecha(s);
  return `${DIAS_LARGOS[d.getDay()]} ${d.getDate()} de ${MESES_LARGOS[d.getMonth()]}`;
}

/** Duración en m:ss o h:mm:ss */
export function fmtDuracion(ms) {
  const neg = ms < 0;
  let s = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const txt = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return neg ? `-${txt}` : txt;
}

export function minutosEntre(isoA, isoB) {
  if (!isoA || !isoB) return null;
  return Math.round((new Date(isoB) - new Date(isoA)) / 60000);
}

/** Fecha en formato de Google Calendar (todo el día): AAAAMMDD */
export function fechaCalendario(s) {
  return String(s).slice(0, 10).replace(/-/g, '');
}
