import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createView(host, onPick, onMove) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe5eae7);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.prepend(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-60, 60, 60, -60, 0.1, 100000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.minZoom = 0.05;
  controls.maxZoom = 30;
  controls.addEventListener("change", render);
  const grid = new THREE.GridHelper(2000, 200, 0xaebeb4, 0xc9d3cc);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  scene.add(new THREE.HemisphereLight(0xfff9e8, 0xb7c6b8, 2.5));
  const sun = new THREE.DirectionalLight(0xfff1d4, 2.5);
  sun.position.set(-60, -90, 160);
  scene.add(sun);
  const material = new THREE.MeshStandardMaterial({
    color: 0xe48a4d,
    roughness: 0.64,
    metalness: 0.15,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const ink = new THREE.LineBasicMaterial({
    color: 0x764c38,
    transparent: true,
    opacity: 0.58,
  });
  let mesh,
    edges,
    bounds,
    span = 105,
    view = "iso";
  const axisCanvas = host.querySelector("#axis");
  const ctx = axisCanvas.getContext("2d");
  let runs = [], selection, measure = false;
  const highlight = material.clone();
  highlight.color.set(0x37aab0);
  const overlay = host.querySelector("#dimension-lines");
  const pen = overlay.getContext("2d");
  let textBounds;
  const ray = new THREE.Raycaster();
  const pointers = new Set();
  let tap, moveAxis, drag;
  const surface = renderer.domElement;
  function setRay(e) {
    const r = surface.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(
      2*(e.clientX-r.left)/r.width-1, 1-2*(e.clientY-r.top)/r.height,
    ), camera);
  }
  function dragPoint(e, current) {
    if (current.plane) {
      setRay(e);
      return ray.ray.intersectPlane(current.plane, new THREE.Vector3());
    }
    const dx = (e.clientX - current.x) * current.unitsPerPixel;
    const dy = (current.y - e.clientY) * current.unitsPerPixel;
    if (moveAxis === "z") return new THREE.Vector3(0, 0, dy / current.verticalScale);
    return new THREE.Vector3(dx, dy, 0).applyAxisAngle(
      new THREE.Vector3(0, 0, 1), current.horizontalAngle,
    );
  }
  surface.addEventListener("pointerdown", e => {
    if (moveAxis) {
      if (drag || e.button !== 0 || !selection) return;
      const direction = camera.getWorldDirection(new THREE.Vector3());
      const plane = moveAxis === "xy" && Math.abs(direction.z) > 0.15
        ? new THREE.Plane(new THREE.Vector3(0,0,1), -(selection.z ?? 0))
        : null;
      drag = {
        id: e.pointerId, x: e.clientX, y: e.clientY, plane,
        position: new THREE.Vector3(selection.x, selection.y, selection.z ?? 0),
        unitsPerPixel: (camera.top-camera.bottom) / (camera.zoom*surface.clientHeight),
        verticalScale: Math.max(0.25, Math.hypot(direction.x, direction.y)),
        horizontalAngle: Math.atan2(direction.y, direction.x) - Math.PI / 2,
      };
      drag.start = dragPoint(e, drag);
      surface.setPointerCapture(e.pointerId);
      return;
    }
    pointers.add(e.pointerId);
    tap = pointers.size === 1 && e.button === 0 ? [e.clientX,e.clientY] : null;
  });
  surface.addEventListener("pointermove", e => {
    if (drag?.id === e.pointerId) {
      const point = dragPoint(e, drag);
      if (point && drag.start) {
        point.sub(drag.start);
        onMove(point.toArray().map((delta, axis) => drag.position.getComponent(axis) + Math.round(delta*10)/10));
      }
      return;
    }
    if (tap && Math.hypot(e.clientX-tap[0],e.clientY-tap[1]) > 5) tap = null;
  });
  function endPointer(e) {
    if (drag?.id === e.pointerId) drag = undefined;
    pointers.delete(e.pointerId);
    tap = null;
  }
  surface.addEventListener("pointercancel", endPointer);
  surface.addEventListener("lostpointercapture", endPointer);
  surface.addEventListener("pointerup", e => {
    if (moveAxis) return endPointer(e);
    pointers.delete(e.pointerId);
    if (!tap || !mesh) return;
    tap=null;
    setRay(e);
    const hit=ray.intersectObject(mesh,false)[0];
    const index=hit?.faceIndex*3;
    onPick(runs.find(run=>index>=run.start && index<run.start+run.count)?.id);
  });
  function drawDimensions() {
    const w=host.clientWidth,h=host.clientHeight,ratio=renderer.getPixelRatio();
    pen.setTransform(ratio,0,0,ratio,0,0);
    pen.clearRect(0,0,w,h);
    if (!selection || !measure) return;
    const f=selection;
    const project = coords => {
      const p=new THREE.Vector3(...coords).project(camera);
      return [(1+p.x)*w/2,(1-p.y)*h/2];
    };
    function line(a,b) {
      pen.beginPath();pen.moveTo(...a);pen.lineTo(...b);pen.stroke();
    }
    function dimension(from,to,label,offset) {
      const a=project(from),b=project(to);
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      if(len<1) return;
      const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
      const ends=[a,b].map(p=>[p[0]+offset*nx,p[1]+offset*ny]);
      pen.strokeStyle="#18435c";pen.lineWidth=1.4;
      line(a,ends[0]);line(b,ends[1]);line(...ends);
      for(const [i,end] of ends.entries()) {
        const sign=i===0?1:-1;
        for(const side of [-1,1]) line(end,[end[0]+sign*ux*5+nx*side*2,end[1]+sign*uy*5+ny*side*2]);
      }
      pen.save();pen.translate((ends[0][0]+ends[1][0])/2,(ends[0][1]+ends[1][1])/2);
      let angle=Math.atan2(dy,dx);if(Math.abs(angle)>Math.PI/2) angle+=Math.PI;
      pen.rotate(angle);pen.textAlign="center";pen.font="bold 12px sans-serif";
      pen.strokeStyle="white";pen.lineWidth=3;pen.strokeText(label,0,-4);
      pen.fillStyle="#153448";pen.fillText(label,0,-4);pen.restore();
    }
    const {x,y}=f, z=f.type==="hole" || (f.mode==="cut" && f.through) ? holeTop : f.z+f.height;
    if(f.type==="box") {
      const l=x-f.width/2,r=x+f.width/2,b=y-f.depth/2,t=y+f.depth/2;
      dimension([l,b+f.radius,z],[r,b+f.radius,z],f.width,24);
      dimension([r-f.radius,b,z],[r-f.radius,t,z],f.depth,20);
      dimension([r,y,f.z],[r,y,z],f.height,20);
      if(f.radius) {
        const cx=l+f.radius,cy=t-f.radius,d=f.radius/Math.sqrt(2);
        dimension([cx,cy,z],[cx-d,cy+d,z],f.radius,-10);
      }
    } else if (f.type==="text") {
      const box=textBounds?.get(f.id);
      if (!box) return;
      const [l,b]=box.min,[r,t]=box.max;
      const angle = THREE.MathUtils.degToRad(f.rotation ?? 0);
      const point = (u,v,h=z) => [x+u*Math.cos(angle)-v*Math.sin(angle), y+u*Math.sin(angle)+v*Math.cos(angle), h];
      dimension(point(l,b),point(r,b),Number((r-l).toFixed(2)),18);
      dimension(point(r,b),point(r,t),Number((t-b).toFixed(2)),16);
      if(!f.through) dimension(point(r,0,f.z),point(r,0),f.height,18);
    } else {
      const diameter=f.type==="gear" ? f.module*(f.teeth+2) : f.diameter;
      const r=diameter/2;
      dimension([x-r,y,z],[x+r,y,z],diameter,-10);
      if(f.type!=="hole" && !f.through) dimension([x+r,y,f.z],[x+r,y,z],f.height,18);
    }
  }
  let holeTop=0;
  function render() {
    ctx.clearRect(0,0,160,160);
    const inverse = camera.quaternion.clone().invert();
    for (const [index,color] of ["#a02824","#227140","#275aab"].entries()) {
      const vector = new THREE.Vector3().setComponent(index,1).applyQuaternion(inverse);
      const x = 80 + 45*vector.x, y = 80 - 45*vector.y;
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(80,80); ctx.lineTo(x,y); ctx.stroke();
      ctx.font = "bold 24px sans-serif"; ctx.fillText("XYZ"[index],x+2,y-2);
    }
    renderer.render(scene, camera);
    drawDimensions();
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    overlay.width=Math.round(w*renderer.getPixelRatio()); overlay.height=Math.round(h*renderer.getPixelRatio());
    const ratio = w / h,
      half = span / 2;
    camera.left = -half * Math.max(1, ratio);
    camera.right = -camera.left;
    camera.top = half * Math.max(1, 1 / ratio);
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    render();
  }
  function fit(mode = view) {
    view = mode;
    const center = new THREE.Vector3(),
      size = new THREE.Vector3(60, 40, 6);
    if (bounds) {
      const box = new THREE.Box3(
        new THREE.Vector3(...bounds.min),
        new THREE.Vector3(...bounds.max),
      );
      box.getCenter(center);
      box.getSize(size);
    }
    span = Math.max(1, size.length() * 1.14);
    const direction =
      mode === "top"
        ? [0, -0.00001, 1]
        : mode === "front"
          ? [0, -1, 0]
          : [0.95, -1.45, 1.12];
    camera.position
      .copy(center)
      .addScaledVector(
        new THREE.Vector3(...direction).normalize(),
        Math.max(150, span * 2),
      );
    controls.target.copy(center);
    camera.zoom = 1;
    resize();
    controls.update();
  }
  new ResizeObserver(resize).observe(host);
  return {
    update(data, refit = false) {
      for (const object of [mesh, edges])
        if (object) {
          scene.remove(object);
          object.geometry.dispose();
        }
      mesh = edges = null;
      bounds = data?.bounds;
      textBounds = data?.textBounds;
      if (data) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(data.vertices, 3),
        );
        geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1));
        geometry.computeVertexNormals();
        runs=data.runs;
        for(const run of runs) geometry.addGroup(run.start,run.count,0);
        mesh = new THREE.Mesh(geometry, [material,highlight]);
        edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 25),
          ink,
        );
        scene.add(mesh, edges);
        grid.position.z = bounds.min[2] - 0.15;
      }
      if (refit) fit();
      else render();
    },
    fit,
    move(axis) {
      if (drag && surface.hasPointerCapture(drag.id)) surface.releasePointerCapture(drag.id);
      drag = undefined;
      tap = null;
      moveAxis = axis;
      controls.enabled = !axis;
      host.dataset.moving = String(!!axis);
    },
    zoom(factor) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.05, 30);
      camera.updateProjectionMatrix();
      render();
    },
    select(feature, visible) {
      selection=feature;
      measure=visible;
      if(mesh) {
        holeTop=bounds.max[2];
        let top=-Infinity;
        mesh.geometry.groups.forEach((group,i)=>{
          const active=!!feature && runs[i].id===feature.id;
          group.materialIndex=active ? 1 : 0;
          if(active && (feature.type==="hole" || feature.through)) {
            const geo=mesh.geometry;
            for(let n=group.start;n<group.start+group.count;n++)
              top=Math.max(top,geo.attributes.position.getZ(geo.index.getX(n)));
          }
        });
        if(Number.isFinite(top)) holeTop=top;
      }
      render();
    },
  };
}
