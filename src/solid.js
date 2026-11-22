import { validate } from './model.js';

// Positions are in mm. Z is up and each feature is applied in tree order.
export function buildSolid(kernel, model) {
  validate(model);
  const {Manifold, CrossSection} = kernel;
  let solid;
  try {
    for (const f of model.features) {
      const owned = [];
      const keep = obj => { owned.push(obj); return obj; };
      try {
        let piece, bottom = f.z;
        if (f.type === 'box') {
          const inner = keep(CrossSection.square([f.width - 2*f.radius, f.depth - 2*f.radius], true));
          const outline = f.radius ? keep(inner.offset(f.radius, 'Round', 2, 96)) : inner;
          piece = keep(outline.extrude(f.height));
        } else {
          let height = f.height;
          if (f.type === 'hole') {
            if (!solid || solid.isEmpty()) continue;
            const bounds = solid.boundingBox();
            bottom = bounds.min[2] - 1;
            height = bounds.max[2] - bottom + 1;
          }
          piece = keep(Manifold.cylinder(height, f.diameter / 2, f.diameter / 2, 96));
        }
        const placed = keep(piece.translate([f.x, f.y, bottom]));
        const next = solid ? (f.type === 'hole' ? solid.subtract(placed) : solid.add(placed)) : placed;
        if (next === placed) owned.pop();
        solid?.delete();
        solid = next;
      } finally { owned.forEach(obj => obj.delete()); }
    }
    if (!solid || solid.isEmpty()) return null;
    if (solid.status() !== 'NoError') throw Error('立体を計算できませんでした。寸法を確認してください。');
    const mesh = solid.getMesh();
    return { vertices: mesh.vertProperties.slice(), triangles: mesh.triVerts.slice(), bounds: solid.boundingBox(), volume: solid.volume() };
  } finally { solid?.delete(); }
}
