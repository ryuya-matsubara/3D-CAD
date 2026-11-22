import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

export function createView(host) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe5eae7);
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  host.prepend(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-60,60,60,-60,0.1,100000);
  camera.up.set(0,0,1);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.minZoom = 0.05;
  controls.maxZoom = 30;
  controls.addEventListener('change',render);
  const grid = new THREE.GridHelper(2000,200,0xaebeb4,0xc9d3cc);
  grid.rotation.x = Math.PI/2;
  scene.add(grid);
  scene.add(new THREE.HemisphereLight(0xfff9e8,0xb7c6b8,2.5));
  const sun = new THREE.DirectionalLight(0xfff1d4,2.5);
  sun.position.set(-60,-90,160);
  scene.add(sun);
  const material = new THREE.MeshStandardMaterial({color:0xe48a4d,roughness:0.64,metalness:0.15,flatShading:true,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const ink = new THREE.LineBasicMaterial({color:0x764c38,transparent:true,opacity:0.58});
  let mesh, edges, bounds, span=105, view='iso';
  function render() { renderer.render(scene,camera); }
  function resize() {
    const w=host.clientWidth,h=host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w,h);
    const ratio=w/h, half=span/2;
    camera.left=-half*Math.max(1,ratio); camera.right=-camera.left;
    camera.top=half*Math.max(1,1/ratio); camera.bottom=-camera.top;
    camera.updateProjectionMatrix(); render();
  }
  function fit(mode=view) {
    view=mode;
    const center=new THREE.Vector3(), size=new THREE.Vector3(60,40,6);
    if (bounds) {
      const box=new THREE.Box3(new THREE.Vector3(...bounds.min),new THREE.Vector3(...bounds.max));
      box.getCenter(center); box.getSize(size);
    }
    span=Math.max(1,size.length()*1.14);
    const direction=mode==='top' ? [0,-0.00001,1] : mode==='front' ? [0,-1,0] : [0.95,-1.45,1.12];
    camera.position.copy(center).addScaledVector(new THREE.Vector3(...direction).normalize(),Math.max(150,span*2));
    controls.target.copy(center);
    camera.zoom=1; resize(); controls.update();
  }
  new ResizeObserver(resize).observe(host);
  return {
    update(data, refit=false) {
      for (const object of [mesh,edges]) if (object) { scene.remove(object); object.geometry.dispose(); }
      mesh=edges=null;
      bounds=data?.bounds;
      if (data) {
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.BufferAttribute(data.vertices,3));
        geometry.setIndex(new THREE.BufferAttribute(data.triangles,1));
        geometry.computeVertexNormals();
        mesh=new THREE.Mesh(geometry,material);
        edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),ink);
        scene.add(mesh,edges);
        grid.position.z=bounds.min[2]-0.15;
      }
      if (refit) fit(); else render();
    },
    fit,
    zoom(factor) { camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,0.05,30); camera.updateProjectionMatrix(); render(); },
    grid(on) { grid.visible=on; render(); }
  };
}
