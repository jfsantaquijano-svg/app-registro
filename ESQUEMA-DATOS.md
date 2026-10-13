# Esquema de datos de la app (contrato entre la app y el archivo de cada persona)

Este documento es genérico: todos los nombres, números y textos de los ejemplos son inventados. Lo de cada persona vive en su archivo de arranque (`arranque.json`, que se entrega como `.txt`) y en la copia que exporta la app; nunca en este repositorio.

## Archivo de arranque / copia (mismo formato)

```json
{
  "formato": "app-registro",
  "version": 1,
  "creado": "2030-01-01T12:00:00+00:00",
  "tipo": "arranque | copia",
  "ajustes": { ... },
  "metas": { ... },
  "alimentos": [ ... ],
  "platos": [ ... ],
  "rutina": { ... },
  "registros": { ... }
}
```

Al importar un `arranque` en una app vacía se carga todo. "Actualizar plan" reemplaza `rutina`, `metas` y `ajustes`, y combina `alimentos` y `platos` por `id`: agrega y corrige lo del plan, y nunca borra ni pisa lo que creó el usuario (`origen: "usuario"`) ni lo que corrigió (`editado: true`). Conserva las marcas del usuario (favorito, en casa, el interruptor del suplemento diario y lo que ya marcó como hecho en `recordatorio`). Nunca toca `registros`.

## ajustes

```json
{
  "zonas": {
    "zona1": { "nombre": "Zona A", "sesiones": ["a"], "preguntaManana": "texto", "preguntaDormir": "texto", "dormirAnula": true,
               "siEmpeora": "recorrido", "momentosEvento": ["evento", "noche"], "consejoSiPasaUmbral": "texto", "donde": "texto" },
    "zona2": { "nombre": "Zona B", "sesiones": ["b"], "preguntaManana": "texto", "preguntaNoche": "texto" }
  },
  "umbralDolor": 4,
  "alarmas": ["texto", "..."],
  "avisoAlarma": "texto",
  "cita": { "texto": "texto del recordatorio", "hecha": false },
  "gimnasios": ["Gimnasio Norte"],
  "gimnasioPorDefecto": "Gimnasio Norte",
  "comidaLibre": { "desde": "AAAA-MM-DD", "cadaDias": 10 },
  "fechas": [ { "fecha": "AAAA-MM-DD", "titulo": "texto", "repetir": "mensual|semanal|ninguna", "soloCalendario": false } ],
  "omega3": { "nombre": "Suplemento diario", "kcal": 20, "p": 0, "g": 2, "c": 0, "activo": true, "grasaVisible": true },
  "diasPeso": [2, 4, 6],
  "pesoNoResaltarTrasViajeDias": 2,
  "diasAvisoRecorrido": 21,
  "cierre": { "nuncaSolos": ["palabra"], "preferir": ["palabra"], "porcionesLacteo": [125, 150] },
  "textos": { "clave": "texto libre que la app muestra" }
}
```

