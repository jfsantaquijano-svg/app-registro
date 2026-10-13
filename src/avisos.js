// Avisos que se calculan al abrir la app (no hay servidor ni avisos a una hora fija).
import { S, getDia, totalesDelDia, metaDelDia, diasDesdeCopia, sesionActiva, tipoDelDia } from './estado.js';
import { sumarDias, lunesDe, difDias, diaSemana, fechaDeIso, fechaMedia } from './fechas.js';
import { esDiaAlto, proximaComidaLibre, fechaCoincide, semanasPeso, bajadaRapida, diasConTotales, metaDelTipo } from './calculos.js';
import { sesionesValidas, semanaDelBloque, esSemanaSuave } from './progresion.js';

function texto(clave, porDefecto) {
  return S.ajustes?.textos?.[clave] || porDefecto;
}

function tipoSesion(sesionId) {
  return (S.rutina?.sesiones || []).find((s) => s.id === sesionId)?.tipo || null;
}

function sesionesDelDia(fecha) {
  return sesionesValidas(S.reg.sesiones).filter((s) => (s.fecha || fechaDeIso(s.inicio)) === fecha);
}

/** Días hacia atrás en que todavía se pregunta cómo amaneció después de una sesión. */
const DIAS_PREGUNTA_MANANA = 3;
/** Antes de esta hora la pregunta de la mañana todavía no sale (la noche anterior no cuenta). */
const HORA_MANANA = 4;

function hayDolor(zona, momento, fecha) {
  return S.reg.dolor.some((d) => d.zona === zona && d.momento === momento && d.fecha === fecha);
}

export function kcalDelDia(fecha) {
  const d = getDia(fecha);
  if (d) {
    const t = totalesDelDia(fecha);
    if (t.nConf) return t.conf.kcal;
  }
  const h = S.reg.historialDias.find((x) => x.fecha === fecha);
  return h ? h.kcal : null;
}

export function fueDiaAlto(fecha) {
  const h = S.reg.historialDias.find((x) => x.fecha === fecha);
  const d = getDia(fecha);
  const meta = d || !h ? metaDelDia(fecha) : metaDelTipo(S.metas, h.tipo);
  return esDiaAlto(kcalDelDia(fecha), meta, S.metas?.diaAltoKcal);
}

/** Días altos de la semana de `fecha` (sin contar `fecha`). */
export function diasAltosSemana(fecha, excluir = fecha) {
  const lunes = lunesDe(fecha);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(lunes, i);
    if (f === excluir || f > fecha) continue;
    if (fueDiaAlto(f)) out.push(f);
  }
  return out;
}

/** ¿En el periodo del archivo el recorrido registrado no mejora, o el dolor registrado no cede? */
function avisoRecorrido(fecha) {
  if (!S.ajustes?.textos?.citaRecorrido || S.ajustes?.cita?.hecha) return false;
  const registros = [];
  for (const s of sesionesValidas(S.reg.sesiones)) {
    for (const e of s.ejercicios || []) {
      if (e.recorrido != null) registros.push({ fecha: s.fecha, recorrido: e.recorrido, dolor: e.dolor, clave: e.clave });
    }
  }
  if (!registros.length) return false;
  const dias = Number(S.ajustes?.diasAvisoRecorrido) > 0 ? Number(S.ajustes.diasAvisoRecorrido) : 21;
  if (difDias(registros[0].fecha, fecha) < dias) return false;
  const desde = sumarDias(fecha, -dias);
  const recientes = registros.filter((r) => r.fecha >= desde);
  if (!recientes.length) return false;
  const max = Math.max(...registros.map((r) => r.recorrido));
  const todosLosRecorridos = (S.rutina?.sesiones || []).flatMap((s) => s.bloques.flatMap((b) => b.ejercicios)).flatMap((e) => e.recorridos || []);
  const completo = todosLosRecorridos.length ? Math.max(...todosLosRecorridos) : max;
  const noAbre = recientes.every((r) => r.recorrido < completo);
  const conDolor = recientes.filter((r) => r.dolor != null);
  const noBaja = conDolor.length >= 2 && conDolor[conDolor.length - 1].dolor > 0 && conDolor[conDolor.length - 1].dolor >= conDolor[0].dolor;
  return noAbre || noBaja;
}

