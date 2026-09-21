(() => {
  const $ = id => document.getElementById(id);
  const BK = window.BK;

  let passages = [];
  let chapters = [];
  let limit = 50;

  const cutoff = () =>
    BK?.getReaderPosition?.() ?? Number.MAX_SAFE_INTEGER;

  const key = x =>
    `${x.part}|${x.book}|${x.chapter}`;

  const esc = s =>
    String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;");

  function visibleChapters() {
    return chapters.filter(
      x => Number(x.max_narrative_position) <= cutoff()
    );
  }

  function populate() {
    const vc = visibleChapters();

    const part = $("bk-passages-part");
    const book = $("bk-passages-book");
    const chapter = $("bk-passages-chapter");

    const oldPart = part.value;
    const oldBook = book.value;
    const oldChapter = chapter.value;

    const parts = [...new Set(vc.map(x => x.part))];

    part.innerHTML =
      '<option value="">All visible parts</option>' +
      parts.map(x =>
        `<option value="${x}">Part ${x}</option>`
      ).join("");

    if (parts.includes(oldPart)) part.value = oldPart;

    const books = [...new Set(
      vc.filter(x => !part.value || x.part === part.value)
        .map(x => x.book)
    )];

    book.innerHTML =
      '<option value="">All visible books</option>' +
      books.map(x =>
        `<option value="${x}">Book ${x}</option>`
      ).join("");

    if (books.includes(oldBook)) book.value = oldBook;

    const choices = vc.filter(x =>
      (!part.value || x.part === part.value) &&
      (!book.value || x.book === book.value)
    );

    chapter.innerHTML =
      '<option value="">All visible chapters</option>' +
      choices.map(x =>
        `<option value="${key(x)}">Chapter ${x.chapter} — ${
          esc(x.chapter_title || "")
        }</option>`
      ).join("");

    if (choices.some(x => key(x) === oldChapter))
      chapter.value = oldChapter;
  }

  function results() {
    const part = $("bk-passages-part").value;
    const book = $("bk-passages-book").value;
    const chapter = $("bk-passages-chapter").value;
    const search =
      $("bk-passages-search").value.trim().toLowerCase();

    return passages.filter(p =>
      Number(p.narrative_position) <= cutoff() &&
      (!part || p.part === part) &&
      (!book || p.book === book) &&
      (!chapter || key(p) === chapter) &&
      (!search ||
        String(p.text || "").toLowerCase().includes(search))
    );
  }

  function renderChapters() {
    const target = $("bk-passages-chapter-list");

    if (!target) return;

    target.innerHTML = visibleChapters().map(c => `
      <button
        type="button"
        class="bk-passages-chapter-button"
        data-key="${key(c)}">
        <span>
          Part ${c.part} · Book ${c.book} · Chapter ${c.chapter}
        </span>
        <strong>${esc(c.chapter_title || "")}</strong>
      </button>
    `).join("");

    target.querySelectorAll("button").forEach(b => {
      b.onclick = () => {
        const c = chapters.find(x => key(x) === b.dataset.key);
        if (!c) return;

        $("bk-passages-part").value = c.part;
        populate();

        $("bk-passages-book").value = c.book;
        populate();

        $("bk-passages-chapter").value = key(c);

        limit = 50;
        render();
      };
    });
  }

  function render() {
    const rows = results();

    $("bk-passages-status").innerHTML =
      `<strong>${rows.length.toLocaleString()} passages</strong>
       <span>within your current reading boundary</span>`;

    let previous = "";

    $("bk-passages-results").innerHTML =
      rows.slice(0, limit).map(p => {
        const k = key(p);

        let heading = "";

        if (k !== previous) {
          heading = `
            <div class="bk-reader-chapter-heading">
              <div class="bk-eyebrow">
                Part ${p.part} · Book ${p.book} · Chapter ${p.chapter}
              </div>
              <h2>${esc(p.chapter_title || "")}</h2>
            </div>`;
        }

        previous = k;

        return `
          ${heading}
          <article class="bk-reader-passage">
            <p>${esc(p.text)}</p>
            <footer>
              ${esc(p.passage_id)} ·
              position ${p.narrative_position}
            </footer>
          </article>`;
      }).join("");

    $("bk-passages-more").style.display =
      limit < rows.length ? "" : "none";
  }

  async function init() {
    console.log("PASSAGES INIT STARTING");

    [passages, chapters] = await Promise.all([
      BK.fetchJSON("data/public/passage_index.json"),
      BK.fetchJSON("data/public/chapters_v2.json")
    ]);

    console.log(
      "PASSAGES READY",
      passages.length,
      chapters.length
    );

    populate();
    renderChapters();
    render();

    $("bk-passages-part").onchange = () => {
      limit = 50;
      populate();
      render();
    };

    $("bk-passages-book").onchange = () => {
      limit = 50;
      populate();
      render();
    };

    $("bk-passages-chapter").onchange = () => {
      limit = 50;
      render();
    };

    $("bk-passages-search").oninput = () => {
      limit = 50;
      render();
    };

    $("bk-passages-more").onclick = () => {
      limit += 50;
      render();
    };

    window.addEventListener(
      "bk-reader-position-changed",
      () => {
        limit = 50;
        populate();
        renderChapters();
        render();
      }
    );
  }

  window.BKPassagesInit = init;
})();