- Toda frase propia de cada persona (nombres de zonas, alarmas, preguntas, recordatorios, fechas, reglas) viene de aquí. El código solo usa `zona1`, `zona2`, `alarmas[i]` y textos genéricos.
- `zonas.*.sesiones`: tipos de sesión (`rutina.sesiones[].tipo`) en que se pregunta esa zona. `preguntaManana` sale la mañana siguiente a esas sesiones (si no se anotó ese día, se pregunta hasta 3 días después con la fecha). `preguntaNoche` sale desde las 19:00 del mismo día. `preguntaDormir` + `dormirAnula`: si marca la casilla, ese dolor de la mañana no cuenta para subir peso.
- `umbralDolor`: dolor (0–10) por encima del cual no se sube peso. Sin él, la app no aplica reglas de dolor.
- `siEmpeora: "recorrido"`: si en un ejercicio de esa zona el dolor pasa del umbral, la próxima vez va con el recorrido corto (`recorridoSiEmpeora`, o el menor que sigue de `recorridos`) y, si ya estaba ahí o se repite, con 5–10 % menos de peso. Son dos pasos, no tres. La mañana siguiente peor que antes de empezar solo cuenta en los ejercicios con `empeoraPorManana`.
- `momentosEvento`: qué registros de `dolor` cuentan como "ese dolor volvió a aparecer" para `noSubirSi: evento{Zona}DesdeUltimaSesion`. Por defecto solo `evento` (lo anotado fuera del gimnasio); con `["evento", "noche"]` también la respuesta de la noche mayor que 0.
- `consejoSiPasaUmbral`: qué hacer con esa zona cuando el dolor del ejercicio pasa del umbral. La app lo muestra al guardar las preguntas del ejercicio y lo repite en el motivo de la sugerencia.
- `donde`: dónde duele, con las palabras de la persona. La app lo muestra al anotar dolor fuera del gimnasio, para confirmar que es el mismo sitio.
- `fechas[].soloCalendario`: la fecha solo sale en "Agregar al calendario", no como aviso en Hoy.
- `omega3`: suplemento que se suma solo cada día (el nombre del campo es histórico). Cada día guarda su marca al crearse; apagarlo en Ajustes vale para los días nuevos. `grasaVisible: false` si no es grasa que se ve.
- `cierre`: gustos para "Cerrar el día": palabras de alimentos que nunca se proponen solos, palabras que se prefieren, y porciones de lácteo en gramos.
- `textos`: claves que la app usa si existen: `cita`, `citaRecorrido`, `unaPierna`, `porEncontrar`, `ayerDiaAlto`, `bajadaRapida`, `fotos`, `eventoZona1` (ayuda en "Dolor fuera del gimnasio"), `eventoZona1NoSubir` (motivo cuando ese registro frena la subida), `unaSesionPorDia` (la regla del plan sobre entrenar una sola vez al día), y lo mismo para otras zonas.

## metas

```json
{
  "tipos": {
    "entreno":  { "nombre": "Entreno",  "kcal": 2000, "p": 150, "g": 60, "c": 215, "pMin": 140, "pMax": 160, "gMin": 55, "gMax": 65 },
    "descanso": { "nombre": "Descanso", "kcal": 1900, "p": 150, "g": 58, "c": 194, "pMin": 140, "pMax": 160, "gMin": 52, "gMax": 62 },
    "viaje":    { "nombre": "Viaje", "kcal": 2500, "pMin": 130, "soloKcalYProteina": true, "cuentaDiaAlto": false, "promedioLimpio": false },
    "pausa":    { "nombre": "Pausa de ejemplo", "kcal": 2400, "p": 150, "g": 75, "c": 280, "pMin": 140, "pMax": 160, "gMin": 60, "gMax": 85, "activo": false, "diaModeloDe": "descanso" }
  },
  "diaAltoKcal": 150,
  "toleranciaKcal": 30,
  "reglaDeOroP": 150,
  "grasaMinima": 50,
  "recargos": { "salteado": 0.25, "plancha": 0.15, "medido": 0.05 },
  "peorCasoAceite": { "arroz": 4, "frijol": 6, "polloMarinado": 2 }
}
```

- `activo: false`: el tipo no sale en "¿Hoy entrenas?" hasta que se activa en Metas.
- `diaModeloDe`: si el tipo no tiene platos de día modelo propios, "Planear el día" usa los de ese otro tipo.
- `toleranciaKcal`: margen sobre la meta que todavía cuenta como ✅ (una sola tolerancia en barras, cierre y propuesta). Por defecto 30.

## alimentos

Valores por `base`: por 100 g (`"100g"`) o por unidad (`"unidad"`).

```json
{
  "id": "texto-unico",
  "nombre": "texto",
  "marca": "texto",
  "categoria": "proteina|lacteo|carbo|fruta|verdura|grasa|salsa|snack|suplemento|restaurante|bebida|otro",
  "base": "100g | unidad",
  "unidadNombre": "arepa",
  "gramosUnidad": 60,
  "kcal": 120, "p": 3, "g": 1, "c": 25,
  "estimado": false,
  "fuente": "etiqueta|tabla|guia|restaurante|estimado|usuario",
  "grasaVisible": false,
  "coccion": null,
  "genero": null,
  "restaurante": null,
  "ingredientes": null,
  "enCasa": false,
  "favorito": false,
  "libre": false,
  "origen": "plan|usuario",
  "editado": false,
  "notas": "texto"
}
```

