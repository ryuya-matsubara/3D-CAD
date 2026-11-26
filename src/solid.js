import { gearProfile, profileFrame, textProfile, triangleProfile } from "./templates.js";
import { isPlanar, validate } from "./model.js";

// Historical cuts follow tree order. New cutouts subtract from the complete model.
export function buildSolid(kernel, model) {
  validate(model);
  const { Manifold, CrossSection } = kernel;
  const owners = new Map();
  const partBounds = new Map(), textBounds = new Map();
  let solid;
  try {
    const isGlobalCut = f => f.mode === "cut" && f.globalCut === true;
    const ordered = model.features.filter(f => !isGlobalCut(f)).concat(model.features.filter(isGlobalCut));
    for (const f of ordered) {
      const owned = [];
      const keep = (obj) => {
        owned.push(obj);
        return obj;
      };
      try {
        let piece,
          bottom = f.z;
        const cut = f.type === "hole" || f.mode === "cut";
        if (cut && (!solid || solid.isEmpty())) continue;
        let height = f.height;
        if (f.type === "hole" || (cut && f.through)) {
          const bounds = solid.boundingBox();
          bottom = bounds.min[2] - 1;
          height = bounds.max[2] - bottom + 1;
        }
        if (f.type === "box") {
          const inner = keep(
            CrossSection.square(
              [f.width - 2 * f.radius, f.depth - 2 * f.radius],
              true,
            ),
          );
          const outline = f.radius
            ? keep(inner.offset(f.radius, "Round", 2, 96))
            : inner;
          piece = keep(outline.extrude(height));
        } else if (f.type === "text" || f.type === "gear" || f.type === "triangle") {
          let rings;
          if (f.type === "text") {
            const { min, max, rings: textRings } = textProfile(f);
            textBounds.set(f.id, { min, max });
            rings = textRings;
          } else {
            rings = f.type === "gear" ? gearProfile(f) : [triangleProfile(f)];
          }
          const outline = keep(new CrossSection(rings, "EvenOdd"));
          const extruded = keep(outline.extrude(height));
          piece = f.type === "text" && f.rotation ? keep(extruded.rotate([0, 0, f.rotation])) : extruded;
        } else {
          piece = keep(
            Manifold.cylinder(height, f.diameter / 2, f.diameter / 2, 96),
          );
        }
        let translated;
        if (isPlanar(f.type)) {
          const [u, v, n, origin] = profileFrame({ ...f, z: bottom, height });
          translated = keep(piece.transform([...u, 0, ...v, 0, ...n, 0, ...origin, 1]));
        } else {
          translated = keep(piece.translate([f.x, f.y, bottom]));
        }
        const placed = keep(translated.asOriginal());
        owners.set(placed.originalID(), f.id);
        partBounds.set(f.id, placed.boundingBox());
        const next = solid
          ? cut
            ? solid.subtract(placed)
            : solid.add(placed)
          : placed;
        if (next === placed) owned.pop();
        solid?.delete();
        solid = next;
      } finally {
        owned.forEach((obj) => obj.delete());
      }
    }
    if (!solid || solid.isEmpty()) return null;
    if (solid.status() !== "NoError")
      throw Error("立体を計算できませんでした。寸法を確認してください。");
    const mesh = solid.getMesh();
    return {
      partBounds,
      textBounds,
      runs: Array.from(mesh.runOriginalID, (id, i) => ({id: owners.get(id), start: mesh.runIndex[i], count: mesh.runIndex[i+1]-mesh.runIndex[i]})),
      vertices: mesh.vertProperties.slice(),
      triangles: mesh.triVerts.slice(),
      bounds: solid.boundingBox(),
      volume: solid.volume(),
    };
  } finally {
    solid?.delete();
  }
}
