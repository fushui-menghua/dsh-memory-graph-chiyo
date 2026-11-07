/**
 * galaxy.js —— 完整版星图（单文件可交互 HTML）
 *
 * 跟 viz.js 的静态 SVG 不同：这里生成一个**自带交互**的 HTML，
 * 双击就能在浏览器里看——缩放、拖拽、按层/类型过滤、搜索、点节点看详情和锚点。
 *
 * 不依赖任何前端框架/CDN：canvas + 原生 JS，离线可用。
 */
import fs from 'node:fs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderGalaxyHtml(nodes = [], { title = '记忆星图', scope = '' } = {}) {
  const live = nodes.filter((n) => !n.archived);
  const data = live.map((n) => ({
    id: n.id,
    text: String(n.text || '').slice(0, 300),
    kind: n.kind || 'fact',
    layer: n.layer || 'short',
    category: n.category || '',
    importance: Number(n.importance || 0),
    mentions: Number(n.mentionCount || 0),
    recalls: Number(n.recallCount || 0),
    anchors: (n.anchors || []).map((a) => ({ quote: String(a.quote || '').slice(0, 200), source: a.source || '' })),
    relations: (n.relations || []).map((r) => ({ type: r.type, targetId: r.targetId, weight: r.weight ?? 1 })),
    createdAt: n.createdAt || 0,
    superseded: Boolean(n.superseded),
    archived: false,
  }));
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  const safeTitle = esc(title);
  const safeScope = esc(scope);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0b1020; color: #e5e7eb; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }
  #app { display: flex; height: 100%; }
  #side { width: 330px; border-right: 1px solid #1f2937; padding: 14px; overflow-y: auto; background: #0f172a; }
  #side h1 { font-size: 15px; margin: 0 0 4px; }
  #side .meta { color: #94a3b8; font-size: 12px; margin-bottom: 12px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  button { background: #1e293b; color: #e5e7eb; border: 1px solid #334155; border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
  button.on { background: #2563eb; border-color: #2563eb; }
  input[type=search] { width: 100%; background: #0b1220; color: #e5e7eb; border: 1px solid #334155; border-radius: 6px; padding: 6px 8px; margin-bottom: 10px; }
  #detail { font-size: 12px; line-height: 1.6; color: #cbd5e1; }
  #detail .q { color: #93c5fd; }
  #detail h2 { font-size: 13px; margin: 10px 0 4px; color: #f8fafc; }
  canvas { flex: 1; display: block; cursor: grab; }
  #hud { position: fixed; right: 12px; bottom: 12px; font-size: 11px; color: #64748b; }
</style>
</head>
<body>
<div id="app">
  <div id="side">
    <h1>${safeTitle}</h1>
    <div class="meta">${safeScope ? esc(scope) + ' · ' : ''}<span id="count"></span> 个节点</div>
    <input id="q" type="search" placeholder="搜索记忆…">
    <div class="row" id="layerFilter"></div>
    <div class="row" id="kindFilter"></div>
    <div class="row"><button id="reset">重置视图</button><button id="toggleEdges">显示关系边</button></div>
    <div id="detail">点一个节点看详情</div>
  </div>
  <canvas id="cv"></canvas>
</div>
<div id="hud">滚轮缩放 · 拖拽平移 · 单击选中</div>
<script>
const NODES = ${payload};
const LAYERS = ['instant','short','long','cold','permanent'];
const KINDS = ['fact','impression','plan'];
const KIND_COLOR = { fact:'#60a5fa', impression:'#c084fc', plan:'#fbbf24' };
const LAYER_R = { instant:0.28, short:0.46, long:0.64, cold:0.8, permanent:0.94 };
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
let W=0,H=0, view={x:0,y:0,z:1}, selected=null, hover=null;
let activeLayers=new Set(LAYERS), activeKinds=new Set(KINDS), showEdges=true, keyword='';

function resize(){ W=cv.width=cv.clientWidth*devicePixelRatio; H=cv.height=cv.clientHeight*devicePixelRatio; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); draw(); }
addEventListener('resize', resize);

function visible(n){
  if(!activeLayers.has(n.layer)) return false;
  if(!activeKinds.has(n.kind)) return false;
  if(keyword && !n.text.toLowerCase().includes(keyword)) return false;
  return true;
}
// 布局：按层排同心圆，节点按索引均匀分布
function layout(){
  const buckets={}; NODES.filter(visible).forEach(n=>{ (buckets[n.layer]=buckets[n.layer]||[]).push(n); });
  const pos=new Map(); const cx=0, cy=0;
  for(const layer of LAYERS){
    const arr=buckets[layer]||[]; const r=LAYER_R[layer];
    arr.forEach((n,i)=>{ const a=(i/Math.max(1,arr.length))*Math.PI*2 - Math.PI/2; pos.set(n.id,{x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r, n}); });
  }
  return pos;
}
function toScreen(p){ const s=Math.min(W,H)*0.42*view.z; return { x: W/2 + p.x*s + view.x, y: H/2 + p.y*s + view.y }; }
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0b1020'; ctx.fillRect(0,0,W,H);
  const pos=layout();
  // 同心圆参考线
  for(const layer of LAYERS){ if(!activeLayers.has(layer)) continue;
    const r=LAYER_R[layer]*Math.min(W,H)*0.42*view.z;
    ctx.beginPath(); ctx.arc(W/2+view.x,H/2+view.y,r,0,Math.PI*2); ctx.strokeStyle='rgba(148,163,184,0.12)'; ctx.stroke();
  }
  // 边
  if(showEdges){ ctx.strokeStyle='rgba(148,163,184,0.22)';
    for(const n of NODES){ if(!pos.has(n.id)) continue; for(const rel of n.relations||[]){ const b=pos.get(rel.targetId); if(!b) continue; const a=pos.get(n.id);
      const pa=toScreen(a), pb=toScreen(b); ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke(); } } }
  // 节点
  for(const [id,p] of pos){ const s=toScreen(p); const n=p.n; const r=3.5+Math.min(6,n.mentions*0.8);
    ctx.beginPath(); ctx.arc(s.x,s.y,r,0,Math.PI*2);
    ctx.fillStyle = n.superseded ? '#64748b' : (KIND_COLOR[n.kind]||'#94a3b8');
    ctx.fill();
    if(selected===id){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke(); }
    if(view.z>2.2){ ctx.fillStyle='#cbd5e1'; ctx.font='10px system-ui'; ctx.fillText(n.text.slice(0,14), s.x+r+3, s.y+3); }
  }
  document.getElementById('count').textContent=pos.size;
}
function pick(mx,my){ const pos=layout(); let best=null,bd=1e9;
  for(const [id,p] of pos){ const s=toScreen(p); const d=(s.x-mx)**2+(s.y-my)**2; if(d<bd){bd=d;best=id;} }
  return bd < 900 ? best : null;
}
cv.addEventListener('mousedown',e=>{ dragging={x:e.offsetX,y:e.offsetY,vx:view.x,vy:view.y}; cv.style.cursor='grabbing'; });
addEventListener('mousemove',e=>{ if(dragging){ view.x=dragging.vx+(e.clientX-dragging.x); view.y=dragging.vy+(e.clientY-dragging.y); draw(); } });
addEventListener('mouseup',()=>{ dragging=null; cv.style.cursor='grab'; });
cv.addEventListener('click',e=>{ const id=pick(e.offsetX,e.offsetY); selected=id; showDetail(id); draw(); });
cv.addEventListener('wheel',e=>{ e.preventDefault(); const k=e.deltaY<0?1.15:0.87; view.z=Math.max(0.4,Math.min(6,view.z*k)); draw(); },{passive:false});