- `coccion`: `{ "tipo": "carne|arroz", "estado": "crudo|cocido" }`. Carne: cocido = crudo × 0.75; crudo = cocido × 1.33. Arroz (y granos que se hinchan igual): cocido = crudo × 2.7. El usuario escribe lo que pesó y elige "crudo" o "ya cocido"; la app convierte al estado del alimento y siempre muestra los dos ("135 g ya cocida = 50 g cruda").
- `genero`: `"f"` o `"m"` para escribir "cocida/cocido". Sin él, la app lo deduce del nombre.
- `restaurante`: `{ "nombre": "texto", "recargo": "salteado|plancha|medido", "variante": "texto" }`. El recargo se aplica al registrar: `extraKcal = kcal × porcentaje`; se suma como grasa (`extraKcal / 9`). La proteína y los carbos no se inflan.
- `ingredientes`: lista opcional con el desglose de un plato medido (se ve en "Qué trae"): `[{ "nombre", "gramos", "kcal", "p", "g", "c" }]`.
- `libre: true`: verduras y salsas libres (0 en todo; se registran sin pesar).
- `grasaVisible: true`: aceites, mantequilla, mayonesa, aguacate, cremas de frutos secos, salsas cremosas. El recargo de restaurante también cuenta como grasa visible.
- `editado: true`: lo pone la app cuando el usuario corrige un alimento del plan.

## platos

Una combinación que se registra con un toque, escalable (½, 1, 1½).

```json
{
  "id": "texto-unico",
  "nombre": "texto",
  "momento": "desayuno|almuerzo|merienda|cena|cualquiera",
  "items": [ { "alimentoId": "id", "cantidad": 220, "unidad": "g|und", "estado": "crudo|cocido|null" } ],
  "totales": null,
  "incompleto": null,
  "incompletoBuscar": null,
  "estimado": false,
  "etiquetas": ["diaModelo", "entreno", "descanso", "restaurante"],
  "restaurante": null,
  "origen": "plan|usuario",
  "notas": "texto"
}
```

- Si `totales` existe (`{ "kcal", "p", "g", "c", "incluyeRecargo": true }`), el plato se registra con esos números y no con `items` (pedidos fijos de restaurante).
- `incompleto`: texto con el dato que falta. Al agregarlo, la app ofrece primero "Agregar lo que falta" (abre la búsqueda con `incompletoBuscar`) y después "Sumar sin el dato" (queda "con estimados").
- `estimado: true`: el día queda "con estimados" al registrarlo.
- "Planear el día" usa los platos con `diaModelo` y la etiqueta del tipo de día. "Cambiar" ofrece los demás platos de ese momento, incluidos los de restaurante.

## rutina

```json
{
  "nombre": "Rutina de ejemplo",
  "inicio": "AAAA-MM-DD (lunes de la semana 1)",
  "semanasTrabajo": 4,
  "semanaSuave": 5,
  "suave": { "series": { "5": 3, "4": 2, "3": 2, "2": 1, "1": 1 }, "rir": "4", "sinFallo": true, "sinSubir": true },
  "rotacion": ["S1", "S2", "S3"],
  "equipos": { "mancuernas": ["clave-de-progresion", "..."] },
  "ladoQueDecide": "der",
  "minutosRecorte": 75,
  "vecesRecorte": 2,
  "descansoEntreBloquesSeg": 90,
  "reglas": ["texto"],
  "palabras": [ { "palabra": "texto", "significa": "texto" } ],
  "sesiones": [
    {
      "id": "S1", "nombre": "Cuerpo completo 1", "tipo": "a", "duracionMin": 50,
      "duracionDesdeSemana": { "semana": 3, "min": 55 },
      "calentamiento": ["texto"],
      "recorte": "texto (qué se quita si la sesión pasa de minutosRecorte las vecesRecorte veces)",
      "bloques": [
        {
          "id": "S1-1", "tipo": "simple|superserie", "descansoSeg": 100,
          "ejercicios": [
            {
              "id": "texto-unico", "nombre": "texto", "clave": "clave-de-progresion",
              "series": 3, "repMin": 5, "repMax": 7, "rir": "1|1-2|2",
              "fallo": false, "unilateral": false, "unilateralTexto": null, "ladoQueDecide": null,
              "pesoInicial": 80, "pesoTexto": "texto", "porEncontrar": false,
              "pesoRegreso": 70, "pesoRegresoDesde": 80, "incremento": null, "volverAlAnterior": false,
              "pesoInicialDe": null, "pesoReferencia": null,
              "zona": "zona1|zona2|null", "registraRecorrido": false, "recorridos": [100, 80],
              "recorridoSiEmpeora": null, "empeoraPorManana": false,
              "seriesDesdeSemana": [ { "semana": 2, "series": 3, "condicion": "zona2-ok-2-sesiones", "texto": "texto" } ],
              "ajusteSesion": [ { "si": "sobranMas3|noLlegaMin|primeraNoLlegaMin", "accion": "sumar|restar|fijar", "kg": 5, "siKg": 80 } ],
              "noSubirSi": ["eventoZona1DesdeUltimaSesion", "dolorZona1Mas4"],
              "nota": "texto corto de técnica",
              "notaSiSeries": { "min": 4, "texto": "texto que solo vale si ese día toca ese número de series" }
            }
          ]
        }
      ]
    }
  ]
}
```

