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


async function retrieve(question, n = 10) {

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
   EVIDENCE SUFFICIENCY — EXPERIMENTAL HEURISTIC v1

   This is deliberately conservative. Semantic similarity
   alone is not treated as evidence quality.

   IMPORTANT:
   This is an experimental policy calibrated from the
   project's initial retrieval evaluation. It is not a
   general-purpose confidence score.
------------------------------------------------------- */

function questionFeatures(question) {

  const q = question.toLowerCase();

  const broad =
    /\b(theme|meaning|believe|belief|faith|doubt|suffering|money|love|morality|moral|idea|ideas|represent|symbol|why)\b/.test(q);

  const relationship =
    /\b(relationship|between|toward|towards|feel about|feels about)\b/.test(q);

  return {
    broad,
    relationship
  };
}


function assessEvidence(question, candidates) {

  if (!candidates.length) {

    return {
      status: "INSUFFICIENT",
      reason:
        "No spoiler-safe evidence was retrieved.",
      metrics: {}
    };
  }

  /*
   * Evaluate the top-three evidence package even though
   * generation currently receives only one source.
   */
  const top =
    candidates.slice(0, 3);

  const scores =
    top.map(
      x => Number(x.semantic_score || 0)
    );

  const top1 =
    scores[0] || 0;

  const top3Mean =
    scores.reduce(
      (a, b) => a + b,
      0
    ) / scores.length;

  const wordCounts =
    top.map(
      x =>
        String(x.text || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .length
    );

  const substantive =
    wordCounts.filter(
      n => n >= 35
    ).length;

  const substantial =
    wordCounts.filter(
      n => n >= 80
    ).length;

  const strong =
    scores.filter(
      x => x >= 0.40
    ).length;

  const veryStrong =
    scores.filter(
      x => x >= 0.50
    ).length;

  const {
    broad,
    relationship
  } = questionFeatures(question);

  let status = "LIMITED";

  let reason =
    "Relevant evidence was retrieved, but the evidence package is incomplete.";

  /*
   * Very weak evidence package.
   */
  if (
    top1 < 0.30 &&
    top3Mean < 0.28
  ) {

    status = "INSUFFICIENT";

    reason =
      "The retrieved passages are too weakly related to the question to support a responsible answer.";
  }

  /*
   * Broad interpretive questions require more than a
   * single semantic hit.
   */
  else if (
    broad &&
    (
      substantive === 0 ||
      (
        strong < 2 &&
        top3Mean < 0.42
      )
    )
  ) {

    status = "INSUFFICIENT";

    reason =
      "The question requires interpretive synthesis, but the retrieved evidence does not yet provide enough substantive coverage.";
  }

  /*
   * Strong broad-question evidence package.
   */
  else if (
    broad &&
    substantive >= 2 &&
    strong >= 2 &&
    top3Mean >= 0.45
  ) {

    status = "SUPPORTED";

    reason =
      "Multiple substantive passages provide sufficiently strong evidence for a grounded synthesis.";
  }

  /*
   * Relationship questions can sometimes be supported
   * by fewer passages when the match is direct.
   */
  else if (
    relationship &&
    top1 >= 0.50 &&
    (
      substantive >= 1 ||
      veryStrong >= 2
    )
  ) {

    status = "SUPPORTED";

    reason =
      "The retrieved evidence is sufficiently direct to characterize the relationship at this reading point.";
  }

  /*
   * General strong evidence package.
   */
  else if (
    top1 >= 0.50 &&
    top3Mean >= 0.45 &&
    substantive >= 1
  ) {

    status = "SUPPORTED";

    reason =
      "The retrieved passages provide a sufficiently strong and substantive evidence package.";
  }

  return {
    status,
    reason,

    metrics: {
      top1:
        Number(top1.toFixed(4)),

      top3Mean:
        Number(top3Mean.toFixed(4)),

      substantive,
      substantial,
      strong,
      veryStrong,
      broad,
      relationship,

      wordCounts
    }
  };
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


function userPrompt(question, sources, assessment = null) {

  return `
READER QUESTION:

${question}

EVIDENCE SUFFICIENCY:
${assessment?.status || "UNKNOWN"}

${assessment?.status === "LIMITED"
  ? "The available evidence is LIMITED. Answer narrowly, explicitly qualify uncertainty, and do not imply that the text has established more than these passages support."
  : "The available evidence has been judged sufficient for a grounded answer."}

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
  statusNode,
  assessment = null
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
          sources,
          assessment
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

  const candidates =
    await retrieve(question, 10);

  const assessment =
    assessEvidence(
      question,
      candidates
    );

  console.log(
    "EVIDENCE SUFFICIENCY",
    assessment
  );

  /*
   * Keep local generation deliberately small for the
   * current WebGPU hardware configuration.
   */
  const sources =
    candidates.slice(0, 1);

  if (!candidates.length) {

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

  if (
    assessment.status ===
    "INSUFFICIENT"
  ) {

    const status =
      addStatus(
        "The text available before your current reading boundary does not provide enough evidence for me to answer this responsibly. " +
        assessment.reason
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

  if (
    assessment.status ===
    "LIMITED"
  ) {

    status.innerHTML =
      `<div class="bk-ask-speaker">
         LOCAL AI
       </div>

       <p>
         Evidence status:
         <strong>LIMITED</strong>.
         I will answer only as far as the
         available text permits.
       </p>`;
  }

  const answer =
    await generateAnswer(
      question,
      sources,
      status,
      assessment
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
