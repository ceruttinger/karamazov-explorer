(function () {
  "use strict";

  const BK = window.BK || {};

  let characters = [];
  let relationships = [];
  let passages = [];
  let concepts = [];

  let selectedCharacterId = null;
  let selectedCharacterGroup = "all";

  const characterGroups = {
    all: null,

    karamazov: [
      "CHAR_001",
      "CHAR_002",
      "CHAR_003",
      "CHAR_004",
      "CHAR_005"
    ],

    relationships: [
      "CHAR_006",
      "CHAR_007"
    ],

    social: [
      "CHAR_008",
      "CHAR_011",
      "CHAR_013",
      "CHAR_014"
    ],

    ilyusha: [
      "CHAR_009",
      "CHAR_010",
      "CHAR_012"
    ]
  };

  function esc(v) {
    return BK.escapeHTML
      ? BK.escapeHTML(v)
      : String(v ?? "");
  }

  function currentPosition() {
    return BK.getReaderPosition
      ? BK.getReaderPosition()
      : Number.MAX_SAFE_INTEGER;
  }

  function allowed(position) {
    if (position === null || position === undefined) return true;
    return Number(position) <= currentPosition();
  }

  function shortName(name) {
    if (!name) return "";
    return name
      .replace("Fyodorovich ", "")
      .replace("Pavlovich ", "");
  }

  function chapterLabel(row) {
    return `Part ${row.part} · Book ${row.book} · Chapter ${row.chapter}`;
  }

  function visibleCharacters() {
    let result = characters
      .filter(c => allowed(c.first_narrative_position));

    const groupIds =
      characterGroups[selectedCharacterGroup];

    if (groupIds) {
      result = result.filter(
        c => groupIds.includes(c.entity_id)
      );
    }

    return result.sort(
      (a, b) => b.mention_count - a.mention_count
    );
  }

  function populateCharacterJump() {
    const select =
      document.getElementById("bk-character-jump");

    if (!select) return;

    const visible = visibleCharacters();

    select.innerHTML =
      '<option value="">Select character…</option>';

    visible.forEach(c => {
      const option =
        document.createElement("option");

      option.value = c.entity_id;
      option.textContent = c.canonical_name;

      if (c.entity_id === selectedCharacterId) {
        option.selected = true;
      }

      select.appendChild(option);
    });
  }

  function visibleCharacterPassages(character) {
    return passages
      .filter(p =>
        Number(p.narrative_position) <= currentPosition() &&
        Array.isArray(p.entities_mentioned) &&
        p.entities_mentioned.includes(character.canonical_name)
      )
      .sort(
        (a, b) =>
          Number(a.narrative_position) -
          Number(b.narrative_position)
      );
  }

  function visibleConnections(characterId) {
    return relationships
      .filter(r =>
        (r.source === characterId || r.target === characterId) &&
        allowed(r.first_narrative_position)
      )
      .map(r => {
        const otherId =
          r.source === characterId ? r.target : r.source;

        const other = characters.find(
          c => c.entity_id === otherId
        );

        return {
          ...r,
          otherId,
          otherName:
            other?.canonical_name ||
            (r.source === characterId
              ? r.target_name
              : r.source_name)
        };
      })
      .filter(r => {
        const other = characters.find(
          c => c.entity_id === r.otherId
        );

        return !other || allowed(other.first_narrative_position);
      })
      .sort(
        (a, b) =>
          Number(b.shared_passages || b.weight || 0) -
          Number(a.shared_passages || a.weight || 0)
      );
  }

  function visibleTrajectory(character) {
    return (character.trajectory || []).filter(
      t => allowed(t.first_narrative_position)
    );
  }

  function renderCards() {
    const grid =
      document.getElementById("bk-character-grid");

    if (!grid) return;

    const visible = visibleCharacters();

    grid.innerHTML = visible.map(c => {
      const selected =
        c.entity_id === selectedCharacterId
          ? " is-selected"
          : "";

      return `
        <button
          class="bk-character-card${selected}"
          data-character-id="${esc(c.entity_id)}"
          type="button"
        >
          <div class="bk-character-card-top">
            <div class="bk-character-initial">
              ${esc(c.canonical_name?.charAt(0) || "?")}
            </div>

            <div>
              <h3>${esc(shortName(c.canonical_name))}</h3>
              <div class="bk-character-fullname">
                ${esc(c.canonical_name)}
              </div>
            </div>
          </div>

          <div class="bk-stat-row">
            <div>
              <strong>${Number(c.mention_count || 0).toLocaleString()}</strong>
              <span>mentions</span>
            </div>

            <div>
              <strong>${Number(c.passage_count || 0).toLocaleString()}</strong>
              <span>passages</span>
            </div>
          </div>
        </button>
      `;
    }).join("");

    grid.querySelectorAll(".bk-character-card")
      .forEach(card => {
        card.addEventListener("click", () => {
          selectedCharacterId =
            card.dataset.characterId;

          renderCards();
          populateCharacterJump();
          renderCharacterDetail(selectedCharacterId);

          card.scrollIntoView({
            behavior: "smooth",
            inline: "center",
            block: "nearest"
          });
        });
      });

    populateCharacterJump();
  }

  function emotionRows(character) {
    const labels = [
      ["anger", "Anger"],
      ["anticipation", "Anticipation"],
      ["disgust", "Disgust"],
      ["fear", "Fear"],
      ["joy", "Joy"],
      ["sadness", "Sadness"],
      ["surprise", "Surprise"],
      ["trust", "Trust"]
    ];

    const values = labels
      .map(([key, label]) => ({
        key,
        label,
        value: Number(character.emotions?.[key] || 0)
      }));

    const max =
      Math.max(...values.map(x => x.value), 0.001);

    return values.map(x => `
      <div class="bk-emotion-row">
        <span>${esc(x.label)}</span>

        <div class="bk-emotion-track">
          <div
            class="bk-emotion-fill"
            style="width:${Math.max(2, (x.value / max) * 100)}%"
          ></div>
        </div>

        <strong>${x.value.toFixed(2)}</strong>
      </div>
    `).join("");
  }

  function renderTrajectory(character) {
    const target =
      document.getElementById("bk-character-trajectory");

    if (!target) return;

    const trajectory =
      visibleTrajectory(character);

    if (!trajectory.length) {
      target.innerHTML =
        "<p>No visible appearances at this reader position.</p>";
      return;
    }

    const x = trajectory.map(
      t => `${t.part}.${t.book}.${t.chapter}`
    );

    const y = trajectory.map(
      t => Number(t.mentions || 0)
    );

    if (window.Plotly) {
      Plotly.newPlot(
        target,
        [{
          x,
          y,
          type: "scatter",
          mode: "lines+markers",
          hovertemplate:
            "<b>%{x}</b><br>%{y} mentions<extra></extra>"
        }],
        {
          margin: { l: 45, r: 15, t: 15, b: 70 },
          xaxis: {
            title: "Part · Book · Chapter",
            tickangle: -45,
            automargin: true
          },
          yaxis: {
            title: "Mentions",
            rangemode: "tozero"
          },
          hovermode: "closest"
        },
        {
          responsive: true,
          displaylogo: false
        }
      );
    } else {
      target.innerHTML =
        "<p>Chart library did not load.</p>";
    }
  }

  function renderConnections(character) {
    const connections =
      visibleConnections(character.entity_id);

    if (!connections.length) {
      return `
        <p class="bk-muted">
          No connections are visible at this reader position.
        </p>
      `;
    }

    const max = Math.max(
      ...connections.map(
        r => Number(r.shared_passages || r.weight || 0)
      ),
      1
    );

    return connections.slice(0, 12).map(r => {
      const value =
        Number(r.shared_passages || r.weight || 0);

      const width =
        Math.max(3, value / max * 100);

      return `
        <button
          class="bk-connection-row"
          type="button"
          data-character-id="${esc(r.otherId)}"
        >
          <span class="bk-connection-name">
            ${esc(shortName(r.otherName))}
          </span>

          <span class="bk-connection-bar">
            <span style="width:${width}%"></span>
          </span>

          <strong>${value}</strong>
        </button>
      `;
    }).join("");
  }

  function characterConcepts(character) {
    const visiblePassages =
      visibleCharacterPassages(character);

    const counts = new Map();

    visiblePassages.forEach(p => {
      (p.concepts || []).forEach(concept => {
        counts.set(
          concept,
          (counts.get(concept) || 0) + 1
        );
      });
    });

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1]);
  }

  function renderConcepts(character) {
    const data =
      characterConcepts(character);

    if (!data.length) {
      return `
        <p class="bk-muted">
          No curated concept matches are visible yet.
        </p>
      `;
    }

    return `
      <div class="bk-tag-cloud">
        ${data.slice(0, 12).map(([name, count]) => `
          <span class="bk-concept-tag">
            ${esc(name)}
            <strong>${count}</strong>
          </span>
        `).join("")}
      </div>
    `;
  }

  function renderPassagePreview(character) {
    const cp =
      visibleCharacterPassages(character);

    if (!cp.length) {
      return `
        <p class="bk-muted">
          No passages visible at this reader position.
        </p>
      `;
    }

    /*
      Show recent visible evidence rather than future passages.
      This makes changing the spoiler boundary immediately useful.
    */
    return cp
      .slice(-5)
      .reverse()
      .map(p => `
        <article class="bk-passage-card">
          <div class="bk-passage-citation">
            ${esc(p.citation_label)}
          </div>

          <p>${esc(p.text)}</p>

          <div class="bk-passage-meta">
            Passage ${esc(p.passage_id)}
          </div>
        </article>
      `)
      .join("");
  }

  function renderCharacterDetail(characterId) {
    const target =
      document.getElementById("bk-character-detail");

    if (!target) return;

    const character =
      characters.find(
        c => c.entity_id === characterId
      );

    if (!character) {
      target.innerHTML = "";
      return;
    }

    if (!allowed(character.first_narrative_position)) {
      target.innerHTML = `
        <div class="bk-method-note">
          This character has not appeared by your current
          reader position.
        </div>
      `;
      return;
    }

    const aliases =
      (character.aliases || [])
        .filter(a => a && a !== character.canonical_name);

    const sentiment =
      Number(character.emotions?.sentiment || 0);

    const connections =
      visibleConnections(character.entity_id);

    const visiblePassages =
      visibleCharacterPassages(character);

    target.innerHTML = `
      <section class="bk-character-profile">

        <div class="bk-profile-header">
          <div>
            <div class="bk-eyebrow">
              CHARACTER PROFILE
            </div>

            <h2>${esc(character.canonical_name)}</h2>

            ${
              aliases.length
                ? `<p class="bk-aliases">
                     Also encountered as:
                     ${aliases.map(esc).join(", ")}
                   </p>`
                : ""
            }
          </div>

          <div class="bk-profile-stats">
            <div>
              <strong>
                ${visiblePassages.length.toLocaleString()}
              </strong>
              <span>visible passages</span>
            </div>

            <div>
              <strong>
                ${connections.length.toLocaleString()}
              </strong>
              <span>connections</span>
            </div>

            <div>
              <strong>
                ${sentiment.toFixed(2)}
              </strong>
              <span>AFINN / 100 words</span>
            </div>
          </div>
        </div>

        <div class="bk-profile-grid">

          <section class="bk-panel bk-panel-wide">
            <div class="bk-panel-heading">
              <div>
                <div class="bk-eyebrow">
                  NARRATIVE PRESENCE
                </div>
                <h3>Appearance trajectory</h3>
              </div>
            </div>

            <div
              id="bk-character-trajectory"
              class="bk-chart"
            ></div>
          </section>

          <section class="bk-panel">
            <div class="bk-eyebrow">
              LEXICAL CONTEXT
            </div>
            <h3>Emotional profile</h3>

            <p class="bk-panel-help">
              NRC emotion signals in passages where this
              character appears. These describe surrounding
              language, not the character's psychological state.
            </p>

            <div class="bk-emotion-list">
              ${emotionRows(character)}
            </div>
          </section>

          <section class="bk-panel">
            <div class="bk-eyebrow">
              OBSERVED NETWORK
            </div>
            <h3>Connected characters</h3>

            <p class="bk-panel-help">
              Ranked by passages in which both characters occur.
            </p>

            <div id="bk-character-connections">
              ${renderConnections(character)}
            </div>
          </section>

          <section class="bk-panel">
            <div class="bk-eyebrow">
              CURATED LEXICAL CONCEPTS
            </div>
            <h3>Concepts in context</h3>

            ${renderConcepts(character)}
          </section>

          <section class="bk-panel bk-panel-wide">
            <div class="bk-eyebrow">
              SOURCE EVIDENCE
            </div>
            <h3>Recent visible passages</h3>

            <p class="bk-panel-help">
              These passages are restricted to your current
              spoiler boundary.
            </p>

            <div>
              ${renderPassagePreview(character)}
            </div>
          </section>

        </div>
      </section>
    `;

    target.querySelectorAll(
      ".bk-connection-row"
    ).forEach(row => {
      row.addEventListener("click", () => {
        selectedCharacterId =
          row.dataset.characterId;

        renderCards();
        renderCharacterDetail(selectedCharacterId);

        document
          .getElementById("bk-character-detail")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
      });
    });

    renderTrajectory(character);
  }

  function initializeCharacterNavigation() {
    const group =
      document.getElementById("bk-character-group");

    const jump =
      document.getElementById("bk-character-jump");

    const prev =
      document.getElementById("bk-character-prev");

    const next =
      document.getElementById("bk-character-next");

    const carousel =
      document.getElementById("bk-character-grid");

    group?.addEventListener("change", () => {
      selectedCharacterGroup = group.value;

      const visible = visibleCharacters();

      if (
        !visible.some(
          c => c.entity_id === selectedCharacterId
        )
      ) {
        selectedCharacterId =
          visible[0]?.entity_id || null;
      }

      renderCards();

      if (selectedCharacterId) {
        renderCharacterDetail(selectedCharacterId);
      }
    });

    jump?.addEventListener("change", () => {
      if (!jump.value) return;

      selectedCharacterId = jump.value;

      renderCards();
      renderCharacterDetail(selectedCharacterId);

      const card =
        document.querySelector(
          `[data-character-id="${selectedCharacterId}"]`
        );

      card?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest"
      });
    });

    prev?.addEventListener("click", () => {
      carousel?.scrollBy({
        left: -420,
        behavior: "smooth"
      });
    });

    next?.addEventListener("click", () => {
      carousel?.scrollBy({
        left: 420,
        behavior: "smooth"
      });
    });
  }

  async function initializeCharacters() {
    const grid =
      document.getElementById("bk-character-grid");

    if (!grid) return;

    initializeCharacterNavigation();

    grid.innerHTML =
      `<div class="bk-loading">Loading characters…</div>`;

    try {
      [
        characters,
        relationships,
        passages,
        concepts
      ] = await Promise.all([
        BK.fetchJSON("data/public/characters_v2.json"),
        BK.fetchJSON("data/public/relationship_network.json"),
        BK.fetchJSON("data/public/passage_index.json"),
        BK.fetchJSON("data/public/concepts_v2.json")
      ]);

      renderCards();

      const visible =
        visibleCharacters();

      if (visible.length) {
        selectedCharacterId =
          visible[0].entity_id;

        renderCards();
        renderCharacterDetail(selectedCharacterId);
      }

    } catch (err) {
      console.error(
        "Character explorer failed:",
        err
      );

      grid.innerHTML = `
        <div class="bk-error">
          Character explorer could not load:
          ${esc(err.message)}
        </div>
      `;
    }
  }

  window.addEventListener(
    "bk-reader-position-changed",
    () => {
      if (!document.getElementById("bk-character-grid")) {
        return;
      }

      const visible =
        visibleCharacters();

      if (
        selectedCharacterId &&
        !visible.some(
          c => c.entity_id === selectedCharacterId
        )
      ) {
        selectedCharacterId =
          visible[0]?.entity_id || null;
      }

      renderCards();

      if (selectedCharacterId) {
        renderCharacterDetail(
          selectedCharacterId
        );
      }
    }
  );

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeCharacters
    );
  } else {
    initializeCharacters();
  }

})();