- `clave`: los ejercicios con la misma clave comparten historial y peso sugerido. Nunca se agrupa por nombre.
- `equipos`: claves que comparten los pesos que existen, porque son el mismo equipo (las mancuernas de un gimnasio, una barra). Para sugerir el peso siguiente, la app junta los pesos registrados de todas las claves del grupo, en ese gimnasio.
- `incremento: null` = la placa siguiente: la app sugiere el siguiente peso real que ya se registró en esa máquina o en ese equipo (también en el bloque anterior). **El salto de cada máquina no se supone:** si no conoce ninguno más arriba, la sugerencia dice "sube una placa" sin número y el usuario la pone con + y − o escribiéndola; si el peso conocido que sigue queda más de 10 % arriba, la sugerencia avisa que lo confirme en la máquina. Los botones + y − sí se mueven de 2.5 en 2.5 cuando no hay un peso conocido al lado: eso lo mueve la persona, no es una sugerencia.
- `volverAlAnterior: true`: si con este peso no llega al mínimo del rango, la próxima vez vuelve al peso conocido anterior (el par de mancuernas de antes), sin esperar dos sesiones.
- `unilateralTexto`: cómo se dice el rango en los ejercicios a un lado ("por pierna"); por defecto "por lado".
- `recorridoSiEmpeora`: el recorrido corto al que se va de una cuando la zona empeora (sin este dato, se baja un recorrido cada vez).
- `empeoraPorManana: true`: solo en los ejercicios que el plan condiciona a esa zona. En los demás, amanecer peor no frena la subida; solo cuenta el dolor por encima del umbral durante ese ejercicio.
- `seriesDesdeSemana[].texto` y `notaSiSeries`: textos del plan que la app muestra en la rutina completa y en el plan del día.
- `ladoQueDecide` (de la rutina o del ejercicio): en ejercicios a un lado, ese lado va primero y decide el peso y las repeticiones; el otro lado copia. Por defecto, el primero (`izq`).
- `minutosRecorte` y `vecesRecorte`: cuándo se muestra el `recorte` de una sesión. Sin ellos, no hay aviso.
- Doble progresión: sube lo mínimo cuando todas las series normales que pedía el plan ese día (guardadas al empezar en `seriesPlan`) llegan al tope al RIR indicado. Las series hechas con más peso que el de trabajo cuentan para completarlas.
- `pesoRegreso` solo se usa si no llegó al mínimo con el peso de `pesoRegresoDesde` (por defecto `pesoInicial`); si ya progresó, se repite el peso y baja 5–10 % después de dos sesiones seguidas.
- `ajusteSesion`: solo después de la primera serie normal. `fijar` solo desde `siKg` (por defecto `pesoInicial`) y solo en la dirección de la condición (sobran → sube; no llega → baja). `sumar` y `restar` solo la primera vez de ese ejercicio en ese gimnasio (con `kg: null`, una placa; si no se conoce ninguna, lo dice sin número). En la semana suave no se aplican los ajustes que suben el peso.
- "No llegar al mínimo" cuenta lo que le quedaba: si el plan pide quedar a 2 y la serie terminó quedando a 0, se descuentan esas 2 repeticiones (8 × quedando a 0 no es llegar a 8 quedando a 2). Vale para `ajusteSesion` y para la sugerencia de la próxima vez.
- `pesoInicialDe`: clave de otro ejercicio cuyo último peso de trabajo es el peso de partida.
- `pesoReferencia`: sin peso de partida, la app sugiere la placa conocida siguiente a ese peso; + y − parten de él.
- `noSubirSi`: `evento{Zona}DesdeUltimaSesion` (un registro de dolor fuera del gimnasio, con dolor o sin número, desde la última sesión) y `dolor{Zona}Mas{N}` (dolor de más de N en el ejercicio o en la mañana siguiente; si falta el dato de la mañana, no sube).

