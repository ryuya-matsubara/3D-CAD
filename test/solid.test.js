import { test } from "node:test";
import assert from "node:assert/strict";
import init from "manifold-3d";
import { unzipSync, strFromU8 } from "fflate";
import { feature, sample, validate } from "../src/model.js";
import { buildSolid } from "../src/solid.js";
import { binarySTL, threeMF } from "../src/export.js";
const kernel = await init();
kernel.setup();

test("Plate with a through bore stays watertight in both exports", () => {
  const plate = {
    ...feature("box"),
    width: 60,
    depth: 40,
    height: 3,
    radius: 0,
  };
  const model = {
    version: 1,
    title: "test",
    features: [plate, feature("hole")],
  };
  const mesh = buildSolid(kernel, model);
  assert.deepEqual(mesh.bounds, { min: [-30, -20, 0], max: [30, 20, 3] });
  assert.ok(Math.abs(mesh.volume - (60 * 40 - Math.PI * 16) * 3) < 0.2);
  const edges = new Map();
  for (let t = 0; t < mesh.triangles.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = mesh.triangles[t + e],
        b = mesh.triangles[t + ((e + 1) % 3)];
      const key = [Math.min(a, b), Math.max(a, b)].join(",");
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  assert.ok([...edges.values()].every((n) => n === 2));
  const stl = binarySTL(mesh);
  assert.equal(
    stl.length,
    84 + 50 * new DataView(stl.buffer).getUint32(80, true),
  );
  const archive = unzipSync(threeMF(mesh));
  const xml = strFromU8(archive["3D/3dmodel.model"]);
  assert.match(xml, /unit="millimeter"/);
  assert.equal(xml.match(/<triangle /g).length, mesh.triangles.length / 3);
});
test("Sample builds, empty models remain editable, invalid dimensions fail", () => {
  assert.deepEqual(buildSolid(kernel, sample()).bounds.max, [40, 28, 18]);
  const model = sample();
  model.features = [];
  assert.equal(buildSolid(kernel, model), null);
  model.features = [{ ...feature("box"), height: -1 }];
  assert.throws(() => validate(model));
});

test("Triangular plates stay positioned on all three planes", () => {
  const triangle = { ...feature("triangle"), x: 2, y: 4, z: 6, apex: 0 };
  const boundsByPlane = {
    xy: { min: [-18, -11, 6], max: [22, 19, 9] },
    xz: { min: [-18, 2.5, 6], max: [22, 5.5, 36] },
    yz: { min: [0.5, -16, 6], max: [3.5, 24, 36] },
  };
  for (const [plane, bounds] of Object.entries(boundsByPlane)) {
    const model = { version: 1, title: "Triangle", features: [{ ...triangle, plane }] };
    const mesh = buildSolid(kernel, model);
    assert.deepEqual(mesh.bounds, bounds, plane);
    assert.ok(Math.abs(mesh.volume - 1800) < 0.001, plane);
    if (plane === "yz") {
      const upperVerticesY = [];
      for (let i = 0; i < mesh.vertices.length; i += 3)
        if (mesh.vertices[i + 2] === bounds.max[2]) upperVerticesY.push(mesh.vertices[i + 1]);
      assert.ok(upperVerticesY.length > 0);
      assert.ok(upperVerticesY.every(y => y === bounds.min[1]));
    }
    model.features[0].apex = 101;
    assert.throws(() => validate(model), /頂点位置/);
  }
});

test("A vertical circle can cut a round opening through a side", () => {
  const plate = { ...feature("box"), height: 40, radius: 0 };
  const circle = { ...feature("circle"), plane: "xz", height: 50, z: 8, mode: "cut", globalCut: true };
  const model = { version: 1, title: "Side opening", features: [plate, circle] };
  const mesh = buildSolid(kernel, model);
  assert.deepEqual(mesh.bounds, { min: [-30, -20, 0], max: [30, 20, 40] });
  const removed = 60 * 40 * 40 - mesh.volume;
  const circleArea = 96 * 12 ** 2 * Math.sin(2 * Math.PI / 96) / 2;
  assert.ok(Math.abs(removed - circleArea * 40) < 0.01);
  model.features[1].plane = "invalid";
  assert.throws(() => validate(model), /置く面/);
});
