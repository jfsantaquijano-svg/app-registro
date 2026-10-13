# Registro

App web instalable (PWA) para anotar **comida, entreno y cuerpo**. Funciona sin internet, abre rápido y se usa con una mano.

**Tus datos viven en tu teléfono.** No hay servidor ni cuentas: nada sale del celular salvo cuando tú exportas una copia.

## Qué hace

- **Hoy:** tipo de día (los que traiga el archivo), botones de todos los días arriba, "Planear el día", barras de calorías, proteína, grasa y carbos contra la meta, lo que falta, grasa que se ve y que no se ve, avisos del día, resumen de la semana (también de semanas anteriores) y "Copiar para Claude".
- **Comida:** el día en 4 momentos, buscador sin tildes con favoritos y recientes primero, gramos o unidades, crudo o ya cocido, recargo de restaurante, platos guardados (½, 1 o 1½), producto nuevo desde la etiqueta (con lector de código de barras si el navegador lo permite) y "Cerrar el día" con una propuesta hecha con lo que hay en casa.
- **Entreno:** la sesión que sigue en la rotación, semana del bloque, registro por serie (peso, repeticiones, cuántas quedaban, lado), superseries (con "Dejar para el final" para cuando toque esperar un aparato), series al fallo con bajadas, cronómetro de descanso, preguntas por zona (las define el archivo) y peso sugerido para la próxima vez (doble progresión, siempre con pesos que ya se registraron en esa máquina: la app no inventa el salto de la máquina).
- **Cuerpo:** peso con promedio semanal (lunes a domingo) y gráfica, medidas, fotos, mediciones de composición corporal y enlaces para Google Calendar.
- **Datos (menú ⋮):** exportar e importar la copia, metas, alimentos, platos, rutina y ajustes.

## Cómo instalarla

1. Abre el enlace de la app en **Chrome** (no en otro navegador: los datos se guardan en el navegador donde la abras).
2. Menú ⋮ de Chrome → **"Instalar app"** (o "Agregar a la pantalla principal").
3. Abre la app desde su ícono → ⋮ → **Importar** → elige tu archivo de arranque (`.txt` o `.json`).

## Tus datos y las copias

- Todo se guarda en el teléfono (IndexedDB). La app pide al navegador que no lo borre por falta de espacio.
- **Si borras los datos de Chrome o desinstalas la app sin una copia, se pierde todo.** Por eso la pantalla Hoy siempre muestra "Última copia: hace X días".
- ⋮ → **Exportar copia** crea `copia-AAAA-MM-DD.txt` (JSON). Guárdala donde quieras, por ejemplo en Google Drive.
- ⋮ → **Importar** acepta `.txt` y `.json`:
  - **Restaurar copia completa:** reemplaza todo. Antes guarda lo actual para que puedas deshacerlo.
  - **Actualizar plan:** cambia la rutina, las metas y los ajustes; agrega y corrige alimentos y platos sin borrar los que creaste; no toca tus registros.
- Lo único que usa internet: la consulta a Open Food Facts cuando lees un código de barras, y los enlaces que tú abres (búsqueda en FatSecret y Google Calendar).
- Los avisos aparecen al abrir la app; no suenan solos.

El formato de la copia y del archivo de arranque está en [`ESQUEMA-DATOS.md`](ESQUEMA-DATOS.md).

## Para desarrollar

Sin librerías ni paso de compilación: HTML, CSS y módulos de JavaScript.

```bash
python3 -m http.server 8080      # y abre http://localhost:8080
npm test                         # pruebas de cálculos y de punta a punta
```

Las pruebas usan el runner de Node y Playwright 1.56.1 con Chromium (pantalla de celular de 412 × 915). Las capturas quedan en `test/capturas/`.

- `index.html`, `estilos.css`, `manifest.webmanifest`, `sw.js` (caché para usarla sin internet y aviso "Versión nueva: toca para actualizar"; al publicar cambios, sube `VERSION`).
- `src/`: `app.js` (arranque y pestañas), `db.js` (IndexedDB), `estado.js`, `calculos.js`, `cierre.js`, `progresion.js`, `fechas.js`, `copia.js` (formato de importar y exportar), `avisos.js`, `resumen.js`, `ui.js` y una vista por pestaña (`hoy.js`, `comida.js`, `entreno.js`, `cuerpo.js`, `datos.js`).
- `test/arranque-prueba.json`: datos **de prueba, inventados** (no se parecen a los de nadie).

Este repositorio solo tiene código genérico. Las reglas de cada plan (lado que decide, umbral de dolor, recorridos, recorte, textos y gustos) vienen del archivo de arranque de cada persona, que nunca se sube aquí: `.gitignore` bloquea archivos de arranque, copias y carpetas de datos, y `test/unit/privacidad.test.mjs` revisa los archivos y el historial contra una lista privada que vive fuera del repositorio (se salta si no la encuentra).
