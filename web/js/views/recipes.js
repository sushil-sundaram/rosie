import { api, conflictCurrent } from "../api.js";
import { delBtn, fail, h, list, safeHref, safeImg, showConflict, toast } from "../dom.js";
import { submitAiJob } from "../jobs.js";
import { fmtQty } from "../money.js";
import { matchRecipePantry } from "../pantry_match.js";
import { consumeRecipeOpen, render } from "../router.js";
import { showModal } from "../shortcuts.js";
import { cached } from "../store.js";
import { photoButton } from "../components/domain.js";

/*
 * A recipe being reviewed before it is saved: an import result, a new blank
 * recipe, or an existing one being edited (then it has an id). Kept outside
 * the view so live-sync re-renders don't lose it.
 */
let recipeDraft = null;
let recipeImporting = false;
let pendingShare = null;
let recipeQuery = "";
const openRecipes = new Set();

export function setSharedImport({ url, text, title }) {
  const rawUrl = (url || "").trim();
  const rawText = (text || "").trim();
  const match = rawUrl.match(/https?:\/\/\S+/i) || rawText.match(/https?:\/\/\S+/i);
  if (match) {
    pendingShare = { url: match[0] };
  } else if (rawText) {
    pendingShare = { text: title ? `${title.trim()}\n\n${rawText}` : rawText };
  }
}

