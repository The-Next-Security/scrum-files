const fs = require("fs");

const SKILLS_DIR = "/root/.openclaw/skills";
const SCRUM_DIR = "/root/.openclaw/scrum";
const TEAM_STATE_FILE = `${SCRUM_DIR}/team-state.json`;
const SPRINT_STATE_FILE = `${SCRUM_DIR}/sprint-state.json`;
const PRODUCT_BACKLOG_FILE = `${SCRUM_DIR}/product-backlog.json`;

function listAgents(skillsDir) {
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found: ${skillsDir}`);
  }

  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function classifyAgents(agents) {
  const scrumMaster = agents.includes("scrum-master") ? "scrum-master" : null;
  const productOwner = agents.includes("product-owner") ? "product-owner" : null;

  const developmentTeam = agents.filter(
    (agent) => agent !== "scrum-master" && agent !== "product-owner"
  );

  return {
    scrumMaster,
    productOwner,
    developmentTeam,
  };
}

function buildTeamState(classification) {
  return {
    generatedAt: new Date().toISOString(),
    scrumMaster: classification.scrumMaster,
    productOwner: classification.productOwner,
    developmentTeam: classification.developmentTeam,
    teamSize: classification.developmentTeam.length,
    readiness: {
      scrumMasterReady: Boolean(classification.scrumMaster),
      productOwnerReady: Boolean(classification.productOwner),
      developmentTeamReady: classification.developmentTeam.length > 0,
    },
  };
}

function buildInitialSprintState(selectedBacklog) {
  return {
    generatedAt: new Date().toISOString(),
    sprintId: "sprint-001",
    sprintGoal: "Initialize autonomous Scrum orchestration in OpenClaw",
    status: "planning-complete",
    currentPhase: "ready-for-execution",
    backlog: selectedBacklog,
    inProgress: [],
    done: [],
    impediments: [],
    reviewNotes: [],
    retrospectiveNotes: []
  };
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`JSON file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function summarizeBacklog(backlogData) {
  if (!backlogData.items || !Array.isArray(backlogData.items)) {
    throw new Error("Invalid backlog format: 'items' array is missing");
  }

  const total = backlogData.items.length;
  const done = backlogData.items.filter(item => item.status === "done");
  const planned = backlogData.items.filter(item => item.status === "planned");
  const other = backlogData.items.filter(
    item => item.status !== "done" && item.status !== "planned"
  );

  return {
    total,
    done,
    planned,
    other
  };
}

function selectSprintBacklog(plannedItems) {
  return plannedItems
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map(item => ({
      id: item.id,
      title: item.title,
      priority: item.priority,
      status: "todo",
      assignedRole: item.assignedRole,
      sourceStatus: item.status
    }));
}

function initializeSprint() {
  const agents = listAgents(SKILLS_DIR);
  const classification = classifyAgents(agents);
  const teamState = buildTeamState(classification);
  const backlogData = readJson(PRODUCT_BACKLOG_FILE);
  const backlogSummary = summarizeBacklog(backlogData);
  const selectedSprintBacklog = selectSprintBacklog(backlogSummary.planned);
  const sprintState = buildInitialSprintState(selectedSprintBacklog);

  saveJson(TEAM_STATE_FILE, teamState);
  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log("=== OpenClaw Sprint Manager v9 ===");
  console.log(`Agents found: ${agents.length}`);
  console.log(`Sprint backlog items: ${selectedSprintBacklog.length}`);
  console.log(`Sprint state saved to: ${SPRINT_STATE_FILE}`);
}

function startItem(itemId) {
  const sprintState = readJson(SPRINT_STATE_FILE);

  const index = sprintState.backlog.findIndex(item => item.id === itemId);
  if (index === -1) {
    throw new Error(`Item not found in sprint backlog: ${itemId}`);
  }

  const item = sprintState.backlog[index];
  if (item.status === "blocked") {
    throw new Error(`Item is blocked and cannot be started: ${itemId}`);
  }

  const [moved] = sprintState.backlog.splice(index, 1);
  moved.status = "in-progress";
  moved.startedAt = new Date().toISOString();

  sprintState.inProgress.push(moved);
  sprintState.currentPhase = "execution";
  sprintState.status = "active";

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log(`Item moved to inProgress: ${moved.id}`);
  console.log(`Assigned role: ${moved.assignedRole}`);
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function completeItem(itemId) {
  const sprintState = readJson(SPRINT_STATE_FILE);

  const index = sprintState.inProgress.findIndex(item => item.id === itemId);
  if (index === -1) {
    throw new Error(`Item not found in inProgress: ${itemId}`);
  }

  const item = sprintState.inProgress[index];
  if (item.status === "blocked") {
    throw new Error(`Blocked item cannot be completed until unblocked: ${itemId}`);
  }

  const [moved] = sprintState.inProgress.splice(index, 1);
  moved.status = "done";
  moved.completedAt = new Date().toISOString();

  sprintState.done.push(moved);

  if (sprintState.inProgress.length === 0 && sprintState.backlog.length === 0) {
    sprintState.currentPhase = "review";
    sprintState.status = "ready-for-review";
  }

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log(`Item moved to done: ${moved.id}`);
  console.log(`Assigned role: ${moved.assignedRole}`);
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function blockItem(itemId, reason) {
  const sprintState = readJson(SPRINT_STATE_FILE);
  let item = sprintState.backlog.find(i => i.id === itemId);
  let location = "backlog";

  if (!item) {
    item = sprintState.inProgress.find(i => i.id === itemId);
    location = "inProgress";
  }

  if (!item) {
    throw new Error(`Item not found in backlog or inProgress: ${itemId}`);
  }

  item.status = "blocked";
  item.blockedAt = new Date().toISOString();

  const existing = sprintState.impediments.find(imp => imp.itemId === itemId);
  if (existing) {
    existing.reason = reason;
    existing.updatedAt = new Date().toISOString();
  } else {
    sprintState.impediments.push({
      itemId,
      reason,
      location,
      createdAt: new Date().toISOString()
    });
  }

  sprintState.status = "active";
  sprintState.currentPhase = "execution";

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log(`Item blocked: ${itemId}`);
  console.log(`Reason: ${reason}`);
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function unblockItem(itemId) {
  const sprintState = readJson(SPRINT_STATE_FILE);

  const backlogItem = sprintState.backlog.find(i => i.id === itemId);
  const progressItem = sprintState.inProgress.find(i => i.id === itemId);
  const item = backlogItem || progressItem;

  if (!item) {
    throw new Error(`Item not found in backlog or inProgress: ${itemId}`);
  }

  const impedimentIndex = sprintState.impediments.findIndex(imp => imp.itemId === itemId);
  if (impedimentIndex === -1) {
    throw new Error(`No impediment found for item: ${itemId}`);
  }

  sprintState.impediments.splice(impedimentIndex, 1);

  if (backlogItem) {
    backlogItem.status = "todo";
  } else if (progressItem) {
    progressItem.status = "in-progress";
  }

  item.unblockedAt = new Date().toISOString();

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log(`Item unblocked: ${itemId}`);
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function addReviewNote(note) {
  const sprintState = readJson(SPRINT_STATE_FILE);

  if (!Array.isArray(sprintState.reviewNotes)) {
    sprintState.reviewNotes = [];
  }

  sprintState.reviewNotes.push({
    note,
    createdAt: new Date().toISOString()
  });

  sprintState.currentPhase = "review";
  if (sprintState.status === "completed") {
    sprintState.status = "reviewed";
  }

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log("Review note added.");
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function addRetroNote(note) {
  const sprintState = readJson(SPRINT_STATE_FILE);

  if (!Array.isArray(sprintState.retrospectiveNotes)) {
    sprintState.retrospectiveNotes = [];
  }

  sprintState.retrospectiveNotes.push({
    note,
    createdAt: new Date().toISOString()
  });

  sprintState.currentPhase = "retrospective-complete";
  sprintState.status = "completed";

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log("Retrospective note added.");
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function showSprint() {
  const sprintState = readJson(SPRINT_STATE_FILE);

  console.log("=== Sprint State ===");
  console.log(`sprintId: ${sprintState.sprintId}`);
  console.log(`status: ${sprintState.status}`);
  console.log(`currentPhase: ${sprintState.currentPhase}`);
  console.log("");

  console.log(`backlog: ${sprintState.backlog.length}`);
  for (const item of sprintState.backlog) {
    console.log(`- ${item.id} | ${item.title} | ${item.status}`);
  }

  console.log("");
  console.log(`inProgress: ${sprintState.inProgress.length}`);
  for (const item of sprintState.inProgress) {
    console.log(`- ${item.id} | ${item.title} | ${item.status}`);
  }

  console.log("");
  console.log(`done: ${sprintState.done.length}`);
  for (const item of sprintState.done) {
    console.log(`- ${item.id} | ${item.title} | ${item.status}`);
  }

  console.log("");
  console.log(`impediments: ${sprintState.impediments.length}`);
  for (const imp of sprintState.impediments) {
    console.log(`- ${imp.itemId} | ${imp.reason} | location=${imp.location}`);
  }

  console.log("");
  console.log(`reviewNotes: ${sprintState.reviewNotes.length}`);
  for (const note of sprintState.reviewNotes) {
    console.log(`- ${note.createdAt} | ${note.note}`);
  }

  console.log("");
  console.log(`retrospectiveNotes: ${sprintState.retrospectiveNotes.length}`);
  for (const note of sprintState.retrospectiveNotes) {
    console.log(`- ${note.createdAt} | ${note.note}`);
  }
}

function dailySummary() {
  const sprintState = readJson(SPRINT_STATE_FILE);

  console.log("=== Daily Scrum Summary ===");
  console.log(`Sprint: ${sprintState.sprintId}`);
  console.log(`Goal: ${sprintState.sprintGoal}`);
  console.log(`Status: ${sprintState.status}`);
  console.log(`Phase: ${sprintState.currentPhase}`);
  console.log("");

  console.log(`Completed yesterday-equivalent: ${sprintState.done.length}`);
  for (const item of sprintState.done) {
    console.log(`- DONE | ${item.id} | ${item.title} | role=${item.assignedRole}`);
  }

  console.log("");
  console.log(`In progress today: ${sprintState.inProgress.length}`);
  for (const item of sprintState.inProgress) {
    console.log(`- IN-PROGRESS | ${item.id} | ${item.title} | role=${item.assignedRole}`);
  }

  console.log("");
  console.log(`Up next: ${sprintState.backlog.length}`);
  for (const item of sprintState.backlog) {
    console.log(`- TODO | ${item.id} | ${item.title} | role=${item.assignedRole} | status=${item.status}`);
  }

  console.log("");
  console.log(`Impediments: ${sprintState.impediments.length}`);
  for (const impediment of sprintState.impediments) {
    console.log(`- BLOCKED | ${impediment.itemId} | ${impediment.reason}`);
  }

  console.log("");
  if (sprintState.impediments.length > 0) {
    console.log("Suggested focus: resolve impediments before pulling more work.");
  } else if (sprintState.inProgress.length > 0) {
    console.log("Suggested focus: finish current in-progress work before starting new items.");
  } else if (sprintState.backlog.length > 0) {
    const nextItem = sprintState.backlog.find(i => i.status !== "blocked");
    if (nextItem) {
      console.log(`Suggested focus: start next highest-priority item -> ${nextItem.id} (${nextItem.title})`);
    } else {
      console.log("Suggested focus: all remaining backlog items are blocked.");
    }
  } else if (sprintState.status === "ready-for-review") {
    console.log("Suggested focus: conduct sprint review and retrospective.");
  } else {
    console.log("Suggested focus: sprint closed; prepare the next sprint.");
  }
}

function main() {
  const command = process.argv[2];

  if (!command || command === "init") {
    initializeSprint();
    return;
  }

  if (command === "start") {
    const itemId = process.argv[3];
    if (!itemId) {
      throw new Error("Usage: node sprint-manager.js start <ITEM_ID>");
    }
    startItem(itemId);
    return;
  }

  if (command === "complete") {
    const itemId = process.argv[3];
    if (!itemId) {
      throw new Error("Usage: node sprint-manager.js complete <ITEM_ID>");
    }
    completeItem(itemId);
    return;
  }

  if (command === "block") {
    const itemId = process.argv[3];
    const reason = process.argv.slice(4).join(" ").trim();
    if (!itemId || !reason) {
      throw new Error('Usage: node sprint-manager.js block <ITEM_ID> "reason"');
    }
    blockItem(itemId, reason);
    return;
  }

  if (command === "unblock") {
    const itemId = process.argv[3];
    if (!itemId) {
      throw new Error("Usage: node sprint-manager.js unblock <ITEM_ID>");
    }
    unblockItem(itemId);
    return;
  }

  if (command === "review") {
    const note = process.argv.slice(3).join(" ").trim();
    if (!note) {
      throw new Error('Usage: node sprint-manager.js review "note"');
    }
    addReviewNote(note);
    return;
  }

  if (command === "retro") {
    const note = process.argv.slice(3).join(" ").trim();
    if (!note) {
      throw new Error('Usage: node sprint-manager.js retro "note"');
    }
    addRetroNote(note);
    return;
  }

  if (command === "show") {
    showSprint();
    return;
  }

  if (command === "daily") {
    dailySummary();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