function showDetail(id){
  const d=document.getElementById('detail');
  if(!id){ d.textContent='点一个节点看详情'; return; }
  const n=NODES.find(x=>x.id===id); if(!n){ d.textContent=''; return; }
  const date=new Date(n.createdAt).toLocaleDateString('zh-CN');
  d.innerHTML = '<h2>'+n.kind+' · '+n.layer+'</h2>'
    + '<div>'+escapeHtml(n.text)+'</div>'
    + '<div style="color:#64748b;margin-top:6px">'+n.id.slice(0,12)+' · 提过 '+n.mentions+' 次 · 召回 '+n.recalls+' 次 · '+date+'</div>'
    + ((n.anchors&&n.anchors.length)? '<h2>锚点</h2>'+n.anchors.map(a=>'<div class="q">「'+escapeHtml(a.quote)+'」</div>').join('') : '')
    + ((n.relations&&n.relations.length)? '<h2>关系</h2>'+n.relations.map(r=>'<div>'+r.type+' → '+r.targetId.slice(0,8)+'</div>').join('') : '');
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// 过滤器
const lf=document.getElementById('layerFilter'), kf=document.getElementById('kindFilter');
for(const l of LAYERS){ const b=document.createElement('button'); b.textContent=l; b.className='on'; b.onclick=()=>{ if(activeLayers.has(l)){activeLayers.delete(l);b.classList.remove('on');} else {activeLayers.add(l);b.classList.add('on');} draw(); }; lf.appendChild(b); }
for(const k of KINDS){ const b=document.createElement('button'); b.textContent=k; b.className='on'; b.onclick=()=>{ if(activeKinds.has(k)){activeKinds.delete(k);b.classList.remove('on');} else {activeKinds.add(k);b.classList.add('on');} draw(); }; kf.appendChild(b); }
document.getElementById('q').oninput=e=>{ keyword=e.target.value.trim().toLowerCase(); draw(); };
document.getElementById('reset').onclick=()=>{ view={x:0,y:0,z:1}; draw(); };
document.getElementById('toggleEdges').onclick=e=>{ showEdges=!showEdges; e.target.classList.toggle('on',showEdges); draw(); };

resize();
</script>
</body>
</html>`;
}

/** 写到磁盘并返回路径（方便 CLI 直接出图） */
export function writeGalaxyHtml(file, nodes, opts) {
  fs.writeFileSync(file, renderGalaxyHtml(nodes, opts), 'utf8');
  return file;
}
