export const types = { box: 'プレート', cylinder: '円柱', hole: '貫通穴' };
export const labels = { width: '幅', depth: '奥行き', height: '高さ', radius: '角丸半径', diameter: '直径', x: '中心 X', y: '中心 Y', z: '底面 Z' };
export const dimensions = {
  box: ['width', 'depth', 'height', 'radius', 'x', 'y', 'z'],
  cylinder: ['diameter', 'height', 'x', 'y', 'z'],
  hole: ['diameter', 'x', 'y']
};

export function feature(type, name = types[type]) {
  const base = { id: crypto.randomUUID(), type, name, x: 0, y: 0 };
  if (type === 'box') return { ...base, z: 0, width: 60, depth: 40, height: 5, radius: 3 };
  if (type === 'cylinder') return { ...base, z: 0, diameter: 24, height: 14 };
  return { ...base, diameter: 8 };
}

export function sample() {
  const plate = { ...feature('box', 'ベースプレート'), width: 80, depth: 56, height: 6, radius: 6 };
  const boss = { ...feature('cylinder', '中央ボス'), diameter: 32, height: 12, z: 6 };
  const bore = { ...feature('hole', '中心穴'), diameter: 18 };
  const holes = [[-31,-19],[31,-19],[31,19],[-31,19]].map(([x,y], i) => ({ ...feature('hole', '取付穴 ' + (i+1)), diameter: 7, x, y }));
  return { version: 1, title: 'フランジプレート', features: [plate, boss, bore, ...holes] };
}

export function validate(model) {
  if (model?.version !== 1 || !model.title?.trim?.() || model.title.length > 80 || !Array.isArray(model.features) || model.features.length > 100) throw Error('モデル名または形状数が範囲外です。');
  const ids = new Set();
  for (const f of model.features) {
    if (!Object.hasOwn(types, f.type) || typeof f.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(f.id) || ids.has(f.id) || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 64) throw Error('形状の名前または識別子が無効です。');
    ids.add(f.id);
    for (const key of dimensions[f.type]) {
      const n = f[key];
      if (!Number.isFinite(n) || Math.abs(n) > 5000 || (!['x','y','z','radius'].includes(key) && n < 0.01)) throw Error(labels[key] + 'の値を確認してください（寸法は0.01〜5000 mm）。');
    }
    if (f.type === 'box' && (f.radius < 0 || 2*f.radius >= Math.min(f.width,f.depth))) throw Error('角丸半径は短辺の半分未満で指定してください。');
  }
  return model;
}
