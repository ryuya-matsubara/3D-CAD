import { contours } from "d3-contour";

// Standard 20 degree involute flanks, with radial clearance below the base circle.
export function gearProfile(f) {
  const pitch = f.module * f.teeth / 2;
  const root = pitch - 1.25 * f.module;
  const tip = pitch + f.module;
  const base = pitch * Math.cos(Math.PI / 9);
  const involute = r => {
    const angle = Math.acos(Math.min(1, base / r));
    return Math.tan(angle) - angle;
  };
  const half = r => Math.PI / (2 * f.teeth) + involute(pitch) - involute(r);
  const points = [];
  for (let i = 0; i < f.teeth; i++) {
    const center = 2 * Math.PI * i / f.teeth;
    const add = (r, offset) => points.push([r*Math.cos(center+offset),r*Math.sin(center+offset)]);
    add(root, -half(root));
    for (let step=0; step<=6; step++) {
      const r = Math.max(root,base) + (tip-Math.max(root,base))*step/6;
      add(r, -half(r));
    }
    add(tip, 0);
    for (let step=6; step>=0; step--) {
      const r = Math.max(root,base) + (tip-Math.max(root,base))*step/6;
      add(r, half(r));
    }
    add(root, half(root));
    add(root, Math.PI/f.teeth);
  }
  const rings = [points];
  if (f.bore > 0) rings.push(Array.from({length:96}, (_,i) => {
    const a = -2*Math.PI*i/96;
    return [f.bore*Math.cos(a)/2,f.bore*Math.sin(a)/2];
  }));
  return rings;
}

export const textFont = '96px "Noto Sans JP"';
export function textProfile(f) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", {willReadFrequently:true});
  ctx.font = textFont;
  const metrics = ctx.measureText(f.text);
  const width = Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight);
  const height = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
  if (!width || !height) throw Error("立体化できる文字を入力してください。");
  canvas.width = width + 4;
  canvas.height = height + 4;
  ctx.font = textFont;
  ctx.fillText(f.text, 2+metrics.actualBoundingBoxLeft, 2+metrics.actualBoundingBoxAscent);
  const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const alpha = new Uint8Array(pixels.length/4);
  for(let i=0;i<alpha.length;i++) alpha[i]=pixels[4*i+3];
  const outline = contours().size([canvas.width,canvas.height]).contour(alpha,128);
  const scale = f.size / height;
  return outline.coordinates.flat().map(ring => ring.slice(0,-1).map(([x,y]) =>
    [(x-canvas.width/2)*scale,(canvas.height/2-y)*scale]));
}
