let pageTable = [];
let tlb = [];
let lastPage = null;
let lastFrame = null;
let stats = { hits: 0, misses: 0, faults: 0 };
const TLB_SIZE = 4;

const $ = (id) => document.getElementById(id);

function getConfig() {
  return {
    pageSize: Number($("pageSize").value),
    numPages: Number($("numPages").value),
    numFrames: Number($("numFrames").value),
    mode: document.querySelector('input[name="allocationMode"]:checked')?.value || "sequential"
  };
}

function validateConfig(c) {
  if (![c.pageSize, c.numPages, c.numFrames].every(Number.isInteger) || c.pageSize <= 0 || c.numPages <= 0 || c.numFrames <= 0) {
    alert("Please enter positive whole numbers for page size, pages and frames.");
    return false;
  }
  return true;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getManualMappings(numPages, numFrames) {
  const mappings = [];
  for (let page = 0; page < numPages; page++) {
    const value = $(`manualFrame-${page}`)?.value ?? "";
    const frame = value === "" ? null : Number(value);
    if (frame !== null && (!Number.isInteger(frame) || frame < 0 || frame >= numFrames)) {
      throw new Error(`Page ${page}: frame must be between 0 and ${numFrames - 1}.`);
    }
    mappings.push(frame);
  }

  const used = mappings.filter(v => v !== null);
  if (new Set(used).size !== used.length) {
    throw new Error("Manual allocation cannot assign the same frame to two pages.");
  }
  return mappings;
}

function createMappings(c) {
  if (c.mode === "manual") {
    return getManualMappings(c.numPages, c.numFrames);
  }

  const frames = Array.from({ length: c.numFrames }, (_, i) => i);
  const available = c.mode === "random" ? shuffle(frames) : frames;
  return Array.from({ length: c.numPages }, (_, page) => page < c.numFrames ? available[page] : null);
}

function generateMemory(showMessage = true) {
  const c = getConfig();
  if (!validateConfig(c)) return;

  try {
    const mappings = createMappings(c);
    pageTable = mappings.map((frame, page) => ({ page, frame, valid: frame !== null }));
    tlb = pageTable.filter(e => e.valid).slice(0, TLB_SIZE).map(e => ({ page: e.page, frame: e.frame }));
    stats = { hits: 0, misses: 0, faults: 0 };
    lastPage = null;
    lastFrame = null;

    displayPageTable();
    displayTLB();
    displayFrames();
    updateStats();
    clearTranslationUI();

    if (showMessage) {
      setResult("success", `Memory generated using <strong>${capitalize(c.mode)}</strong> allocation. ${pageTable.filter(e => e.valid).length} of ${c.numPages} pages are currently loaded.`);
    }
  } catch (error) {
    alert(error.message);
  }
}

function renderManualEditor() {
  const editor = $("manualEditor");
  const c = getConfig();
  if (c.mode !== "manual") {
    editor.classList.add("hidden");
    editor.innerHTML = "";
    return;
  }

  editor.classList.remove("hidden");
  editor.innerHTML = `
    <div class="manual-head"><b>Manual Page → Frame Mapping</b><span>Leave a page as “Not Loaded” to demonstrate a page fault.</span></div>
    <div class="manual-grid">
      ${Array.from({ length: c.numPages }, (_, page) => `
        <label>Page ${page}
          <select id="manualFrame-${page}">
            <option value="">Not Loaded</option>
            ${Array.from({ length: c.numFrames }, (_, frame) => `<option value="${frame}">Frame ${frame}</option>`).join("")}
          </select>
        </label>
      `).join("")}
    </div>
    <div class="hint">Tip: every frame can be used only once. Example: Page 0 → Frame 5, Page 1 → Frame 2, Page 2 → Frame 7.</div>
  `;
}

function displayPageTable() {
  const body = $("pageTableBody");
  body.innerHTML = "";
  if (!pageTable.length) {
    body.innerHTML = `<tr><td colspan="4">No page table generated.</td></tr>`;
    return;
  }
  pageTable.forEach(entry => {
    const row = document.createElement("tr");
    if (entry.page === lastPage) row.classList.add("highlight-row");
    row.innerHTML = `
      <td><span class="number-pill">${entry.page}</span></td>
      <td>${entry.frame === null ? "—" : `<span class="frame-pill">${entry.frame}</span>`}</td>
      <td><span class="valid-pill ${entry.valid ? "valid" : "invalid"}">${entry.valid ? "1" : "0"}</span></td>
      <td>${entry.valid ? `<span class="table-status loaded">Loaded</span>` : `<span class="table-status unloaded">Not Loaded</span>`}</td>
    `;
    body.appendChild(row);
  });
}

function displayTLB() {
  const body = $("tlbBody");
  body.innerHTML = "";
  if (!tlb.length) {
    body.innerHTML = `<tr><td colspan="3">No valid mappings in TLB.</td></tr>`;
    return;
  }
  tlb.forEach((entry, index) => {
    const row = document.createElement("tr");
    if (entry.page === lastPage) row.classList.add("highlight-row");
    row.innerHTML = `<td>${index + 1}</td><td>${entry.page}</td><td>${entry.frame}</td>`;
    body.appendChild(row);
  });
}

function displayFrames() {
  const grid = $("frameGrid");
  const numFrames = Number($("numFrames").value);
  grid.innerHTML = "";
  for (let frame = 0; frame < numFrames; frame++) {
    const page = pageTable.find(e => e.valid && e.frame === frame)?.page;
    const card = document.createElement("div");
    card.className = `frame-card ${frame === lastFrame ? "active-frame" : ""} ${page === undefined ? "free-frame" : ""}`;
    card.innerHTML = `
      <div class="frame-top"><span>FRAME ${frame}</span>${frame === lastFrame ? "<b>USED NOW</b>" : ""}</div>
      <div class="frame-content">${page === undefined ? "<span class='free-text'>Free / Unmapped</span>" : `<strong>Page ${page}</strong><small>Page ${page} is stored here</small>`}</div>
    `;
    grid.appendChild(card);
  }
}

function addToTLB(page, frame) {
  tlb = tlb.filter(e => e.page !== page);
  if (tlb.length >= TLB_SIZE) tlb.shift();
  tlb.push({ page, frame });
  displayTLB();
}

function translateAddress() {
  if (!pageTable.length) {
    generateMemory(false);
    if (!pageTable.length) return;
  }

  const logicalAddress = Number($("logicalAddress").value);
  const pageSize = Number($("pageSize").value);
  const result = $("result");

  if (!Number.isInteger(logicalAddress) || logicalAddress < 0) {
    setResult("fault", "Please enter a valid non-negative whole-number logical address.");
    return;
  }

  const pageNumber = Math.floor(logicalAddress / pageSize);
  const offset = logicalAddress % pageSize;
  lastPage = pageNumber;
  lastFrame = null;
  displayPageTable();

  $("translationFlow").classList.remove("hidden");
  $("flowLogicalVal").textContent = logicalAddress;
  $("flowPageVal").textContent = `Page ${pageNumber} · Offset ${offset}`;

  if (pageNumber >= pageTable.length) {
    stats.misses++;
    stats.faults++;
    updateStats();
    $("translationBadge").className = "status-badge fault-badge";
    $("translationBadge").textContent = "INVALID";
    setFlow("TLB", "Not checked", "neutral");
    setFlow("Page Table", "Page does not exist", "fault");
    setFlow("Physical", "No address", "fault");
    showSteps([
      ["1", `Logical address = ${logicalAddress}`],
      ["2", `Page number = floor(${logicalAddress} ÷ ${pageSize}) = ${pageNumber}`],
      ["3", `Page ${pageNumber} is outside the configured page table.`],
      ["4", "Result: Invalid logical address — no physical address exists in this simulation."]
    ]);
    setResult("fault", `<strong>Invalid Logical Address</strong><br>Page ${pageNumber} does not exist in the configured page table.`);
    return;
  }

  const tlbEntry = tlb.find(entry => entry.page === pageNumber);
  if (tlbEntry) {
    stats.hits++;
    const physicalAddress = tlbEntry.frame * pageSize + offset;
    lastFrame = tlbEntry.frame;
    updateStats();
    displayPageTable();
    displayTLB();
    displayFrames();
    $("translationBadge").className = "status-badge hit-badge";
    $("translationBadge").textContent = "TLB HIT";
    setFlow("TLB", `HIT → Frame ${tlbEntry.frame}`, "hit");
    setFlow("Page Table", "Not required", "neutral");
    setFlow("Physical", physicalAddress, "hit");
    showSteps([
      ["1", `Logical address = ${logicalAddress}`],
      ["2", `Page number = floor(${logicalAddress} ÷ ${pageSize}) = ${pageNumber}; offset = ${offset}`],
      ["3", `TLB lookup → HIT. Page ${pageNumber} maps to Frame ${tlbEntry.frame}.`],
      ["4", `Physical address = (${tlbEntry.frame} × ${pageSize}) + ${offset} = ${physicalAddress}`]
    ]);
    setResult("success", `<strong>⚡ TLB HIT</strong><br>Page ${pageNumber} → Frame ${tlbEntry.frame}<br>Offset: ${offset}<br>Physical Address: <strong>${physicalAddress}</strong>`);
    return;
  }

  stats.misses++;
  const pageEntry = pageTable[pageNumber];
  $("translationBadge").className = "status-badge miss-badge";
  $("translationBadge").textContent = "TLB MISS";
  setFlow("TLB", "MISS", "miss");

  if (!pageEntry.valid) {
    stats.faults++;
    updateStats();
    setFlow("Page Table", "INVALID", "fault");
    setFlow("Physical", "Page Fault", "fault");
    showSteps([
      ["1", `Logical address = ${logicalAddress}`],
      ["2", `Page number = ${pageNumber}; offset = ${offset}`],
      ["3", `TLB lookup → MISS. Page table entry for Page ${pageNumber} is invalid.`],
      ["4", "Result: PAGE FAULT. The page is not currently loaded into a frame."]
    ]);
    setResult("fault", `<strong>⚠ PAGE FAULT</strong><br>Page ${pageNumber} is <strong>Not Loaded</strong>.<br>The OS would normally fetch this page from secondary storage.`);
    displayFrames();
    return;
  }

  const physicalAddress = pageEntry.frame * pageSize + offset;
  lastFrame = pageEntry.frame;
  addToTLB(pageNumber, pageEntry.frame);
  updateStats();
  displayPageTable();
  displayFrames();
  setFlow("Page Table", `Frame ${pageEntry.frame}`, "hit");
  setFlow("Physical", physicalAddress, "hit");
  $("translationBadge").textContent = "TLB MISS → TABLE HIT";
  showSteps([
    ["1", `Logical address = ${logicalAddress}`],
    ["2", `Page number = floor(${logicalAddress} ÷ ${pageSize}) = ${pageNumber}; offset = ${offset}`],
    ["3", `TLB lookup → MISS. Search page table.`],
    ["4", `Page ${pageNumber} → Frame ${pageEntry.frame}. Mapping is valid.`],
    ["5", `Physical address = (${pageEntry.frame} × ${pageSize}) + ${offset} = ${physicalAddress}`],
    ["6", `Page ${pageNumber} is added to the TLB for future fast lookups.`]
  ]);
  setResult("success", `<strong>✓ TLB MISS → PAGE TABLE HIT</strong><br>Page ${pageNumber} → Frame ${pageEntry.frame}<br>Offset: ${offset}<br>Physical Address: <strong>${physicalAddress}</strong>`);
}

function showSteps(steps) {
  const panel = $("stepPanel");
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="step-title">🧭 Step-by-Step Translation</div>${steps.map(([n, text]) => `<div class="step"><b>${n}</b><span>${text}</span></div>`).join("")}`;
}

function setFlow(name, value, state) {
  const idMap = { "TLB": "flowTLB", "Page Table": "flowTable", "Physical": "flowPhysical" };
  const valMap = { "TLB": "flowTLBVal", "Page Table": "flowTableVal", "Physical": "flowPhysicalVal" };
  const node = $(idMap[name]);
  node.className = `flow-node ${state}`;
  $(valMap[name]).textContent = value;
}

function setResult(type, html) {
  const result = $("result");
  result.className = `result ${type}`;
  result.innerHTML = html;
}

function updateStats() {
  $("statPages").textContent = pageTable.length;
  $("statFrames").textContent = Number($("numFrames").value) || 0;
  $("statHits").textContent = stats.hits;
  $("statMisses").textContent = stats.misses;
  $("statFaults").textContent = stats.faults;
}

function clearTranslationUI() {
  $("logicalAddress").value = "";
  $("translationFlow").classList.add("hidden");
  $("stepPanel").classList.add("hidden");
  $("translationBadge").className = "status-badge neutral";
  $("translationBadge").textContent = "READY";
  $("result").className = "result neutral-result";
  $("result").innerHTML = "Memory generated. Enter a logical address to begin translation.";
  ["flowTLB", "flowTable", "flowPhysical"].forEach(id => $(id).className = "flow-node");
  ["flowTLBVal", "flowTableVal", "flowPhysicalVal"].forEach(id => $(id).textContent = "—");
}

function resetSimulator() {
  $("pageSize").value = 1024;
  $("numPages").value = 8;
  $("numFrames").value = 8;
  document.querySelector('input[name="allocationMode"][value="sequential"]').checked = true;
  document.querySelectorAll(".mode-option").forEach(x => x.classList.remove("selected"));
  document.querySelector('.mode-option input[value="sequential"]').closest(".mode-option").classList.add("selected");
  renderManualEditor();
  generateMemory(false);
  setResult("neutral-result", "Simulator reset to the default configuration.");
}

function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

function setupTabs() {
  document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", () => {
      const target = button.dataset.tab;
      document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === button));
      document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active-panel", panel.id === target));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  document.querySelector("[data-open-sim]").addEventListener("click", () => document.querySelector('[data-tab="simulator"]').click());
}

function setupModeOptions() {
  document.querySelectorAll('input[name="allocationMode"]').forEach(input => {
    input.addEventListener("change", () => {
      document.querySelectorAll(".mode-option").forEach(x => x.classList.remove("selected"));
      input.closest(".mode-option").classList.add("selected");
      renderManualEditor();
    });
  });
  ["numPages", "numFrames"].forEach(id => $(id).addEventListener("input", () => {
    if (document.querySelector('input[name="allocationMode"]:checked')?.value === "manual") renderManualEditor();
  }));
}

$("generateBtn").addEventListener("click", () => generateMemory(true));
$("translateBtn").addEventListener("click", translateAddress);
$("resetBtn").addEventListener("click", resetSimulator);
$("logicalAddress").addEventListener("keydown", e => { if (e.key === "Enter") translateAddress(); });
setupTabs();
setupModeOptions();
renderManualEditor();
generateMemory(false);
