"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const WIDTH=1672, HEIGHT=941, UNIT=.01;
const PIVOT=new THREE.Vector3(1.04,-.705,0);
function bezierPath(start:number[],curves:number[][]){
 const path=new THREE.CurvePath<THREE.Vector2>();let point=new THREE.Vector2(start[0],start[1]);
 for(const c of curves){const next=new THREE.Vector2(c[4],c[5]);path.add(new THREE.CubicBezierCurve(point,new THREE.Vector2(c[0],c[1]),new THREE.Vector2(c[2],c[3]),next));point=next;}return path;
}
function sculptedBridge(detail:number){
 const outer=bezierPath([243,604],[[450,591,606,459,795,401],[919,357,1031,366,1135,402],[1310,460,1481,577,1631,612]]);
 const inner=bezierPath([243,617],[[373,624,469,577,583,658],[647,488,807,435,944,444],[1082,446,1179,518,1237,658],[1321,585,1480,612,1631,621]]);
 const ring=36,vertices:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(let i=0;i<=detail;i++){
  const t=i/detail,a=outer.getPoint(t),b=inner.getPoint(t);
  for(let j=0;j<=ring;j++){
   const theta=j/ring*Math.PI*2,mix=.5+.5*Math.cos(theta);
   const x=THREE.MathUtils.lerp(b.x,a.x,mix),y=THREE.MathUtils.lerp(b.y,a.y,mix);
   const depth=.42*Math.sin(theta)*(.2+.8*Math.sin(Math.PI*t));
   vertices.push((x-WIDTH/2)*UNIT-PIVOT.x,(HEIGHT/2-y)*UNIT-PIVOT.y,depth);
   uvs.push(x/WIDTH,1-y/HEIGHT);
   if(i<detail&&j<ring){const k=i*(ring+1)+j;indices.push(k,k+1,k+ring+1,k+1,k+ring+2,k+ring+1);}
  }
 }
 for(let j=1;j<ring-1;j++){indices.push(0,j+1,j);const k=detail*(ring+1);indices.push(k,k+j,k+j+1);}
 const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function bridgeMaterial(texture:THREE.Texture){return new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false});}
