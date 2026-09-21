(function () {
  "use strict";

  const BK = window.BK || {};

  let characters = [];
  let relationships = [];
  let assertions = [];
  let passages = [];

  let network = null;
  let selectedEdge = null;
  let customSelection = new Set();

  const POSITION_KEY = "bk-relationship-node-positions-v1";

  // Human-curated navigation lenses, not machine-derived claims.
  const characterGroups = {
    "karamazov-household": [
      "CHAR_001", "CHAR_002", "CHAR_003", "CHAR_004", "CHAR_005"
    ],
    "karamazov-brothers": [
      "CHAR_002", "CHAR_003", "CHAR_004", "CHAR_005"
    ],
    "central-relationships": [
      "CHAR_002", "CHAR_003", "CHAR_006", "CHAR_007"
    ],
    "monastery": [
      "CHAR_004", "CHAR_008"
    ],
    "khokhlakov": [
      "CHAR_004", "CHAR_013", "CHAR_014"
    ],
    "ilyusha": [
      "CHAR_004", "CHAR_009", "CHAR_010"
    ],
    "fyodor-social": [
      "CHAR_001", "CHAR_011"
    ],
    "major-network": [
      "CHAR_001", "CHAR_002", "CHAR_003", "CHAR_004",
      "CHAR_005", "CHAR_006", "CHAR_007", "CHAR_008"
    ]
  };

  function esc(value) {
    return BK.escapeHTML
      ? BK.escapeHTML(value)
      : String(value ?? "")
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
    if (
      position === null ||
      position === undefined ||
      position === ""
    ) {
      return true;
    }

    return Number(position) <= cutoff();
  }

  function shortName(name) {
    return String(name || "")
      .replace("Fyodorovich ", "")
      .replace("Pavlovich ", "");
  }

  function characterById(id) {
    return characters.find(c => c.entity_id === id);
  }

  function passageById(id) {
    return passages.find(
      p => String(p.passage_id) === String(id)
    );
  }

  function visibleCharacters() {
    return characters.filter(
      c => allowed(c.first_narrative_position)
    );
  }

  function threshold() {
    return Number(
      document.getElementById("bk-network-threshold")?.value || 1
    );
  }

  function currentView() {
    return (
      document.getElementById("bk-network-view")?.value ||
      "all"
    );
  }

  function currentGroup() {
    return (
      document.getElementById("bk-network-group")?.value ||
      "karamazov-household"
    );
  }

  function loadPositions() {
    try {
      return JSON.parse(
        localStorage.getItem(POSITION_KEY) || "{}"
      );
    } catch (err) {
      console.warn("Could not load saved node positions.", err);
      return {};
    }
  }

  function savePositions() {
    if (!network) return;

    try {
      const positions = network.getPositions();
      const previous = loadPositions();

      Object.entries(positions).forEach(([id, pos]) => {
        previous[id] = {
          x: pos.x,
          y: pos.y
        };
      });

      localStorage.setItem(
        POSITION_KEY,
        JSON.stringify(previous)
      );
    } catch (err) {
      console.warn("Could not save node positions.", err);
    }
  }

  function clearPositions() {
    localStorage.removeItem(POSITION_KEY);
  }

  function baseVisibleEdges() {
    return relationships.filter(r => {
      const weight =
        Number(r.shared_passages || r.weight || 0);

      return (
        allowed(r.first_narrative_position) &&
        weight >= threshold()
      );
    });
  }

  function selectedIdsForView() {
    const view = currentView();

    if (view === "all") {
      return new Set(
        visibleCharacters().map(c => c.entity_id)
      );
    }

    if (view === "group") {
      const ids =
        characterGroups[currentGroup()] || [];

      return new Set(
        ids.filter(id => {
          const c = characterById(id);

          return (
            c &&
            allowed(c.first_narrative_position)
          );
        })
      );
    }

    return new Set(
      [...customSelection].filter(id => {
        const c = characterById(id);

        return (
          c &&
          allowed(c.first_narrative_position)
        );
      })
    );
  }

  function networkSelection() {
    const selected = selectedIdsForView();

    if (
      currentView() !== "custom" ||
      !document.getElementById("bk-include-neighbors")?.checked
    ) {
      return selected;
    }

    const expanded = new Set(selected);

    baseVisibleEdges().forEach(edge => {
      if (selected.has(edge.source)) {
        expanded.add(edge.target);
      }

      if (selected.has(edge.target)) {
        expanded.add(edge.source);
      }
    });

    return expanded;
  }

  function visibleEdges() {
    const selected = networkSelection();

    return baseVisibleEdges().filter(
      edge =>
        selected.has(edge.source) &&
        selected.has(edge.target)
    );
  }

  function renderCustomCheckboxes() {
    const target =
      document.getElementById("bk-character-checkboxes");

    if (!target) return;

    target.innerHTML =
      visibleCharacters()
        .sort((a, b) =>
          a.canonical_name.localeCompare(b.canonical_name)
        )
        .map(c => `
          <label class="bk-character-check">
            <input
              type="checkbox"
              value="${esc(c.entity_id)}"
              ${customSelection.has(c.entity_id) ? "checked" : ""}
            >
            <span>${esc(shortName(c.canonical_name))}</span>
          </label>
        `)
        .join("");

    target
      .querySelectorAll('input[type="checkbox"]')
      .forEach(input => {
        input.addEventListener("change", () => {
          if (input.checked) {
            customSelection.add(input.value);
          } else {
            customSelection.delete(input.value);
          }

          selectedEdge = null;
          resetInspector();
          renderNetwork();
        });
      });
  }

  function updateControlVisibility() {
    const view = currentView();

    const groupWrap =
      document.getElementById("bk-network-group-wrap");

    const customWrap =
      document.getElementById("bk-custom-selection");

    if (groupWrap) {
      groupWrap.style.display =
        view === "group" ? "" : "none";
    }

    if (customWrap) {
      customWrap.style.display =
        view === "custom" ? "" : "none";
    }
  }

  function networkData() {
    const selected = networkSelection();
    const edges = visibleEdges();
    const savedPositions = loadPositions();

    const nodes =
      visibleCharacters()
        .filter(c => selected.has(c.entity_id))
        .map(c => {
          const saved =
            savedPositions[c.entity_id];

          const node = {
            id: c.entity_id,
            label: shortName(c.canonical_name),

            title:
              `${c.canonical_name}\n` +
              `${Number(c.mention_count || 0).toLocaleString()} mentions`,

            value: Math.max(
              6,
              Math.sqrt(Number(c.mention_count || 1))
            ),

            borderWidth:
              currentView() === "custom" &&
              customSelection.has(c.entity_id)
                ? 4
                : 2
          };

          if (saved) {
            node.x = saved.x;
            node.y = saved.y;

            // A manually positioned node should remain where
            // the researcher placed it.
            node.fixed = {
              x: true,
              y: true
            };
          }

          return node;
        });

    const visEdges =
      edges.map((edge, index) => {
        const weight =
          Number(
            edge.shared_passages ||
            edge.weight ||
            0
          );

        return {
          id: `edge_${index}`,
          from: edge.source,
          to: edge.target,
          value: Math.max(1, Math.sqrt(weight)),
          title: `${weight} shared passages`,
          original: edge
        };
      });

    return {
      nodes,
      edges: visEdges
    };
  }

  function updateStatus(data) {
    const target =
      document.getElementById("bk-network-status");

    if (!target) return;

    let label = "All visible characters";

    if (currentView() === "group") {
      const select =
        document.getElementById("bk-network-group");

      label =
        select?.options[select.selectedIndex]?.text ||
        "Curated group";
    }

    if (currentView() === "custom") {
      label =
        `${customSelection.size} selected character` +
        `${customSelection.size === 1 ? "" : "s"}`;

      if (
        document.getElementById("bk-include-neighbors")?.checked
      ) {
        label += " + immediate neighbors";
      }
    }

    target.innerHTML = `
      <strong>${esc(label)}</strong>
      <span>
        ${data.nodes.length} visible nodes ·
        ${data.edges.length} visible connections
      </span>
    `;
  }

  function renderNetwork() {
    const container =
      document.getElementById("bk-relationship-network");

    if (!container || !window.vis) return;

    if (network) {
      savePositions();
      network.destroy();
      network = null;
    }

    const data = networkData();

    updateStatus(data);

    if (!data.nodes.length) {
      container.innerHTML = `
        <div class="bk-network-empty">
          <div>
            <div class="bk-eyebrow">
              EMPTY NETWORK
            </div>

            <h3>Select characters to explore</h3>

            <p>
              Choose characters for your custom network,
              or switch to a curated group.
            </p>
          </div>
        </div>
      `;

      return;
    }

    const originals =
      new Map(
        data.edges.map(edge => [
          edge.id,
          edge.original
        ])
      );

    const nodes =
      new vis.DataSet(data.nodes);

    const edges =
      new vis.DataSet(
        data.edges.map(({ original, ...edge }) => edge)
      );

    network =
      new vis.Network(
        container,
        { nodes, edges },
        {
          autoResize: true,

          nodes: {
            shape: "dot",
            borderWidth: 2,
            font: {
              size: 15,
              face: "Georgia"
            }
          },

          edges: {
            smooth: {
              type: "continuous"
            },
            width: 1.5,
            selectionWidth: 3
          },

          interaction: {
            hover: true,
            navigationButtons: true,
            keyboard: true,
            dragNodes: true,
            dragView: true,
            zoomView: true
          },

          physics: {
            enabled: true,
            stabilization: {
              iterations: 250
            },
            barnesHut: {
              gravitationalConstant: -5000,
              springLength: 160,
              springConstant: 0.035
            }
          }
        }
      );

    /*
     * After automatic stabilization, stop physics.
     * This keeps the network calm instead of constantly
     * rearranging itself.
     */
    network.once(
      "stabilizationIterationsDone",
      () => {
        network.setOptions({
          physics: false
        });
      }
    );

    /*
     * When a user drags a node:
     * 1. unfix it temporarily,
     * 2. allow the drag,
     * 3. fix it at the final coordinates,
     * 4. save those coordinates to localStorage.
     */
    network.on("dragStart", params => {
      if (!params.nodes.length) return;

      params.nodes.forEach(id => {
        nodes.update({
          id,
          fixed: {
            x: false,
            y: false
          }
        });
      });
    });

    network.on("dragEnd", params => {
      if (!params.nodes.length) return;

      params.nodes.forEach(id => {
        const pos =
          network.getPositions([id])[id];

        nodes.update({
          id,
          x: pos.x,
          y: pos.y,
          fixed: {
            x: true,
            y: true
          }
        });
      });

      savePositions();
    });

    network.on("selectEdge", params => {
      if (!params.edges.length) return;

      const edge =
        originals.get(params.edges[0]);

      if (!edge) return;

      selectedEdge = edge;
      renderRelationshipDetail(edge);
    });

    network.on("selectNode", params => {
      if (!params.nodes.length) return;

      renderCharacterSummary(
        params.nodes[0]
      );
    });
  }

  function assertionsForPair(edge) {
    const pair =
      new Set([
        edge.source,
        edge.target
      ]);

    return assertions
      .filter(assertion =>
        pair.has(assertion.subject_id) &&
        pair.has(assertion.object_id) &&
        assertion.subject_id !== assertion.object_id &&
        allowed(assertion.first_known_position)
      )
      .sort(
        (a, b) =>
          Number(b.confidence || 0) -
          Number(a.confidence || 0)
      );
  }

  function citationForPassage(passage) {
    if (!passage) return "";

    const parts = [];

    if (passage.part !== undefined) {
      parts.push(`Part ${passage.part}`);
    }

    if (passage.book !== undefined) {
      parts.push(`Book ${passage.book}`);
    }

    if (passage.chapter !== undefined) {
      parts.push(`Chapter ${passage.chapter}`);
    }

    return parts.join(" · ");
  }

  function evidenceDrawer(assertion, index) {
    const passage =
      passageById(assertion.evidence_passage_id);

    const evidenceText =
      passage?.text ||
      assertion.evidence_text ||
      "";

    const citation =
      passage?.citation_label ||
      citationForPassage(passage);

    const drawerId =
      `bk-evidence-${index}-${esc(assertion.assertion_id || "assertion")}`;

    return `
      <details
        class="bk-evidence-drawer"
        id="${drawerId}"
      >
        <summary>
          <span>View source evidence</span>
          <span class="bk-evidence-chevron">⌄</span>
        </summary>

        <div class="bk-evidence-body">

          ${
            citation
              ? `
                <div class="bk-evidence-location">
                  ${esc(citation)}
                </div>
              `
              : ""
          }

          ${
            passage?.book_title
              ? `
                <div class="bk-evidence-book-title">
                  ${esc(passage.book_title)}
                </div>
              `
              : ""
          }

          ${
            passage?.chapter_title
              ? `
                <div class="bk-evidence-chapter-title">
                  ${esc(passage.chapter_title)}
                </div>
              `
              : ""
          }

          ${
            evidenceText
              ? `
                <blockquote class="bk-source-passage">
                  ${esc(evidenceText)}
                </blockquote>
              `
              : `
                <p class="bk-muted">
                  No source passage text is available for
                  this assertion.
                </p>
              `
          }

          <div class="bk-evidence-metadata">

            ${
              assertion.evidence_passage_id
                ? `
                  <div>
                    <span>Passage</span>
                    <strong>
                      ${esc(assertion.evidence_passage_id)}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              assertion.epistemic_status
                ? `
                  <div>
                    <span>Epistemic status</span>
                    <strong>
                      ${esc(assertion.epistemic_status)}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              assertion.validation_status
                ? `
                  <div>
                    <span>Review status</span>
                    <strong>
                      ${esc(assertion.validation_status)}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              assertion.extraction_method
                ? `
                  <div>
                    <span>Extraction method</span>
                    <strong>
                      ${esc(assertion.extraction_method)}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              assertion.first_known_position !== undefined
                ? `
                  <div>
                    <span>First-known position</span>
                    <strong>
                      ${esc(assertion.first_known_position)}
                    </strong>
                  </div>
                `
                : ""
            }

            ${
              assertion.assertion_id
                ? `
                  <div>
                    <span>Assertion</span>
                    <strong>
                      ${esc(assertion.assertion_id)}
                    </strong>
                  </div>
                `
                : ""
            }

          </div>

        </div>
      </details>
    `;
  }

  function assertionHTML(assertion, index) {
    return `
      <article class="bk-assertion-card">

        <div class="bk-assertion-header">

          <span class="bk-status-machine">
            MACHINE-PROPOSED
          </span>

          <span class="bk-confidence">
            confidence
            ${Number(assertion.confidence || 0).toFixed(2)}
          </span>

        </div>

        <h4>
          ${esc(assertion.subject_name)}

          <span class="bk-predicate">
            ${esc(
              assertion.effective_predicate ||
              assertion.predicate
            )}
          </span>

          ${esc(assertion.object_name)}
        </h4>

        <div class="bk-validation">
          Review status:
          <strong>
            ${esc(
              assertion.validation_status ||
              "unreviewed"
            )}
          </strong>
        </div>

        ${evidenceDrawer(assertion, index)}

      </article>
    `;
  }

  function renderRelationshipDetail(edge) {
    const target =
      document.getElementById("bk-relationship-detail");

    if (!target) return;

    const source =
      characterById(edge.source);

    const dest =
      characterById(edge.target);

    const weight =
      Number(
        edge.shared_passages ||
        edge.weight ||
        0
      );

    const pairAssertions =
      assertionsForPair(edge);

    target.innerHTML = `
      <div class="bk-eyebrow">
        OBSERVED CONNECTION
      </div>

      <h2>
        ${esc(
          shortName(
            source?.canonical_name ||
            edge.source_name
          )
        )}

        <span class="bk-edge-arrow">↔</span>

        ${esc(
          shortName(
            dest?.canonical_name ||
            edge.target_name
          )
        )}
      </h2>

      <div class="bk-relationship-stat">
        <strong>
          ${weight.toLocaleString()}
        </strong>
        <span>shared passages</span>
      </div>

      <p class="bk-panel-help">
        This is an observed textual connection:
        both characters occur in the same passages.
        Co-occurrence does not by itself establish
        the nature of their relationship.
      </p>

      <hr>

      <div class="bk-eyebrow">
        INTERPRETIVE LAYER
      </div>

      <h3>Proposed relationships</h3>

      ${
        pairAssertions.length
          ? pairAssertions
              .slice(0, 20)
              .map(assertionHTML)
              .join("")
          : `
            <div class="bk-empty-state">
              No machine-proposed semantic relationship
              between these characters is visible at your
              current reader position.
            </div>
          `
      }
    `;
  }

  function renderCharacterSummary(id) {
    const target =
      document.getElementById("bk-relationship-detail");

    const character =
      characterById(id);

    if (!target || !character) return;

    const connected =
      baseVisibleEdges()
        .filter(
          edge =>
            edge.source === id ||
            edge.target === id
        )
        .sort(
          (a, b) =>
            Number(
              b.shared_passages ||
              b.weight ||
              0
            ) -
            Number(
              a.shared_passages ||
              a.weight ||
              0
            )
        );

    target.innerHTML = `
      <div class="bk-eyebrow">
        CHARACTER NODE
      </div>

      <h2>
        ${esc(character.canonical_name)}
      </h2>

      <div class="bk-profile-stats bk-network-profile-stats">

        <div>
          <strong>
            ${Number(
              character.mention_count || 0
            ).toLocaleString()}
          </strong>
          <span>mentions</span>
        </div>

        <div>
          <strong>
            ${connected.length}
          </strong>
          <span>visible connections</span>
        </div>

      </div>

      <p class="bk-panel-help">
        Select an edge to inspect the textual evidence
        and proposed interpretation behind a connection.
      </p>

      <div class="bk-node-connections">

        ${connected.slice(0, 20).map(edge => {
          const otherId =
            edge.source === id
              ? edge.target
              : edge.source;

          const other =
            characterById(otherId);

          const weight =
            Number(
              edge.shared_passages ||
              edge.weight ||
              0
            );

          return `
            <div class="bk-node-connection">
              <span>
                ${esc(
                  shortName(
                    other?.canonical_name ||
                    otherId
                  )
                )}
              </span>

              <strong>${weight}</strong>
            </div>
          `;
        }).join("")}

      </div>
    `;
  }

  function resetInspector() {
    const target =
      document.getElementById("bk-relationship-detail");

    if (!target) return;

    target.innerHTML = `
      <div class="bk-detail-placeholder">

        <div class="bk-eyebrow">
          RELATIONSHIP INSPECTOR
        </div>

        <h3>Select a connection</h3>

        <p>
          Click an edge to inspect its evidence and
          proposed semantic interpretations. Click a
          node to inspect that character's visible
          network.
        </p>

      </div>
    `;
  }

  function addResetLayoutButton() {
    const resetView =
      document.getElementById("bk-network-reset");

    if (!resetView) return;

    if (
      document.getElementById(
        "bk-network-reset-layout"
      )
    ) {
      return;
    }

    const button =
      document.createElement("button");

    button.id =
      "bk-network-reset-layout";

    button.className =
      "bk-button";

    button.type =
      "button";

    button.textContent =
      "Reset layout";

    button.addEventListener(
      "click",
      () => {
        clearPositions();

        selectedEdge = null;
        resetInspector();
        renderNetwork();

        /*
         * Give the physics engine a fresh opportunity
         * to produce a layout.
         */
        if (network) {
          network.setOptions({
            physics: {
              enabled: true
            }
          });

          network.stabilize(250);
        }
      }
    );

    resetView.insertAdjacentElement(
      "afterend",
      button
    );
  }

  function resetView() {
    const view =
      document.getElementById(
        "bk-network-view"
      );

    const slider =
      document.getElementById(
        "bk-network-threshold"
      );

    const value =
      document.getElementById(
        "bk-network-threshold-value"
      );

    const neighbors =
      document.getElementById(
        "bk-include-neighbors"
      );

    if (view) {
      view.value = "all";
    }

    if (slider) {
      slider.value = "3";
    }

    if (value) {
      value.textContent = "3";
    }

    if (neighbors) {
      neighbors.checked = false;
    }

    customSelection.clear();
    selectedEdge = null;

    updateControlVisibility();
    renderCustomCheckboxes();
    resetInspector();
    renderNetwork();
  }

  function wireControls() {
    const view =
      document.getElementById(
        "bk-network-view"
      );

    const group =
      document.getElementById(
        "bk-network-group"
      );

    const slider =
      document.getElementById(
        "bk-network-threshold"
      );

    const value =
      document.getElementById(
        "bk-network-threshold-value"
      );

    view?.addEventListener(
      "change",
      () => {
        selectedEdge = null;

        updateControlVisibility();
        renderCustomCheckboxes();
        resetInspector();
        renderNetwork();
      }
    );

    group?.addEventListener(
      "change",
      () => {
        selectedEdge = null;
        resetInspector();
        renderNetwork();
      }
    );

    slider?.addEventListener(
      "input",
      () => {
        if (value) {
          value.textContent =
            slider.value;
        }

        selectedEdge = null;
        resetInspector();
        renderNetwork();
      }
    );

    document
      .getElementById(
        "bk-include-neighbors"
      )
      ?.addEventListener(
        "change",
        () => {
          selectedEdge = null;
          resetInspector();
          renderNetwork();
        }
      );

    document
      .getElementById(
        "bk-custom-clear"
      )
      ?.addEventListener(
        "click",
        () => {
          customSelection.clear();
          selectedEdge = null;

          renderCustomCheckboxes();
          resetInspector();
          renderNetwork();
        }
      );

    document
      .getElementById(
        "bk-custom-all"
      )
      ?.addEventListener(
        "click",
        () => {
          customSelection =
            new Set(
              visibleCharacters()
                .map(c => c.entity_id)
            );

          selectedEdge = null;

          renderCustomCheckboxes();
          resetInspector();
          renderNetwork();
        }
      );

    document
      .getElementById(
        "bk-network-reset"
      )
      ?.addEventListener(
        "click",
        resetView
      );
  }

  function rerenderForReaderPosition() {
    customSelection =
      new Set(
        [...customSelection].filter(id => {
          const character =
            characterById(id);

          return (
            character &&
            allowed(
              character.first_narrative_position
            )
          );
        })
      );

    selectedEdge = null;

    renderCustomCheckboxes();
    resetInspector();
    renderNetwork();
  }

  async function initialize() {
    const container =
      document.getElementById(
        "bk-relationship-network"
      );

    if (!container) return;

    try {
      [
        characters,
        relationships,
        assertions,
        passages
      ] = await Promise.all([
        BK.fetchJSON(
          "data/public/characters_v2.json"
        ),

        BK.fetchJSON(
          "data/public/relationship_network.json"
        ),

        BK.fetchJSON(
          "data/public/assertions_v2.json"
        ),

        BK.fetchJSON(
          "data/public/passage_index.json"
        )
      ]);

      updateControlVisibility();
      renderCustomCheckboxes();
      wireControls();
      addResetLayoutButton();
      renderNetwork();

      window.addEventListener(
        "bk-reader-position-changed",
        rerenderForReaderPosition
      );

    } catch (err) {
      console.error(
        "Relationship explorer failed:",
        err
      );

      container.innerHTML = `
        <div class="bk-error">
          Could not load relationship data:
          ${esc(err.message)}
        </div>
      `;
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initialize
    );
  } else {
    initialize();
  }

})();
