# Plan de pruebas del Sprint 4

## 1. Alcance

El plan cubre las historias US-C2 (carga por planilla), US-C3 (lectura de boletas), US-E1 (búsqueda por lenguaje natural) y US-E2 (asistente conversacional), además de las pruebas funcionales, de humo, UAT y de carga comprometidas en el cronograma.

La verificación se realizó sobre la rama `feature/sprint4-ia-pruebas`. Las migraciones del Sprint 4 están en `supabase/migrations/` y requieren aplicación en el entorno remoto antes de ejecutar los casos que dependen de pgvector y del bucket privado. Las rutas de IA externa necesitan `OPENAI_API_KEY` (US-E1) y `VISION_API_KEY` (US-C3); sin esas claves las rutas responden en modo degradado o con un mensaje explícito de indisponibilidad.

## 2. Criterios de severidad

| Severidad | Definición | Ejemplo |
| --- | --- | --- |
| S1 Bloqueante | Impide el uso de la función o corrompe datos. | Un precio OCR se publica sin validación. |
| S2 Alta | La función opera pero entrega información incorrecta. | El asistente cita un precio de otra comuna. |
| S3 Media | Falla una validación o un mensaje, sin pérdida de datos. | El informe de errores omite el número de línea. |
| S4 Baja | Desviación visual o de redacción. | Etiqueta con contraste insuficiente. |

Criterio de salida: cero defectos S1 y S2; los S3 deben tener plan de corrección antes del cierre del Sprint 5.

## 3. Casos funcionales y de humo

| ID | Historia | Paso principal | Resultado esperado | Evidencia |
| --- | --- | --- | --- | --- |
| F-01 | US-C2 | Subir CSV con una fila inválida | Ninguna inserción; error con número de línea | `csv.test.ts`, 21 pruebas |
| F-02 | US-C2 | Subir CSV válido con oferta vigente | Precios en estado `pendiente` | `validacion_fechas.test.ts`, 19 pruebas |
| F-03 | US-C3 | Enviar imagen sin sesión | HTTP 401 | Smoke: `POST /api/ocr` → 401 |
| F-04 | US-C3 | Enviar imagen sin `VISION_API_KEY` | HTTP 503 con alternativa de carga manual | Revisión de la ruta; requiere repetir con clave |
| F-05 | US-C3 | JSON del modelo con cerca de código y montos chilenos | Ítems normalizados y precios numéricos | `ocr.test.ts`, 9 pruebas |
| F-06 | US-C3 | Confirmar boleta | Boleta y precios insertados en una transacción; `origen = ocr`, `validado = false` | `fn_confirmar_boleta_ocr` (migración) |
| F-07 | US-E1 | Buscar «arroz» | Productos ordenados por similitud; modo degradado señalado | Smoke: similitud máxima 0,5067 |
| F-08 | US-E1 | Buscar «algo para hacer cazuela» | Papas y productos de la canasta entre los primeros resultados | Smoke: Papas, similitud 0,1516 |
| F-09 | US-E1 | Consulta de menos de 2 caracteres | HTTP 400 | Revisión de la ruta |
| F-10 | US-E1 | Proveedor de embeddings caído | Vector léxico local y flag `degradado: true` | `embeddings.test.ts`, 8 pruebas |
| F-11 | US-E2 | Preguntar por precios vigentes | Respuesta con comercio, dirección y fecha de registro | `chat_contexto.test.ts`, 14 pruebas |
| F-12 | US-E2 | Solicitar datos fuera del observatorio | Respuesta acotada al ámbito comunal | Prompt institucional en `chat_contexto.ts` |
| F-13 | US-E2 | Abrir la PWA en móvil | Botón flotante accesible y panel de chat visible | Integración en `app/layout.tsx` |

## 4. Ejecución automatizada

| Comando | Resultado |
| --- | --- |
| `npx tsc --noEmit` | Correcto |
| `npm run lint` | Correcto |
| `npm test` | 153 pruebas en 12 archivos, todas aprobadas |
| `npm run build` | Compilación correcta, 33 rutas generadas |

## 5. Pruebas de carga

Se emitieron 20 solicitudes secuenciales a `/api/busqueda-semantica?q=arroz` contra el servidor de desarrollo local, en modo léxico y sin pgvector aplicado.

| Métrica | Valor |
| --- | --- |
| Mínimo | 0,321 s |
| Mediana | 0,339 s |
| p95 | 0,613 s |
| Máximo | 1,089 s |

El objetivo de 1,5 s de p95 se cumple en esta muestra. La medición no sustituye una prueba con dataset sintético comunal sobre el entorno desplegado; esa prueba queda pendiente de la migración de embeddings.

## 6. UAT

| Participante | Escenario | Criterio de aceptación |
| --- | --- | --- |
| Personal DIDESE | Revisar métricas y validar precios cargados | Los precios OCR aparecen primero en la bandeja pendiente. |
| Fiscalizadores | Fotografiar una boleta real y corregir un producto detectado | Ningún precio se guarda antes de la confirmación explícita. |
| Comercios | Cargar planilla semanal con 100 filas | El informe distingue filas aceptadas y rechazadas. |
| Vecinos | Buscar «verduras baratas» y conversar con el asistente | Las respuestas citan comercios de Pedro Aguirre Cerda y no inventan datos. |

La UAT con participantes reales no se ha ejecutado. El resultado de esta sección es el guion propuesto, no evidencia de ejecución.

## 7. Riesgos de testing

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Falta de claves de IA | No se puede verificar la precisión real de OCR ni embeddings | Pruebas unitarias con respuestas simuladas y modo degradado explícito. |
| Migraciones sin aplicar | Las RPC y el bucket no existen en remoto | Aplicar las tres migraciones antes de la UAT. |
| Modelo con alucinaciones | Precios inexistentes en la boleta | Revisión humana obligatoria e inserción como pendiente. |
| Latencia del proveedor externo | Supera el objetivo de 1,5 s | Timeout de 2,5 s en embeddings y caída al modo local. |
| Fuga de imágenes | Acceso a boletas de otro usuario | Bucket privado y políticas por carpeta de `auth.uid()`. |