function labelPatch(texture:THREE.Texture,x:number,y:number,w:number,h:number){
 const geometry=new THREE.PlaneGeometry(w*UNIT,h*UNIT);const uv=geometry.getAttribute("uv");
 for(let i=0;i<uv.count;i++)uv.setXY(i,(x+uv.getX(i)*w)/WIDTH,1-(y+(1-uv.getY(i))*h)/HEIGHT);
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{uMap:{value:texture}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`uniform sampler2D uMap;varying vec2 vUv;void main(){vec3 c=texture2D(uMap,vUv).rgb;float a=smoothstep(.24,.68,min(c.r,c.g));gl_FragColor=vec4(c,a);#include <colorspace_fragment>}`.replace(';#include',';\n#include')});
 const mesh=new THREE.Mesh(geometry,material);mesh.position.set((x+w/2-WIDTH/2)*UNIT-PIVOT.x,(HEIGHT/2-y-h/2)*UNIT-PIVOT.y,1);return mesh;
}
function backgroundMaterial(reference:THREE.Texture,clean:THREE.Texture){
 return new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{uRef:{value:reference},uClean:{value:clean},uMobile:{value:0},uTime:{value:0},uRipples:{value:Array.from({length:12},()=>new THREE.Vector4(0,0,-100,0))}},
 vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
 fragmentShader:`uniform sampler2D uRef;uniform sampler2D uClean;uniform float uMobile;uniform float uTime;uniform vec4 uRipples[12];varying vec2 vUv;
 float box(vec2 p,vec4 b,float feather){vec2 d=min(p-b.xy,b.zw-p);return smoothstep(-feather,feather,min(d.x,d.y));}
 vec3 toSRGB(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
 vec3 toLinear(vec3 c){return mix(c/12.92,pow(max((c+.055)/1.055,vec3(0.0)),vec3(2.4)),step(vec3(.04045),c));}
 void main(){
  vec2 p=vec2(vUv.x*1672.0,(1.0-vUv.y)*941.0);
  vec2 displacement=vec2(0.0);float shimmer=0.0;
  for(int i=0;i<12;i++){
   vec4 ripple=uRipples[i];float age=uTime-ripple.z;
   if(ripple.w>0.0&&age>=0.0&&age<5.0){
    vec2 delta=vec2(p.x-ripple.x,(p.y-ripple.y)*2.2);
    float distance=length(delta),radius=age*88.0;
    float envelope=exp(-pow((distance-radius)/24.0,2.0))*exp(-age*.82);
    float wave=sin((distance-radius)*.18)*envelope*ripple.w;
    displacement+=normalize(delta+vec2(.001))*wave*3.8;shimmer+=wave*.016;
   }
  }
  float waterMask=smoothstep(676.0,690.0,p.y);
  waterMask*=smoothstep(.95,1.15,length((p-vec2(530.0,704.0))/vec2(34.0,44.0)));
  waterMask*=smoothstep(.95,1.15,length((p-vec2(1149.0,710.0))/vec2(55.0,84.0)));
  waterMask*=smoothstep(.95,1.15,length((p-vec2(1454.0,710.0))/vec2(29.0,43.0)));
  vec2 sampleUV=vUv+clamp(displacement,vec2(-7.0),vec2(7.0))/vec2(1672.0,-941.0)*waterMask;
  // All source UI, including CTA glow, stays fully inside the clean regions.
  float m=box(p,vec4(-100.0,-100.0,1772.0,116.0),14.0);
  m=max(m,box(p,vec4(62.0,120.0,830.0,533.0),18.0));
  m=max(m,box(p,vec4(1427.0,139.0,1627.0,414.0),18.0));
  m=max(m,box(p,vec4(228.0,350.0,1648.0,673.0),10.0));
  m=max(m,box(p,vec4(953.0,325.0,1086.0,387.0),10.0));
  m=max(m,box(p,vec4(-100.0,814.0,1772.0,1100.0),18.0));
  float ellipse=clamp((p.x-910.0)/324.0,-1.0,1.0);
  float innerTop=657.0-208.0*sqrt(1.0-ellipse*ellipse);
  float hole=box(p,vec4(605.0,441.0,1217.0,653.0),6.0)*smoothstep(innerTop+12.0,innerTop+20.0,p.y);
  m*=1.0-hole*(1.0-uMobile);
  vec3 source=texture2D(uRef,sampleUV).rgb,clean=texture2D(uClean,sampleUV).rgb;
  vec3 corrected=toSRGB(clean);
  corrected+=vec3(mix(.025,-.035,smoothstep(0.0,.4,corrected.r)),mix(-.015,.035,smoothstep(.1,.85,corrected.r)),mix(-.083,.085,smoothstep(.15,.9,corrected.r)))*.95;
  clean=toLinear(clamp(corrected,0.0,1.0));
  gl_FragColor=vec4(max(vec3(0.0),mix(source,clean,m)+clamp(shimmer,-.02,.02)*waterMask),1.0);
  #include <colorspace_fragment>
 }`});
}

