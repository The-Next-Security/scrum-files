# ARCHITECTURE — scrum-files

Diagrama del sistema, estados de implementación y límites operativos.

---

## Diagrama del sistema completo

```
Felipe (humano)
  │
  ▼
Aníbal (Telegram — capa 0)
  │  recibe instrucciones de Felipe vía bot @asistente_tns_bot
  │
  ▼
Roy (autonomous-workbench — capa 1)
  │  lee y escribe usando sprint-manager.js
  │
  ▼
sprint-manager.js (scrum-files)
  ├── sprint-state.json         → qué está en progreso
  ├── product-backlog.json      → qué está pendiente
  ├── skills-routing-registry.json → quién hace qué
  ├── repos-catalog.json        → qué repos gestiona el sistema
  ├── team-state.json           → capacidad del equipo
  └── sprint-history/           → sprints archivados (001-006+)
        │
        ▼
  Workers Capa 2 (agents-files)
  backend-dev | frontend-dev | qa-analyst | ux-dev | git-expert | ...
  (actúan en autonomous-workbench/worktrees/)
```

---

## Estados de implementación

### IMPLEMENTADO ✅

- Los 30 comandos de `sprint-manager.js` (CLI funcional, 1760 líneas)
- Los 6 archivos JSON de estado (`sprint-state.json`, `product-backlog.json`,
  `team-state.json`, `repos-catalog.json`, `skills-routing-registry.json` + history)
- Archivado automático de sprints en `sprint-history/`
- Idempotencia via `workerSessionId` en `assign`
- Sincronización con GitHub en `import-github` y `reconcile`
- Routing de issues a workers via `skills-routing-registry.json`

### DOCUMENTADO 📄

- Patrón `workerSessionId` para continuidad de sesiones de workers
- Ciclo de vida completo de items: backlog → inProgress → prOpen → qaPass → merged → completed
- Matriz de routing skill → ownerAgent → worker de Capa 2
- Flujo Scrum completo mapeado a comandos CLI

### COMPORTAMIENTO ESPERADO 🎯

- Roy lee `sprint-state.json` al inicio de cada sesión para conocer el contexto
- Roy ejecuta los comandos del CLI como parte natural del flujo Scrum
- Los workers de Capa 2 reportan PR URLs y QA status a Roy
- Roy actualiza el estado después de cada evento significativo

### FUERA DE SCOPE ❌

- Ejecución de código de aplicación
- Spawn directo de workers (eso es rol de autonomous-workbench/agent-dispatch)
- Notificaciones a Telegram (eso es rol de autonomous-workbench/infra/lib)
- Gestión de credenciales o secretos
- Deploy a producción
- Webhook handler (eso es autonomous-workbench/infra/webhooks/)

---

## Archivos de estado: responsabilidades

| Archivo | Qué contiene | Quién lo modifica |
|---------|-------------|-------------------|
| `sprint-state.json` | Estado del sprint activo en tiempo real | Roy via sprint-manager.js |
| `product-backlog.json` | Todas las historias del producto | Roy via `import-github`, `refine` |
| `team-state.json` | Capacidad del equipo, asignaciones | Roy via `capacity-update`, `assign` |
| `repos-catalog.json` | Repos GitHub bajo gestión del sistema | Roy via `add-repo`, `remove-repo` |
| `skills-routing-registry.json` | Matriz skill → ownerAgent → riskLevel | Felipe (manualmente, solo en actualización de skills) |
| `sprint-history/` | Sprints completados (inmutables) | sprint-manager.js via `next-sprint` |

---

## Convenciones

- **IDs de historias**: formato `ITEM-<número>` (e.g., `ITEM-42`)
- **IDs de sprint**: formato `sprint-<NNN>` (e.g., `sprint-007`)
- **workerSessionId**: formato `<ownerAgent>-issue-<número>` (e.g., `backend-dev-issue-115`)
- **Prioridades de repo**: 1 = alta, 2 = media, 3 = baja
