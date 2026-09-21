(function () {
  "use strict";

  const BK = window.BK || {};
  const target = document.getElementById("bk-chapter-browser");

  if (!target) return;

  let chapters = [];
  let passages = [];
  let chapterIndex = 0;

  function esc(value) {
    return BK.escapeHTML ? BK.escapeHTML(value) : String(value ?? "");
  }

  function sameChapter(a, b) {
    return String(a.part) === String(b.part) &&
      String(a.book) === String(b.book) &&
      String(a.chapter) === String(b.chapter);
  }

  function chapterPassages(chapter) {
    return passages.filter((passage) => sameChapter(passage, chapter));
  }

  function chapterHeading(chapter) {
    const location = `Part ${chapter.part} · Book ${chapter.book} · Chapter ${chapter.chapter}`;
    return chapter.chapter_title ? `${location}: ${chapter.chapter_title}` : location;
  }

  function render() {
    const chapter = chapters[chapterIndex];

    if (!chapter) {
      target.innerHTML = '<div class="bk-error">No chapter is available.</div>';
      return;
    }

    const visiblePassages = chapterPassages(chapter);
    const bookTitle = chapter.book_title
      ? `<p class="bk-reader-book-title">${esc(chapter.book_title)}</p>`
      : "";

    target.innerHTML = `
      <section class="bk-novel-reader" aria-live="polite">
        <div class="bk-novel-reader-header">
          <div>
            <div class="bk-eyebrow">CURRENT CHAPTER</div>
            <h2>${esc(chapterHeading(chapter))}</h2>
            ${bookTitle}
          </div>
          <div class="bk-reader-word-count">
            ${Number(chapter.words || 0).toLocaleString()} words
          </div>
        </div>

        <div class="bk-reader-actions" aria-label="Chapter navigation">
          <button id="bk-read-prev" type="button" ${chapterIndex === 0 ? "disabled" : ""}>
            ← Previous chapter
          </button>
          <span>Chapter ${chapterIndex + 1} of ${chapters.length}</span>
          <button id="bk-read-next" type="button" ${chapterIndex === chapters.length - 1 ? "disabled" : ""}>
            Next chapter →
          </button>
        </div>

        <article class="bk-novel-text">
          ${visiblePassages.map((passage) =>
            `<p data-passage-id="${esc(passage.passage_id)}">${esc(passage.text)}</p>`
          ).join("") || '<p class="bk-error">No text was found for this chapter.</p>'}
        </article>
      </section>
    `;

    document.getElementById("bk-read-prev")?.addEventListener("click", () => selectChapter(chapterIndex - 1));
    document.getElementById("bk-read-next")?.addEventListener("click", () => selectChapter(chapterIndex + 1));
  }

  function selectChapter(nextIndex) {
    if (nextIndex < 0 || nextIndex >= chapters.length) return;

    chapterIndex = nextIndex;
    const chapter = chapters[chapterIndex];
    const globalSelect = document.getElementById("bk-reader-chapter");

    if (globalSelect) globalSelect.value = String(chapterIndex);
    if (BK.setReaderPosition) BK.setReaderPosition(chapter);

    render();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function initialize() {
    target.innerHTML = '<div class="bk-loading">Loading the novel…</div>';

    try {
      [chapters, passages] = await Promise.all([
        BK.fetchJSON("data/public/chapters_v2.json"),
        BK.fetchJSON("data/public/passage_index.json")
      ]);

      const readerPosition = BK.getReaderPosition ? BK.getReaderPosition() : null;
      const matchingIndex = chapters.findIndex(
        (chapter) => Number(chapter.max_narrative_position) === Number(readerPosition)
      );
      chapterIndex = matchingIndex >= 0 ? matchingIndex : 0;
      render();
    } catch (error) {
      console.error("Novel reader failed:", error);
      target.innerHTML = `<div class="bk-error">The novel could not load: ${esc(error.message)}</div>`;
    }
  }

  window.addEventListener("bk-reader-position-changed", (event) => {
    if (!chapters.length) return;
    const matchingIndex = chapters.findIndex((chapter) => sameChapter(chapter, event.detail.chapter));
    if (matchingIndex >= 0 && matchingIndex !== chapterIndex) {
      chapterIndex = matchingIndex;
      render();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
