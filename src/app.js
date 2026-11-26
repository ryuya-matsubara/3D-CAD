import { saveEntry, listEntries } from "./library.js";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";
import { textFont, textProfile } from "./templates.js";
import init from "manifold-3d";
import wasm from "manifold-3d/manifold.wasm?url";
import { labels, dimensions, feature, isPlanar, sample, validate } from "./model.js";
import { buildSolid } from "./solid.js";
import { createView } from "./view.js";
import { binarySTL, threeMF } from "./export.js";
import { readRoom, newRoom, roomURL, requestRoom } from "./sync.js";

const $ = (id) => document.getElementById(id);
const draftKey = "katachi.draft.v1",
  serverKey = "katachi.server.v1";
const pagesApi =
  location.origin === "https://ryuya-matsubara.github.io" &&
  location.pathname.startsWith("/3D-CAD/")
    ? "https://katachi-cad-sync.r-matubara.workers.dev"
    : "";
const defaultApi =
  import.meta.env.VITE_SYNC_URL ||
  (import.meta.env.DEV ? "http://localhost:8787" : pagesApi);
let model,
  mesh,
  kernel,
  viewer,
  room,
  selected,
  revision = 0,
  busy = false,
  polling = false,
  dirty = false,
  ready = false;
let undo = [],
  redo = [],
  noticeTimer;