## registros

```json
{
  "dias": {
    "AAAA-MM-DD": {
      "tipo": "entreno|descanso|viaje|...",
      "comidas": [ { "id", "momento", "alimentoId", "platoId", "nombre", "cantidad", "unidad", "estado",
                     "recargo", "estimado", "kcal", "p", "g", "c", "gVisible", "hora", "planeado": false } ],
      "omega3": true,
      "notas": "texto",
      "resumen": null
    }
  },
  "sesiones": [
    { "id", "fecha", "sesionId": "S1", "nombre", "gimnasio", "inicio", "fin", "semanaBloque", "suave": false,
      "dolorAntes": { "zona1": 0 },
      "ejercicios": [ { "ejercicioId", "clave", "nombre", "seriesPlan": 3, "falloPlan": false,
                        "series": [ { "kg", "reps", "rir", "lado": "izq|der|null", "fallo": false,
                                      "tramos": [ { "kg", "reps": null } ], "tecnica": "normal|bajada|pausa|bombeo" } ],
                        "dolor": null, "recorrido": null, "alarmas": [], "nota": "" } ],
      "soloLectura": false, "notas": "" }
  ],
  "dolor": [ { "fecha", "hora", "zona", "momento": "manana|noche|antes|evento", "valor", "durmioSobre": null, "duracionMin": null, "actividad": "" } ],
  "pesos": [ { "fecha", "kg", "tipo": "casa|bio", "nota": "" } ],
  "medidas": [ { "fecha", "cintura", "cadera", "musloD", "musloI", "brazoDRel", "brazoIRel", "brazoDFuerza", "brazoIFuerza" } ],
  "cintura": [ { "fecha", "cm" } ],
  "fotos": [ { "fecha", "poses": ["frente", "perfil", "espalda", "brazosArriba"] } ],
  "bioimpedancias": [ { "fecha", "pesoMaquina", "pesoCasa", "grasaPct", "grasaKg", "masaLibreGrasa", "musculo", "agua", "visceral", "segmentos": {}, "condiciones": "" } ],
  "historialDias": [ { "fecha", "tipo", "kcal", "p", "g", "c", "nota": "" } ],
  "ultimaCopia": null
}
```

- `historialDias`: totales de días anteriores a la app (solo para promedios).
- Las sesiones importadas del bloque anterior van con `soloLectura: true`: no entran a las sugerencias de peso, pero sus pesos sí enseñan las placas reales de cada máquina.
- Una sesión cargada a mano (contada por la persona, no registrada en la app) va sin `soloLectura` para que cuente, con `inicio: null` y `fin` con solo la fecha (`"AAAA-MM-DD"`): así cuenta como terminada y la duración queda sin dato. Lo que no se sabe va vacío (`reps: null`, `dolor: null`, `seriesPlan: null`) y nunca inventado; con `seriesPlan: null` la app no sube el peso y dice que faltan datos de esa sesión. Un ejercicio que no se reportó va con `series: []` y una nota.
- `dias.*.resumen.cerrado`: el día se cerró. El día de hoy entra a los promedios de la semana solo cuando se cierra.
- Los respaldos de antes de restaurar una copia quedan dentro de la app (hasta 5) y se pueden deshacer durante una semana.