export default function BridgeScene(){
 const mount=useRef<HTMLDivElement>(null),control=useRef({paused:false});const[status,setStatus]=useState("loading");
 useEffect(()=>{
  const host=mount.current;if(!host)return;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"low-power"});}catch{const failureTimer=window.setTimeout(()=>setStatus("error"),0);return()=>window.clearTimeout(failureTimer);}
  const canvas=renderer.domElement;host.appendChild(canvas);canvas.tabIndex=0;canvas.setAttribute("role","img");canvas.setAttribute("aria-label","实时三维桥与交互水面：移动鼠标或轻触水面产生涟漪，空格键泛起涟漪，Home 键使水面平静");
  renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-8.36,8.36,4.705,-4.705,.1,100);camera.position.z=20;camera.lookAt(0,0,0);
  let mobile=window.innerWidth<=760,disposed=false,ready=0,contextLost=false,dirty=true,inView=true,frame=0,previous=0,time=0;
  const loaded=()=>{if(disposed)return;ready++;dirty=true;if(ready===2)setStatus("ready");};
  const failed=()=>{if(!disposed)setStatus("error");};
  const loader=new THREE.TextureLoader();
  const reference=loader.load("/assets/hangzhou-upgrade-reference.png",loaded,undefined,failed),clean=loader.load("/assets/hangzhou-upgrade-background.png",loaded,undefined,failed);
  reference.colorSpace=clean.colorSpace=THREE.SRGBColorSpace;reference.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const geometry=sculptedBridge(mobile?96:224),material=bridgeMaterial(reference);
  const sculpture=new THREE.Group();sculpture.position.copy(PIVOT);sculpture.add(new THREE.Mesh(geometry,material));scene.add(sculpture);
  const labels=[[548,428,111,66],[737,355,102,54],[968,334,106,42],[1170,378,115,59]].map(r=>labelPatch(reference,...r as [number,number,number,number]));labels.forEach(l=>sculpture.add(l));
  const bgGeometry=new THREE.PlaneGeometry(WIDTH*UNIT,HEIGHT*UNIT),bgMaterial=backgroundMaterial(reference,clean),bg=new THREE.Mesh(bgGeometry,bgMaterial);bg.position.z=-8;bg.renderOrder=-100;scene.add(bg);
  let waterPointer:THREE.Vector2|null=null,lastSpawn=-100,rippleIndex=0,rippleCount=0;
  const ripplePositions=bgMaterial.uniforms.uRipples.value as THREE.Vector4[];
  const spawnRipple=(point:THREE.Vector2,strength=1)=>{if(control.current.paused)return;ripplePositions[rippleIndex].set(point.x,point.y,time,strength);rippleIndex=(rippleIndex+1)%12;lastSpawn=time;rippleCount++;dirty=true;canvas.dataset.ripples=String(rippleCount);};
  const pointOnWater=(e:PointerEvent)=>{const rect=canvas.getBoundingClientRect();const x=WIDTH/2+((e.clientX-rect.left)/rect.width-.5)*(camera.right-camera.left)/UNIT,y=HEIGHT/2+((e.clientY-rect.top)/rect.height-.5)*(camera.top-camera.bottom)/UNIT;return y>=684&&y<900?new THREE.Vector2(x,y):null;};
  let lastPaused=control.current.paused;
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");const motionChange=()=>{if(reduced.matches)control.current.paused=true;dirty=true;};motionChange();reduced.addEventListener("change",motionChange);
  const resize=()=>{
   const w=host.clientWidth,h=host.clientHeight,aspect=w/h;mobile=window.innerWidth<=760;
   renderer.setPixelRatio(Math.min(window.devicePixelRatio,mobile?1.25:1.75));renderer.setSize(w,h);
   const worldW=aspect>=WIDTH/HEIGHT?WIDTH*UNIT:HEIGHT*UNIT*aspect,worldH=aspect>=WIDTH/HEIGHT?WIDTH*UNIT/aspect:HEIGHT*UNIT;
   camera.left=-worldW/2;camera.right=worldW/2;camera.top=worldH/2;camera.bottom=-worldH/2;camera.updateProjectionMatrix();
   if(mobile){sculpture.scale.setScalar(Math.min(.43,worldW/14.8));sculpture.position.set(-.24,-1.895+1.19*sculpture.scale.x,0);}else{sculpture.scale.setScalar(1);sculpture.position.copy(PIVOT);}
   bgMaterial.uniforms.uMobile.value=mobile?1:0;labels.forEach(l=>l.visible=!mobile);canvas.dataset.quality=mobile?"mobile-30fps-dpr1.25":"desktop-60fps-dpr1.75";dirty=true;
  };
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  const visibility=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;dirty=true;},{threshold:.01});visibility.observe(host);
  const visibleChange=()=>{dirty=true;previous=performance.now();};document.addEventListener("visibilitychange",visibleChange);
  const down=(e:PointerEvent)=>{if(e.pointerType==="mouse"){e.preventDefault();canvas.focus({preventScroll:true});}const p=pointOnWater(e);if(p)spawnRipple(p,1.25);};
  const move=(e:PointerEvent)=>{waterPointer=pointOnWater(e);canvas.style.cursor=waterPointer?"crosshair":"default";if(waterPointer&&time-lastSpawn>.13)spawnRipple(waterPointer,.8);};
  const leave=()=>{waterPointer=null;};const up=(e:PointerEvent)=>{if(e.pointerType!=="mouse")waterPointer=null;};
  const clear=()=>{ripplePositions.forEach(r=>r.set(0,0,-100,0));waterPointer=null;dirty=true;};
  const keydown=(e:KeyboardEvent)=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();spawnRipple(new THREE.Vector2(900,755),1.25);}if(e.key==="Home"){e.preventDefault();clear();}};
  const lost=(e:Event)=>{e.preventDefault();contextLost=true;failed();};const restored=()=>{contextLost=false;dirty=true;setStatus("ready");};
  canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerleave",leave);canvas.addEventListener("pointerup",up);canvas.addEventListener("pointercancel",leave);canvas.addEventListener("keydown",keydown);canvas.addEventListener("webglcontextlost",lost);canvas.addEventListener("webglcontextrestored",restored);
  const render=(now:number)=>{
   if(disposed)return;frame=requestAnimationFrame(render);if(ready<2||contextLost||!inView||document.hidden){previous=now;return;}
   const delta=now-previous;if(delta<(mobile?1000/30:1000/60)-1)return;previous=now;const c=control.current;
   if(c.paused!==lastPaused){lastPaused=c.paused;dirty=true;}if(c.paused&&!dirty)return;
   if(!c.paused)time+=Math.min(delta,80)*.001;if(!c.paused&&waterPointer&&time-lastSpawn>.72)spawnRipple(waterPointer,.7);
   if(!dirty&&!ripplePositions.some(r=>r.w>0&&time-r.z<5))return;
   bgMaterial.uniforms.uTime.value=time;renderer.render(scene,camera);
   canvas.dataset.engine="three-webgl-textured-geometry";canvas.dataset.bridgeRotation="fixed";canvas.dataset.frames=String(renderer.info.render.frame);canvas.dataset.triangles=String(renderer.info.render.triangles);canvas.dataset.paused=String(c.paused);dirty=false;
  };frame=requestAnimationFrame(render);
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();visibility.disconnect();reduced.removeEventListener("change",motionChange);document.removeEventListener("visibilitychange",visibleChange);canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerleave",leave);canvas.removeEventListener("pointerup",up);canvas.removeEventListener("pointercancel",leave);canvas.removeEventListener("keydown",keydown);canvas.removeEventListener("webglcontextlost",lost);canvas.removeEventListener("webglcontextrestored",restored);geometry.dispose();material.dispose();labels.forEach(l=>{l.geometry.dispose();l.material.dispose();});reference.dispose();clean.dispose();bgGeometry.dispose();bgMaterial.dispose();renderer.dispose();canvas.remove();};
 },[]);
 return <div ref={mount} className="scene-mount" data-scene-state={status}>{status==="loading"&&<div className="scene-message" role="status">正在加载杭州的暮色…</div>}{status==="error"&&<div className="scene-message" role="alert"><strong>当前环境无法显示实时 3D</strong><span>请使用支持 WebGL 的浏览器，开启硬件加速后刷新。下方活动仍可浏览。</span></div>}</div>;
}
