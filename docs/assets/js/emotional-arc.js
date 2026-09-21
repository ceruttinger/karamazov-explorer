console.log(">>> EMOTIONAL ARC SCRIPT EXECUTING <<<");
(function () {
  "use strict";

  const BK = window.BK || {};

  let passages = [];
  let chapters = [];
  let characters = [];

  let selectedMeasures = new Set(["afinn"]);
  let selectedChapter = "";

  const measures = {
    afinn: {
      label: "Net sentiment",
      field: "afinn_per_100_words",
      description: "AFINN lexical sentiment per 100 words",
      signed: true
    },
    joy: {
      label: "Joy",
      field: "joy_per_100",
      description: "NRC joy terms per 100 words"
    },
    sadness: {
      label: "Sadness",
      field: "sadness_per_100",
      description: "NRC sadness terms per 100 words"
    },
    fear: {
      label: "Fear",
      field: "fear_per_100",
      description: "NRC fear terms per 100 words"
    },
    anger: {
      label: "Anger",
      field: "anger_per_100",
      description: "NRC anger terms per 100 words"
    },
    trust: {
      label: "Trust",
      field: "trust_per_100",
      description: "NRC trust terms per 100 words"
    },
    disgust: {
      label: "Disgust",
      field: "disgust_per_100",
      description: "NRC disgust terms per 100 words"
    },
    anticipation: {
      label: "Anticipation",
      field: "anticipation_per_100",
      description: "NRC anticipation terms per 100 words"
    },
    surprise: {
      label: "Surprise",
      field: "surprise_per_100",
      description: "NRC surprise terms per 100 words"
    }
  };

  const fingerprintMeasures = [
    "joy", "sadness", "fear", "anger",
    "trust", "disgust", "anticipation", "surprise"
  ];

  function esc(v) {
    return BK.escapeHTML
      ? BK.escapeHTML(v)
      : String(v ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
  }

  function cutoff() {
    return BK.getReaderPosition
      ? BK.getReaderPosition()
      : Number.MAX_SAFE_INTEGER;
  }

  function allowed(position) {
    if (position === null || position === undefined || position === "") {
      return true;
    }
    return Number(position) <= cutoff();
  }

  function chapterKey(x) {
    return `${x.part}|${x.book}|${x.chapter}`;
  }

  function chapterLabel(x) {
    return `Part ${x.part} · Book ${x.book} · Chapter ${x.chapter}`;
  }

  function shortName(name) {
    return String(name || "")
      .replace("Fyodorovich ", "")
      .replace("Pavlovich ", "");
  }

  function visibleChapters() {
    return chapters
      .filter(c => allowed(c.max_narrative_position))
      .sort((a, b) =>
        Number(a.chapter_order) - Number(b.chapter_order)
      );
  }

  function visiblePassages() {
    return passages.filter(p => allowed(p.narrative_position));
  }

  function currentLens() {
    return document.getElementById("bk-emotion-lens")?.value || "novel";
  }

  function selectedCharacter() {
    return document.getElementById("bk-emotion-character")?.value || "";
  }

  function characterById(id) {
    return characters.find(c => c.entity_id === id);
  }

  function passageHasCharacter(passage, id) {
    if (!id) return true;

    const character = characterById(id);
    if (!character) return false;

    const names = Array.isArray(passage.entities_mentioned)
      ? passage.entities_mentioned
      : [];

    return names.includes(character.canonical_name);
  }

  function analyticalPassages() {
    let rows = visiblePassages();

    if (currentLens() === "character") {
      const id = selectedCharacter();
      rows = rows.filter(p => passageHasCharacter(p, id));
    }

    return rows;
  }

  /*
   * Weighted chapter mean.
   *
   * Each passage metric is expressed per 100 words, so weighting by
   * passage word count prevents a tiny passage from having the same
   * influence as a much longer passage.
   */
  function chapterMetric(chapter, measureKey) {
    const field = measures[measureKey].field;

    const rows = analyticalPassages().filter(
      p => chapterKey(p) === chapterKey(chapter)
    );

    if (!rows.length) return null;

    let numerator = 0;
    let denominator = 0;

    rows.forEach(p => {
      const value = Number(p[field]);
      const words = Number(p.word_count || 0);

      if (!Number.isFinite(value) || words <= 0) return;

      numerator += value * words;
      denominator += words;
    });

    if (!denominator) return null;

    return numerator / denominator;
  }

  function chapterRows(measureKey) {
    return visibleChapters().map(chapter => ({
      chapter,
      value: chapterMetric(chapter, measureKey)
    }));
  }

  function renderMeasurePills() {
    const target = document.getElementById("bk-emotion-measures");
    if (!target) return;

    const compare =
      document.getElementById("bk-emotion-view")?.value === "compare";

    target.innerHTML = Object.entries(measures).map(([key, m]) => `
      <label class="bk-theme-pill">
        <input
          type="${compare ? "checkbox" : "radio"}"
          name="${compare ? "emotion-compare" : "emotion-single"}"
          value="${key}"
          ${selectedMeasures.has(key) ? "checked" : ""}
        >
        <span>${esc(m.label)}</span>
      </label>
    `).join("");

    target.querySelectorAll("input").forEach(input => {
      input.addEventListener("change", () => {
        if (compare) {
          if (input.checked) {
            selectedMeasures.add(input.value);
          } else {
            selectedMeasures.delete(input.value);
          }
        } else {
          selectedMeasures = new Set([input.value]);
        }

        if (!selectedMeasures.size) {
          selectedMeasures.add("afinn");
        }

        selectedChapter = "";
        renderEverything();
      });
    });
  }

  function renderStatus() {
    const target = document.getElementById("bk-emotion-status");
    if (!target) return;

    let lens = "Whole novel";

    if (currentLens() === "character") {
      const c = characterById(selectedCharacter());
      lens = c
        ? `Passages containing ${c.canonical_name}`
        : "Character context";
    }

    const measureLabels = [...selectedMeasures]
      .map(k => measures[k]?.label)
      .filter(Boolean)
      .join(" · ");

    target.innerHTML = `
      <strong>${esc(lens)}</strong>
      <span>
        ${esc(measureLabels)} ·
        ${visibleChapters().length} chapters visible
      </span>
    `;
  }

  function renderChart() {
    const target = document.getElementById("bk-emotion-chart");
    if (!target || !window.Plotly) return;

    const keys = [...selectedMeasures];

    const traces = keys.map(key => {
      const rows = chapterRows(key)
        .filter(r => r.value !== null);

      return {
        type: "scatter",
        mode: "lines+markers",
        name: measures[key].label,

        x: rows.map(r => Number(r.chapter.chapter_order)),
        y: rows.map(r => r.value),

        customdata: rows.map(r => chapterKey(r.chapter)),

        text: rows.map(r =>
          `${chapterLabel(r.chapter)}` +
          `${r.chapter.chapter_title
            ? "<br>" + r.chapter.chapter_title
            : ""}`
        ),

        hovertemplate:
          "%{text}<br>" +
          `${measures[key].label}: %{y:.2f}` +
          "<extra></extra>"
      };
    });

    let title = "Emotional language across the novel";

    if (currentLens() === "character") {
      const c = characterById(selectedCharacter());
      if (c) {
        title = `Emotional context around ${shortName(c.canonical_name)}`;
      }
    }

    const titleNode =
      document.getElementById("bk-emotion-chart-title");

    if (titleNode) titleNode.textContent = title;

    Plotly.newPlot(
      target,
      traces,
      {
        margin: { l: 60, r: 25, t: 35, b: 60 },
        hovermode: "closest",

        xaxis: {
          title: "Chapter progression",
          showgrid: false
        },

        yaxis: {
          title: "Lexical score per 100 words"
        },

        legend: {
          orientation: "h",
          y: 1.12
        },

        shapes:
          keys.includes("afinn")
            ? [{
                type: "line",
                xref: "paper",
                x0: 0,
                x1: 1,
                y0: 0,
                y1: 0,
                line: {
                  width: 1,
                  dash: "dot"
                }
              }]
            : []
      },
      {
        responsive: true,
        displaylogo: false
      }
    );

    target.on("plotly_click", event => {
      const point = event?.points?.[0];
      if (!point) return;

      selectedChapter = String(point.customdata || "");

      renderInspector();
      renderEvidence();
    });
  }

  function selectedChapterObject() {
    return chapters.find(c => chapterKey(c) === selectedChapter);
  }

  function chapterPassages() {
    if (!selectedChapter) return [];

    return analyticalPassages().filter(
      p => chapterKey(p) === selectedChapter
    );
  }

  function fingerprint() {
    const rows = chapterPassages();

    return fingerprintMeasures.map(key => {
      const field = measures[key].field;

      let numerator = 0;
      let denominator = 0;

      rows.forEach(p => {
        const value = Number(p[field]);
        const words = Number(p.word_count || 0);

        if (!Number.isFinite(value) || words <= 0) return;

        numerator += value * words;
        denominator += words;
      });

      return {
        key,
        label: measures[key].label,
        value: denominator ? numerator / denominator : 0
      };
    });
  }

  function renderFingerprint(targetId) {
    const target = document.getElementById(targetId);
    if (!target || !window.Plotly) return;

    const fp = fingerprint();

    Plotly.newPlot(
      target,
      [{
        type: "bar",
        x: fp.map(x => x.value),
        y: fp.map(x => x.label),
        orientation: "h",
        hovertemplate: "%{y}: %{x:.2f}<extra></extra>"
      }],
      {
        margin: { l: 90, r: 20, t: 10, b: 35 },
        xaxis: {
          title: "Terms per 100 words",
          rangemode: "tozero"
        },
        yaxis: {
          automargin: true
        },
        height: 320
      },
      {
        responsive: true,
        displaylogo: false
      }
    );
  }

  function renderInspector() {
    const target = document.getElementById("bk-emotion-detail");
    if (!target) return;

    const chapter = selectedChapterObject();

    if (!chapter) {
      target.innerHTML = `
        <div class="bk-detail-placeholder">
          <div class="bk-eyebrow">CHAPTER INSPECTOR</div>
          <h3>Select a chapter</h3>
          <p>
            Click a point in the trajectory to inspect its emotional
            fingerprint and source passages.
          </p>
        </div>
      `;
      return;
    }

    const rows = chapterPassages();

    const values = [...selectedMeasures].map(key => ({
      key,
      label: measures[key].label,
      value: chapterMetric(chapter, key)
    }));

    target.innerHTML = `
      <div class="bk-eyebrow">CHAPTER INSPECTOR</div>

      <h2>${esc(chapterLabel(chapter))}</h2>

      ${
        chapter.chapter_title
          ? `<p class="bk-theme-definition">
               ${esc(chapter.chapter_title)}
             </p>`
          : ""
      }

      <div class="bk-theme-stat-grid">

        <div>
          <strong>${rows.length}</strong>
          <span>analyzed passages</span>
        </div>

        <div>
          <strong>
            ${rows.reduce(
              (sum, p) => sum + Number(p.word_count || 0),
              0
            ).toLocaleString()}
          </strong>
          <span>analyzed words</span>
        </div>

        <div>
          <strong>
            ${currentLens() === "character" ? "Character" : "Novel"}
          </strong>
          <span>analysis lens</span>
        </div>

      </div>

      <h3>Selected measures</h3>

      <div class="bk-emotion-score-list">
        ${values.map(row => `
          <div class="bk-emotion-score">
            <span>${esc(row.label)}</span>
            <strong>
              ${row.value === null
                ? "—"
                : Number(row.value).toFixed(2)}
            </strong>
          </div>
        `).join("")}
      </div>

      <h3>Emotional fingerprint</h3>

      <div id="bk-emotion-fingerprint"></div>

      <p class="bk-panel-help">
        NRC scores characterize emotion-associated vocabulary in these
        passages. They should not be read as a diagnosis of a character's
        internal emotional state.
      </p>
    `;

    requestAnimationFrame(() => {
      renderFingerprint("bk-emotion-fingerprint");
    });
  }

  function activeEvidenceMeasure() {
    return [...selectedMeasures][0] || "afinn";
  }

  function renderEvidence() {
    const target = document.getElementById("bk-emotion-evidence");
    if (!target) return;

    if (!selectedChapter) {
      target.innerHTML = `
        <div class="bk-empty-state">
          Click a chapter in the trajectory to inspect the passages
          behind its emotional signal.
        </div>
      `;
      return;
    }

    const key = activeEvidenceMeasure();
    const field = measures[key].field;

    let rows = chapterPassages()
      .filter(p => Number.isFinite(Number(p[field])));

    const sort =
      document.getElementById("bk-emotion-sort")?.value || "strongest";

    if (sort === "reading") {
      rows.sort(
        (a, b) =>
          Number(a.narrative_position) -
          Number(b.narrative_position)
      );
    } else {
      rows.sort((a, b) => {
        const av = Number(a[field]);
        const bv = Number(b[field]);

        if (measures[key].signed) {
          return Math.abs(bv) - Math.abs(av);
        }

        return bv - av;
      });
    }

    const shown = rows.slice(0, 30);

    if (!shown.length) {
      target.innerHTML = `
        <div class="bk-empty-state">
          No matching passages are available for this chapter and lens.
        </div>
      `;
      return;
    }

    target.innerHTML = `
      <div class="bk-evidence-result-count">
        Showing ${shown.length} of ${rows.length} passages ·
        ranked by ${esc(measures[key].label)}
      </div>

      <div class="bk-theme-passage-grid">

        ${shown.map(p => {
          const value = Number(p[field]);

          return `
            <article class="bk-theme-passage-card">

              <div class="bk-theme-passage-location">
                ${esc(p.citation_label || chapterLabel(p))}
              </div>

              <div class="bk-emotion-passage-score">
                <span>${esc(measures[key].label)}</span>
                <strong>${value.toFixed(2)}</strong>
              </div>

              <p class="bk-theme-passage-text">
                ${esc(p.text || "")}
              </p>

              <div class="bk-theme-passage-tags">
                ${(p.entities_mentioned || []).map(name => `
                  <span class="bk-character-tag">
                    ${esc(shortName(name))}
                  </span>
                `).join("")}
              </div>

              <div class="bk-theme-passage-id">
                ${esc(p.passage_id)}
              </div>

            </article>
          `;
        }).join("")}

      </div>
    `;
  }

  function populateCharacters() {
    const select =
      document.getElementById("bk-emotion-character");

    if (!select) return;

    const previous = select.value;

    select.innerHTML = characters
      .filter(c => allowed(c.first_narrative_position))
      .sort((a, b) =>
        a.canonical_name.localeCompare(b.canonical_name)
      )
      .map(c => `
        <option value="${esc(c.entity_id)}">
          ${esc(c.canonical_name)}
        </option>
      `)
      .join("");

    if (
      previous &&
      [...select.options].some(o => o.value === previous)
    ) {
      select.value = previous;
    }
  }

  function updateControlVisibility() {
    const wrap =
      document.getElementById("bk-emotion-character-wrap");

    if (wrap) {
      wrap.style.display =
        currentLens() === "character"
          ? ""
          : "none";
    }
  }

  function renderEverything() {
    populateCharacters();
    updateControlVisibility();
    renderStatus();
    renderChart();
    renderInspector();
    renderEvidence();
  }

  function wireControls() {
    document
      .getElementById("bk-emotion-lens")
      ?.addEventListener("change", () => {
        selectedChapter = "";
        renderEverything();
      });

    document
      .getElementById("bk-emotion-character")
      ?.addEventListener("change", () => {
        selectedChapter = "";
        renderEverything();
      });

    document
      .getElementById("bk-emotion-view")
      ?.addEventListener("change", event => {
        if (event.target.value === "single") {
          selectedMeasures =
            new Set([[...selectedMeasures][0] || "afinn"]);
        }

        renderMeasurePills();
        selectedChapter = "";
        renderEverything();
      });

    document
      .getElementById("bk-emotion-sort")
      ?.addEventListener("change", renderEvidence);
  }

  async function initialize() {
    const target =
      document.getElementById("bk-emotion-chart");

    if (!target) return;

    try {
      [passages, chapters, characters] =
        await Promise.all([
          BK.fetchJSON("data/public/passage_index.json"),
          BK.fetchJSON("data/public/chapters_v2.json"),
          BK.fetchJSON("data/public/characters_v2.json")
        ]);

      console.log("Emotional Arc v2 loaded:", {
        passages: passages.length,
        chapters: chapters.length,
        characters: characters.length
      });

      renderMeasurePills();
      populateCharacters();
      wireControls();
      renderEverything();

      window.addEventListener(
        "bk-reader-position-changed",
        () => {
          selectedChapter = "";
          renderMeasurePills();
          renderEverything();
        }
      );

    } catch (error) {
      console.error(
        "Emotional Arc v2 initialization failed:",
        error
      );

      target.innerHTML = `
        <div class="bk-error">
          Emotional Arc could not be initialized:
          ${esc(error.message)}
        </div>
      `;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }

})();