let moveDraft, moveFrame;
const format = (n) => Number(n.toFixed(2)).toLocaleString("ja-JP");
function note(text) {
  $("notice").textContent = text;
  $("notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("notice").hidden = true), 6500);
}
function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, fn) {
  const b = el("button", text);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function status(text) {
  $("status").textContent = text;
}
function synced() {
  status(room ? "共有中 · v" + revision : "この端末に保存");
}
let libraryId = crypto.randomUUID();
function writeDraft(value, id = libraryId) {
  localStorage.setItem(draftKey, JSON.stringify({ libraryId: id, model: value }));
}
function localModel() {
  try {
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      const data = JSON.parse(saved);
      if (!data.libraryId) return validate(data);
      const restored = validate(data.model);
      libraryId = data.libraryId;
      return restored;
    }
  } catch {
    note("端末の下書きを読み込めませんでした。");
  }
  return sample();
}
function controls() {
  const blocked = !ready || busy;
  for (const b of document.querySelectorAll(
    "[data-add],#rename,#remove,#inspector button,#inspector input,#inspector select,#share,#saveModel,#openModel,#newModel,#tree button",
  ))
    b.disabled = blocked || !!moveDraft;
  $("undo").disabled = blocked || !!moveDraft || !undo.length;
  $("redo").disabled = blocked || !!moveDraft || !redo.length;
  $("export").disabled = blocked || !!moveDraft;
  $("moveShape").disabled = blocked || dirty;
  $("moveAxis").disabled = blocked;
}
function moveControls() {
  const moving = !!moveDraft;
  $("moveShape").parentElement.hidden = !viewer || !selected;
  $("moveShape").textContent = moving ? "✓" : "✋";
  $("moveShape").dataset.moving = String(moving);
  $("moveShape").title = moving ? "移動を確定" : "形状を移動";
  $("moveShape").setAttribute("aria-label", $("moveShape").title);
  $("moveAxis").hidden = !moving;
  $("moveAxis").value = moveDraft?.axis ?? "xy";
  $("moveZ").disabled = moving &&
    (moveDraft.feature.type === "hole" || moveDraft.feature.mode === "cut" && moveDraft.feature.through);
}
function endMove() {
  if (!moveDraft) return;
  cancelAnimationFrame(moveFrame);
  moveFrame = undefined;
  moveDraft = undefined;
  viewer.move();
}
function showGeometry(data, refit = false) {
  viewer?.update(data, refit);
  $("empty").hidden = !!data || !!moveDraft;
  $("size").textContent = data
    ? data.bounds.max.map((v, i) => format(v - data.bounds.min[i])).join(" × ")
    : "—";
}
function moveModel() {
  return { ...model, features: model.features.map(f => f.id === selected ? moveDraft.feature : f) };
}
function previewMove(position) {
  if (!moveDraft || busy) return;
  const axes = [...moveDraft.axis];
  const next = { ...moveDraft.feature };
  for (const key of axes) {
    const value = position[["x", "y", "z"].indexOf(key)];
    next[key] = Math.max(-5000, Math.min(5000, value));
  }
  if (axes.every(key => next[key] === moveDraft.feature[key])) return;
  moveDraft.feature = next;
  for (const key of axes) $("inspector").elements.namedItem(key).value = next[key];
  if (moveFrame !== undefined) return;
  moveFrame = requestAnimationFrame(() => {
    moveFrame = undefined;
    try {
      showGeometry(buildSolid(kernel, moveModel()));
    } catch (error) {
      note(error.message);
    }
    updateDimensions();
  });
}
$("moveShape").onclick = async () => {
  if (!moveDraft) {
    moveDraft = { feature: { ...model.features.find(f => f.id === selected) }, axis: "xy" };
    viewer.move("xy");
    moveControls();
    controls();
    return;
  }
  const original = model.features.find(f => f.id === selected);
  if (["x", "y", "z"].every(key => moveDraft.feature[key] === original[key])) {
    resetMove();
    return;
  }
  await commit(moveModel());
};
$("moveAxis").onchange = (event) => {
  moveDraft.axis = event.target.value;
  viewer.move(moveDraft.axis);
};
function resetMove() {
  endMove();
  showGeometry(mesh);
  renderEditor();
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && moveDraft && !busy) resetMove();
});
function textLength(f) {
  if (f.length !== undefined) return f.length;
  const { min, max } = mesh?.textBounds.get(f.id) ?? textProfile(f);
  return max[0] - min[0];
}
function displayFeatureName(f) {
  return (f.type === "cylinder" || f.type === "hole") && f.name === "円柱" ? "円" : f.name;
}
function renderEditor() {
  $("rename").textContent = model.title;
  $("count").textContent = model.features.length + " 件";
  const tree = $("tree");
  tree.replaceChildren();
  if (!model.features.some((f) => f.id === selected))
    selected = undefined;
  for (const f of model.features) {
    const row = button("", () => {
      selected = selected === f.id ? undefined : f.id;
      renderEditor();
    });
    row.className = "shape";
    row.setAttribute("aria-pressed", String(selected === f.id));
    const symbol = el("span", { box: "▱", triangle: "△", circle: "○", cylinder: "○", hole: "⊖", text:"T", gear:"⚙" }[f.type]);
    symbol.setAttribute("aria-hidden", "true");
    row.append(
      symbol,
      el("span", displayFeatureName(f) + (f.type === "hole" || f.mode === "cut" ? "（透過）" : "")),
      el(
        "small",
        f.type === "text" ? f.text : f.type === "gear" ? f.teeth+"歯" :
          f.type === "triangle" ? f.width + " × " + f.profileHeight :
          f.type === "box" ? f.width + " × " + f.depth : "Ø " + f.diameter,
      ),
    );
    tree.append(row);
  }
  const f = model.features.find((s) => s.id === selected);
  $("inspector").hidden = !f;
  updateDimensions();
  dirty = false;
  $("fields").replaceChildren();
  if (f) {
    $("featureName").value = displayFeatureName(f);
    $("cutout").checked = f.type === "hole" || f.mode === "cut";
    $("textRow").hidden = f.type !== "text";
    $("weightRow").hidden = f.type !== "text";
    $("planeRow").hidden = !isPlanar(f.type);
    $("profilePlane").value = f.plane ?? "xy";
    $("textValue").value = f.text || "";
    $("textWeight").value = f.weight ?? 400;
    const keys = f.type === "text" ? ["length", "rotation", ...dimensions.text.slice(1)] : dimensions[f.type];
    for (const key of keys) {
      const unit = key === "teeth" ? "" : key === "rotation" ? " (°)" : key === "apex" ? " (%)" : " (mm)";
      const caption = key === "height" && (isPlanar(f.type) || f.type === "cylinder") ? "厚さ" :
        key === "width" && f.type === "triangle" ? "底辺" : labels[key];
      const label = el("label", caption + unit),
        input = el("input");
      input.type = "number";
      input.step = "any";
      input.required = true;
      input.name = key;
      input.value = key === "length" ? textLength(f) : f[key] ?? 0;
      input.min = ["x", "y", "z"].includes(key)
        ? -5000
        : ["radius","bore"].includes(key)
          ? 0
          : 0.01;
      input.max = 5000;
      if (key === "rotation") {
        input.min = -360;
        input.max = 360;
      }
      if (key === "apex") {
        input.value = f.apex ?? 50;
        input.min = 0;
        input.max = 100;
        input.title = "0%または100%で直角三角形";
      }
      if (key === "length" && f.length === undefined) {
        input.min = Math.min(0.01, input.valueAsNumber);
        input.max = Math.max(5000, input.valueAsNumber);
      }
      label.append(input);
      const cell = el("div");
      cell.append(label);
      if (["x", "y", "z"].includes(key)) {
        if (key === "x") cell.style.gridColumnStart = "1";
        const movement = el("div");
        movement.className = "movement";
        for (const delta of [-1, 1]) {
          const move = button(delta > 0 ? "+" : "−", () => {
            input.value = Number((input.valueAsNumber + delta).toFixed(6));
            $("inspector").requestSubmit();
          });
          move.setAttribute("aria-label", labels[key] + " " + delta + " mm移動");
          movement.append(move);
        }
        cell.append(movement);
      }
      $("fields").append(cell);
    }
  }
  moveControls();
  controls();
}
function show(next, data, refit = false) {
  endMove();
  model = next;
  mesh = data;
  showGeometry(mesh, refit);
  $("empty").textContent = "形状を追加してください";
  renderEditor();
}
function remember(stack, value) {
  stack.push(value);
  if (stack.length > 30) stack.shift();
}
async function prepareFonts(next) {
  const letters = new Map();
  for (const f of next.features) if (f.type === "text") {
    const weight = f.weight ?? 400;
    letters.set(weight, (letters.get(weight) ?? "") + f.text);
  }
  await Promise.all(Array.from(letters, ([weight, text]) => document.fonts.load(textFont(weight), text)));
}
function acceptRemote(remote, refit = false) {
  const geometry = buildSolid(kernel, remote.model);
  undo = [];
  redo = [];
  revision = remote.revision;
  ready = true;
  show(remote.model, geometry, refit);
  synced();
}
async function commit(next, kind = "edit", nextSelection = selected) {
  if (!ready || busy) return false;
  busy = true;
  controls();
  try {
    await prepareFonts(next);
    const geometry = buildSolid(kernel, next);
    if (room) {
      status("保存中…");
      const result = await requestRoom(room, revision, next);
      if (result.conflict) {
        await prepareFonts(result.model);
        acceptRemote(result);
        note(
          "他の編集を受信しました。最新の寸法を確認して、変更をもう一度入力してください。",
        );
        return false;
      }
      revision = result.revision;
    } else writeDraft(next);
    if (kind === "undo") {
      undo.pop();
      remember(redo, model);
    } else if (kind === "redo") {
      redo.pop();
      remember(undo, model);
    } else {
      remember(undo, model);
      redo = [];
    }
    const refit = !mesh;
    if (kind !== "edit") {
      const previous = new Map(model.features.map(f => [f.id, f]));
      const changed = next.features.find(f => JSON.stringify(previous.get(f.id)) !== JSON.stringify(f));
      const removedIndex = model.features.findIndex(f => !next.features.some(other => other.id === f.id));
      nextSelection = changed?.id ?? next.features[Math.min(removedIndex, next.features.length - 1)]?.id ?? nextSelection;
    }
    selected = nextSelection;
    show(next, geometry, refit);
    synced();
    return true;
  } catch (e) {
    status("変更は未保存");
    note(e.message);
    return false;
  } finally {
    busy = false;
    controls();
  }
}
async function poll() {
  if (
    !room ||
    !kernel ||
    busy ||
    polling ||
    dirty ||
    moveDraft ||
    document.hidden ||
    $("modal").open
  )
    return;
  polling = true;
  const start = revision;
  try {
    const result = await requestRoom(room, revision);
    if (result) await prepareFonts(result.model);
    if (start !== revision || busy || dirty || moveDraft || $("modal").open) return;
    if (result) acceptRemote(result, !ready);
    else synced();
  } catch (e) {
    if (start === revision && !busy) {
      status("共有接続を再試行中");
      if (!ready) $("empty").textContent = e.message;
    }
  } finally {
    polling = false;
  }
}
function dialog(title, ...content) {
  $("dialogTitle").textContent = title;
  $("dialogBody").replaceChildren(...content);
  if (!$("modal").open) $("modal").showModal();
}
function field(caption, value) {
  const label = el("label", caption),
    input = el("input");
  input.value = value;
  label.append(input);
  return { label, input };
}
function shareDialog() {
  const msg = el("output");
  if (room) {
    const { label, input } = field("共同編集URL", roomURL(room));
    input.readOnly = true;
    input.onclick = () => input.select();
    const copy = button("リンクをコピー", async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        msg.textContent = "コピーしました。";
      } catch {
        input.select();
        msg.textContent = "選択したURLをコピーしてください。";
      }
    });
    dialog(
      "編集リンクを共有",
      el(
        "p",
        "このリンクを持つ人はモデルを編集できます。スマホやChatGPTで同じリンクを開いてください。",
      ),
      label,
      copy,
      msg,
    );
    return;
  }
  const { label, input } = field(
    "共有サーバー URL",
    defaultApi || localStorage.getItem(serverKey) || "",
  );
  input.placeholder = "https://katachi-cad-sync.…workers.dev";
  const create = button("共有プロジェクトを作成", async () => {
    create.disabled = true;
    busy = true;
    controls();
    try {
      const target = newRoom(input.value.trim());
      const saved = await requestRoom(target, 0, model);
      if (saved.conflict) throw Error("新しいリンクを発行し直してください。");
      libraryId = crypto.randomUUID();
      room = target;
      revision = saved.revision;
      history.replaceState(null, "", roomURL(room));
      try {
        localStorage.setItem(serverKey, room.api);
      } catch {}
      undo = [];
      redo = [];
      synced();
      shareDialog();
    } catch (e) {
      msg.textContent =
        "共有を開始できませんでした。サーバーURLと接続状態を確認してください。 " +
        e.message;
    } finally {
      busy = false;
      controls();
      create.disabled = false;
    }
  });
  const items = [
    el(
      "p",
      "このモデルを共有データベースに保存し、編集用のリンクを発行します。",
    ),
  ];
  if (!defaultApi) items.push(label);
  dialog("編集リンクを共有", ...items, create, msg);
}
$("share").onclick = shareDialog;
$("rename").onclick = () => {
  const { label, input } = field("モデル名", model.title);
  input.maxLength = 80;
  dialog(
    "モデル名を変更",
    label,
    button("保存", async () => {
      if (await commit({ ...model, title: input.value.trim() }))
        $("modal").close();
    }),
  );
};
$("cutout").onchange = () => $("inspector").requestSubmit();
$("inspector").oninput = () => {
  dirty = true;
  $("moveShape").disabled = true;
};
$("inspector").onsubmit = async (event) => {
  event.preventDefault();
  const next = structuredClone(model),
    f = next.features.find((s) => s.id === selected);
  const originalType = f.type;
  if(f.type === "hole") Object.assign(f, {type:"cylinder",height:mesh ? mesh.bounds.max[2]-mesh.bounds.min[2] : 10,z:mesh?.bounds.min[2] ?? 0});
  const cutout = $("cutout").checked;
  // Preserve historical through cuts when only another parameter is edited.
  const existingCut = originalType === "hole" || f.mode === "cut";
  f.through = cutout && existingCut && (originalType === "hole" || !!f.through);
  f.globalCut = cutout && (!existingCut || !!f.globalCut);
  f.mode = cutout ? "cut" : "add";
  delete f.transparent;
  const fields = event.currentTarget.elements;
  if (f.type === "text") {
    const length = fields.namedItem("length").valueAsNumber;
    if (f.length !== undefined || length >= 0.01 && length <= 5000) f.length = length;
    f.rotation = fields.namedItem("rotation").valueAsNumber;
    f.weight = Number($("textWeight").value);
    f.text = $("textValue").value;
  }
  if (isPlanar(f.type)) {
    f.plane = $("profilePlane").value;
    if (f.plane !== "xy") f.through = false;
  }
  f.name = $("featureName").value.trim();
  for (const key of dimensions[originalType])
    if (key !== "size") f[key] = fields.namedItem(key).valueAsNumber;
  await commit(next);
};
document.querySelectorAll("[data-add]").forEach(
  (b) =>
    (b.onclick = () => {
      const f = feature(b.dataset.add);
      if ((f.type === "text" || isPlanar(f.type)) && mesh) f.z = mesh.bounds.max[2];
      commit({ ...model, features: [...model.features, f] }, "edit", f.id);
    }),
);
$("remove").onclick = () =>
  commit({
    ...model,
    features: model.features.filter((f) => f.id !== selected),
  });
