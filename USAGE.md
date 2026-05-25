# USAGE — sprint-manager.js

Referencia completa de los 30 comandos del CLI Scrum de OpenClaw.

```bash
node sprint-manager.js <comando> [argumentos]
```

Los archivos de estado se leen y escriben en `/root/.openclaw/scrum/`.

---

## CICLO DE VIDA (14 comandos)

### `init`

```bash
node sprint-manager.js init
```

Inicializa la estructura de archivos de estado en `~/.openclaw/scrum/` si no existe.
Crea `sprint-state.json` y `team-state.json` con valores por defecto.
**Ejecutar una sola vez en instalación nueva.**

---

### `planning "SPRINT_GOAL"`

```bash
node sprint-manager.js planning "Completar autenticación OAuth y dashboard básico"
```

Establece el Sprint Goal del sprint activo. Escribe en `sprint-state.json` el objetivo
del sprint. Prerequisito antes de `import-github` y `select`.

---

### `import-github`

```bash
node sprint-manager.js import-github
```

Importa issues abiertos de los repos registrados en `repos-catalog.json` al backlog
local en `product-backlog.json`. Requiere `gh` CLI autenticado.

---

### `refine <ITEM_ID>`

```bash
node sprint-manager.js refine ITEM-42
```

Marca una historia como refinada en el backlog. Señal de que el PO y el equipo
revisaron los criterios de aceptación y la historia está lista para Sprint Planning.

---

### `select <N>`

```bash
node sprint-manager.js select 5
```

Mueve las primeras N historias refinadas del backlog al sprint activo
(`sprint-state.json` → `inProgress[]`). Roy ejecuta esto tras Sprint Planning.

---

### `route <ITEM_ID>`

```bash
node sprint-manager.js route ITEM-42
```

Consulta `skills-routing-registry.json` y asigna el `ownerAgent` correcto a la
historia según el tipo de tarea. Determina qué worker de Capa 2 debe implementarla.

---

### `assign <ITEM_ID> [sessionId]`

```bash
node sprint-manager.js assign ITEM-42
node sprint-manager.js assign ITEM-42 backend-dev-issue-115
```

Asigna la historia a un worker con un `workerSessionId` opcional (idempotencia).
Si no se provee sessionId, se genera automáticamente. Escribe en `sprint-state.json`.

---

### `start <ITEM_ID>`

```bash
node sprint-manager.js start ITEM-42
```

Marca la historia como iniciada (`status: inProgress`). El worker ya tomó el trabajo.

---

### `pr-open <ITEM_ID> <PR_URL>`

```bash
node sprint-manager.js pr-open ITEM-42 https://github.com/The-Next-Security/TNS_TRACK_DEMO/pull/87
```

Registra la URL del PR abierto para la historia. Cambia status a `prOpen`.

---

### `qa-pass <ITEM_ID> [REVIEW_URL]`

```bash
node sprint-manager.js qa-pass ITEM-42
node sprint-manager.js qa-pass ITEM-42 https://github.com/.../pull/87#pullrequestreview-12345
```

QA Analyst aprobó el PR. Cambia status a `qaPass`. `REVIEW_URL` es opcional.

---

### `qa-fail <ITEM_ID> "razón"`

```bash
node sprint-manager.js qa-fail ITEM-42 "Falta validación de input en formulario de login"
```

QA Analyst rechazó el PR. Cambia status a `qaFail` con la razón documentada.
El worker debe corregir y volver a abrir el PR.

---

### `human-merge <ITEM_ID>`

```bash
node sprint-manager.js human-merge ITEM-42
```

Registra que un humano realizó el merge del PR. Cambia status a `merged`.
El merge a dev/main/master siempre requiere acción humana — no se automatiza.

---

### `complete <ITEM_ID>`

```bash
node sprint-manager.js complete ITEM-42
```

Marca la historia como completada y DoD cumplida. La mueve de `inProgress[]`
a `completed[]` en `sprint-state.json`.

---

### `next-sprint`

```bash
node sprint-manager.js next-sprint
```

Cierra el sprint activo: mueve el estado a `sprint-history/`, incrementa el
contador de sprint e inicializa el siguiente. Ejecutar tras la Retrospectiva.

---

## ESTADO (5 comandos)

### `show`

```bash
node sprint-manager.js show
```

