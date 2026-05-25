# scrum-files — Motor Scrum de OpenClaw

Motor de estado Scrum del sistema autónomo TNS/OpenClaw. Contiene el CLI
`sprint-manager.js` (30 comandos), los archivos JSON de estado del sprint y
el histórico de sprints completados.

**scrum-files es el estado — no el corredor de ejecución.** No ejecuta código,
no gestiona credenciales y no hace llamadas en tiempo real. Roy (autonomous-workbench)
lee y escribe este estado usando los comandos del CLI.

---

## Los 4 repos del sistema

| Repo | Rol | Punto de entrada |
|------|-----|-----------------|
| **agents-files** | Catálogo de skills — source of truth de capacidades | `README.md` → directorio de skills |
| **scrum-files** | Motor Scrum — estado del sprint y CLI de ciclo de vida | este README + `USAGE.md` |
| **autonomous-workbench** | Corredor de ejecución — Roy y workers actúan aquí | `FACTORY-OVERVIEW.md` |
| **tns-openclaw-agents** | Doctrina de agentes — identidad y reglas de Aníbal, Roy y workers | `README.md` |

---

## Estructura del repo

```
scrum-files/
├── sprint-manager.js            # CLI de 30 comandos, 1760 líneas
├── sprint-state.json            # Estado en tiempo real del sprint activo
├── team-state.json              # Capacidad y asignaciones del equipo
├── product-backlog.json         # Backlog global del producto
├── repos-catalog.json           # Repos GitHub que el sistema gestiona
├── skills-routing-registry.json # Qué skill y qué agente atiende cada tipo de tarea
└── sprint-history/              # Sprints completados (sprint-001 a sprint-006 y más)
```

### Archivos `.bak`

El directorio contiene múltiples archivos `.bak` (artefactos de desarrollo y
recuperación). **No forman parte de la instalación.** Al instalar en un servidor
nuevo, copiar solo los archivos listados arriba.

---

## Prerrequisitos

- Node.js (cualquier versión LTS >= 16)
- Acceso de lectura/escritura a `~/.openclaw/scrum/`

---

## Instalación

```bash
cp sprint-manager.js ~/.openclaw/scrum/
cp sprint-state.json ~/.openclaw/scrum/
cp team-state.json ~/.openclaw/scrum/
cp product-backlog.json ~/.openclaw/scrum/
cp repos-catalog.json ~/.openclaw/scrum/
cp skills-routing-registry.json ~/.openclaw/scrum/
```

El path de instalación está hardcodeado en `sprint-manager.js`:

```
SCRUM_DIR = "/root/.openclaw/scrum"
SKILLS_DIR = "/root/.openclaw/skills"
```

Esta es una convención de instalación TNS, no una limitación técnica del CLI.

---

## Uso básico

```bash
# Ver estado del sprint activo
node sprint-manager.js show

# Ver backlog completo
node sprint-manager.js show-backlog

# Iniciar un nuevo sprint
node sprint-manager.js planning "OBJETIVO DEL SPRINT"
```

Ver referencia completa de los 30 comandos en [`USAGE.md`](./USAGE.md).

---

## Documentación

- [`USAGE.md`](./USAGE.md) — Referencia de los 30 comandos con sintaxis, descripción y ejemplos
- [`INTEGRATION.md`](./INTEGRATION.md) — Flujo completo historia→merge y conexión entre los 4 repos
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Diagrama del sistema, estados implementados y fuera de scope
