const fs = require("fs");

const SKILLS_DIR = "/root/.openclaw/skills";
const SCRUM_DIR = "/root/.openclaw/scrum";
const TEAM_STATE_FILE = `${SCRUM_DIR}/team-state.json`;
const SPRINT_STATE_FILE = `${SCRUM_DIR}/sprint-state.json`;
const PRODUCT_BACKLOG_FILE = `${SCRUM_DIR}/product-backlog.json`;
const REPOS_CATALOG_FILE = `${SCRUM_DIR}/repos-catalog.json`;
const JOBS_FILE = "/root/.openclaw/cron/jobs.json";

const SEVERITY_LABELS = [
  "severity: blocker",
  "severity: major",
  "severity: minor",
  "severity: cosmetic"
];

const SEVERITY_ORDER = {
  "severity: blocker": 1,
  "severity: major":   2,
  "severity: minor":   3,
  "severity: cosmetic": 4
};

const EXCLUDED_REPOS = [
  "The-Next-Security/autonomous-workbench",
  "The-Next-Security/scrum-files",
  "The-Next-Security/tns-openclaw-agents",
  "The-Next-Security/agents-files"
];

const SCRUM_LABELS = {
  imported: "scrum:imported",
  planned: "scrum:planned",
  "in-sprint": "scrum:in-sprint",
  "in-progress": "scrum:in-progress",
  blocked: "scrum:blocked",
  done: "scrum:done"
};

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

function selectSprintBacklog(plannedItems, limit) {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : plannedItems.length;

  return plannedItems
    .slice()
    .map((item, index) => ({
      originalIndex: index,
      item
    }))
    .sort((a, b) => {
      // Primary: severity (blocker=1 > major=2 > minor=3 > cosmetic=4 > none=5)
      const sevA = a.item.severity ? (SEVERITY_ORDER[a.item.severity] || 5) : 5;
      const sevB = b.item.severity ? (SEVERITY_ORDER[b.item.severity] || 5) : 5;
      if (sevA !== sevB) return sevA - sevB;

      // Secondary: bugs before stories within same severity
      const aType = typeof a.item.type === "string" ? a.item.type.toLowerCase() : "story";
      const bType = typeof b.item.type === "string" ? b.item.type.toLowerCase() : "story";
      const aBugRank = aType === "bug" ? 0 : 1;
      const bBugRank = bType === "bug" ? 0 : 1;
      if (aBugRank !== bBugRank) return aBugRank - bBugRank;

      // Tertiary: lower priority number = higher priority (older issues first)
      const aPriority = Number.isFinite(a.item.priority) ? a.item.priority : Number.MAX_SAFE_INTEGER;
      const bPriority = Number.isFinite(b.item.priority) ? b.item.priority : Number.MAX_SAFE_INTEGER;
      if (aPriority !== bPriority) return aPriority - bPriority;

      return a.originalIndex - b.originalIndex;
    })
    .slice(0, normalizedLimit)
    .map(({ item }) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      priority: item.priority,
      status: "in-sprint",
      assignedRole: item.assignedRole,
      sourceStatus: item.status
    }));
}