Muestra el estado completo del sprint activo: Sprint Goal, historias en progreso,
completadas, bloqueadas, velocity y capacidad del equipo.

---

### `show-backlog`

```bash
node sprint-manager.js show-backlog
```

Lista todas las historias del backlog con su estado de refinamiento y prioridad.

---

### `daily`

```bash
node sprint-manager.js daily
```

Genera el resumen del Daily: qué está en progreso, impedimentos activos y
burndown del sprint. Input para `tns-scrum-daily-standup`.

---

### `history`

```bash
node sprint-manager.js history
```

Lista todos los sprints archivados en `sprint-history/` con su ID y fecha de cierre.

---

### `history-detail <SPRINT_ID>`

```bash
node sprint-manager.js history-detail sprint-005
```

Muestra el detalle completo de un sprint archivado: historias completadas,
velocity, impedimentos y notas de Review y Retrospectiva.

---

## IMPEDIMENTOS (3 comandos)

### `block <ITEM_ID> "razón"`

```bash
node sprint-manager.js block ITEM-42 "Servicio externo de pagos caído, esperando respuesta del proveedor"
```

Registra un impedimento para una historia. Cambia status a `blocked` con razón
documentada. Roy notifica al SM para gestión del impedimento.

---

### `unblock <ITEM_ID>`

```bash
node sprint-manager.js unblock ITEM-42
```

Remueve el bloqueo de una historia. Vuelve al status anterior al bloqueo.

---

### `reconcile [--fix] [--dry-run]`

```bash
node sprint-manager.js reconcile --dry-run
node sprint-manager.js reconcile --fix
```

Sincroniza el estado local de `sprint-state.json` con el estado real de los issues
en GitHub. `--dry-run` muestra discrepancias sin modificar. `--fix` aplica los cambios.

---

## CEREMONIAS (3 comandos)

### `review "nota"`

```bash
node sprint-manager.js review "Sprint Goal alcanzado. 8/9 historias completadas. Historia ITEM-38 se mueve al siguiente sprint."
```

Registra una nota de Sprint Review en `sprint-state.json`.

---

### `review-close`

```bash
node sprint-manager.js review-close
```

Cierra el Sprint Review formalmente. Marca el sprint como listo para Retrospectiva.

---

### `retro "nota"`

```bash
node sprint-manager.js retro "Mejorar definición de criterios de aceptación en Grooming. Acción: QA valida criterios antes del Planning."
```

Registra una nota de Retrospectiva en `sprint-state.json`. Puede llamarse múltiples
veces para acumular acciones de mejora.

---

## GESTIÓN DE REPOS Y CONFIG (5 comandos)

### `add-repo <owner/repo>`

```bash
node sprint-manager.js add-repo The-Next-Security/TNS_TRACK_DEMO
```

Agrega un repo a `repos-catalog.json`. Los issues de ese repo estarán disponibles
para `import-github`.

---

### `list-repos`

```bash
node sprint-manager.js list-repos
```

Lista todos los repos registrados en `repos-catalog.json` con su prioridad.

---

### `remove-repo <owner/repo>`

```bash
node sprint-manager.js remove-repo The-Next-Security/OLD_REPO
```

Elimina un repo de `repos-catalog.json`. No elimina issues ya importados.

---

### `priority-update <owner/repo> <1|2|3> ["nota"]`

```bash
node sprint-manager.js priority-update The-Next-Security/TNS_TRACK_DEMO 1 "Repo principal del sprint Q2"
```

Actualiza la prioridad de un repo en `repos-catalog.json`. Prioridad 1 = alta,
2 = media, 3 = baja. Afecta el orden de `import-github`.

---

### `capacity-update <N>`

```bash
node sprint-manager.js capacity-update 8
```

Actualiza la capacidad del equipo en `team-state.json` (número de story points
disponibles para el sprint). Roy ejecuta esto al inicio de cada Sprint Planning.

---

## Flujo típico de una historia

```
planning "OBJETIVO"
import-github
refine ITEM-ID
select N
route ITEM-ID
assign ITEM-ID [sessionId]
start ITEM-ID
pr-open ITEM-ID URL
qa-pass ITEM-ID
human-merge ITEM-ID
complete ITEM-ID
```

Ver flujo completo con contexto inter-repo en [`INTEGRATION.md`](./INTEGRATION.md).