/**
 * La mañana que falta por anotar para una zona: la siguiente a la sesión más reciente de su tipo
 * (de los últimos días) que todavía no tiene registro. La de hoy solo desde la hora de la mañana.
 */
export function mananaPendiente(zona, z, fecha, hora = 12) {
  const tipos = z?.sesiones || [];
  const sesiones = sesionesValidas(S.reg.sesiones)
    .filter((s) => tipos.includes(tipoSesion(s.sesionId)))
    .map((s) => s.fecha || fechaDeIso(s.inicio))
    .filter((f) => f < fecha && difDias(f, fecha) <= DIAS_PREGUNTA_MANANA);
  const fechas = [...new Set(sesiones)].sort().reverse();
  for (const f of fechas) {
    const m = sumarDias(f, 1);
    if (m > fecha) continue;
    if (m === fecha && hora < HORA_MANANA) continue;
    if (!hayDolor(zona, 'manana', m)) return m;
  }
  return null;
}

/**
 * Lista de avisos para Hoy. Cada aviso: { id, clase: 'info'|'alerta'|'peligro', tipo, texto, … }
 */
export function calcularAvisos(fecha, ahora = new Date()) {
  const out = [];
  const hora = ahora.getHours();
  const zonas = S.ajustes?.zonas || {};
  const activa = sesionActiva();
  if (activa) out.push({ id: 'sesion', clase: 'alerta', tipo: 'sesion', texto: `Tienes la sesión ${activa.nombre} en curso.` });

  // Dolor: la mañana siguiente a una sesión (también si no abrió la app ese día) y la noche del mismo día
  const ayer = sumarDias(fecha, -1);
  const sesHoy = sesionesDelDia(fecha);
  for (const [zona, z] of Object.entries(zonas)) {
    const aplica = (lista) => lista.some((s) => (z.sesiones || []).includes(tipoSesion(s.sesionId)));
    const manana = z.preguntaManana ? mananaPendiente(zona, z, fecha, hora) : null;
    if (manana) {
      const texto = manana === fecha ? z.preguntaManana : `${z.preguntaManana} (${fechaMedia(manana)})`;
      out.push({ id: `manana-${zona}`, clase: 'info', tipo: 'dolorManana', zona, fechaDolor: manana, texto, preguntaDormir: z.preguntaDormir || null });
    }
    if (z.preguntaNoche && aplica(sesHoy) && hora >= 19 && !hayDolor(zona, 'noche', fecha)) {
      out.push({ id: `noche-${zona}`, clase: 'info', tipo: 'dolorNoche', zona, texto: z.preguntaNoche });
    }
  }

  // Días altos
  const diaAltoKcal = S.metas?.diaAltoKcal ?? 150;
  if (fueDiaAlto(ayer)) {
    out.push({ id: 'ayer-alto', clase: 'alerta', tipo: 'texto', texto: texto('ayerDiaAlto', 'Ayer fue día alto: hoy, tu día modelo.') });
  }
  const meta = metaDelDia(fecha);
  const t = totalesDelDia(fecha);
  const proyectado = t.conf.kcal + t.plan.kcal;
  if (meta && meta.cuentaDiaAlto !== false && proyectado > meta.kcal + diaAltoKcal) {
    const otros = diasAltosSemana(fecha);
    if (otros.length >= 1) {
      out.push({ id: 'segundo-alto', clase: 'alerta', tipo: 'texto', texto: `Este sería tu ${otros.length + 1}.º día alto de la semana.` });
    }
    if (fueDiaAlto(ayer)) out.push({ id: 'altos-seguidos', clase: 'alerta', tipo: 'texto', texto: 'Serían dos días altos seguidos.' });
  }

  // Comida libre
  const libre = proximaComidaLibre(S.ajustes?.comidaLibre, fecha);
  if (libre) {
    const d = difDias(fecha, libre);
    if (d === 0) out.push({ id: 'libre', clase: 'info', tipo: 'texto', texto: 'Hoy es tu comida libre.' });
    else if (d > 0 && d <= 3) out.push({ id: 'libre', clase: 'info', tipo: 'texto', texto: `Comida libre: ${fechaMedia(libre)}` });
  }

  // Fechas del plan
  for (const f of S.ajustes?.fechas || []) {
    if (f.soloCalendario) continue;
    if (fechaCoincide(f, fecha)) out.push({ id: `fecha-${f.titulo}`, clase: 'info', tipo: 'texto', texto: f.titulo });
  }

  // Semana suave
  if (S.rutina && esSemanaSuave(S.rutina, semanaDelBloque(S.rutina, fecha)) && difDias(S.rutina.inicio, fecha) >= 0) {
    out.push({ id: 'suave', clase: 'info', tipo: 'texto', texto: 'Semana suave: menos series, sin fallo y sin subir peso.' });
  }

  // Cita
  if (S.ajustes?.cita && !S.ajustes.cita.hecha && S.ajustes.cita.texto) {
    out.push({ id: 'cita', clase: 'alerta', tipo: 'cita', texto: S.ajustes.cita.texto, detalle: S.ajustes?.textos?.cita || null });
  }
  if (avisoRecorrido(fecha)) out.push({ id: 'cita-recorrido', clase: 'peligro', tipo: 'texto', texto: S.ajustes.textos.citaRecorrido });

  // Peso: bajada muy rápida
  const sem = semanasPeso(S.reg.pesos).filter((s) => difDias(s.lunes, fecha) <= 21);
  if (bajadaRapida(sem)) {
    out.push({ id: 'bajada', clase: 'alerta', tipo: 'texto', texto: texto('bajadaRapida', 'Bajaste más de 1 kg por semana dos semanas seguidas. Revísalo en la próxima revisión.') });
  }

  // Copia
  const dc = diasDesdeCopia();
  const hayDatos = Object.keys(S.reg.dias).length || S.reg.sesiones.length || S.reg.pesos.length;
  if (hayDatos && (dc == null || dc > 7)) {
    out.push({ id: 'copia', clase: 'peligro', tipo: 'copia', texto: dc == null ? 'Todavía no has hecho una copia de tus datos.' : `Tu última copia es de hace ${dc} días.` });
  } else if (hayDatos && diaSemana(fecha) === 0 && dc !== 0) {
    out.push({ id: 'copia', clase: 'alerta', tipo: 'copia', texto: 'Hoy es domingo: haz la copia de la semana.' });
  }
  return out;
}

/** ¿Se resalta el botón de Peso hoy? (días de pesarse, salvo viaje y los días después) */
export function resaltarPeso(fecha) {
  const dias = S.ajustes?.diasPeso || [];
  if (!dias.includes(diaSemana(fecha))) return false;
  if (S.reg.pesos.some((p) => p.fecha === fecha && (p.tipo || 'casa') === 'casa')) return false;
  const n = S.ajustes?.pesoNoResaltarTrasViajeDias ?? 3;
  for (let i = 0; i <= n; i++) {
    const f = sumarDias(fecha, -i);
    if (getDia(f)?.tipo === 'viaje') return false;
  }
  return true;
}

export function diasParaResumen() {
  const fechasSesion = new Set(sesionesValidas(S.reg.sesiones).map((s) => s.fecha));
  return diasConTotales({ dias: S.reg.dias, historialDias: S.reg.historialDias }, S.ajustes, fechasSesion);
}

export { tipoDelDia };
