(function () {
  const DATA = window.SHEETS;
  if (!DATA || !DATA.a2z || !DATA.tracking) {
    document.body.insertAdjacentHTML(
      "beforeend",
      "<p class='noscript'>Sheet data did not load. Open this page from the TUF folder so data.js sits beside index.html.</p>"
    );
    return;
  }

  const KEY = "tuf-practice-tracker-v1";
  const UI_KEY = "tuf-practice-ui-v1";
  const RING = 97.39;
  const STRIPES = ["#e24b20", "#1f7a45", "#1f4e79", "#a15c07", "#6b3fa0", "#0f6e6e"];

  const $ = (id) => document.getElementById(id);
  const els = {
    q: $("q"),
    list: $("list"),
    nav: $("nav"),
    shown: $("shown"),
    legend: $("legend"),
    toast: $("toast"),
    diffs: $("diffs"),
    diffBars: $("diff-bars"),
    file: $("file"),
  };

  let saveWarned = false;
  let toastTimer = 0;
  let nextId = "";
  let db = null;
  let syncTimer = 0;

  function blank() {
    return { done: false, revision: false, revisions: 0, revisit: false, note: "", doneAt: "", updatedAt: "", deleted: false };
  }

  function isProblemId(id) {
    return id.startsWith("a2z-") || id.startsWith("tuf-");
  }

  function normalizeEntry(val) {
    if (!val || typeof val !== "object") return null;
    return {
      done: !!val.done,
      revision: !!val.revision,
      revisions: Math.max(0, Number(val.revisions) || 0),
      revisit: !!val.revisit,
      note: typeof val.note === "string" ? val.note.slice(0, 4000) : "",
      doneAt: typeof val.doneAt === "string" ? val.doneAt : "",
      updatedAt: typeof val.updatedAt === "string" ? val.updatedAt : "",
      deleted: !!val.deleted,
    };
  }

  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      const out = {};
      if (!raw || typeof raw !== "object") return out;
      for (const [id, val] of Object.entries(raw)) {
        if (!isProblemId(id)) continue;
        const entry = normalizeEntry(val);
        if (entry) out[id] = entry;
      }
      return out;
    } catch {
      return {};
    }
  }

  function loadUi() {
    const base = { sheet: "a2z", status: "all", difficulty: "all", query: "", collapsed: {} };
    try {
      const raw = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
      if (!raw || typeof raw !== "object") return base;
      if (raw.sheet === "tracking") base.sheet = "tracking";
      if (["all", "left", "done", "revisit"].includes(raw.status)) base.status = raw.status;
      if (["all", "easy", "medium", "hard"].includes(raw.difficulty)) base.difficulty = raw.difficulty;
      if (raw.collapsed && typeof raw.collapsed === "object") base.collapsed = raw.collapsed;
      return base;
    } catch {
      return base;
    }
  }

  const progress = loadProgress();
  const ui = loadUi();

  function saveLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(progress));
      return true;
    } catch {
      if (!saveWarned) {
        saveWarned = true;
        toast("This browser blocked local saving. Connect Supabase so the checks have a database.");
      }
      setStatus("error", "Not saved in this browser");
      return false;
    }
  }

  function saveProgress() {
    saveLocal();
    scheduleSync();
  }

  function saveUi() {
    try {
      localStorage.setItem(
        UI_KEY,
        JSON.stringify({
          sheet: ui.sheet,
          status: ui.status,
          difficulty: ui.difficulty,
          collapsed: ui.collapsed,
        })
      );
    } catch {
      /* UI memory is optional */
    }
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function entry(id) {
    const stored = progress[id];
    if (!stored || stored.deleted) return blank();
    return { ...blank(), ...stored, deleted: false };
  }

  function write(id, patch) {
    const cur = entry(id);
    const next = { ...cur, ...patch, deleted: false, updatedAt: new Date().toISOString() };
    if (Object.prototype.hasOwnProperty.call(patch, "done")) {
      if (next.done && !cur.done) next.doneAt = new Date().toISOString();
      if (!next.done) next.doneAt = "";
    }
    const empty =
      !next.done && !next.revision && !next.revisit && !next.note.trim() && !(next.revisions > 0) && !next.doneAt;
    progress[id] = empty ? { ...blank(), deleted: true, updatedAt: next.updatedAt } : next;
    saveProgress();
    return entry(id);
  }

  function sectionsOf(which) {
    if (which === "a2z") {
      return DATA.a2z.map((step, index) => ({
        id: step.id,
        title: step.name,
        short: "Step " + (index + 1),
        topic: step.topics[0] ? step.topics[0].name : "",
        groups: step.topics.map((topic, gi) => ({
          id: step.id + "-g" + gi,
          name: topic.name,
          problems: topic.problems,
        })),
      }));
    }
    return DATA.tracking.map((topic) => ({
      id: topic.id,
      title: topic.name,
      short: topic.name,
      topic: "Topic",
      groups: topic.groups.map((group, gi) => ({
        id: topic.id + "-g" + gi,
        name: group.name,
        problems: group.problems,
      })),
    }));
  }

  const INDEX = new Map();
  for (const which of ["a2z", "tracking"]) {
    for (const section of sectionsOf(which)) {
      for (const group of section.groups) {
        for (const problem of group.problems) {
          INDEX.set(problem.id, { problem, section, group, sheet: which });
        }
      }
    }
  }

  function sheet() {
    return ui.sheet === "tracking" ? "tracking" : "a2z";
  }

  function problemsIn(section) {
    const list = [];
    for (const group of section.groups) {
      for (const problem of group.problems) list.push(problem);
    }
    return list;
  }

  function counts(problems) {
    let done = 0;
    let revisit = 0;
    let revision = 0;
    let revisionMarks = 0;
    for (const problem of problems) {
      const item = entry(problem.id);
      if (item.done) done += 1;
      if (item.revisit) revisit += 1;
      if (item.revision) revision += 1;
      revisionMarks += item.revisions || 0;
    }
    return { total: problems.length, done, revisit, revision, revisionMarks, left: problems.length - done };
  }

  function visible(problem, section, group) {
    const item = entry(problem.id);
    if (ui.status === "left" && item.done) return false;
    if (ui.status === "done" && !item.done) return false;
    if (ui.status === "revisit" && !item.revisit) return false;
    if (sheet() === "a2z" && ui.difficulty !== "all") {
      if ((problem.difficulty || "").toLowerCase() !== ui.difficulty) return false;
    }
    const query = ui.query.trim().toLowerCase();
    if (!query) return true;
    const hay = [problem.name, section.title, section.topic, group.name, problem.difficulty || ""]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function pct(done, total) {
    if (!total || !done) return 0;
    const value = (done / total) * 100;
    if (value < 1) return 1;
    return Math.round(value);
  }

  function renderTabs() {
    for (const which of ["a2z", "tracking"]) {
      const button = $("tab-" + which);
      const problems = [];
      for (const section of sectionsOf(which)) problems.push(...problemsIn(section));
      const stat = counts(problems);
      button.setAttribute("aria-selected", which === sheet() ? "true" : "false");
      $("tab-" + which + "-count").textContent = stat.done + " / " + stat.total + " completed";
    }
    els.diffs.hidden = sheet() !== "a2z";
    els.diffBars.hidden = sheet() !== "a2z";
    els.legend.textContent =
      sheet() === "a2z"
        ? "Columns match the A2Z checklist: Completed, Revision, and Revisit. The level on each row is the Easy / Medium / Hard mark from the sheet."
        : "Columns match the TUF+ tracking sheet: Completed, Revision count, and Revisit. Use + and − each time you revise a problem.";
  }

  function renderFilters() {
    document.querySelectorAll("#filters button").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.status === ui.status ? "true" : "false");
    });
    document.querySelectorAll("#diffs button").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.diff === ui.difficulty ? "true" : "false");
    });
  }

  function renderStats() {
    const sections = sectionsOf(sheet());
    const problems = [];
    for (const section of sections) problems.push(...problemsIn(section));
    const stat = counts(problems);
    const percent = pct(stat.done, stat.total);
    $("ring-pct").textContent = percent + "%";
    $("ring").style.strokeDashoffset = String(RING * (1 - percent / 100));
    $("m-done").textContent = String(stat.done);
    $("m-done-sub").textContent = "of " + stat.total;
    $("m-left").textContent = String(stat.left);
    $("m-revisit").textContent = String(stat.revisit);

    if (sheet() === "a2z") {
      $("m-rev-label").textContent = "Revision";
      $("m-rev").textContent = String(stat.revision);
      $("m-rev-sub").textContent = "marked revised";
      for (const level of ["easy", "medium", "hard"]) {
        const subset = problems.filter((problem) => (problem.difficulty || "").toLowerCase() === level);
        const sub = counts(subset);
        $(level + "-label").textContent = sub.done + "/" + sub.total;
        $(level + "-bar").style.width = pct(sub.done, sub.total) + "%";
      }
    } else {
      $("m-rev-label").textContent = "Revisions";
      $("m-rev").textContent = String(stat.revisionMarks);
      $("m-rev-sub").textContent = "times counted";
    }

    const upcoming = problems.find((problem) => !entry(problem.id).done);
    const go = $("upnext-go");
    const surprise = $("surprise");
    if (!upcoming) {
      nextId = "";
      $("upnext-kicker").textContent = "Sheet complete";
      $("upnext-name").textContent = "Every problem on this sheet is checked off.";
      $("upnext-where").textContent = "Revisit flags are still listed if you want another pass.";
      go.hidden = true;
      surprise.disabled = true;
    } else {
      const hit = INDEX.get(upcoming.id);
      nextId = upcoming.id;
      $("upnext-kicker").textContent = "Up next";
      $("upnext-name").textContent = upcoming.name;
      $("upnext-where").textContent = hit.section.short + (hit.section.topic && sheet() === "a2z" ? " · " + hit.section.topic : "");
      go.hidden = false;
      surprise.disabled = false;
    }
  }

  function renderNav() {
    const sections = sectionsOf(sheet());
    const searching = ui.query.trim().length > 0;
    els.nav.innerHTML = sections
      .map((section) => {
        const stat = counts(problemsIn(section));
        const shown = problemsIn(section).filter((problem) => {
          const group = section.groups.find((item) => item.problems.includes(problem));
          return visible(problem, section, group);
        }).length;
        if (searching && shown === 0 && ui.status === "all" && ui.difficulty === "all") return "";
        if ((ui.status !== "all" || ui.difficulty !== "all" || searching) && shown === 0) return "";
        return (
          '<button type="button" data-jump="' +
          esc(section.id) +
          '"><span class="nav-kicker">' +
          esc(section.short) +
          '</span><span class="nav-title">' +
          esc(sheet() === "a2z" ? section.topic : section.title) +
          '</span><span class="nav-count">' +
          stat.done +
          "/" +
          stat.total +
          "</span></button>"
        );
      })
      .join("");
  }

  function checksHtml(problem) {
    const item = entry(problem.id);
    if (sheet() === "tracking") {
      return (
        '<label class="tick"><input type="checkbox" data-field="done"' +
        (item.done ? " checked" : "") +
        '><span>Completed</span></label>' +
        '<div class="stepper-wrap' +
        (item.revisions > 0 ? " on" : "") +
        '"><span>Revision count</span><div class="stepper"><button type="button" data-step="-1" aria-label="Decrease revision count">−</button><strong data-count>' +
        item.revisions +
        '</strong><button type="button" data-step="1" aria-label="Increase revision count">+</button></div></div>' +
        '<label class="tick flag"><input type="checkbox" data-field="revisit"' +
        (item.revisit ? " checked" : "") +
        '><span>Revisit</span></label>'
      );
    }
    return (
      '<label class="tick"><input type="checkbox" data-field="done"' +
      (item.done ? " checked" : "") +
      '><span>Completed</span></label>' +
      '<label class="tick rev"><input type="checkbox" data-field="revision"' +
      (item.revision ? " checked" : "") +
      '><span>Revision</span></label>' +
      '<label class="tick flag"><input type="checkbox" data-field="revisit"' +
      (item.revisit ? " checked" : "") +
      '><span>Revisit</span></label>'
    );
  }

  function problemHtml(problem) {
    const item = entry(problem.id);
    const classes = ["problem"];
    if (item.done) classes.push("is-done");
    if (item.revisit) classes.push("is-revisit");
    const diff = problem.difficulty
      ? '<span class="diff ' + esc(problem.difficulty.toLowerCase()) + '">' + esc(problem.difficulty) + "</span>"
      : "";
    const when = item.done && item.doneAt ? "Completed " + formatDate(item.doneAt) : "";
    return (
      '<article class="' +
      classes.join(" ") +
      '" id="row-' +
      esc(problem.id) +
      '" data-id="' +
      esc(problem.id) +
      '"><span class="num">' +
      problem.n +
      '</span><div class="main"><div class="name-line"><h3>' +
      esc(problem.name) +
      "</h3>" +
      diff +
      '</div><p class="when" data-date>' +
      esc(when) +
      '</p></div><div class="checks">' +
      checksHtml(problem) +
      '<button type="button" class="note-btn' +
      (item.note.trim() ? " has-note" : "") +
      '" data-note-btn>' +
      (item.note.trim() ? "Note" : "Add note") +
      '</button></div><div class="note"><textarea data-note rows="3" placeholder="Pattern, mistake, or what to remember next time">' +
      esc(item.note) +
      "</textarea></div></article>"
    );
  }

  function meter(done, total) {
    return (
      '<div class="meter"><b>' +
      done +
      " / " +
      total +
      '</b><i><em style="width:' +
      pct(done, total) +
      '%"></em></i></div>'
    );
  }

  function renderList() {
    const sections = sectionsOf(sheet());
    const forceOpen = ui.query.trim().length > 0;
    let shown = 0;
    const html = [];

    sections.forEach((section, index) => {
      const blocks = [];
      const multi = section.groups.length > 1;
      for (const group of section.groups) {
        const rows = group.problems.filter((problem) => visible(problem, section, group));
        shown += rows.length;
        if (!rows.length) continue;
        const groupOpen = forceOpen || !ui.collapsed[group.id];
        if (multi) {
          const stat = counts(group.problems);
          blocks.push(
            '<div class="group' +
              (groupOpen ? "" : " collapsed") +
              '" id="' +
              esc(group.id) +
              '"><div class="group-head"><button type="button" data-collapse="' +
              esc(group.id) +
              '" aria-expanded="' +
              (groupOpen ? "true" : "false") +
              '"><span class="chevron" aria-hidden="true"></span><strong>' +
              esc(group.name) +
              "</strong></button>" +
              meter(stat.done, stat.total) +
              '</div><div class="group-body">' +
              rows.map(problemHtml).join("") +
              "</div></div>"
          );
        } else {
          blocks.push(rows.map(problemHtml).join(""));
        }
      }
      if (!blocks.length) return;
      const open = forceOpen || !ui.collapsed[section.id];
      const stat = counts(problemsIn(section));
      const kicker = sheet() === "a2z" ? section.topic : "Topic";
      html.push(
        '<section class="section' +
          (open ? "" : " collapsed") +
          '" id="' +
          esc(section.id) +
          '" style="--stripe:' +
          STRIPES[index % STRIPES.length] +
          '"><div class="section-head"><button type="button" data-collapse="' +
          esc(section.id) +
          '" aria-expanded="' +
          (open ? "true" : "false") +
          '"><span class="chevron" aria-hidden="true"></span><span><span class="kicker-inline">' +
          esc(kicker) +
          "</span><strong>" +
          esc(section.title) +
          "</strong></span></button>" +
          meter(stat.done, stat.total) +
          '</div><div class="section-body">' +
          blocks.join("") +
          "</div></section>"
      );
    });

    if (!html.length) {
      els.list.innerHTML =
        '<div class="empty"><p>Nothing matches this search or filter.</p><p>Clear the search, or switch the status filter back to All.</p></div>';
    } else {
      els.list.innerHTML = html.join("");
    }
    const sheetTotal = sections.reduce((sum, section) => sum + problemsIn(section).length, 0);
    els.shown.textContent = shown === sheetTotal ? shown + " problems" : shown + " shown of " + sheetTotal;
  }

  function syncRow(row) {
    const id = row.dataset.id;
    const item = entry(id);
    row.classList.toggle("is-done", item.done);
    row.classList.toggle("is-revisit", item.revisit);
    row.querySelectorAll("input[data-field]").forEach((input) => {
      input.checked = !!item[input.dataset.field];
    });
    const count = row.querySelector("[data-count]");
    if (count) count.textContent = String(item.revisions || 0);
    const stepper = row.querySelector(".stepper-wrap");
    if (stepper) stepper.classList.toggle("on", item.revisions > 0);
    const date = row.querySelector("[data-date]");
    if (date) date.textContent = item.done && item.doneAt ? "Completed " + formatDate(item.doneAt) : "";
    const noteBtn = row.querySelector("[data-note-btn]");
    if (noteBtn) {
      noteBtn.classList.toggle("has-note", !!item.note.trim());
      noteBtn.textContent = item.note.trim() ? "Note" : "Add note";
    }
  }

  function refreshMeters() {
    document.querySelectorAll(".section, .group").forEach((node) => {
      const hit = node.classList.contains("section")
        ? sectionsOf(sheet()).find((section) => section.id === node.id)
        : null;
      let problems = [];
      if (hit) problems = problemsIn(hit);
      else {
        const section = sectionsOf(sheet()).find((item) => item.groups.some((group) => group.id === node.id));
        const group = section && section.groups.find((item) => item.id === node.id);
        problems = group ? group.problems : [];
      }
      if (!problems.length) return;
      const stat = counts(problems);
      const meterNode = node.querySelector(":scope > .section-head .meter, :scope > .group-head .meter");
      if (!meterNode) return;
      meterNode.querySelector("b").textContent = stat.done + " / " + stat.total;
      meterNode.querySelector("em").style.width = pct(stat.done, stat.total) + "%";
    });
  }

  function updateShown() {
    const n = els.list.querySelectorAll(".problem").length;
    const sheetTotal = sectionsOf(sheet()).reduce((sum, section) => sum + problemsIn(section).length, 0);
    els.shown.textContent = n === sheetTotal ? n + " problems" : n + " shown of " + sheetTotal;
  }

  function prune(row) {
    const group = row.closest(".group");
    const section = row.closest(".section");
    row.remove();
    if (group && !group.querySelector(".problem")) group.remove();
    if (section && !section.querySelector(".problem")) section.remove();
    if (!els.list.querySelector(".problem")) renderList();
  }

  function render() {
    renderTabs();
    renderFilters();
    renderStats();
    renderNav();
    renderList();
  }

  function jumpTo(id) {
    const hit = INDEX.get(id);
    if (!hit) return;
    ui.sheet = hit.sheet;
    ui.query = "";
    ui.status = "all";
    ui.difficulty = "all";
    els.q.value = "";
    ui.collapsed[hit.section.id] = false;
    ui.collapsed[hit.group.id] = false;
    saveUi();
    render();
    requestAnimationFrame(() => {
      const row = document.getElementById("row-" + id);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.remove("flash");
      void row.offsetWidth;
      row.classList.add("flash");
      document.querySelectorAll("#nav button").forEach((button) => {
        button.classList.toggle("active", button.dataset.jump === hit.section.id);
      });
    });
  }

  function surprise() {
    const pool = [];
    for (const section of sectionsOf(sheet())) {
      for (const problem of problemsIn(section)) {
        if (!entry(problem.id).done) pool.push(problem.id);
      }
    }
    if (!pool.length) {
      toast("Nothing left on this sheet.");
      return;
    }
    jumpTo(pool[Math.floor(Math.random() * pool.length)]);
  }

  $("tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sheet]");
    if (!button || button.dataset.sheet === sheet()) return;
    ui.sheet = button.dataset.sheet;
    saveUi();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-status]");
    if (!button) return;
    ui.status = button.dataset.status;
    saveUi();
    renderFilters();
    renderNav();
    renderList();
  });

  els.diffs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-diff]");
    if (!button) return;
    ui.difficulty = button.dataset.diff;
    saveUi();
    renderFilters();
    renderNav();
    renderList();
  });

  els.q.addEventListener("input", () => {
    ui.query = els.q.value;
    renderNav();
    renderList();
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
      event.preventDefault();
      els.q.focus();
    }
  });

  $("expand").addEventListener("click", () => {
    for (const section of sectionsOf(sheet())) {
      ui.collapsed[section.id] = false;
      for (const group of section.groups) ui.collapsed[group.id] = false;
    }
    saveUi();
    renderList();
  });

  $("collapse").addEventListener("click", () => {
    for (const section of sectionsOf(sheet())) {
      ui.collapsed[section.id] = true;
      for (const group of section.groups) ui.collapsed[group.id] = true;
    }
    saveUi();
    renderList();
  });

  els.nav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-jump]");
    if (!button) return;
    const id = button.dataset.jump;
    ui.collapsed[id] = false;
    saveUi();
    const node = document.getElementById(id);
    if (node) {
      node.classList.remove("collapsed");
      const toggle = node.querySelector("[data-collapse]");
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    document.querySelectorAll("#nav button").forEach((item) => item.classList.toggle("active", item === button));
  });

  els.list.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-field]");
    if (!input) return;
    const row = input.closest(".problem");
    const id = row.dataset.id;
    write(id, { [input.dataset.field]: input.checked });
    syncRow(row);
    renderTabs();
    renderStats();
    renderNav();
    refreshMeters();
    const hit = INDEX.get(id);
    if (hit && !visible(hit.problem, hit.section, hit.group)) prune(row);
    updateShown();
  });

  els.list.addEventListener("click", (event) => {
    const stepBtn = event.target.closest("[data-step]");
    if (stepBtn) {
      const row = stepBtn.closest(".problem");
      const item = entry(row.dataset.id);
      write(row.dataset.id, { revisions: Math.max(0, (item.revisions || 0) + Number(stepBtn.dataset.step)) });
      syncRow(row);
      renderStats();
      return;
    }
    const noteBtn = event.target.closest("[data-note-btn]");
    if (noteBtn) {
      const row = noteBtn.closest(".problem");
      row.classList.toggle("show-note");
      if (row.classList.contains("show-note")) row.querySelector("textarea").focus();
      return;
    }
    const collapse = event.target.closest("[data-collapse]");
    if (collapse) {
      const id = collapse.dataset.collapse;
      ui.collapsed[id] = !ui.collapsed[id];
      saveUi();
      const node = document.getElementById(id);
      const collapsed = !!ui.collapsed[id];
      node.classList.toggle("collapsed", collapsed);
      collapse.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  });

  els.list.addEventListener("input", (event) => {
    const area = event.target.closest("textarea[data-note]");
    if (!area) return;
    const row = area.closest(".problem");
    write(row.dataset.id, { note: area.value });
    const noteBtn = row.querySelector("[data-note-btn]");
    noteBtn.classList.toggle("has-note", !!area.value.trim());
    noteBtn.textContent = area.value.trim() ? "Note" : "Add note";
  });

  $("upnext-go").addEventListener("click", () => {
    if (nextId) jumpTo(nextId);
  });
  $("surprise").addEventListener("click", surprise);

  $("export").addEventListener("click", () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      progress,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = "tuf-practice-tracker-" + stamp + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("Backup downloaded.");
  });

  $("import").addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", () => {
    const file = els.file.files && els.file.files[0];
    els.file.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const map = data && data.progress && typeof data.progress === "object" ? data.progress : data;
        if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("bad");
        let kept = 0;
        for (const [id, val] of Object.entries(map)) {
          if ((!id.startsWith("a2z-") && !id.startsWith("tuf-")) || !val || typeof val !== "object") continue;
          const next = normalizeEntry(val);
          if (!next) continue;
          next.updatedAt = new Date().toISOString();
          progress[id] = next;
          kept += 1;
        }
        saveProgress();
        render();
        toast(kept ? "Imported " + kept + " saved rows." : "That backup had no tracker rows.");
      } catch {
        toast("That file is not a tracker backup.");
      }
    };
    reader.readAsText(file);
  });

  $("reset").addEventListener("click", () => {
    const name = sheet() === "a2z" ? "A2Z sheet" : "TUF+ tracking sheet";
    if (!window.confirm("Clear every check, revision, revisit flag, and note on the " + name + "?")) return;
    const prefix = sheet() === "a2z" ? "a2z-" : "tuf-";
    const now = new Date().toISOString();
    for (const id of Object.keys(progress)) {
      if (id.startsWith(prefix)) progress[id] = { ...blank(), deleted: true, updatedAt: now };
    }
    saveProgress();
    render();
    toast(name + " progress cleared.");
  });

  function setStatus(kind, detail) {
    const el = $("save-state");
    if (!el) return;
    el.className = "save-state " + kind;
    if (kind === "local") el.textContent = "Saved on this browser";
    else if (kind === "remote") el.textContent = "Saved to Supabase";
    else if (kind === "saving") el.textContent = "Saving…";
    else el.textContent = detail || "Database not saved";
  }

  function dbConfig() {
    const file = window.TRACKER_CONFIG || {};
    return {
      url: String(file.supabaseUrl || "").trim(),
      key: String(file.supabaseKey || "").trim(),
    };
  }

  function replaceProgress(next) {
    for (const id of Object.keys(progress)) delete progress[id];
    Object.assign(progress, next);
  }

  function mergeProgress(local, remote) {
    const out = {};
    const ids = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    for (const id of ids) {
      if (!isProblemId(id)) continue;
      const left = local && local[id] ? normalizeEntry(local[id]) : null;
      const right = remote && remote[id] ? normalizeEntry(remote[id]) : null;
      if (left && right) out[id] = (left.updatedAt || "") >= (right.updatedAt || "") ? left : right;
      else if (left) out[id] = left;
      else if (right) out[id] = right;
    }
    return out;
  }

  function loadSdk() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load the Supabase client."));
      document.head.appendChild(script);
    });
  }

  function scheduleSync() {
    if (!db) {
      setStatus(saveWarned ? "error" : "local");
      return;
    }
    setStatus("saving");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      pushRemote();
    }, 450);
  }

  async function pushRemote() {
    if (!db) return;
    setStatus("saving");
    const loaded = await db.from("tracker").select("progress").eq("id", "main").maybeSingle();
    if (loaded.error) {
      setStatus("error", tableHint(loaded.error.message));
      return;
    }
    const remote = loaded.data && loaded.data.progress ? loaded.data.progress : {};
    const before = JSON.stringify(progress);
    const merged = mergeProgress(progress, remote);
    replaceProgress(merged);
    saveLocal();
    const saved = await db.from("tracker").upsert({
      id: "main",
      progress: merged,
      updated_at: new Date().toISOString(),
    });
    if (saved.error) {
      setStatus("error", tableHint(saved.error.message));
      return;
    }
    setStatus("remote");
    const typing = document.activeElement && document.activeElement.matches("textarea, input");
    if (JSON.stringify(progress) !== before && !typing) render();
  }

  function tableHint(message) {
    if (/relation|schema cache|does not exist|permission|row-level/i.test(message || "")) {
      return "Connected, but the tracker table is missing. Run supabase.sql in the Supabase SQL editor.";
    }
    return "Saved on this browser. Database did not update.";
  }

  async function bootDatabase() {
    const cfg = dbConfig();
    if (!cfg.url || !cfg.key) {
      setStatus("local");
      return;
    }
    try {
      await loadSdk();
      db = window.supabase.createClient(cfg.url, cfg.key);
      await pushRemote();
    } catch (error) {
      setStatus("error", error.message || "Could not connect to Supabase.");
    }
  }

  render();
  bootDatabase();
})();