function selectPlannedItemsIntoActiveSprint(limit) {
  const backlogData = readJson(PRODUCT_BACKLOG_FILE);
  const backlogSummary = summarizeBacklog(backlogData);
  const sprintState = readJson(SPRINT_STATE_FILE);

  const backlogItems = Array.isArray(sprintState.backlog) ? sprintState.backlog : [];
  const inProgressItems = Array.isArray(sprintState.inProgress) ? sprintState.inProgress : [];
  const doneItems = Array.isArray(sprintState.done) ? sprintState.done : [];

  const existingIds = new Set(
    []
      .concat(backlogItems)
      .concat(inProgressItems)
      .concat(doneItems)
      .map(item => item.id)
  );

  const usedCapacity = backlogItems.length + inProgressItems.length;
  const availableCapacity = Math.max(0, limit - usedCapacity);

  if (availableCapacity === 0) {
    console.log(`No items selected: sprint is already at full capacity (${usedCapacity}/${limit})`);
    return;
  }

  const eligibleItems = backlogSummary.planned.filter(item => !existingIds.has(item.id));
  const selectedItems = selectSprintBacklog(eligibleItems, availableCapacity);

  console.log(`Eligible planned items: ${eligibleItems.length}`);
  console.log(`Capacity used: ${usedCapacity}/${limit}`);

  if (selectedItems.length === 0) {
    console.log("No eligible planned items found to load into sprint backlog");
    return;
  }

  if (!Array.isArray(sprintState.backlog)) {
    sprintState.backlog = [];
  }

  sprintState.backlog.push(...selectedItems);

  const selectedIds = new Set(selectedItems.map(item => item.id));

  if (Array.isArray(backlogData.items)) {
    for (const backlogItem of backlogData.items) {
      if (selectedIds.has(backlogItem.id)) {
        backlogItem.status = "in-sprint";
        backlogItem.sprintId = sprintState.sprintId;

        try {
          writeBackGitHubIssueEvent(backlogItem, "select", sprintState.sprintId);
        } catch (error) {
          console.log(`GitHub write-back failed for select ${backlogItem.id}: ${error.message}`);
        }
      }
    }
    saveJson(PRODUCT_BACKLOG_FILE, backlogData);
  }

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log(`Planned items loaded into sprint backlog: ${selectedItems.length}`);
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function initializeSprint() {
  const agents = listAgents(SKILLS_DIR);  const classification = classifyAgents(agents);
  const teamState = buildTeamState(classification);
  const backlogData = readJson(PRODUCT_BACKLOG_FILE);
  const backlogSummary = summarizeBacklog(backlogData);
  const selectedSprintBacklog = selectSprintBacklog(backlogSummary.planned);
  const sprintState = buildInitialSprintState(selectedSprintBacklog);

  const selectedIds = new Set(selectedSprintBacklog.map(item => item.id));

  if (Array.isArray(backlogData.items)) {
    for (const backlogItem of backlogData.items) {
      if (selectedIds.has(backlogItem.id)) {
        backlogItem.status = "in-sprint";
        backlogItem.sprintId = sprintState.sprintId;
      }
    }
    saveJson(PRODUCT_BACKLOG_FILE, backlogData);
  }

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
  if (item.status !== "in-sprint" && item.status !== "blocked") {
    throw new Error(`Only in-sprint items can be started from sprint backlog: ${itemId} (current: ${item.status})`);
  }
  if (item.status === "blocked") {
    throw new Error(`Item is blocked and cannot be started: ${itemId}`);
  }

  const [moved] = sprintState.backlog.splice(index, 1);
  moved.status = "in-progress";
  moved.startedAt = new Date().toISOString();

  sprintState.inProgress.push(moved);
  sprintState.currentPhase = "execution";
  sprintState.status = "active";

  const productBacklog = readJson(PRODUCT_BACKLOG_FILE);
  const backlogItem = Array.isArray(productBacklog.items)
    ? productBacklog.items.find(i => i.id === itemId)
    : null;

  if (backlogItem) {
    backlogItem.status = "in-progress";
    backlogItem.startedAt = moved.startedAt;
    saveJson(PRODUCT_BACKLOG_FILE, productBacklog);
    writeBackGitHubIssueEvent(backlogItem, "start", sprintState.sprintId);
    console.log(`Product backlog synced: ${itemId} -> in-progress`);
  } else {
    console.log(`Product backlog item not found, sync skipped: ${itemId}`);
  }

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
  if (item.humanMergeStatus && item.humanMergeStatus !== "merged") {
    console.log(`WARNING: completing item where humanMergeStatus=${item.humanMergeStatus}. Run human-merge first for full pipeline tracking.`);
  }

  const [moved] = sprintState.inProgress.splice(index, 1);
  moved.status = "done";
  moved.completedAt = new Date().toISOString();

  sprintState.done.push(moved);

  const productBacklog = readJson(PRODUCT_BACKLOG_FILE);
  const backlogItem = Array.isArray(productBacklog.items)
    ? productBacklog.items.find(i => i.id === itemId)
    : null;

  if (backlogItem) {
    backlogItem.status = "done";
    backlogItem.completedAt = moved.completedAt;
    saveJson(PRODUCT_BACKLOG_FILE, productBacklog);
    writeBackGitHubIssueEvent(backlogItem, "complete", sprintState.sprintId);
    console.log(`Product backlog synced: ${itemId} -> done`);
  } else {
    console.log(`Product backlog item not found, sync skipped: ${itemId}`);
  }

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

  if (item.status === "blocked") {
    throw new Error(`Item is already blocked: ${itemId}`);
  }

  item.previousStatus = item.status;
  item.status = "blocked";
  item.blockedAt = new Date().toISOString();

  const existing = sprintState.impediments.find(imp => imp.itemId === itemId);
  if (existing) {
    existing.reason = reason;
    existing.location = location;
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

  const productBacklog = readJson(PRODUCT_BACKLOG_FILE);
  const backlogItem = Array.isArray(productBacklog.items)
    ? productBacklog.items.find(i => i.id === itemId)
    : null;

  if (backlogItem) {
    backlogItem.previousStatus = backlogItem.status;
    backlogItem.status = "blocked";
    backlogItem.blockedAt = item.blockedAt;
    saveJson(PRODUCT_BACKLOG_FILE, productBacklog);

    try {
      writeBackGitHubIssueEvent(backlogItem, "block", sprintState.sprintId, { reason });
    } catch (error) {
      console.log(`GitHub write-back failed for block ${itemId}: ${error.message}`);
    }

    console.log(`Product backlog synced: ${itemId} -> blocked`);
  } else {
    console.log(`Product backlog item not found, sync skipped: ${itemId}`);
  }

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

  const [resolved] = sprintState.impediments.splice(impedimentIndex, 1);
  resolved.resolvedAt = new Date().toISOString();
  if (!sprintState.impedimentHistory) sprintState.impedimentHistory = [];
  sprintState.impedimentHistory.push(resolved);

  const restoredStatus = item.previousStatus || (backlogItem ? "in-sprint" : "in-progress");
  item.status = restoredStatus;
  item.unblockedAt = new Date().toISOString();
  delete item.previousStatus;

  const productBacklog = readJson(PRODUCT_BACKLOG_FILE);
  const productItem = Array.isArray(productBacklog.items)
    ? productBacklog.items.find(i => i.id === itemId)
    : null;

  if (productItem) {
    const productRestoredStatus = productItem.previousStatus || restoredStatus;
    productItem.status = productRestoredStatus;
    productItem.unblockedAt = item.unblockedAt;
    delete productItem.previousStatus;
    saveJson(PRODUCT_BACKLOG_FILE, productBacklog);

    try {
      writeBackGitHubIssueEvent(productItem, "unblock", sprintState.sprintId, { restoredStatus: productRestoredStatus });
    } catch (error) {
      console.log(`GitHub write-back failed for unblock ${itemId}: ${error.message}`);
    }

    console.log(`Product backlog synced: ${itemId} -> ${productRestoredStatus}`);
  } else {
    console.log(`Product backlog item not found, sync skipped: ${itemId}`);
  }

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log(`Item unblocked: ${itemId}`);
  console.log(`Restored status: ${restoredStatus}`);
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}


function closeReview() {
  const sprintState = readJson(SPRINT_STATE_FILE);

  if (sprintState.inProgress.length > 0 || sprintState.backlog.length > 0) {
    throw new Error("Cannot close review while backlog or inProgress still has items");
  }

  sprintState.currentPhase = "retrospective";
  sprintState.status = "reviewed";

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log("Review closed.");
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


function setSprintPlanning(goal) {
  if (!goal || !goal.trim()) {
    throw new Error('Usage: node sprint-manager.js planning "SPRINT_GOAL"');
  }

  const sprintState = readJson(SPRINT_STATE_FILE);

  sprintState.sprintGoal = goal.trim();
  sprintState.status = "planned";
  sprintState.currentPhase = "planning";
  sprintState.generatedAt = new Date().toISOString();

  saveJson(SPRINT_STATE_FILE, sprintState);

  console.log("Sprint planning updated.");
  console.log(`Sprint goal: ${sprintState.sprintGoal}`);
  console.log(`Sprint state updated: ${SPRINT_STATE_FILE}`);
}

function showSprint() {
  const sprintState = readJson(SPRINT_STATE_FILE);

  console.log("=== Sprint State ===");
  console.log(`sprintId: ${sprintState.sprintId}`);
  console.log(`sprintGoal: ${sprintState.sprintGoal || ""}`);
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
    showPipelineFields(item);
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


function resolveGitHubRepoFromOrigin() {
  const execSync = require("child_process").execSync;

  let remoteUrl;
  try {
    remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
  } catch (err) {
    throw new Error("Failed to resolve git origin remote");
  }

  const match = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Unsupported GitHub origin URL: ${remoteUrl}`);
  }

  return match[1];
}

function escapeShellArg(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function assertGitHubIssueRepoMatchesWorkspace(backlogItem) {
  if (!backlogItem || backlogItem.source !== "github-issue") {
    return null;
  }
  return backlogItem.repo || null;
}

function listScrumLabelsForIssue(repo, issueNumber) {
  const execSync = require("child_process").execSync;
  const raw = execSync(
    `gh issue view ${issueNumber} --repo ${repo} --json labels`,
    { encoding: "utf-8" }
  );

  const parsed = JSON.parse(raw);
  const labels = Array.isArray(parsed.labels) ? parsed.labels.map(label => label.name) : [];
  return labels.filter(name => typeof name === "string" && name.startsWith("scrum:"));
}

function syncGitHubIssueScrumLabel(backlogItem, nextStatus) {
  const repo = assertGitHubIssueRepoMatchesWorkspace(backlogItem);
  if (!repo) {
    return;
  }

  const execSync = require("child_process").execSync;
  const issueNumber = backlogItem.issueNumber;
  const nextLabel = SCRUM_LABELS[nextStatus];

  if (!nextLabel) {
    throw new Error(`No Scrum label configured for status: ${nextStatus}`);
  }

  const currentScrumLabels = listScrumLabelsForIssue(repo, issueNumber);

  for (const label of currentScrumLabels) {
    if (label !== nextLabel) {
      execSync(
        `gh issue edit ${issueNumber} --repo ${repo} --remove-label ${escapeShellArg(label)}`,
        { stdio: "ignore" }
      );
    }
  }

  if (!currentScrumLabels.includes(nextLabel)) {
    execSync(
      `gh issue edit ${issueNumber} --repo ${repo} --add-label ${escapeShellArg(nextLabel)}`,
      { stdio: "ignore" }
    );
  }
}

function writeBackGitHubIssueEvent(backlogItem, action, sprintId, metadata = {}) {
  const repo = assertGitHubIssueRepoMatchesWorkspace(backlogItem);
  if (!repo) {
    return;
  }

  const execSync = require("child_process").execSync;
  const issueNumber = backlogItem.issueNumber;

  let body = null;
  let nextStatus = null;
  let shouldCloseIssue = false;

  if (action === "refine") {
    nextStatus = "planned";
    body = `OpenClaw update: item ${backlogItem.id} refined to planned.`;
  } else if (action === "select") {
    nextStatus = "in-sprint";
    body = `OpenClaw update: item ${backlogItem.id} selected into ${sprintId}.`;
  } else if (action === "start") {
    nextStatus = "in-progress";
    body = `OpenClaw update: item ${backlogItem.id} moved to in-progress in ${sprintId}.`;
  } else if (action === "block") {
    nextStatus = "blocked";
    const reasonSuffix = metadata.reason ? ` Reason: ${metadata.reason}` : "";
    body = `OpenClaw update: item ${backlogItem.id} blocked in ${sprintId}.${reasonSuffix}`;
  } else if (action === "unblock") {
    nextStatus = metadata.restoredStatus || backlogItem.status;
    body = `OpenClaw update: item ${backlogItem.id} unblocked in ${sprintId}; restored to ${nextStatus}.`;
  } else if (action === "complete") {
    nextStatus = "done";
    body = `OpenClaw update: item ${backlogItem.id} completed in ${sprintId}.`;
    shouldCloseIssue = true;
  } else {
    throw new Error(`Unsupported GitHub write-back action: ${action}`);
  }

  if (body) {
    execSync(
      `gh issue comment ${issueNumber} --repo ${repo} --body ${escapeShellArg(body)}`,
      { stdio: "ignore" }
    );
  }

  if (nextStatus) {
    syncGitHubIssueScrumLabel(backlogItem, nextStatus);
  }

  if (shouldCloseIssue) {
    execSync(
      `gh issue close ${issueNumber} --repo ${repo} --comment ${escapeShellArg("Closed automatically by OpenClaw after completion.")}`,
      { stdio: "ignore" }
    );
  }
}

function getExpectedScrumLabelForStatus(status) {
  return SCRUM_LABELS[status] || null;
}

function reconcileGitHubScrumMirror(options = {}) {
  const fix = options.fix || false;
  const dryRun = options.dryRun || false;
  const backlog = readJson(PRODUCT_BACKLOG_FILE);
  const items = Array.isArray(backlog.items) ? backlog.items : [];

  const githubItems = items.filter(item => item && item.source === "github-issue");

  if (githubItems.length === 0) {
    console.log("[INFO] No GitHub-backed items found in product backlog");
    return;
  }

  let ok = 0;
  let missing = 0;
  let multiple = 0;
  let mismatch = 0;
  let skipped = 0;
  let fixed = 0;
  let fixFailed = 0;

  console.log(`=== GITHUB SCRUM RECONCILE${fix ? " --fix" : ""} ===`);

  for (const item of githubItems) {
    if (item.state === "closed" || item.closed === true) {
      console.log(`SKIP | ${item.id} | reason=issue_closed`);
      skipped += 1;
      continue;
    }

    const expectedLabel = getExpectedScrumLabelForStatus(item.status);

    if (!expectedLabel) {
      console.log(`SKIP | ${item.id} | status=${item.status} | reason=no expected scrum label`);
      skipped += 1;
      continue;
    }

    let repo;
    try {
      repo = assertGitHubIssueRepoMatchesWorkspace(item);
    } catch (error) {
      console.log(`SKIP | ${item.id} | status=${item.status} | reason=${error.message}`);
      skipped += 1;
      continue;
    }

    try {
      const scrumLabels = listScrumLabelsForIssue(repo, item.issueNumber);

      if (scrumLabels.length === 0) {
        console.log(`MISSING_LABEL | ${item.id} | status=${item.status} | expected=${expectedLabel} | actual=[]`);
        missing += 1;

        if (fix) {
          try {
            if (dryRun) {
              console.log(`DRY_RUN_FIX | ${item.id} | would_sync_label | status=${item.status}`);
            } else {
              syncGitHubIssueScrumLabel(item, item.status);
              console.log(`FIXED | ${item.id} | action=apply_expected_label | label=${expectedLabel}`);
              fixed += 1;
            }
          } catch (fixError) {
            console.log(`FIX_FAILED | ${item.id} | action=apply_expected_label | reason=${fixError.message}`);
            fixFailed += 1;
          }
        }

        continue;
      }

      if (scrumLabels.length > 1) {
        console.log(`MULTIPLE_SCRUM_LABELS | ${item.id} | status=${item.status} | expected=${expectedLabel} | actual=${scrumLabels.join(",")}`);
        multiple += 1;

        if (fix) {
          try {
            if (dryRun) {
              console.log(`DRY_RUN_FIX | ${item.id} | would_sync_label | status=${item.status}`);
            } else {
              syncGitHubIssueScrumLabel(item, item.status);
              console.log(`FIXED | ${item.id} | action=normalize_single_scrum_label | label=${expectedLabel}`);
              fixed += 1;
            }
          } catch (fixError) {
            console.log(`FIX_FAILED | ${item.id} | action=normalize_single_scrum_label | reason=${fixError.message}`);
            fixFailed += 1;
          }
        }

        continue;
      }

      const actualLabel = scrumLabels[0];

      if (actualLabel !== expectedLabel) {
        console.log(`MISMATCH | ${item.id} | status=${item.status} | expected=${expectedLabel} | actual=${actualLabel}`);
        mismatch += 1;

        if (fix) {
          try {
            if (dryRun) {
              console.log(`DRY_RUN_FIX | ${item.id} | would_sync_label | status=${item.status}`);
            } else {
              syncGitHubIssueScrumLabel(item, item.status);
              console.log(`FIXED | ${item.id} | action=replace_scrum_label | from=${actualLabel} | to=${expectedLabel}`);
              fixed += 1;
            }
          } catch (fixError) {
            console.log(`FIX_FAILED | ${item.id} | action=replace_scrum_label | reason=${fixError.message}`);
            fixFailed += 1;
          }
        }

        continue;
      }

      console.log(`OK | ${item.id} | status=${item.status} | label=${actualLabel}`);
      ok += 1;
    } catch (error) {
      console.log(`SKIP | ${item.id} | status=${item.status} | reason=${error.message}`);
      skipped += 1;
    }
  }

  console.log("");
  console.log("=== RECONCILE SUMMARY ===");
  console.log(`ok=${ok}`);
  console.log(`missing=${missing}`);
  console.log(`multiple=${multiple}`);
  console.log(`mismatch=${mismatch}`);
  console.log(`skipped=${skipped}`);

  if (fix) {
    console.log(`fixed=${fixed}`);
    console.log(`fixFailed=${fixFailed}`);
  }
}
    
function getSeverityLabel(labels) {
  if (!Array.isArray(labels)) return null;
  for (const sl of SEVERITY_LABELS) {
    if (labels.includes(sl)) return sl;
  }
  return null;
}

function ensureSeverityLabels(repo) {
  const execSync = require("child_process").execSync;
  const defs = [
    { name: "severity: blocker",  color: "B60205", desc: "Blocks all progress, no workaround" },
    { name: "severity: major",    color: "E4E669", desc: "Significant issue, workaround exists but costly" },
    { name: "severity: minor",    color: "0075CA", desc: "Low impact, does not block daily work" },
    { name: "severity: cosmetic", color: "0E8A16", desc: "Visual or UX issue, no functional impact" }
  ];
  for (const def of defs) {
    try {
      execSync(
        `gh label create ${escapeShellArg(def.name)} --repo ${repo} --color ${escapeShellArg(def.color)} --description ${escapeShellArg(def.desc)} --force`,
        { encoding: "utf-8", stdio: "pipe" }
      );
      console.log(`  Label ensured: ${def.name}`);
    } catch (err) {
      console.log(`  Label warning (${def.name}): ${String(err.message).slice(0, 120)}`);
    }
  }
}

function readCatalog() {
  if (!fs.existsSync(REPOS_CATALOG_FILE)) {
    return { version: 1, excludedRepos: EXCLUDED_REPOS, repos: [] };
  }
  return readJson(REPOS_CATALOG_FILE);
}

function saveCatalog(catalog) {
  catalog.updatedAt = new Date().toISOString();
  saveJson(REPOS_CATALOG_FILE, catalog);
}

function addRepo(repoFullName) {
  if (!repoFullName || !repoFullName.includes("/")) {
    throw new Error("Usage: node sprint-manager.js add-repo <owner/repo>");
  }
  repoFullName = repoFullName
    .replace(/\.git$/, "")
    .replace(/^https?:\/\/github\.com\//, "");

  if (EXCLUDED_REPOS.includes(repoFullName)) {
    throw new Error(`Repo ${repoFullName} is excluded (system/infrastructure repo)`);
  }

  const catalog = readCatalog();
  const existing = catalog.repos.find(r => r.repo === repoFullName);

  if (existing) {
    if (existing.status === "active") {
      console.log(`Repo already active in catalog: ${repoFullName}`);
      return;
    }
    existing.status = "active";
    existing.reactivatedAt = new Date().toISOString();
    saveCatalog(catalog);
    console.log(`Repo reactivated: ${repoFullName}`);
    return;
  }

  console.log(`Adding repo: ${repoFullName}`);
  console.log("Creating severity labels...");
  ensureSeverityLabels(repoFullName);

  catalog.repos.push({
    repo: repoFullName,
    status: "active",
    addedAt: new Date().toISOString(),
    firstImportDone: false,
    lastImportAt: null
  });
  saveCatalog(catalog);

  console.log(`Repo added to catalog: ${repoFullName}`);
  console.log("Next sprint-pickup will import all open issues from this repo.");
}

function listRepos() {
  const catalog = readCatalog();
  if (!catalog.repos || catalog.repos.length === 0) {
    console.log("No repos in catalog. Use: node sprint-manager.js add-repo <owner/repo>");
    return;
  }
  console.log("=== Repos Catalog ===");
  for (const r of catalog.repos) {
    const lastImport = r.lastImportAt ? r.lastImportAt.slice(0, 10) : "never";
    const firstDone = r.firstImportDone ? "yes" : "pending";
    console.log(`${r.status.toUpperCase().padEnd(8)} | ${r.repo.padEnd(45)} | added=${r.addedAt.slice(0, 10)} | last_import=${lastImport} | first_import=${firstDone}`);
  }
  console.log(`\nExcluded (system repos):`);
  for (const e of (catalog.excludedRepos || EXCLUDED_REPOS)) {
    console.log(`  - ${e}`);
  }
}

function removeRepo(repoFullName) {
  if (!repoFullName) {
    throw new Error("Usage: node sprint-manager.js remove-repo <owner/repo>");
  }
  const catalog = readCatalog();
  const entry = catalog.repos.find(r => r.repo === repoFullName);
  if (!entry) {
    throw new Error(`Repo not found in catalog: ${repoFullName}`);
  }
  entry.status = "inactive";
  entry.removedAt = new Date().toISOString();
  saveCatalog(catalog);
  console.log(`Repo marked inactive: ${repoFullName}`);
}

function importGitHubIssues() {
  const execSync = require("child_process").execSync;
  const catalog = readCatalog();
  const activeRepos = (catalog.repos || []).filter(r => r.status === "active");

  if (activeRepos.length === 0) {
    console.log("No active repos in catalog. Use: node sprint-manager.js add-repo <owner/repo>");
    return;
  }

  const backlog = readJson(PRODUCT_BACKLOG_FILE);
  const items = backlog.items || [];
  const existingIds = new Set(items.map(i => i.id));

  let totalImported = 0;
  const needsSeverityAnalysis = [];

  for (const repoEntry of activeRepos) {
    const repo = repoEntry.repo;
    const isFirstImport = !repoEntry.firstImportDone;

    console.log(`\nProcessing: ${repo} (first_import=${isFirstImport})`);

    let raw;
    try {
      raw = execSync(
        `gh issue list --repo ${repo} --state open --limit 100 --json number,title,body,labels,url,createdAt,updatedAt,comments`,
        { encoding: "utf-8" }
      );
    } catch (err) {
      console.log(`  ERROR fetching issues from ${repo}: ${String(err.message).slice(0, 200)}`);
      continue;
    }

    const issues = JSON.parse(raw);
    const newItems = [];

    for (const issue of issues) {
      const issueId = `${repo}#${issue.number}`;
      if (existingIds.has(issueId)) continue;

      const labels = (issue.labels || []).map(l => l.name);
      const type = labels.includes("bug") ? "bug" : "story";
      const severityLabel = getSeverityLabel(labels);
      // priority encodes severity tier + issue number for natural sort
      const severityTier = severityLabel ? SEVERITY_ORDER[severityLabel] : 5;
      const priority = severityTier * 10000 + issue.number;

      const body = (issue.body || "").trim();
      const shortBody = body.slice(0, 500) + (body.length > 500 ? "..." : "");
      const commentCount = Array.isArray(issue.comments) ? issue.comments.length : 0;

      newItems.push({
        id: issueId,
        title: issue.title,
        type,
        priority,
        severity: severityLabel,
        status: "imported",
        assignedRole: "product-owner",
        description:
          `Imported from GitHub issue #${issue.number} in ${repo}.\n` +
          `URL: ${issue.url}\n` +
          `Labels: ${labels.join(", ") || "none"}\n` +
          `Comments at import: ${commentCount}\n\n` +
          shortBody,
        definitionOfDone: [
          "severity label verified",
          "full issue context read (body + all comments)",
          "work item reviewed by product-owner",
          "implementation approach defined",
          "item ready for sprint selection"
        ],
        source: "github-issue",
        repo,
        issueNumber: issue.number,
        issueUrl: issue.url,
        labels,
        commentCount,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        importedAt: new Date().toISOString(),
        firstImport: isFirstImport
      });

      existingIds.add(issueId);

      if (!severityLabel) {
        needsSeverityAnalysis.push({
          id: issueId,
          repo,
          issueNumber: issue.number,
          title: issue.title,
          url: issue.url,
          commentCount
        });
      }
    }

    backlog.items.push(...newItems);
    totalImported += newItems.length;
    repoEntry.lastImportAt = new Date().toISOString();
    if (isFirstImport) repoEntry.firstImportDone = true;

    console.log(`  Imported: ${newItems.length} new issues`);
  }

  saveJson(PRODUCT_BACKLOG_FILE, backlog);
  saveCatalog(catalog);

  console.log(`\nTotal issues imported: ${totalImported}`);
  console.log(`Product backlog updated: ${PRODUCT_BACKLOG_FILE}`);

  if (needsSeverityAnalysis.length > 0) {
    console.log(`\n=== NEEDS_SEVERITY_ANALYSIS: ${needsSeverityAnalysis.length} issues ===`);
    console.log("These issues have no severity label. For EACH: read full context (body + all comments), then apply label and comment.");
    for (const item of needsSeverityAnalysis) {
      console.log(`NEEDS_SEVERITY_ANALYSIS | ${item.id} | repo=${item.repo} | issue=${item.issueNumber} | comments=${item.commentCount} | title=${JSON.stringify(item.title)} | url=${item.url}`);
    }
    console.log("\nFor each issue above, run in order:");
    console.log('  1. gh issue view <n> --repo <owner/repo> --comments   # read body + ALL existing comments');
    console.log('  2. gh issue edit <n> --repo <owner/repo> --add-label "severity: <level>"');
    console.log('  3. gh issue comment <n> --repo <owner/repo> --body "OpenClaw: propuesta de severidad [nivel] — [razonamiento basado en el contexto leído]. Por favor confirma o ajusta."');
  }
}


function refineItem(itemId) {
  const backlog = readJson(PRODUCT_BACKLOG_FILE);

  const item = Array.isArray(backlog.items)
    ? backlog.items.find(i => i.id === itemId)
    : null;

  if (!item) {
    throw new Error(`Item not found in product backlog: ${itemId}`);
  }

  if (item.status !== "imported") {
    throw new Error(`Only imported items can be refined to planned: ${itemId} (current: ${item.status})`);
  }

  item.status = "planned";
  item.refinedAt = new Date().toISOString();

  saveJson(PRODUCT_BACKLOG_FILE, backlog);

  try {
    writeBackGitHubIssueEvent(item, "refine");
  } catch (error) {
    console.log(`GitHub write-back failed for refine ${itemId}: ${error.message}`);
  }

  console.log(`Item refined: ${itemId} -> planned`);
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
    console.log(`- IN-SPRINT | ${item.id} | ${item.title} | role=${item.assignedRole} | status=${item.status}`);
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


function archiveCurrentSprint() {
  const sprint = readJson(SPRINT_STATE_FILE);

  if (!sprint.sprintId) {
    throw new Error("sprint-state.json inválido: falta sprintId");
  }

  const historyDir = `${SCRUM_DIR}/sprint-history`;
  fs.mkdirSync(historyDir, { recursive: true });

  const archiveFile = `${historyDir}/${sprint.sprintId}.json`;

  if (fs.existsSync(archiveFile)) {
    throw new Error(`El archivo de historial ya existe: ${archiveFile}`);
  }

  fs.writeFileSync(archiveFile, JSON.stringify(sprint, null, 2));
  console.log(`[OK] Sprint archivado: ${archiveFile}`);
}

function buildNextSprintFromCurrent(currentSprint) {
  const match = String(currentSprint.sprintId || "").match(/^(.*-)(\d+)$/);
  if (!match) {
    throw new Error(`Formato de sprintId no soportado: ${currentSprint.sprintId}`);
  }

  const prefix = match[1];
  const currentNumber = parseInt(match[2], 10);
  const nextNumber = String(currentNumber + 1).padStart(match[2].length, "0");

  const carryOverBacklog = Array.isArray(currentSprint.backlog)
    ? currentSprint.backlog.map(item => ({
        ...item,
        status: "planned"
      }))
    : [];
  const carryOverInProgress = Array.isArray(currentSprint.inProgress)
    ? currentSprint.inProgress.map(item => ({
        ...item,
        status: "planned"
      }))
    : [];

  return {
    generatedAt: new Date().toISOString(),
    sprintId: `${prefix}${nextNumber}`,
    sprintGoal: "",
    status: "planned",
    currentPhase: "planning",
    backlog: [...carryOverBacklog, ...carryOverInProgress],
    inProgress: [],
    done: [],
    impediments: [],
    reviewNotes: [],
    retrospectiveNotes: []
  };
}

function nextSprint() {
  const currentSprint = readJson(SPRINT_STATE_FILE);

  archiveCurrentSprint();

  const nextSprintState = buildNextSprintFromCurrent(currentSprint);

  const productBacklog = readJson(PRODUCT_BACKLOG_FILE);
  const nextBacklogIds = new Set(
    (Array.isArray(nextSprintState.backlog) ? nextSprintState.backlog : []).map(item => item.id)
  );

  if (Array.isArray(productBacklog.items)) {
    for (const backlogItem of productBacklog.items) {
      if (nextBacklogIds.has(backlogItem.id)) {
        backlogItem.status = "planned";
      }
    }
    saveJson(PRODUCT_BACKLOG_FILE, productBacklog);
  }

  saveJson(SPRINT_STATE_FILE, nextSprintState);

  console.log(`[OK] Nuevo sprint activo: ${nextSprintState.sprintId}`);
}


function showSprintHistory() {
  const historyDir = `${SCRUM_DIR}/sprint-history`;

  if (!fs.existsSync(historyDir)) {
    console.log("[INFO] No existe sprint-history todavía");
    return;
  }

  const files = fs.readdirSync(historyDir)
    .filter(name => name.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.log("[INFO] No hay sprints archivados");
    return;
  }

  console.log("=== SPRINT HISTORY ===");

  files.forEach(file => {
    const fullPath = `${historyDir}/${file}`;
    const sprint = readJson(fullPath);

    const sprintId = sprint.sprintId || file.replace(/\.json$/, "");
    const status = sprint.status || "unknown";
    const goal = sprint.sprintGoal || "";
    const doneCount = Array.isArray(sprint.done) ? sprint.done.length : 0;
    const backlogCount = Array.isArray(sprint.backlog) ? sprint.backlog.length : 0;
    const inProgressCount = Array.isArray(sprint.inProgress) ? sprint.inProgress.length : 0;

    console.log(`${sprintId} | status=${status} | done=${doneCount} | backlog=${backlogCount} | inProgress=${inProgressCount} | goal=${goal}`);
  });
}


function showSprintHistoryDetail(sprintId) {
  if (!sprintId) {
    throw new Error("Usage: node sprint-manager.js history-detail <SPRINT_ID>");
  }

  const historyDir = `${SCRUM_DIR}/sprint-history`;
  const filePath = `${historyDir}/${sprintId}.json`;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Sprint archivado no encontrado: ${sprintId}`);
  }

  const sprint = readJson(filePath);
  console.log(JSON.stringify(sprint, null, 2));
}

function showBacklog() {
  const backlog = readJson(PRODUCT_BACKLOG_FILE);
  const items = Array.isArray(backlog.items) ? backlog.items : [];

  const counts = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }

  console.log("=== Product Backlog ===");
  console.log(`Total items: ${items.length}`);
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log("");

  const ORDER = ["imported", "planned", "in-sprint", "in-progress", "blocked", "done"];
  for (const status of ORDER) {
    const statusItems = items.filter(i => i.status === status);
    if (statusItems.length === 0) continue;
    console.log(`--- ${status.toUpperCase()} (${statusItems.length}) ---`);
    for (const item of statusItems) {
      const sev = item.severity ? `[${item.severity}]` : "[no-severity]";
      const repo = item.repo ? ` (${item.repo})` : "";
      console.log(`  ${item.id} | ${sev} | ${item.title}${repo}`);
    }
    console.log("");
  }
}

// ============================================================
// PIPELINE TRACKING — R2 + R3: Router automático + Lifecycle extendido
// ============================================================

function computeRouting(fullItem) {
  const labels = Array.isArray(fullItem.labels)
    ? fullItem.labels.map(l => String(l).toLowerCase())
    : [];
  const title = String(fullItem.title || "").toLowerCase();
  const hasSeverity = Boolean(fullItem.severity);
  const hasBody = (fullItem.description || "").length > 80;

  const isBug = labels.includes("bug") || title.includes("[bug]");
  let isFrontend = labels.some(l =>
    ["frontend", "ui", "react", "css", "componente", "component", "responsive"].includes(l)
  );
  let isBackend = labels.some(l =>
    ["api", "backend", "cli", "db", "database", "service", "integración", "integration"].includes(l)
  );
  // Campo detectedStack escrito por Roy antes de llamar a route (M1b)
  if (fullItem.detectedStack === 'frontend') isFrontend = true;
  if (fullItem.detectedStack === 'backend') isBackend = true;
  const isPerformance = labels.some(l =>
    ["performance", "memory", "memory-leak", "event-loop", "node"].includes(l)
  );

  const baseSkills = ["git-expert", "documentation-expert", "qa-analyst"];
  let assignedAgent = null;
  const extraSkills = [];
  const triggeredBy = [];

  if (!hasSeverity) {
    return {
      appliedAt: new Date().toISOString(),
      assignedAgent: null,
      requiredSkills: ["product-owner"],
      triggeredBy: ["missing-severity"],
      confidence: "low",
      note: "Requires product-owner refinement: no severity label found"
    };
  }

  if (!hasBody) {
    return {
      appliedAt: new Date().toISOString(),
      assignedAgent: null,
      requiredSkills: ["product-owner"],
      triggeredBy: ["missing-body"],
      confidence: "low",
      note: "Requires product-owner refinement: issue body is empty or too short"
    };
  }

  if (isBug) triggeredBy.push("label:bug");

  if (isPerformance) {
    triggeredBy.push("label:performance");
    assignedAgent = "backend-dev";
    extraSkills.push("backend-developer", "node-specialist");
    if (isBug) extraSkills.push("tns-debugger-triage");
  } else if (isFrontend && !isBackend) {
    triggeredBy.push("label:frontend");
    assignedAgent = "frontend-dev";
    extraSkills.push("frontend-developer");
    if (isBug) extraSkills.push("tns-debugger-triage");
  } else {
    if (isBackend) triggeredBy.push("label:backend");
    if (!isBackend && !isBug) triggeredBy.push("default");
    assignedAgent = "backend-dev";
    extraSkills.push("backend-developer");
    if (isBug) extraSkills.push("tns-debugger-triage");
  }

  return {
    appliedAt: new Date().toISOString(),
    assignedAgent,
    requiredSkills: [...new Set([...extraSkills, ...baseSkills])],
    triggeredBy,
    confidence: "high"
  };
}

function findInSprintState(sprintState, itemId) {
  const inBacklog = sprintState.backlog.find(i => i.id === itemId);
  if (inBacklog) return { item: inBacklog, list: "backlog" };
  const inProgress = sprintState.inProgress.find(i => i.id === itemId);
  if (inProgress) return { item: inProgress, list: "inProgress" };
  const inDone = sprintState.done.find(i => i.id === itemId);
  if (inDone) return { item: inDone, list: "done" };
  return null;
}

function routeItem(itemId) {
  const sprintState = readJson(SPRINT_STATE_FILE);
  const found = findInSprintState(sprintState, itemId);
  if (!found) throw new Error(`Item not found in sprint state: ${itemId}`);

  const productBacklog = readJson(PRODUCT_BACKLOG_FILE);
  const fullItem = Array.isArray(productBacklog.items)
    ? productBacklog.items.find(i => i.id === itemId)
    : null;
  if (!fullItem) throw new Error(`Item not found in product backlog: ${itemId}`);

  const routing = computeRouting(fullItem);
  found.item.routingDecision = routing;
  found.item.assignedAgent = routing.assignedAgent;
  found.item.requiredSkills = routing.requiredSkills;

  fullItem.routingDecision = routing;
  fullItem.assignedAgent = routing.assignedAgent;
  fullItem.requiredSkills = routing.requiredSkills;

  saveJson(SPRINT_STATE_FILE, sprintState);
  saveJson(PRODUCT_BACKLOG_FILE, productBacklog);

  console.log(`Item routed: ${itemId}`);
  console.log(`assignedAgent: ${routing.assignedAgent || "none (needs product-owner first)"}`);
  console.log(`requiredSkills: ${routing.requiredSkills.join(", ")}`);
  console.log(`triggeredBy: ${routing.triggeredBy.join(", ")}`);
  console.log(`confidence: ${routing.confidence}`);
  if (routing.note) console.log(`note: ${routing.note}`);
}

function assignItem(itemId, sessionId) {
  if (!itemId) throw new Error("Usage: node sprint-manager.js assign <ITEM_ID> [SESSION_ID]");
  const sprintState = readJson(SPRINT_STATE_FILE);
  const found = findInSprintState(sprintState, itemId);
  if (!found) throw new Error(`Item not found in sprint state: ${itemId}`);

  found.item.workerSessionId = sessionId || null;
  found.item.assignedAt = new Date().toISOString();

  saveJson(SPRINT_STATE_FILE, sprintState);
  console.log(`Item assigned: ${itemId}`);
  console.log(`workerSessionId: ${sessionId || "none"}`);
}

function prOpenItem(itemId, prUrl) {
  if (!itemId || !prUrl) throw new Error("Usage: node sprint-manager.js pr-open <ITEM_ID> <PR_URL>");
  const sprintState = readJson(SPRINT_STATE_FILE);
  const found = findInSprintState(sprintState, itemId);
  if (!found) throw new Error(`Item not found in sprint state: ${itemId}`);

  found.item.prUrl = prUrl;
  found.item.checksStatus = "pending";
  if (!found.item.qaStatus) found.item.qaStatus = "pending";
  found.item.prOpenedAt = new Date().toISOString();

  saveJson(SPRINT_STATE_FILE, sprintState);
  console.log(`PR registered: ${itemId}`);
  console.log(`prUrl: ${prUrl}`);
  console.log(`qaStatus: ${found.item.qaStatus}`);
  console.log(`ACTION REQUIRED: Spawn qa-analyst to review this PR.`);
}

function qaPassItem(itemId, reviewUrl) {
  if (!itemId) throw new Error("Usage: node sprint-manager.js qa-pass <ITEM_ID> [REVIEW_URL]");
  const sprintState = readJson(SPRINT_STATE_FILE);
  const found = findInSprintState(sprintState, itemId);
  if (!found) throw new Error(`Item not found in sprint state: ${itemId}`);

  found.item.qaStatus = "passed";
  found.item.qaReviewUrl = reviewUrl || null;
  found.item.qaPassedAt = new Date().toISOString();
  if (!found.item.humanMergeStatus) found.item.humanMergeStatus = "pending";

  saveJson(SPRINT_STATE_FILE, sprintState);
  console.log(`QA passed: ${itemId}`);
  console.log(`reviewUrl: ${reviewUrl || "none"}`);
  console.log(`humanMergeStatus: ${found.item.humanMergeStatus}`);
  console.log(`ACTION REQUIRED: Notify Felipe that ${itemId} is ready for human merge.`);
}

function qaFailItem(itemId, reason) {
  if (!itemId || !reason) throw new Error('Usage: node sprint-manager.js qa-fail <ITEM_ID> "reason"');
  const sprintState = readJson(SPRINT_STATE_FILE);
  const found = findInSprintState(sprintState, itemId);
  if (!found) throw new Error(`Item not found in sprint state: ${itemId}`);

  found.item.qaStatus = "failed";
  found.item.qaFailReason = reason;
  found.item.qaFailedAt = new Date().toISOString();

  saveJson(SPRINT_STATE_FILE, sprintState);
  console.log(`QA failed: ${itemId}`);
  console.log(`reason: ${reason}`);
  console.log(`ACTION REQUIRED: Run tns-debugger-triage, then respawn worker with QA feedback.`);
}

function humanMergeItem(itemId) {
  if (!itemId) throw new Error("Usage: node sprint-manager.js human-merge <ITEM_ID>");
  const sprintState = readJson(SPRINT_STATE_FILE);
  const found = findInSprintState(sprintState, itemId);
  if (!found) throw new Error(`Item not found in sprint state: ${itemId}`);

  if (found.item.qaStatus !== "passed") {
    console.log(`WARNING: registering human-merge but qaStatus=${found.item.qaStatus || "not set"}. Proceed only if QA was confirmed outside the system.`);
  }

  found.item.humanMergeStatus = "merged";
  found.item.mergedAt = new Date().toISOString();

  saveJson(SPRINT_STATE_FILE, sprintState);
  console.log(`Human merge recorded: ${itemId}`);
  console.log(`mergedAt: ${found.item.mergedAt}`);
  console.log(`Run: node sprint-manager.js complete ${itemId}`);
}

function showPipelineFields(item) {
  const fields = ["assignedAgent", "workerSessionId", "prUrl", "qaStatus", "qaReviewUrl",
    "qaFailReason", "checksStatus", "humanMergeStatus", "routingDecision"];
  const present = fields.filter(f => item[f] !== undefined && item[f] !== null);
  if (present.length === 0) return;
  console.log(`  Pipeline:`);
  if (item.assignedAgent) console.log(`    assignedAgent: ${item.assignedAgent}`);
  if (item.workerSessionId) console.log(`    workerSessionId: ${item.workerSessionId}`);
  if (item.prUrl) console.log(`    prUrl: ${item.prUrl}`);
  if (item.qaStatus) console.log(`    qaStatus: ${item.qaStatus}${item.qaFailReason ? ` (${item.qaFailReason})` : ""}`);
  if (item.qaReviewUrl) console.log(`    qaReviewUrl: ${item.qaReviewUrl}`);
  if (item.checksStatus) console.log(`    checksStatus: ${item.checksStatus}`);
  if (item.humanMergeStatus) console.log(`    humanMergeStatus: ${item.humanMergeStatus}`);
  if (item.routingDecision) {
    const rd = item.routingDecision;
    console.log(`    routing: confidence=${rd.confidence} triggeredBy=${(rd.triggeredBy || []).join(",")}`);
  }
}

function updateRepoPriority(repoFullName, priorityArg, note) {
  const priority = parseInt(priorityArg, 10);
  if (!Number.isInteger(priority) || priority < 1 || priority > 3) {
    throw new Error("Priority must be 1 (alta), 2 (media), or 3 (baja)");
  }
  const catalog = readCatalog();
  const repo = catalog.repos.find(r => r.repo === repoFullName);
  if (!repo) {
    throw new Error(`Repo not found in catalog: ${repoFullName}`);
  }
  repo.priority = priority;
  repo.priorityNote = note || "";
  saveCatalog(catalog);
  const label = priority === 1 ? "alta" : priority === 2 ? "media" : "baja";
  console.log(`priority-update OK: ${repoFullName} → priority=${priority} (${label})`);
  if (note) console.log(`note: ${note}`);
}

function updateCapacity(nArg) {
  const n = parseInt(nArg, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Usage: node sprint-manager.js capacity-update <positive-integer>");
  }
  if (!fs.existsSync(JOBS_FILE)) {
    throw new Error(`Jobs file not found: ${JOBS_FILE}`);
  }
  const content = fs.readFileSync(JOBS_FILE, "utf8");
  const updated = content.replace(/CAPACIDAD_SPRINT = \d+/, `CAPACIDAD_SPRINT = ${n}`);
  if (updated === content) {
    throw new Error("CAPACIDAD_SPRINT pattern not found in jobs.json");
  }
  fs.writeFileSync(JOBS_FILE, updated, "utf8");
  console.log(`capacity-update OK: CAPACIDAD_SPRINT = ${n}`);
}

function main() {
  const command = process.argv[2];

  if (!command) {
    console.error("ERROR: No command provided.");
    console.error("Usage: node sprint-manager.js <command>");
    process.exit(1);
  }

  if (command === "init") {
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

  if (command === "refine") {
    const itemId = process.argv[3];
    if (!itemId) {
      throw new Error("Usage: node sprint-manager.js refine <ITEM_ID>");
    }
    refineItem(itemId);
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

  if (command === "reconcile") {
    const fix = process.argv.includes("--fix");
    const dryRun = process.argv.includes("--dry-run");
    reconcileGitHubScrumMirror({ fix, dryRun });
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

  if (command === "review-close") {
    closeReview();
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

  
  if (command === "import-github") {
    importGitHubIssues();
    return;
  }

  if (command === "add-repo") {
    const repo = process.argv[3];
    if (!repo) {
      throw new Error("Usage: node sprint-manager.js add-repo <owner/repo>");
    }
    addRepo(repo);
    return;
  }

  if (command === "list-repos") {
    listRepos();
    return;
  }

  if (command === "remove-repo") {
    const repo = process.argv[3];
    if (!repo) {
      throw new Error("Usage: node sprint-manager.js remove-repo <owner/repo>");
    }
    removeRepo(repo);
    return;
  }

  if (command === "show-backlog") {
    showBacklog();
    return;
  }

  if (command === "select") {
    const rawLimit = process.argv[3];
    const limit = Number(rawLimit);

    if (!rawLimit || !Number.isInteger(limit) || limit <= 0) {
      throw new Error("Usage: node sprint-manager.js select <POSITIVE_INTEGER>");
    }

    selectPlannedItemsIntoActiveSprint(limit);
    return;
  }

  if (command === "planning") {
    const goal = process.argv.slice(3).join(" ").trim();
    if (!goal) {
      throw new Error('Usage: node sprint-manager.js planning "SPRINT_GOAL"');
    }
    setSprintPlanning(goal);
    return;
  }

  if (command === "daily") {
    dailySummary();
    return;
  }

  if (command === "history") {
    showSprintHistory();
    return;
  }

  if (command === "history-detail") {
    const sprintId = process.argv[3];
    if (!sprintId) {
      throw new Error("Usage: node sprint-manager.js history-detail <SPRINT_ID>");
    }
    showSprintHistoryDetail(sprintId);
    return;
  }

  if (command === "next-sprint") {
    nextSprint();
    return;
  }

  if (command === "route") {
    const itemId = process.argv[3];
    if (!itemId) throw new Error("Usage: node sprint-manager.js route <ITEM_ID>");
    routeItem(itemId);
    return;
  }

  if (command === "assign") {
    const itemId = process.argv[3];
    const sessionId = process.argv[4] || null;
    assignItem(itemId, sessionId);
    return;
  }

  if (command === "pr-open") {
    const itemId = process.argv[3];
    const prUrl = process.argv[4];
    prOpenItem(itemId, prUrl);
    return;
  }

  if (command === "qa-pass") {
    const itemId = process.argv[3];
    const reviewUrl = process.argv[4] || null;
    qaPassItem(itemId, reviewUrl);
    return;
  }

  if (command === "qa-fail") {
    const itemId = process.argv[3];
    const reason = process.argv.slice(4).join(" ").trim();
    qaFailItem(itemId, reason);
    return;
  }

  if (command === "human-merge") {
    const itemId = process.argv[3];
    humanMergeItem(itemId);
    return;
  }

  if (command === "priority-update") {
    const repo = process.argv[3];
    const priority = process.argv[4];
    const note = process.argv.slice(5).join(" ").trim();
    if (!repo || !priority) {
      throw new Error('Usage: node sprint-manager.js priority-update <owner/repo> <1|2|3> ["note"]');
    }
    updateRepoPriority(repo, priority, note);
    return;
  }

  if (command === "capacity-update") {
    const n = process.argv[3];
    if (!n) {
      throw new Error("Usage: node sprint-manager.js capacity-update <positive-integer>");
    }
    updateCapacity(n);
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
