(function () {
  "use strict";

  const BK = window.BK = window.BK || {};

  BK.state = {
    chapters: [],
    readerPosition: null,
    readerChapter: null
  };

  BK.fetchJSON = async function(path) {
    const response = await fetch(path);

    if (!response.ok) {
      throw new Error(
        `Could not load ${path}: HTTP ${response.status}`
      );
    }

    return await response.json();
  };

  BK.escapeHTML = function(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  };

  BK.romanLabel = function(chapter) {
    let label =
      `Part ${chapter.part} · Book ${chapter.book} · Chapter ${chapter.chapter}`;

    if (chapter.book_title) {
      label += ` · ${chapter.book_title}`;
    }

    return label;
  };

  BK.getReaderPosition = function() {
    return BK.state.readerPosition;
  };

  BK.withinReaderPosition = function(position) {
    if (
      BK.state.readerPosition === null ||
      BK.state.readerPosition === undefined
    ) {
      return true;
    }

    if (position === null || position === undefined) {
      return true;
    }

    return Number(position) <= Number(BK.state.readerPosition);
  };

  BK.setReaderPosition = function(chapter) {
    BK.state.readerChapter = chapter;
    BK.state.readerPosition =
      Number(chapter.max_narrative_position);

    localStorage.setItem(
      "bk_reader_position",
      String(BK.state.readerPosition)
    );

    localStorage.setItem(
      "bk_reader_chapter",
      JSON.stringify({
        part: chapter.part,
        book: chapter.book,
        chapter: chapter.chapter
      })
    );

    const status =
      document.getElementById("bk-reader-status");

    if (status) {
      status.textContent =
        `Spoiler boundary: passage ${BK.state.readerPosition.toLocaleString()}`;
    }

    window.dispatchEvent(
      new CustomEvent("bk-reader-position-changed", {
        detail: {
          chapter: chapter,
          narrativePosition: BK.state.readerPosition
        }
      })
    );
  };

  function findSavedChapter(chapters) {
    const raw =
      localStorage.getItem("bk_reader_chapter");

    if (!raw) {
      return chapters[chapters.length - 1];
    }

    try {
      const saved = JSON.parse(raw);

      return chapters.find(c =>
        String(c.part) === String(saved.part) &&
        String(c.book) === String(saved.book) &&
        String(c.chapter) === String(saved.chapter)
      ) || chapters[chapters.length - 1];

    } catch {
      return chapters[chapters.length - 1];
    }
  }

  async function initializeReaderControl() {
    const select =
      document.getElementById("bk-reader-chapter");

    if (!select) return;

    try {
      const chapters =
        await BK.fetchJSON("data/public/chapters_v2.json");

      BK.state.chapters = chapters;

      select.innerHTML = "";

      chapters.forEach((chapter, i) => {
        const option =
          document.createElement("option");

        option.value = String(i);
        option.textContent =
          BK.romanLabel(chapter);

        select.appendChild(option);
      });

      const selected =
        findSavedChapter(chapters);

      const selectedIndex =
        chapters.findIndex(c =>
          String(c.part) === String(selected.part) &&
          String(c.book) === String(selected.book) &&
          String(c.chapter) === String(selected.chapter)
        );

      select.value =
        String(selectedIndex >= 0 ? selectedIndex : chapters.length - 1);

      BK.setReaderPosition(
        chapters[
          selectedIndex >= 0
            ? selectedIndex
            : chapters.length - 1
        ]
      );

      select.addEventListener("change", () => {
        const chapter =
          chapters[Number(select.value)];

        if (chapter) {
          BK.setReaderPosition(chapter);
        }
      });

    } catch (err) {
      console.error("Reader-position initialization failed:", err);

      select.innerHTML =
        `<option>Could not load chapters</option>`;

      const status =
        document.getElementById("bk-reader-status");

      if (status) {
        status.textContent = err.message;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeReaderControl
    );
  } else {
    initializeReaderControl();
  }

})();
