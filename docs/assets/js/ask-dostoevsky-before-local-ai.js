
(() => {

const $ = id => document.getElementById(id);
const BK = window.BK;

let passages = [];

const esc = s =>
  String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");

const cutoff = () =>
  BK?.getReaderPosition?.() ?? Number.MAX_SAFE_INTEGER;

function words(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z']{3,}/g) || [];
}

function retrieve(question, n=6) {

  const q = new Set(words(question));

  return passages
    .filter(p =>
      Number(p.narrative_position) <= cutoff()
    )
    .map(p => {

      let score = 0;

      for (const word of words(p.text)) {
        if (q.has(word)) score++;
      }

      return {p, score};
    })
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0,n)
    .map(x => x.p);
}

function boundary() {
  $("bk-ask-boundary").textContent =
    `Spoiler boundary: passage ${cutoff().toLocaleString()}`;
}

function addUser(text) {

  $("bk-ask-messages").insertAdjacentHTML(
    "beforeend",
    `<div class="bk-ask-message bk-ask-user">
       <div class="bk-ask-speaker">YOU</div>
       <p>${esc(text)}</p>
     </div>`
  );
}

function addPreview(sources) {

  const evidence = sources.map((p,i) => `
    <article class="bk-ask-source">
      <strong>
        [S${i+1}]
        Part ${esc(p.part)} ·
        Book ${esc(p.book)} ·
        Chapter ${esc(p.chapter)}
      </strong>

      <p>${esc(p.text)}</p>

      <small>
        ${esc(p.passage_id)} ·
        position ${esc(p.narrative_position)}
      </small>
    </article>
  `).join("");

  $("bk-ask-messages").insertAdjacentHTML(
    "beforeend",
    `<div class="bk-ask-message bk-ask-dostoevsky">

       <div class="bk-ask-speaker">
         RETRIEVAL PREVIEW
       </div>

       <p>
         These are the passages I would currently permit
         Dostoevsky to see before answering.
       </p>

       <details open>
         <summary>
           ${sources.length} retrieved source passages
         </summary>
         ${evidence}
       </details>

     </div>`
  );
}

async function init() {

  passages =
    await BK.fetchJSON(
      "data/public/passage_index.json"
    );

  console.log(
    "ASK DOSTOEVSKY READY:",
    passages.length
  );

  boundary();

  $("bk-ask-form").onsubmit = e => {

    e.preventDefault();

    const box = $("bk-ask-question");
    const question = box.value.trim();

    if (!question) return;

    addUser(question);

    const sources = retrieve(question);

    addPreview(sources);

    box.value = "";

    $("bk-ask-messages")
      .lastElementChild
      ?.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
  };

  document
    .querySelectorAll(".bk-ask-prompts button")
    .forEach(button => {

      button.onclick = () => {
        $("bk-ask-question").value =
          button.textContent.trim();

        $("bk-ask-question").focus();
      };
    });

  window.addEventListener(
    "bk-reader-position-changed",
    boundary
  );
}

window.BKAskInit = init;

})();
