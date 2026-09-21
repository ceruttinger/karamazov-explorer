(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function csv(filename) {
    const response = await fetch(`data/public/${filename}`);
    if (!response.ok) throw new Error(`Could not load ${filename}`);
    const text = await response.text();

    const lines = text.trim().split(/\r?\n/);
    const headers = parseCSVLine(lines[0]);

    return lines.slice(1).map(line => {
      const values = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => obj[h] = values[i] ?? "");
      return obj;
    });
  }

  function parseCSVLine(line) {
    const result = [];
    let current = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }

    result.push(current);
    return result;
  }

  async function renderChapters() {
    const el = document.getElementById("bk-chapters");
    if (!el) return;

    const rows = await csv("chapters.csv");

    el.innerHTML = rows.map(r => `
      <article class="bk-item">
        <h3>${escapeHtml(r.chapter_title || `Chapter ${r.chapter}`)}</h3>
        <div class="bk-meta">
          Part ${escapeHtml(r.part)} ·
          Book ${escapeHtml(r.book)}
          ${r.book_title ? ` · ${escapeHtml(r.book_title)}` : ""}
        </div>
      </article>
    `).join("");
  }

  async function renderCharacters() {
    const el = document.getElementById("bk-characters");
    if (!el) return;

    const rows = await csv("characters.csv");

    rows.sort((a, b) =>
      Number(b.mentions || 0) - Number(a.mentions || 0)
    );

    el.innerHTML = rows.map(r => `
      <article class="bk-item">
        <h3>${escapeHtml(r.canonical_name)}</h3>

        <div class="bk-meta">
          ${Number(r.mentions || 0).toLocaleString()} mentions ·
          ${Number(r.passages || 0).toLocaleString()} passages ·
          first seen at narrative position
          ${escapeHtml(r.first_position)}
        </div>

        ${r.aliases ? `
          <p><strong>Aliases:</strong>
          ${escapeHtml(r.aliases)}</p>
        ` : ""}
      </article>
    `).join("");
  }

  async function renderRelationships() {
    const el = document.getElementById("bk-relationships");
    if (!el) return;

    const rows = await csv("relationships.csv");

    rows.sort((a, b) =>
      Number(b.confidence || 0) - Number(a.confidence || 0)
    );

    el.innerHTML = rows.slice(0, 300).map(r => `
      <article class="bk-item">
        <h3>
          ${escapeHtml(r.subject_name)}
          →
          ${escapeHtml(r.effective_predicate || r.predicate)}
          →
          ${escapeHtml(r.object_name)}
        </h3>

        <div class="bk-meta">
          confidence ${escapeHtml(r.confidence)} ·
          ${escapeHtml(r.epistemic_status)} ·
          first knowable at position
          ${escapeHtml(r.first_known_position)}
        </div>

        <div class="bk-meta">
          Evidence:
          ${escapeHtml(r.evidence_passage_id)}
        </div>
      </article>
    `).join("");
  }

  async function renderThemes() {
    const el = document.getElementById("bk-themes");
    if (!el) return;

    const concepts = await csv("concepts.csv");
    const links = await csv("passage_concepts.csv");

    const counts = {};

    links.forEach(r => {
      counts[r.concept_id] =
        (counts[r.concept_id] || 0) + 1;
    });

    el.innerHTML = concepts.map(r => `
      <article class="bk-item">
        <h3>${escapeHtml(r.concept_name)}</h3>

        <p>${escapeHtml(r.definition || "")}</p>

        <div class="bk-meta">
          Appears in
          ${(counts[r.concept_id] || 0).toLocaleString()}
          passages
        </div>
      </article>
    `).join("");
  }

  async function renderPassages() {
    const el = document.getElementById("bk-passages");
    if (!el) return;

    const response =
      await fetch("data/public/passage_index.json");

    const passages = await response.json();

    el.innerHTML = passages.slice(0, 100).map(p => `
      <article class="bk-item">
        <h3>${escapeHtml(p.citation_label)}</h3>

        <p>${escapeHtml(p.text)}</p>

        <div class="bk-meta">
          Narrative position:
          ${escapeHtml(p.narrative_position)}
        </div>
      </article>
    `).join("");

    if (passages.length > 100) {
      el.insertAdjacentHTML(
        "beforeend",
        `<p class="bk-meta">
          Showing the first 100 of
          ${passages.length.toLocaleString()}
          passages. Use Search to explore the complete corpus.
        </p>`
      );
    }
  }

  async function run() {
    try {
      await Promise.all([
        renderChapters(),
        renderCharacters(),
        renderRelationships(),
        renderThemes(),
        renderPassages()
      ]);
    } catch (err) {
      console.error(err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
