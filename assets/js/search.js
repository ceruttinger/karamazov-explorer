(function () {
  "use strict";

  let passages = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function load() {
    const status = document.getElementById("bk-search-status");

    try {
      if (status) status.textContent = "Loading passage index…";

      const response = await fetch("./data/public/passage_index.json");

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      passages = await response.json();

      if (!Array.isArray(passages)) {
        throw new Error("Passage index is not an array.");
      }

      console.log(
        "Brothers Karamazov passage index loaded:",
        passages.length
      );

      if (status) {
        status.textContent =
          `${passages.length.toLocaleString()} passages loaded.`;
      }

    } catch (err) {
      console.error("Passage index load failed:", err);

      if (status) {
        status.textContent =
          `Could not load passage index: ${err.message}`;
      }
    }
  }

  function search() {
    const input = document.getElementById("bk-search");
    const results = document.getElementById("bk-search-results");
    const status = document.getElementById("bk-search-status");

    if (!input || !results || !status) return;

    const query = input.value.trim().toLowerCase();

    if (!query) {
      status.textContent =
        `${passages.length.toLocaleString()} passages loaded. Enter a search term.`;
      results.innerHTML = "";
      return;
    }

    if (!passages.length) {
      status.textContent =
        "Passage index has not loaded yet.";
      return;
    }

    const terms = query.split(/\s+/).filter(Boolean);

    const matches = passages
      .map(p => {
        const entities =
          Array.isArray(p.entities_mentioned)
            ? p.entities_mentioned
            : [];

        const concepts =
          Array.isArray(p.concepts)
            ? p.concepts
            : [];

        const haystack = [
          p.text || "",
          p.chapter_title || "",
          p.book_title || "",
          ...entities,
          ...concepts
        ].join(" ").toLowerCase();

        let score = 0;

        for (const term of terms) {
          score += haystack.split(term).length - 1;
        }

        return { p, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    status.textContent =
      `${matches.length.toLocaleString()} matching passages for "${input.value.trim()}".`;

    if (!matches.length) {
      results.innerHTML =
        "<p>No matching passages found.</p>";
      return;
    }

    results.innerHTML = matches
      .slice(0, 50)
      .map(({ p, score }) => `
        <article class="bk-item">
          <h3>${escapeHtml(
            p.citation_label || p.passage_id
          )}</h3>

          <div class="bk-meta">
            Relevance score ${score}
          </div>

          <p>${escapeHtml(p.text || "")}</p>

          ${
            Array.isArray(p.entities_mentioned) &&
            p.entities_mentioned.length
              ? `<div class="bk-meta">
                   Characters:
                   ${escapeHtml(
                     p.entities_mentioned.join(", ")
                   )}
                 </div>`
              : ""
          }

          ${
            Array.isArray(p.concepts) &&
            p.concepts.length
              ? `<div class="bk-meta">
                   Concepts:
                   ${escapeHtml(
                     p.concepts.join(", ")
                   )}
                 </div>`
              : ""
          }
        </article>
      `)
      .join("");
  }

  function bind() {
    const button =
      document.getElementById("bk-search-button");

    const input =
      document.getElementById("bk-search");

    if (!button || !input) {
      console.error(
        "Search controls were not found in the page."
      );
      return;
    }

    button.addEventListener("click", search);

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        search();
      }
    });

    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      bind
    );
  } else {
    bind();
  }
})();
