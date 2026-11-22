import init from "manifold-3d";
import wasm from "manifold-3d/manifold.wasm?url";
import { labels, dimensions, feature, sample, validate } from "./model.js";
import { buildSolid } from "./solid.js";
import { createView } from "./view.js";
import { binarySTL, threeMF } from "./export.js";
import { readRoom, newRoom, roomURL, requestRoom } from "./sync.js";

const $ = (id) => document.getElementById(id);
const draftKey = "katachi.draft.v1",
  serverKey = "katachi.server.v1";
const defaultApi =
  import.meta.env.VITE_SYNC_URL ||
  (import.meta.env.DEV ? "http://localhost:8787" : "");
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
function localModel() {
  try {
    const saved = localStorage.getItem(draftKey);
    if (saved) return validate(JSON.parse(saved));
  } catch {
    note("端末の下書きを読み込めませんでした。");
  }
  return sample();
}
function controls() {
  const blocked = !ready || busy;
  for (const b of document.querySelectorAll(
    "[data-add],#rename,#remove,#inspector button,#inspector input,#share,#tree button",
  ))
    b.disabled = blocked;
  $("undo").disabled = blocked || !undo.length;
  $("redo").disabled = blocked || !redo.length;
  $("export").disabled = blocked || !mesh;
}
function renderEditor() {
  $("rename").textContent = model.title;
  $("count").textContent = model.features.length + " 件";
  const tree = $("tree");
  tree.replaceChildren();
  if (!model.features.some((f) => f.id === selected))
    selected = model.features[0]?.id;
  for (const f of model.features) {
    const row = button("", () => {
      selected = f.id;
      renderEditor();
    });
    row.className = "shape";
    row.setAttribute("aria-pressed", String(selected === f.id));
    const symbol = el("span", { box: "▱", cylinder: "◉", hole: "⊖" }[f.type]);
    symbol.setAttribute("aria-hidden", "true");
    row.append(
      symbol,
      el("span", f.name),
      el(
        "small",
        f.type === "box" ? f.width + " × " + f.depth : "Ø " + f.diameter,
      ),
    );
    tree.append(row);
  }
  const f = model.features.find((s) => s.id === selected);
  $("inspector").hidden = !f;
  dirty = false;
  $("fields").replaceChildren();
  if (f) {
    $("featureName").value = f.name;
    for (const key of dimensions[f.type]) {
      const label = el("label", labels[key] + " (mm)"),
        input = el("input");
      input.type = "number";
      input.step = "any";
      input.required = true;
      input.name = key;
      input.value = f[key];
      input.min = ["x", "y", "z"].includes(key)
        ? -5000
        : key === "radius"
          ? 0
          : 0.01;
      input.max = 5000;
      label.append(input);
      $("fields").append(label);
    }
  }
  controls();
}
function show(next, data, refit = false) {
  model = next;
  mesh = data;
  viewer?.update(mesh, refit);
  $("empty").hidden = !!mesh;
  $("empty").textContent = "形状を追加してください";
  $("size").textContent = mesh
    ? mesh.bounds.max
        .map((v, i) => format(v - mesh.bounds.min[i]))
        .join(" × ") + " mm"
    : "—";
  $("volume").textContent = mesh ? format(mesh.volume / 1000) + " cm³" : "—";
  renderEditor();
}
function remember(stack, value) {
  stack.push(value);
  if (stack.length > 30) stack.shift();
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
    const geometry = buildSolid(kernel, next);
    if (room) {
      status("保存中…");
      const result = await requestRoom(room, revision, next);
      if (result.conflict) {
        acceptRemote(result);
        note(
          "他の編集を受信しました。最新の寸法を確認して、変更をもう一度入力してください。",
        );
        return false;
      }
      revision = result.revision;
    } else localStorage.setItem(draftKey, JSON.stringify(next));
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
    document.hidden ||
    $("modal").open
  )
    return;
  polling = true;
  const start = revision;
  try {
    const result = await requestRoom(room, revision);
    if (start !== revision || busy || dirty || $("modal").open) return;
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
$("inspector").oninput = () => {
  dirty = true;
};
$("inspector").onsubmit = async (event) => {
  event.preventDefault();
  const next = structuredClone(model),
    f = next.features.find((s) => s.id === selected);
  f.name = $("featureName").value.trim();
  for (const key of dimensions[f.type])
    f[key] = event.currentTarget.elements.namedItem(key).valueAsNumber;
  await commit(next);
};
document.querySelectorAll("[data-add]").forEach(
  (b) =>
    (b.onclick = () => {
      const f = feature(b.dataset.add);
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
$("camera").onchange = (e) => viewer?.fit(e.target.value);
$("fit").onclick = () => viewer?.fit($("camera").value);
$("zoomIn").onclick = () => viewer?.zoom(1.25);
$("zoomOut").onclick = () => viewer?.zoom(0.8);
$("grid").onclick = () => {
  const on = $("grid").getAttribute("aria-pressed") !== "true";
  $("grid").setAttribute("aria-pressed", on);
  viewer?.grid(on);
};
$("export").onclick = () => {
  const save = (ext) => {
    const bytes = ext === "stl" ? binarySTL(mesh) : threeMF(mesh);
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
    "印刷用に書き出す",
    el(
      "p",
      "寸法単位はmmです。書き出したファイルをスライサーで開いてください。",
    ),
    button("3MF を保存", () => save("3mf")),
    button("STL を保存", () => save("stl")),
  );
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
        localStorage.setItem(draftKey, JSON.stringify(next));
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
    viewer = createView($("viewport"));
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