const lines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
const fmtTime = (m) => (!m ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const asDraft = (r, extra = {}) => ({
  id: r.id || null,
  name: r.name || "",
  servings: r.servings || "",
  time_minutes: r.time_minutes || "",
  source_url: r.source_url || "",
  image_url: r.image_url || "",
  ingredients: (r.ingredients || []).map((i) => (typeof i === "string" ? i : i.text)).join("\n"),
  instructions: Array.isArray(r.instructions) ? r.instructions.join("\n") : (r.instructions || ""),
  version: r.version ?? null, // the saved version this edit started from
  ...extra,
});

function recipeImport() {
  const status = h("span.meta");
  const box = h("textarea.import", {
    name: "source", rows: 2, autocomplete: "off",
    placeholder: "Paste a recipe link — or the recipe text itself",
    "aria-label": "Recipe link or text",
  });
  const go = h("button.primary", { type: "submit" }, "Import");
  if (recipeImporting) {
    go.disabled = true;
    status.className = "spinner";
    status.textContent = "Still reading the last import";
  }
  const run = async (body, busyText) => {
    if (recipeImporting) return;
    recipeImporting = true;
    go.disabled = true;
    status.className = "spinner";
    status.textContent = busyText;
    try {
      const out = await submitAiJob("/recipes/import", body, "recipe_import");
      recipeDraft = asDraft(out, { method: out.method });
      render();
    } catch (err) {
      fail(err);
      status.className = "meta";
      status.textContent = "";
    } finally {
      recipeImporting = false;
      go.disabled = false;
    }
  };
  const form = h("form.stack", {
    onsubmit: (e) => {
      e.preventDefault();
      const v = box.value.trim();
      if (!v) return toast("Paste a link or some recipe text", true);
      const link = /^https?:\/\/\S+$/i.test(v) ? v : /^(www\.)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(v) ? `https://${v}` : null;
      if (link) run({ url: link }, "Reading the page");
      else run({ text: v }, "Reading it with local AI — this can take a minute");
    },
  }, box);
  const photo = photoButton("From a photo", "Reading the photo with local AI — this can take a minute", "/recipes/import", (out) => {
    recipeDraft = asDraft(out, { method: out.method });
    render();
    return "";
  }, "recipe_import");
  form.append(h("div.scan", go, photo, status,
    h("button", { type: "button", onclick: () => { recipeDraft = asDraft({}); render(); } }, "Write one")));
  if (pendingShare && !recipeImporting) {
    const shared = pendingShare;
    pendingShare = null;
    box.value = shared.url || shared.text || "";
    queueMicrotask(() => {
      if (shared.url) run({ url: shared.url }, "Reading the shared page");
      else if (shared.text) run({ text: shared.text }, "Reading shared text with local AI — this can take a minute");
    });
  }
  return form;
}

function recipeEditor() {
  const d = recipeDraft;
  if (!d) return null;
  const bind = (key) => ({ value: d[key], oninput: (e) => { d[key] = e.target.value; } });
  const save = async (e) => {
    e.preventDefault();
    if (!d.name.trim()) return toast("Give the recipe a name", true);
    const body = {
      name: d.name.trim(),
      servings: String(d.servings).trim() || null,
      time_minutes: Number(d.time_minutes) || null,
      source_url: d.source_url || null,
      image_url: d.image_url || null,
      ingredients: lines(d.ingredients),
      instructions: lines(d.instructions).join("\n"),
      version: d.version,
    };
    try {
      if (d.id) await api(`/recipes/${d.id}`, { method: "PUT", body });
      else await api("/recipes", { method: "POST", body });
      recipeDraft = null;
      toast(d.id ? `Updated ${body.name}` : `Saved ${body.name}`);
      render();
    } catch (err) {
      const now = conflictCurrent(err);
      if (!now) return fail(err);
      // Keep this person's edits on screen and let them choose.
      showConflict(editor, `${now.name} was saved from another device while you were editing.`, [
        ["Keep my changes", () => { d.version = now.version; editor.requestSubmit(); }, true],
        ["Load their version", () => { recipeDraft = asDraft(now); render(); }],
      ]);
    }
  };
  const note = d.id ? "Editing"
    : d.method === "structured" ? `Read from ${hostOf(d.source_url) || "the site"}'s recipe data`
    : d.method === "ai" ? "Read by local AI — check the amounts before saving"
    : "New recipe";
  const n = lines(d.ingredients).length;
  const imgUrl = safeImg(d.image_url);
  const srcUrl = safeHref(d.source_url);
  const editor = h("form.review.recipe-edit", { onsubmit: save, "aria-label": "Review recipe" },
    h("div.spread",
      h("h3", note),
      h("button.icon", { type: "button", onclick: () => { recipeDraft = null; render(); }, "aria-label": "Discard" }, "×")),
    h("div.edit-head",
      imgUrl ? h("img.thumb", { src: imgUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
      h("div.stack.grow",
        h("input", { name: "name", placeholder: "Recipe name", required: true, autocomplete: "off", "aria-label": "Recipe name", ...bind("name") }),
        h("div.row",
          h("label.field", h("span.meta", "Serves"), h("input", { name: "servings", autocomplete: "off", ...bind("servings") })),
          h("label.field", h("span.meta", "Minutes"), h("input", { name: "time_minutes", type: "number", min: "0", ...bind("time_minutes") }))),
        srcUrl ? h("a.meta", { href: srcUrl, target: "_blank", rel: "noopener noreferrer" }, hostOf(srcUrl) + " ↗") : null)),
    h("label.meta", { for: "rd-ing" }, "Ingredients — one per line"),
    h("textarea", { id: "rd-ing", name: "ingredients", rows: Math.min(16, Math.max(4, n + 1)), oninput: bind("ingredients").oninput }, d.ingredients),
    h("label.meta", { for: "rd-steps" }, "Steps — one per line"),
    h("textarea", { id: "rd-steps", name: "instructions", rows: Math.min(16, Math.max(4, lines(d.instructions).length + 1)), oninput: bind("instructions").oninput }, d.instructions),
    h("div.scan", h("button.primary", { type: "submit" }, d.id ? "Save changes" : "Save recipe")),
  );
  return editor;
}

/** Steps as numbered lists; a line ending in ":" ("For the gravy:") starts a new group. */
function stepGroups(steps) {
  const out = [];
  let ol = null;
  for (const s of steps) {
    if (s.endsWith(":") && s.length < 60 && (/^for\b/i.test(s) || s.split(/\s+/).length <= 3)) {
      out.push(h("p.step-section", s.slice(0, -1)));
      ol = null;
      continue;
    }
    if (!ol) {
      ol = h("ol.steps");
      out.push(ol);
    }
    ol.append(h("li", s));
  }
  return out;
}

async function deductFromPantry(deductItems) {
  if (!deductItems.length) return toast("No matched pantry quantities to deduct");
  try {
    await Promise.all(
      deductItems.map((d) => api(`/pantry/${d.id}/adjust`, { method: "POST", body: { delta: -d.delta } })),
    );
    toast(`Deducted ${deductItems.length} pantry item${deductItems.length === 1 ? "" : "s"}`);
    render();
  } catch (err) {
    fail(err);
  }
}

/** Puts what the pantry doesn't cover for this recipe on the groceries list. */
async function addToGroceries(recipe, missingItems) {
  if (!missingItems.length) return;
  try {
    const out = await api("/groceries/batch", {
      method: "POST",
      body: { items: missingItems.map((m) => ({ ...m, source: recipe.name })) },
    });
    const parts = [];
    if (out.added) parts.push(`${out.added} added`);
    if (out.merged) parts.push(`${out.merged} combined with items already listed`);
    if (out.already) parts.push(`${out.already} already on the list for this recipe`);
    toast(`Groceries: ${parts.join(", ") || "nothing to add"}`, false, { label: "Open list", onclick: () => { location.hash = "#/groceries"; } });
    render();
  } catch (err) {
    fail(err);
  }
}

function openCookMode(r, matchInfo) {
  const steps = lines(r.instructions);
  const doneIng = new Set();
  const doneStep = new Set();
  let wakeSentinel = null;
  let wakeStatus = "Requesting screen lock…";
  let closed = false;

  const wrap = h("div.cook-body");

  const acquireWake = async () => {
    if (closed || !navigator.wakeLock?.request) {
      wakeStatus = "Screen wake lock unavailable in this browser";
      updateWakeNote();
      return;
    }
    try {
      wakeSentinel = await navigator.wakeLock.request("screen");
      wakeStatus = "Screen kept awake while cooking";
      wakeSentinel.addEventListener("release", () => {
        if (!closed) {
          wakeStatus = "Screen lock paused";
          updateWakeNote();
        }
      });
    } catch {
      wakeStatus = "Keep-awake requires HTTPS or install as PWA";
    }
    updateWakeNote();
  };

  const onVisibility = () => {
    if (!closed && document.visibilityState === "visible" && (!wakeSentinel || wakeSentinel.released)) {
      acquireWake();
    }
  };

  const updateWakeNote = () => {
    const el = wrap.querySelector(".cook-wake");
    if (el) el.textContent = wakeStatus;
  };

  document.addEventListener("visibilitychange", onVisibility);

  const renderCook = () => {
    const ingNodes = (r.ingredients || []).map((ing, idx) => {
      const m = matchInfo.matches[idx];
      const checked = doneIng.has(idx);
      const pill = m
        ? (m.status === "available"
          ? h("span.tag.c-green", "In pantry")
          : m.status === "low"
            ? h("span.tag.c-orange", `Have ${fmtQty(m.pantryItem.quantity)} ${m.pantryItem.unit}`)
            : m.status === "check"
              ? h("span.tag.c-cyan", `Have ${fmtQty(m.pantryItem.quantity)} ${m.pantryItem.unit}`)
              : h("span.tag.c-red", "Missing"))
        : null;
      return h(
        "label.cook-check",
        { class: checked ? "done" : null },
        h("input", {
          type: "checkbox",
          checked,
          onchange: (e) => {
            if (e.target.checked) doneIng.add(idx);
            else doneIng.delete(idx);
            renderCook();
          },
        }),
        h("span.grow", ing.text),
        pill,
      );
    });

    const stepNodes = steps.map((s, idx) => {
      if (s.endsWith(":") && s.length < 60 && (/^for\b/i.test(s) || s.split(/\s+/).length <= 3)) {
        return h("p.step-section", s.slice(0, -1));
      }
      const checked = doneStep.has(idx);
      return h(
        "label.cook-step",
        { class: checked ? "done" : null },
        h("input", {
          type: "checkbox",
          checked,
          onchange: (e) => {
            if (e.target.checked) doneStep.add(idx);
            else doneStep.delete(idx);
            renderCook();
          },
        }),
        h("span.cook-step-num", `${idx + 1}.`),
        h("span.cook-step-text", s),
      );
    });

    const meta = [fmtTime(r.time_minutes), r.servings && (/^\d+$/.test(r.servings) ? `Serves ${r.servings}` : r.servings)].filter(Boolean).join(" · ");
    wrap.replaceChildren(
      h("div.spread", h("span.meta", meta || "Cook mode"), h("span.meta.cook-wake", wakeStatus)),
      ingNodes.length ? [h("h4", "Ingredients"), h("div.cook-list", ingNodes)] : null,
      stepNodes.length ? [h("h4", "Steps"), h("div.cook-list", stepNodes)] : h("p.empty", "No steps recorded for this recipe."),
      h(
        "div.scan",
        matchInfo.deductItems.length
          ? h("button.primary", { type: "button", onclick: () => deductFromPantry(matchInfo.deductItems) }, `Deduct used (${matchInfo.deductItems.length}) from pantry`)
          : null,
        h("button", { type: "button", onclick: () => close() }, "Done cooking"),
      ),
    );
  };

  renderCook();
  const { close } = showModal({
    title: r.name,
    body: wrap,
    className: "cook-dialog",
    backdropClass: "sheet-mobile",
    onClose: () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      wakeSentinel?.release().catch(() => {});
      wakeSentinel = null;
    },
  });
  acquireWake();
}

function recipeCard(r, pantry) {
  const steps = lines(r.instructions);
  const facts = [fmtTime(r.time_minutes), r.servings && (/^\d+$/.test(r.servings) ? `Serves ${r.servings}` : r.servings)].filter(Boolean);
  const imgUrl = safeImg(r.image_url);
  const srcUrl = safeHref(r.source_url);
  const matchInfo = matchRecipePantry(r.ingredients || [], pantry);
  const matchTag = r.ingredients?.length
    ? h(
        "span.tag",
        {
          class: matchInfo.availableCount === matchInfo.totalCount
            ? "c-green"
            : matchInfo.availableCount > 0
              ? "c-orange"
              : "c-muted",
        },
        `${matchInfo.availableCount}/${matchInfo.totalCount} in pantry`,
      )
    : null;
  return [
    h("details.grow.recipe", {
      "data-recipe-id": r.id,
      open: openRecipes.has(r.id),
      ontoggle: (e) => { if (e.target.open) openRecipes.add(r.id); else openRecipes.delete(r.id); },
    },
      h("summary", h("span.title", r.name), facts.length ? h("span.meta", " · " + facts.join(" · ")) : null, " ", matchTag),
      h("div.recipe-body",
        imgUrl ? h("img.photo", { src: imgUrl, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
        r.ingredients.length ? [
          h("h4", `Ingredients (${r.ingredients.length})`),
          h("ul.ingredients", r.ingredients.map((i, idx) => {
            const m = matchInfo.matches[idx];
            const badge = m?.status === "available"
              ? h("span.ing-status.c-green", " · In pantry")
              : m?.status === "low"
                ? h("span.ing-status.c-orange", ` · Have ${fmtQty(m.pantryItem.quantity)} ${m.pantryItem.unit}`)
                : m?.status === "check"
                  ? h("span.ing-status.c-cyan", ` · Have ${fmtQty(m.pantryItem.quantity)} ${m.pantryItem.unit}`)
                  : h("span.ing-status.c-red", " · Missing");
            return h("li", i.text, badge);
          })),
        ] : null,
        steps.length ? [h("h4", "Steps"), stepGroups(steps)] : null,
        h("div.scan",
          h("button.primary", { type: "button", onclick: () => openCookMode(r, matchInfo) }, "Cook mode"),
          matchInfo.deductItems.length
            ? h("button", { type: "button", onclick: () => deductFromPantry(matchInfo.deductItems) }, `Deduct (${matchInfo.deductItems.length}) from pantry`)
            : null,
          matchInfo.missingItems.length
            ? h("button", { type: "button", onclick: () => addToGroceries(r, matchInfo.missingItems) }, `Add ${matchInfo.missingItems.length} to groceries`)
            : h("span.meta.c-green", "Everything is in the pantry"),
          h("button", { type: "button", onclick: async () => { recipeDraft = asDraft(r); await render(); window.scrollTo(0, 0); } }, "Edit"),
          srcUrl ? h("a.meta", { href: srcUrl, target: "_blank", rel: "noopener noreferrer" }, hostOf(srcUrl) + " ↗") : null))),
    delBtn(`/recipes/${r.id}`, r.name),
  ];
}

export async function recipesView(root) {
  const [recipes, pantry] = await Promise.all([
    cached("recipes", "/recipes"),
    cached("pantry", "/pantry"),
  ]);
  const openTarget = consumeRecipeOpen();
  if (openTarget) {
    openRecipes.add(openTarget);
    recipeQuery = "";
  }

  const listWrap = h("div.recipes-list-wrap");
  const renderRecipes = () => {
    const q = recipeQuery.trim().toLowerCase();
    const visible = q
      ? recipes.filter((r) =>
          r.name.toLowerCase().includes(q)
          || (r.ingredients || []).some((i) => (i.text || i.name || "").toLowerCase().includes(q)),
        )
      : recipes;
    const emptyMsg = recipes.length
      ? "No matching recipes or ingredients"
      : "No recipes yet — paste a link from any recipe site to start";
    listWrap.replaceChildren(list(visible, (r) => recipeCard(r, pantry), emptyMsg));
  };

  const searchInput = h("input.search-input", {
    type: "search",
    value: recipeQuery,
    placeholder: "Search recipes or ingredients…",
    "aria-label": "Search recipes or ingredients",
    "data-shortcut-search": "true",
    oninput: (e) => {
      recipeQuery = e.target.value;
      renderRecipes();
    },
  });
  renderRecipes();

  root.append(h("div.narrow",
    h("h1", "Recipes"),
    h("p.sub", `${recipes.length} saved`),
    recipeDraft ? recipeEditor() : recipeImport(),
    h("h2", "Recipe box"),
    recipes.length ? h("div.filter-bar", searchInput) : null,
    listWrap,
  ));

  if (openTarget) {
    requestAnimationFrame(() => {
      const targetEl = document.querySelector(`[data-recipe-id="${openTarget}"]`);
      if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}
