(() => {

const $ = id => document.getElementById(id);
const BK = window.BK;

let passages = [];
let generator = null;
let transformersModule = null;

const MODEL =
  "onnx-community/Qwen2.5-0.5B-Instruct";

const esc = s =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const cutoff = () =>
  BK?.getReaderPosition?.() ??
  Number.MAX_SAFE_INTEGER;


/* -------------------------------------------------------
   SEMANTIC RETRIEVAL
------------------------------------------------------- */

const EMBEDDING_DIMENSIONS = 384;
const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

let passageVectors = null;
let semanticExtractor = null;


async function loadSemanticIndex() {

  if (passageVectors) return;

  const response = await fetch(
    "data/public/passage_embeddings.f32"
  );

  if (!response.ok) {
    throw new Error(
      `Could not load semantic index: ${response.status}`
    );
  }

  const buffer = await response.arrayBuffer();

  passageVectors = new Float32Array(buffer);

  const expected =
    passages.length * EMBEDDING_DIMENSIONS;

  if (passageVectors.length !== expected) {
    throw new Error(
      `Semantic index mismatch: got ${passageVectors.length} ` +
      `floats; expected ${expected}.`
    );
  }

  console.log("SEMANTIC INDEX READY", {
    passages: passages.length,
    dimensions: EMBEDDING_DIMENSIONS,
    floats: passageVectors.length
  });
}


async function loadSemanticModel() {

  if (semanticExtractor) return;

  /*
   * Reuse the same Transformers.js module that Qwen uses.
   * This avoids importing the library twice.
   */
  await getTransformers();

  console.log("Loading MiniLM semantic query model...");

  semanticExtractor =
    await transformersModule.pipeline(
      "feature-extraction",
      EMBEDDING_MODEL,
      {
        device: "webgpu",
        dtype: "fp32"
      }
    );

  console.log("MINILM READY");
}


function semanticDotProduct(
  queryVector,
  passageIndex
) {

  const offset =
    passageIndex * EMBEDDING_DIMENSIONS;

  let score = 0;

  for (
    let d = 0;
    d < EMBEDDING_DIMENSIONS;
    d++
  ) {
    score +=
      queryVector[d] *
      passageVectors[offset + d];
  }

  return score;
}


async function retrieve(question, n = 1) {

  await loadSemanticIndex();
  await loadSemanticModel();

  const positionCutoff = cutoff();

  const output =
    await semanticExtractor(
      question,
      {
        pooling: "mean",
        normalize: true
      }
    );

  const queryVector =
    output.tolist()[0];

  if (
    queryVector.length !==
    EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `Query embedding has ${queryVector.length} dimensions; ` +
      `expected ${EMBEDDING_DIMENSIONS}.`
    );
  }

  const scored = [];

  for (
    let i = 0;
    i < passages.length;
    i++
  ) {

    const p = passages[i];

    // CRITICAL SPOILER BOUNDARY
    if (
      Number(p.narrative_position) >
      positionCutoff
    ) {
      continue;
    }

    const score =
      semanticDotProduct(
        queryVector,
        i
      );

    scored.push({
      p,
      score
    });
  }

  scored.sort(
    (a, b) => b.score - a.score
  );

  const selected =
    scored
      .slice(0, n)
      .map(x => ({
        ...x.p,
        semantic_score: x.score
      }));

  console.log("SEMANTIC RETRIEVAL", {
    question,
    cutoff: positionCutoff,
    top: scored
      .slice(0, 5)
      .map(x => ({
        passage_id: x.p.passage_id,
        position:
          x.p.narrative_position,
        score:
          Number(x.score.toFixed(4))
      }))
  });

  return selected;
}


/* -------------------------------------------------------
   READER POSITION
------------------------------------------------------- */

function boundary() {

  $("bk-ask-boundary").textContent =
    `Spoiler boundary: passage ${cutoff().toLocaleString()}`;
}


/* -------------------------------------------------------
   MESSAGE UI
------------------------------------------------------- */

function addUser(text) {

  $("bk-ask-messages").insertAdjacentHTML(
    "beforeend",

    `<div class="bk-ask-message bk-ask-user">

       <div class="bk-ask-speaker">
         YOU
       </div>

       <p>${esc(text)}</p>

     </div>`
  );
}


function addStatus(text) {

  const id =
    `bk-ai-status-${Date.now()}`;

  $("bk-ask-messages").insertAdjacentHTML(
    "beforeend",

    `<div
       id="${id}"
       class="bk-ask-message bk-ask-dostoevsky">

       <div class="bk-ask-speaker">
         LOCAL AI
       </div>

       <p>${esc(text)}</p>

     </div>`
  );

  return $(id);
}


function sourceHTML(p, i) {

  return `
    <article class="bk-ask-source">

      <strong>
        [S${i + 1}]
        Part ${esc(p.part)} ·
        Book ${esc(p.book)} ·
        Chapter ${esc(p.chapter)}
      </strong>

      <p>
        ${esc(p.text)}
      </p>

      <small>
        ${esc(p.passage_id)} ·
        position ${esc(p.narrative_position)}
      </small>

    </article>
  `;
}


function addAnswer(answer, sources) {

  const evidence =
    sources
      .map(sourceHTML)
      .join("");

  /*
   * Escape model output first, then make our source
   * markers visually prominent.
   */
  const safeAnswer =
    esc(answer).replace(
      /\[S(\d+)\]/g,
      "<strong>[S$1]</strong>"
    );

  $("bk-ask-messages").insertAdjacentHTML(
    "beforeend",

    `<div class="bk-ask-message bk-ask-dostoevsky">

       <div class="bk-ask-speaker">
         DOSTOEVSKY · SIMULATED LOCAL AI
       </div>

       <div class="bk-ask-answer">
         ${safeAnswer.replaceAll("\n", "<br>")}
       </div>

       <details>

         <summary>
           Evidence · ${sources.length}
           source passages
         </summary>

         ${evidence}

       </details>

       <p class="small">
         Generated locally in your browser.
         No external LLM API was used.
       </p>

     </div>`
  );
}


/* -------------------------------------------------------
   LOCAL MODEL
------------------------------------------------------- */

async function getTransformers() {

  if (transformersModule) {
    return transformersModule;
  }

  transformersModule =
    await import(
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.3"
    );

  transformersModule.env.allowLocalModels = false;

  return transformersModule;
}


async function loadModel(statusNode) {

  if (generator) {
    return generator;
  }

  if (!navigator.gpu) {

    throw new Error(
      "WebGPU is not available in this browser."
    );
  }

  const {
    pipeline
  } = await getTransformers();

  statusNode.innerHTML =
    `<div class="bk-ask-speaker">
       LOCAL AI
     </div>

     <p>
       Loading the local Qwen model.
       The first visit requires a model download;
       later visits can use the browser cache.
     </p>

     <progress
       id="bk-model-progress"
       value="0"
       max="100"
       style="width:100%">
     </progress>

     <p id="bk-model-progress-text"
        class="small">
       Preparing model...
     </p>`;

  generator =
    await pipeline(
      "text-generation",
      MODEL,
      {
        device: "webgpu",
        dtype: "q4",

        progress_callback: info => {

          console.log(
            "MODEL LOAD:",
            info
          );

          if (
            info.progress !== undefined
          ) {

            const bar =
              $("bk-model-progress");

            const label =
              $("bk-model-progress-text");

            if (bar) {
              bar.value = info.progress;
            }

            if (label) {

              label.textContent =
                `Loading model: ${
                  Math.round(info.progress)
                }%`;
            }
          }
        }
      }
    );

  return generator;
}


/* -------------------------------------------------------
   GROUNDED PROMPT
------------------------------------------------------- */

function buildEvidence(sources) {

  return sources
    .map((p, i) => {

      return [
        `[S${i + 1}]`,
        `Part ${p.part}`,
        `Book ${p.book}`,
        `Chapter ${p.chapter}`,
        `Passage ${p.passage_id}`,
        `Narrative position ${p.narrative_position}`,
        "",
        String(p.text || "").slice(0, 700)
      ].join("\n");

    })
    .join(
      "\n\n--------------------\n\n"
    );
}


function systemPrompt() {

  return `
You are a literary interpretation assistant speaking
in a simulated Dostoevskian voice.

STYLE:
Write with psychological seriousness, moral tension,
introspection, dialectical questioning, and occasional
irony. You may sound Dostoevskian, but you must never
claim to actually be Fyodor Dostoevsky.

EVIDENCE RULES:
You may use ONLY the source passages supplied to you.
Do not use your general knowledge of The Brothers
Karamazov.

Do not mention events, revelations, relationships,
or character developments that are not supported by
the supplied passages.

Every substantive literary claim must cite at least
one supplied source using markers such as [S1] or
[S2].

Never invent a quotation.

If the supplied passages are insufficient to answer
the question, say so. Do not fill the gap from memory.

Distinguish textual evidence from interpretation.

The reader has deliberately selected a spoiler
boundary. Protect it absolutely.

Keep the answer reasonably concise.
`.trim();
}


function userPrompt(question, sources) {

  return `
READER QUESTION:

${question}

AVAILABLE SOURCE PASSAGES:

${buildEvidence(sources)}

Answer the reader using only this evidence.
`.trim();
}


/* -------------------------------------------------------
   GENERATION
------------------------------------------------------- */

async function generateAnswer(
  question,
  sources,
  statusNode
) {

  const localGenerator =
    await loadModel(statusNode);

  statusNode.innerHTML =
    `<div class="bk-ask-speaker">
       LOCAL AI
     </div>

     <p>
       Reading ${sources.length}
       spoiler-safe passages and
       generating locally...
     </p>`;

  const messages = [
    {
      role: "system",
      content: systemPrompt()
    },
    {
      role: "user",
      content:
        userPrompt(
          question,
          sources
        )
    }
  ];

    const promptChars =
    messages.reduce(
      (n, m) => n + m.content.length,
      0
    );

  console.log(
    "LOCAL AI GENERATION START",
    {
      sources: sources.length,
      promptChars,
      time: new Date().toISOString()
    }
  );

  const started =
    performance.now();

  const result =
    await localGenerator(
      messages,
      {
        max_new_tokens: 100,
        do_sample: false
      }
    );

  console.log(
    "LOCAL AI GENERATION FINISHED",
    {
      seconds:
        ((performance.now() - started) / 1000)
          .toFixed(1),
      time: new Date().toISOString()
    }
  );

  const generated =
    result?.[0]?.generated_text;

  if (Array.isArray(generated)) {

    return (
      generated[
        generated.length - 1
      ]?.content || ""
    );
  }

  return String(
    generated || ""
  );
}


/* -------------------------------------------------------
   ASK
------------------------------------------------------- */

async function ask(question) {

  addUser(question);

  const sources =
    await retrieve(question, 1);

  if (!sources.length) {

    const status =
      addStatus(
        "I could not find relevant passages before your current reading boundary."
      );

    status.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });

    return;
  }

  /*
   * Safety assertion:
   * retrieved evidence must never exceed the
   * selected reader position.
   */
  const violation =
    sources.some(
      p =>
        Number(p.narrative_position) >
        cutoff()
    );

  if (violation) {

    throw new Error(
      "Spoiler boundary violation detected. Generation stopped."
    );
  }

  const status =
    addStatus(
      `Retrieved ${sources.length} spoiler-safe passages. Preparing local AI...`
    );

  status.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });

  const answer =
    await generateAnswer(
      question,
      sources,
      status
    );

  status.remove();

  addAnswer(
    answer,
    sources
  );

  $("bk-ask-messages")
    .lastElementChild
    ?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
}


/* -------------------------------------------------------
   INITIALIZATION
------------------------------------------------------- */

async function init() {

  passages =
    await BK.fetchJSON(
      "data/public/passage_index.json"
    );

  console.log(
    "ASK DOSTOEVSKY LOCAL RAG READY:",
    passages.length,
    "passages"
  );

  boundary();

  const form =
    $("bk-ask-form");

  const button =
    $("bk-ask-submit");

  form.onsubmit =
    async e => {

      e.preventDefault();

      const box =
        $("bk-ask-question");

      const question =
        box.value.trim();

      if (!question) {
        return;
      }

      box.value = "";

      button.disabled = true;

      try {

        await ask(question);

      } catch (error) {

        console.error(
          "ASK DOSTOEVSKY ERROR:",
          error
        );

        addStatus(
          `Error: ${error.message}`
        );

      } finally {

        button.disabled = false;
      }
    };


  document
    .querySelectorAll(
      ".bk-ask-prompts button"
    )
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