$("undo").onclick = () => commit(undo.at(-1), "undo");
$("redo").onclick = () => commit(redo.at(-1), "redo");
$("fit").onclick = () => viewer?.fit();
function updateDimensions() {
  viewer?.select(moveDraft?.feature ?? model?.features.find(f => f.id === selected),
    $("measure").getAttribute("aria-pressed") === "true");
}
$("measure").onclick = () => {
  const visible = $("measure").getAttribute("aria-pressed") !== "true";
  $("measure").setAttribute("aria-pressed", String(visible));
  updateDimensions();
};
$("pin").onclick = () => {
  const pinned = document.querySelector(".stage").classList.toggle("pinned");
  $("pin").setAttribute("aria-pressed", String(pinned));
  $("pin").textContent = pinned ? "固定を解除" : "ビューを固定";
};
$("zoomIn").onclick = () => viewer?.zoom(1.25);
$("zoomOut").onclick = () => viewer?.zoom(0.8);
$("export").onclick = () => {
  const save = (ext) => {
    const bytes = ext === "3dcad.json" ? JSON.stringify(model) : ext === "stl" ? binarySTL(mesh) : threeMF(mesh);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/octet-stream" }),
    );
    const link = el("a");
    link.href = url;
    link.download = model.title.replace(/[<>:"/\\|?*]/g, "_") + "." + ext;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $("modal").close();
  };
  dialog(
    "書き出し",
    el(
      "p",
      "寸法単位はmmです。書き出したファイルをスライサーで開いてください。",
    ),
    button("編集用モデルを書き出す", () => save("3dcad.json")),
    ...(mesh ? [button("3MF を保存", () => save("3mf")),
    button("STL を保存", () => save("stl"))] : []),
  );
};
$("saveModel").onclick = async () => {
  if (dirty) return note("先に変更を適用してください。");
  if (busy) return;
  busy = true;
  controls();
  try {
    if (!room) writeDraft(model);
    await saveEntry({ id: libraryId, updated: Date.now(), model });
    note("「" + model.title + "」を保存モデル一覧に保存しました。");
  } catch { note("モデルを保存できませんでした。端末の空き容量やサイトデータ設定を確認してください。"); }
  finally { busy = false; controls(); }
};
async function openLocal(next, id) {
  try {
    validate(next);
    await prepareFonts(next);
    buildSolid(kernel, next);
    writeDraft(next, id);
    history.replaceState(null, "", location.pathname + location.search);
    location.reload();
  } catch (error) { note(error.message); }
}
function confirmOpen(next, id) {
  dialog("モデルを開く", el("p", "「" + next.title + "」を開きます。現在の下書きは置き換わります。"),
    button("開く", () => openLocal(next, id)));
}
$("openModel").onclick = async () => {
  const list = el("div");
  list.className = "library-list";
  dialog("保存モデル一覧", list, button("モデルファイルを読み込む", () => $("modelFile").click()));
  try {
    const entries = await listEntries();
    for (const entry of entries.sort((a,b) => b.updated - a.updated)) {
      const row = button("", () => confirmOpen(entry.model, entry.id));
      row.append(el("strong", entry.model.title), el("small", new Date(entry.updated).toLocaleString("ja-JP")));
      list.append(row);
    }
    if (!entries.length) list.textContent = "保存したモデルはまだありません。";
  } catch { list.textContent = "保存モデル一覧を読み込めませんでした。"; }
};
$("modelFile").onchange = async () => {
  const file = $("modelFile").files[0];
  $("modelFile").value = "";
  if (!file) return;
  try {
    if (file.size > 65536) throw Error("モデルファイルが大きすぎます。");
    const next = validate(JSON.parse(await file.text()));
    confirmOpen(next, crypto.randomUUID());
  } catch (error) { note(error.message); }
};
$("newModel").onclick = () => {
  const { label, input } = field("新しいモデル名", "新規モデル");
  input.maxLength = 80;
  dialog(
    "新規モデル",
    el(
      "p",
      room
        ? "現在の共有モデルは編集リンクから再度開けます。"
        : "この端末の下書きを新しいモデルに切り替えます。",
    ),
    label,
    button("新規作成", () => {
      const next = { version: 1, title: input.value.trim(), features: [] };
      try {
        validate(next);
        writeDraft(next, crypto.randomUUID());
        history.replaceState(null, "", location.pathname + location.search);
        location.reload();
      } catch (e) {
        note(e.message);
      }
    }),
  );
};
window.addEventListener("hashchange", () => location.reload());
document.addEventListener("visibilitychange", poll);
window.addEventListener("focus", poll);
controls();
try {
  kernel = await init({ locateFile: () => wasm });
  kernel.setup();
  try {
    viewer = createView($("viewport"), id => {
      if (!ready || busy) return;
      selected = id === selected ? undefined : id;
      renderEditor();
      const row = $("tree").querySelector('[aria-pressed="true"]');
      if (row) $("tree").scrollTop += row.getBoundingClientRect().top - $("tree").getBoundingClientRect().top;
    }, previewMove);
  } catch {
    note(
      "3D表示にはWebGL 2対応ブラウザが必要です。寸法編集と出力は使用できます。",
    );
  }
  room = readRoom();
  if (room) {
    status("共有モデルを取得中");
    $("rename").textContent = "共有モデル";
    $("empty").hidden = false;
    $("empty").textContent = "共有モデルを読み込み中…";
    await poll();
  } else {
    model = localModel();
    ready = true;
    await prepareFonts(model);
    show(model, buildSolid(kernel, model), true);
    synced();
  }
  setInterval(poll, 2500);
} catch (e) {
  status("読み込みエラー");
  note(e.message);
  $("empty").hidden = false;
  $("empty").textContent = e.message;
}
