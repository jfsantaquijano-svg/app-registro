// Resumen de la semana y el texto de "Copiar para Claude".
import { S } from './estado.js';
import { resumenSemana, fmtKcal, fmtG, metaDelTipo, signo, plural } from './calculos.js';
import { lunesDe, sumarDias, fechaCorta, diaMes, fechaDeIso, horaLocal, hoy } from './fechas.js';
import { duracionMin } from './progresion.js';
import { diasParaResumen } from './avisos.js';

/**
 * Resumen de la semana de `fecha` (lunes a domingo). En la semana en curso cuenta hasta hoy,
 * y hoy solo entra cuando el día se cierra.
 */
export function resumenDeSemana(fecha, hoyF = hoy()) {
  const lunes = lunesDe(fecha);
  const enCurso = lunes === lunesDe(hoyF);
  return resumenSemana({ lunes, diasTot: diasParaResumen(), pesos: S.reg.pesos, metas: S.metas, hasta: enCurso ? hoyF : null });
}

export function nombreTipo(tipo) {
  return metaDelTipo(S.metas, tipo)?.nombre || tipo || '—';
}

function nombreZona(z) {
  return S.ajustes?.zonas?.[z]?.nombre || z;
}

function textoSerie(s) {
  let t = `${s.lado === 'izq' ? 'izq ' : s.lado === 'der' ? 'der ' : ''}${s.kg ?? '?'}×${s.reps ?? '?'}`;
  if (s.rir != null) t += ` RIR${s.rir >= 4 ? '4+' : s.rir}`;
  if (s.fallo) t += ' ⚡';
  if (s.tramos?.length) t += ` ${s.tramos.map((x) => `→${x.kg ?? '?'}×${x.reps ?? 'no recuerda'}`).join(' ')}`;
  if (s.tecnica && s.tecnica !== 'normal') t += ` (${s.tecnica})`;
  return t;
}

/** Texto corto de la semana para pegar en el chat. Sin tablas: una línea por cosa. */
export function textoParaClaude(fecha) {
  const r = resumenDeSemana(fecha);
  const L = [];
  L.push(`Semana del ${diaMes(r.lunes)} al ${diaMes(r.domingo)} (lunes a domingo)`);
  L.push('');
  L.push(`Peso promedio: ${r.pesoProm != null ? r.pesoProm.toFixed(2) : '—'} kg (${plural(r.pesajes, 'pesaje', 'pesajes')}) · cambio contra la semana anterior${r.pesoAnterior != null ? ` (${r.pesoAnterior.toFixed(2)})` : ''}: ${signo(r.pesoCambio)} kg`);
  L.push(`Calorías promedio: ${r.kcalProm != null ? fmtKcal(r.kcalProm) : '—'} (meta ${r.kcalMeta != null ? fmtKcal(r.kcalMeta) : '—'})`);
  if (r.nViaje) L.push(`Promedio limpio sin viajes: ${r.kcalLimpio != null ? fmtKcal(r.kcalLimpio) : '—'} (meta ${r.kcalMetaLimpio != null ? fmtKcal(r.kcalMetaLimpio) : '—'})`);
  L.push(`Proteína promedio: ${r.pProm != null ? Math.round(r.pProm) : '—'} g`);
  L.push(`Días altos: ${r.diasAltos.length}${r.diasAltos.length ? ` (${r.diasAltos.map(fechaCorta).join(', ')})` : ''}`);
  if (r.hoyFuera) L.push('Hoy todavía no entra a los promedios: entra al cerrar el día.');
  L.push('');
  L.push('Días:');
  if (!r.dias.length) L.push('- sin días registrados');
  for (const d of r.dias) {
    L.push(`- ${fechaCorta(d.fecha)} · ${nombreTipo(d.tipo)} · ${fmtKcal(d.kcal)} kcal · ${fmtG(d.p)} P · ${fmtG(d.g)} G · ${fmtG(d.c)} C${d.estimados ? ' · con estimados' : ''}${d.historial ? ' · (historial)' : ''}`);
  }
  const ses = S.reg.sesiones
    .filter((s) => (s.fin || s.soloLectura) && (s.fecha || fechaDeIso(s.inicio)) >= r.lunes && (s.fecha || fechaDeIso(s.inicio)) <= r.domingo)
    .sort((a, b) => String(a.inicio || a.fecha).localeCompare(String(b.inicio || b.fecha)));
  L.push('');
  L.push('Sesiones:');
  if (!ses.length) L.push('- sin sesiones');
  for (const s of ses) {
    const antes = Object.entries(s.dolorAntes || {})
      .map(([z, v]) => `${nombreZona(z)} antes ${v}`)
      .join(', ');
    const fs = s.fecha || fechaDeIso(s.inicio);
    L.push(
      `- ${fechaCorta(fs)} · ${s.nombre}${s.soloLectura ? ' (bloque anterior)' : ` · semana ${s.semanaBloque}${s.suave ? ' (suave)' : ''} · ${duracionMin(s) ?? '?'} min`}${s.gimnasio ? ` · ${s.gimnasio}` : ''}${antes ? ` · ${antes}` : ''}`,
    );
    for (const e of s.ejercicios || []) {
      if (!e.series?.length) continue;
      let t = `  ${e.nombre}: ${e.series.map(textoSerie).join(', ')}`;
      if (e.dolor != null) t += ` · dolor ${e.dolor}`;
      if (e.recorrido != null) t += ` · recorrido ${e.recorrido}°`;
      if (e.alarmas?.length) t += ` · ALARMA: ${e.alarmas.join(', ')}`;
      if (e.nota) t += ` · nota: ${e.nota}`;
      L.push(t);
    }
    if (s.notas) L.push(`  Notas: ${s.notas}`);
  }
  const dolor = S.reg.dolor.filter((d) => d.fecha >= r.lunes && d.fecha <= r.domingo);
  L.push('');
  L.push('Dolor:');
  if (!dolor.length) L.push('- sin registros');
  for (const d of dolor) {
    const mom = { manana: 'al despertar', noche: 'en la noche', antes: 'antes de entrenar', evento: 'fuera del gimnasio' }[d.momento] || d.momento;
    let t = `- ${fechaCorta(d.fecha)}${d.hora ? ` ${d.hora}` : ''} · ${nombreZona(d.zona)} · ${d.valor != null ? `${d.valor}/10` : 'sin número'} · ${mom}`;
    if (d.durmioSobre) t += ' · durmió sobre ese lado';
    if (d.duracionMin) t += ` · duró ${d.duracionMin} min`;
    if (d.actividad) t += ` · ${d.actividad}`;
    L.push(t);
  }
  const pesos = S.reg.pesos.filter((p) => p.fecha >= r.lunes && p.fecha <= r.domingo);
  L.push('');
  L.push(`Pesos: ${pesos.length ? pesos.map((p) => `${fechaCorta(p.fecha)} ${p.kg}${p.tipo === 'bio' ? ' (bioimpedancia)' : ''}`).join(', ') : 'sin pesajes'}`);
  return L.join('\n');
}

export { sumarDias, fechaDeIso, horaLocal };
