import { zipSync, strToU8 } from 'fflate';

export function binarySTL({vertices, triangles}) {
  const count = triangles.length/3;
  const bytes = new Uint8Array(84 + 50*count);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, count, true);
  let cursor = 84;
  function write(value) { view.setFloat32(cursor, value, true); cursor += 4; }
  for (let i=0; i<triangles.length; i+=3) {
    const [a,b,c] = Array.from(triangles.subarray(i,i+3), index => vertices.subarray(3*index,3*index+3));
    const u = b.map((v,j)=>v-a[j]), v = c.map((n,j)=>n-a[j]);
    const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const length = Math.hypot(...normal) || 1;
    normal.forEach(n=>write(n/length));
    for (const point of [a,b,c]) point.forEach(write);
    cursor += 2;
  }
  return bytes;
}

export function threeMF({vertices,triangles}) {
  const points = [], faces = [];
  for (let i=0;i<vertices.length;i+=3) points.push('<vertex x="'+vertices[i]+'" y="'+vertices[i+1]+'" z="'+vertices[i+2]+'"/>');
  for (let i=0;i<triangles.length;i+=3) faces.push('<triangle v1="'+triangles[i]+'" v2="'+triangles[i+1]+'" v3="'+triangles[i+2]+'"/>');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>'),
    '3D/3dmodel.model': strToU8('<model unit="millimeter" xml:lang="ja-JP" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>'+points.join('')+'</vertices><triangles>'+faces.join('')+'</triangles></mesh></object></resources><build><item objectid="1"/></build></model>')
  });
}
