# INTEGRATION — scrum-files en el sistema de 4 repos

Cómo scrum-files se conecta con los otros tres repos del sistema autónomo TNS/OpenClaw.

---

## Flujo completo: GitHub issue → merge

```
1. PLANIFICACIÓN
   planning "OBJETIVO DEL SPRINT"
   import-github
   refine <id>
   select <N>

2. ROUTING Y ASIGNACIÓN
   route <id>        ← consulta skills-routing-registry.json → ownerAgent
   assign <id> [sessionId]

3. EJECUCIÓN (worker actúa en autonomous-workbench/worktrees/)
   start <id>
   pr-open <id> <url>

4. REVISIÓN DE CALIDAD
   qa-pass <id> [reviewUrl]
   # o
   qa-fail <id> "razón"

5. CIERRE (requiere acción humana para el merge)
   human-merge <id>
   complete <id>

6. FIN DE SPRINT
   review "nota"
   review-close
   retro "nota"
   next-sprint
```

---

## Estructura de sprint-state.json

`sprint-state.json` es el archivo central que todos los agentes leen.

```json
{
  "sprintId": "sprint-007",
  "goal": "Completar autenticación OAuth",
  "status": "active",
  "capacity": 8,
  "inProgress": [
    {
      "id": "ITEM-42",
      "title": "Implementar login con Google OAuth",
      "ownerAgent": "backend-dev",
      "workerSessionId": "backend-dev-issue-115",
      "status": "prOpen",
      "prUrl": "https://github.com/The-Next-Security/TNS_TRACK_DEMO/pull/87"
    }
  ],
  "completed": [],
  "blocked": [],
  "reviewNotes": [],
  "retroNotes": []
}
```

**`workerSessionId`** es el mecanismo de idempotencia: si Roy respawnea al mismo
worker para la misma historia, el sessionId permite continuar sin duplicar trabajo.

---

## Conexión con los 4 repos

### agents-files → scrum-files

`skills-routing-registry.json` en scrum-files determina el `ownerAgent` asignado
al hacer `route <id>`. El routing registry referencia las skills del catálogo de
`agents-files` (`ownerAgent`, `riskLevel`, `status`).

Roy lee agents-files para conocer las capacidades disponibles; lee scrum-files para
saber qué está comprometido en el sprint activo.

### autonomous-workbench → scrum-files

Roy opera desde `autonomous-workbench/worktrees/`. Lee y escribe `sprint-state.json`
usando los comandos del CLI. El workbench no modifica `sprint-state.json` directamente:
**siempre usa los comandos de sprint-manager.js**.

Los workers de Capa 2 trabajan en `autonomous-workbench/worktrees/<sessionId>/` y
reportan su avance a Roy, quien actualiza el estado con `pr-open`, `qa-pass`, etc.

### tns-openclaw-agents → scrum-files

La doctrina de Roy (en `tns-openclaw-agents/roy/`) incluye instrucciones sobre cómo
leer y usar sprint-manager.js. La doctrina de workers (backend-dev, frontend-dev,
qa-analyst) describe cómo reportar avance a Roy para que actualice el estado.

---

## Lo que scrum-files NO hace

- ❌ No ejecuta código ni hace spawn de workers
- ❌ No hace fetch en tiempo real de GitHub (solo en `import-github` bajo demanda)
- ❌ No gestiona credenciales ni tokens
- ❌ No publica en Telegram ni envía notificaciones
- ❌ No hace merge — `human-merge` solo registra que un humano lo hizo
- ❌ No reemplaza al sistema de issues de GitHub — es un espejo de estado Scrum

---

## Path hardcodeado

```
SCRUM_DIR = "/root/.openclaw/scrum"
SKILLS_DIR = "/root/.openclaw/skills"
```

Esta es la convención de instalación TNS. Los archivos deben estar en esa ruta
para que Roy pueda accederlos desde el corredor `autonomous-workbench`.
No es una limitación técnica — es una convención de deployment.
