/* ═════════════════════════════════════════════════════════════════
   graphiques — dessin SVG et infobulles.
   A le droit au document, jamais aux champs du formulaire :
   ces fonctions servent aussi la page d'accueil.
   ═════════════════════════════════════════════════════════════════ */

/* ---------- charts ---------- */
// Choisit le pas qui donne le nombre de graduations le plus proche de la cible,
// en préférant le pas le plus fin à égalité. Un simple arrondi du pas brut
// produisait des échelles deux fois trop larges (un palier à −200 k€ pour un
// creux réel de −28 k€, soit la moitié du graphe perdue).
function niceTicks(min, max, count){
  if(!(max > min)){ min -= 1; max += 1; }
  const mag = Math.pow(10, Math.floor(Math.log10((max-min)/count)));
  let best = null;
  [1, 2, 2.5, 5, 10].forEach(m => {
    const step = m*mag;
    const lo = Math.floor(min/step)*step, hi = Math.ceil(max/step)*step;
    const n = Math.round((hi-lo)/step) + 1;
    if(n < 3 || n > 9) return;
    const score = Math.abs(n - (count+1));
    if(best === null || score < best.score) best = {step, lo, hi, score};
  });
  if(best === null){
    const step = mag;
    best = {step, lo:Math.floor(min/step)*step, hi:Math.ceil(max/step)*step};
  }
  const out = [];
  for(let v = best.lo; v <= best.hi + best.step*1e-6; v += best.step){
    out.push(Math.abs(v) < best.step*1e-9 ? 0 : v);
  }
  return out;
}
let CLIP_N = 0;
const svgEl = (n,a) => { const e=document.createElementNS("http://www.w3.org/2000/svg",n); for(const k in a) e.setAttribute(k,a[k]); return e; };
// Les couleurs sont lues au runtime pour suivre le thème, mais elles ne bougent
// pas pendant un rendu : sept graphiques les redemandaient une soixantaine de
// fois au navigateur. On les retient le temps d'un cycle, et `oublierTheme()`
// vide le cache — la bascule de thème provoque de toute façon un nouveau rendu.
const _teintes = new Map();
const css = n => {
  if(!_teintes.has(n)) _teintes.set(n, getComputedStyle(document.body).getPropertyValue(n).trim());
  return _teintes.get(n);
};
function oublierTheme(){ _teintes.clear(); }
// Une barre verte se lit à 2,9:1 en thème clair : suffisant pour un tracé,
// pas pour le chiffre posé à côté. --up-ink / --down-ink sont les mêmes teintes
// assombries au seuil AA ; tout ce qui est texte y passe.
const encre = n => n === "--up" ? "--up-ink" : n === "--down" ? "--down-ink" : n;

function roundedBar(x, y0, y1, w, r){
  const up = y1 <= y0;
  const h = Math.abs(y1-y0);
  const rr = Math.min(r, w/2, h);
  if(h < 0.5) return `M${x},${y0}h${w}`;
  return up
    ? `M${x},${y0} L${x},${y1+rr} Q${x},${y1} ${x+rr},${y1} L${x+w-rr},${y1} Q${x+w},${y1} ${x+w},${y1+rr} L${x+w},${y0} Z`
    : `M${x},${y0} L${x},${y1-rr} Q${x},${y1} ${x+rr},${y1} L${x+w-rr},${y1} Q${x+w},${y1} ${x+w},${y1-rr} L${x+w},${y0} Z`;
}

// Un SVG n'expose que son aria-label : sans équivalent textuel, un lecteur
// d'écran annonce le titre du graphique et pas une seule de ses valeurs.
// Le tableau est posé dans le même conteneur, invisible à l'écran.
function resumeTexte(host, titre, entetes, lignes){
  host.querySelectorAll(".visually-hidden").forEach(el => el.remove());
  if(!lignes.length) return;
  // Le tableau vit dans un <div>, jamais posé directement : `height:1px` n'est
  // qu'un *minimum* sur un élément de type table, qui se dimensionne toujours à
  // son contenu. Nu, il mesurait 423 px et donnait à la cascade — seul graphique
  // logé dans un conteneur défilant — un ascenseur vertical invisible.
  const boite = document.createElement("div");
  boite.className = "visually-hidden";
  boite.innerHTML = `<table><caption>${esc(titre)}</caption><thead><tr>`
    + entetes.map(h => `<th scope="col">${esc(h)}</th>`).join("")
    + `</tr></thead><tbody>`
    + lignes.map(l => `<tr><th scope="row">${esc(l[0])}</th>`
        + l.slice(1).map(c => `<td>${esc(c)}</td>`).join("") + `</tr>`).join("")
    + `</tbody></table>`;
  host.appendChild(boite);
}

// Même placement pour les trois graphiques : centrée sur le point, jamais
// débordante du cadre.
function placerInfobulle(tip, host, cx, top){
  const tw = tip.offsetWidth, hw = host.clientWidth;
  tip.style.left = Math.max(4, Math.min(hw-tw-4, cx - tw/2)) + "px";
  tip.style.top = (top === undefined ? 6 : top) + "px";
}

function drawChart(host, tip, cfg){
  const W = Math.max(320, host.clientWidth);
  const H = cfg.height || 260;
  const M = {t:14, r:cfg.padRight||14, b:28, l:cfg.padLeft||62};
  host.querySelectorAll("svg").forEach(n=>n.remove());
  const svg = svgEl("svg",{viewBox:`0 0 ${W} ${H}`, height:H, role:"img",
    tabindex:"0", "aria-label":cfg.label||""});

  const all = cfg.series.flatMap(s => s.values.filter(v => v!==null && isFinite(v)));
  if(!all.length){ host.appendChild(svg); return; }
  let lo = Math.min(...all), hi = Math.max(...all);
  if(cfg.zero){ lo = Math.min(lo,0); hi = Math.max(hi,0); }
  if(cfg.floor !== undefined) lo = Math.max(lo, cfg.floor);
  const ticks = niceTicks(lo, hi, 4);
  const yMin = ticks[0], yMax = ticks[ticks.length-1];
  const n = cfg.x.length;
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const Y = v => M.t + ih*(1 - (v-yMin)/(yMax-yMin || 1));
  const X = i => cfg.band
    ? M.l + iw*(i+0.5)/n
    : M.l + (n>1 ? iw*i/(n-1) : iw/2);

  const gridC = css("--border"), ink3 = css("--text-muted"), lineC = css("--text-muted");

  const scaleRef = Math.max(Math.abs(yMin), Math.abs(yMax));
  ticks.forEach(t => {
    svg.appendChild(svgEl("line",{x1:M.l,x2:W-M.r,y1:Y(t),y2:Y(t),stroke:Math.abs(t)<1e-9?lineC:gridC,"stroke-width":Math.abs(t)<1e-9?1.2:1}));
    const lb = svgEl("text",{x:M.l-9,y:Y(t)+4,"text-anchor":"end",fill:ink3,"font-size":"11"});
    lb.textContent = cfg.fmtAxis(t, scaleRef);
    svg.appendChild(lb);
  });

  const every = n>26 ? 5 : n>14 ? 2 : 1;
  cfg.x.forEach((lab,i) => {
    if(i % every !== 0 && i !== n-1) return;
    const tx = svgEl("text",{x:X(i), y:H-8, "text-anchor":"middle", fill:ink3, "font-size":"11"});
    tx.textContent = lab;
    svg.appendChild(tx);
  });

  const clipId = "clip"+(++CLIP_N);
  const defs = svgEl("defs",{});
  const cp = svgEl("clipPath",{id:clipId});
  cp.appendChild(svgEl("rect",{x:M.l-2, y:M.t-8, width:iw+4, height:ih+10}));
  defs.appendChild(cp); svg.appendChild(defs);
  const plot = svgEl("g",{"clip-path":`url(#${clipId})`});
  svg.appendChild(plot);

  if(cfg.band){
    const slot = iw/n, bw = Math.max(2, slot-4);
    cfg.series[0].values.forEach((v,i) => {
      if(v===null||!isFinite(v)) return;
      // Barres de trésorerie : vert / rouge sémantiques, pas la couleur d'accent.
      const c = v>=0 ? css("--up") : css("--down");
      plot.appendChild(svgEl("path",{d:roundedBar(X(i)-bw/2, Y(0), Y(v), bw, 4), fill:c}));
    });
  } else {
    cfg.series.forEach(s => {
      const col = css(s.color);
      const pts = s.values.map((v,i)=> (v===null||!isFinite(v)) ? null : [X(i),Y(v)]).filter(Boolean);
      if(pts.length<1) return;
      if(s.fill && pts.length>1){
        const base = Y(Math.min(Math.max(yMin,0), yMax));
        const d = `M${pts[0][0]},${base} ` + pts.map(p=>`L${p[0]},${p[1]}`).join(" ") + ` L${pts[pts.length-1][0]},${base} Z`;
        plot.appendChild(svgEl("path",{d, fill:col, opacity:.09}));
      }
      if(pts.length>1){
        const d = "M"+pts.map(p=>p.join(",")).join(" L");
        const a = {d, fill:"none", stroke:col, "stroke-width":s.width || 2,
          "stroke-linejoin":"round", "stroke-linecap":"round"};
        if(s.dash) a["stroke-dasharray"] = typeof s.dash === "string" ? s.dash : "5 4";
        plot.appendChild(svgEl("path",a));
      }
      const last = pts[pts.length-1];
      plot.appendChild(svgEl("circle",{cx:last[0],cy:last[1],r:4.5,fill:col,stroke:css("--surface"),"stroke-width":2}));
    });
  }

  // Seuils fiscaux : repères discrets en bas du graphe, pour que les ruptures
  // de pente ne passent pas pour des artefacts de calcul.
  const rowRight = [-1e9, -1e9]; // bord droit occupé sur chacun des deux niveaux
  (cfg.milestones || []).forEach(ms => {
    if(ms.i < 0 || ms.i >= n) return;
    const mx = X(ms.i);
    svg.appendChild(svgEl("line",{x1:mx, x2:mx, y1:M.t, y2:M.t+ih,
      stroke:ink3, "stroke-width":1, "stroke-dasharray":"2 5", opacity:.4}));
    const atRight = ms.i > n*0.62;
    const tx = mx + (atRight ? -6 : 6);
    const w = ms.text.length*5.3;          // largeur approchée à 10px
    const left = atRight ? tx - w : tx;
    const lvl = left < rowRight[0] + 8 ? 1 : 0;
    rowRight[lvl] = left + w;
    const lb = svgEl("text",{x:tx, y:M.t+ih-7-lvl*12,
      "text-anchor":atRight?"end":"start", fill:ink3, "font-size":"10", opacity:.85});
    lb.textContent = ms.text;
    svg.appendChild(lb);
  });

  if(cfg.mark){
    const mx = X(cfg.mark.i);
    svg.appendChild(svgEl("line",{x1:mx, x2:mx, y1:M.t, y2:M.t+ih,
      stroke:ink3, "stroke-width":1, "stroke-dasharray":"2 4"}));
    const atRight = cfg.mark.i > n*0.6;
    const lab = svgEl("text",{x:mx + (atRight?-8:8), y:M.t+10,
      "text-anchor":atRight?"end":"start", fill:ink3, "font-size":"11.5"});
    lab.textContent = cfg.mark.text;
    svg.appendChild(lab);
  }

  const focus = svgEl("g",{opacity:"0"});
  const vline = svgEl("line",{y1:M.t,y2:M.t+ih,stroke:css("--text-muted"),"stroke-width":1,"stroke-dasharray":"3 3"});
  focus.appendChild(vline);
  const knobs = cfg.series.map(s => {
    const c = svgEl("circle",{r:5,fill:css(s.color||"--d1"),stroke:css("--surface"),"stroke-width":2});
    focus.appendChild(c); return c;
  });
  svg.appendChild(focus);

  const hit = svgEl("rect",{x:M.l,y:M.t,width:iw,height:ih,fill:"transparent"});
  svg.appendChild(hit);
  host.appendChild(svg);

  const fmtVal = cfg.fmtVal || (v => cfg.fmtAxis(v, scaleRef));
  resumeTexte(host, cfg.label || "",
    [cfg.xLabel || "Année"].concat(cfg.series.map((s,si) => s.nom || `Série ${si+1}`)),
    cfg.x.map((lab,i) => [String(lab)].concat(cfg.series.map(s => {
      const v = s.values[i];
      return (v===null||!isFinite(v)) ? "non calculable" : fmtVal(v);
    }))));

  let courant = -1;
  const montrer = i => {
    courant = Math.max(0, Math.min(n-1, i));
    focus.setAttribute("opacity","1");
    vline.setAttribute("x1",X(courant)); vline.setAttribute("x2",X(courant));
    knobs.forEach((c,si) => {
      const v = cfg.series[si].values[courant];
      if(v===null||!isFinite(v)||cfg.band||v<yMin||v>yMax){ c.setAttribute("opacity","0"); return; }
      c.setAttribute("opacity","1"); c.setAttribute("cx",X(courant)); c.setAttribute("cy",Y(v));
    });
    tip.innerHTML = cfg.tip(courant);
    tip.classList.add("on");
    placerInfobulle(tip, host, X(courant)*(host.clientWidth/W));
  };
  const cacher = () => { focus.setAttribute("opacity","0"); tip.classList.remove("on"); };

  // pointer* couvre souris, tactile et stylet d'un seul jeu d'événements ;
  // focus et flèches ouvrent le même chemin au clavier, sans quoi l'infobulle
  // resterait hors d'atteinte de qui n'a pas de souris.
  svg.addEventListener("pointermove", ev => {
    const box = svg.getBoundingClientRect();
    const px = (ev.clientX - box.left) * (W/box.width);
    montrer(cfg.band
      ? Math.floor((px - M.l)/(iw/n))
      : Math.round((px - M.l)/(iw/Math.max(1,n-1))));
  });
  svg.addEventListener("pointerleave", cacher);
  svg.addEventListener("focus", () => montrer(courant < 0 ? n-1 : courant));
  svg.addEventListener("blur", cacher);
  svg.addEventListener("keydown", ev => auClavier(ev, n, courant, montrer, cacher));
}

// Déplacement au clavier, commun aux trois graphiques : flèches, Début, Fin,
// Échap. Retourne sans rien faire pour toute autre touche, pour ne pas
// confisquer la navigation du navigateur.
function auClavier(ev, n, courant, montrer, cacher){
  const pas = {ArrowRight:1, ArrowUp:1, ArrowLeft:-1, ArrowDown:-1}[ev.key];
  if(pas !== undefined) montrer((courant < 0 ? (pas > 0 ? -1 : n) : courant) + pas);
  else if(ev.key === "Home") montrer(0);
  else if(ev.key === "End") montrer(n-1);
  else if(ev.key === "Escape") cacher();
  else return;
  ev.preventDefault();
}

/* ---------- colonnes : régimes et cascade ---------- */
// Barres catégorielles, chacune allant de `from` à `to` : sert au comparatif des
// régimes (base zéro) comme à la cascade du gain (chaque marche part du niveau
// où la précédente s'arrête).
function drawColumns(host, tip, cfg){
  const W = Math.max(320, host.clientWidth);
  const items = cfg.items, n = items.length;
  const lignes = Math.max(...items.map(it => String(it.label).split("\n").length));
  const M = {t:26, r:14, b:16 + lignes*13, l:cfg.padLeft||62};
  const H = (cfg.height || 240) + lignes*13;
  host.querySelectorAll("svg").forEach(el=>el.remove());
  const svg = svgEl("svg",{viewBox:`0 0 ${W} ${H}`, height:H, role:"img",
    tabindex:"0", "aria-label":cfg.label||""});
  const vals = items.flatMap(it => [it.from, it.to]).filter(v => isFinite(v));
  if(!vals.length){ host.appendChild(svg); return; }
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const yMin = ticks[0], yMax = ticks[ticks.length-1];
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const Y = v => M.t + ih*(1 - (v-yMin)/(yMax-yMin || 1));
  const slot = iw/n, bw = Math.min(cfg.maxBar || 76, slot*0.62);
  const X = i => M.l + slot*(i+0.5);
  const gridC = css("--border"), ink3 = css("--text-muted");
  const scaleRef = Math.max(Math.abs(yMin), Math.abs(yMax));
  ticks.forEach(t => {
    const zero = Math.abs(t) < 1e-9;
    svg.appendChild(svgEl("line",{x1:M.l,x2:W-M.r,y1:Y(t),y2:Y(t),stroke:zero?ink3:gridC,"stroke-width":zero?1.2:1}));
    const lb = svgEl("text",{x:M.l-9,y:Y(t)+4,"text-anchor":"end",fill:ink3,"font-size":"11"});
    lb.textContent = cfg.fmtAxis(t, scaleRef);
    svg.appendChild(lb);
  });
  items.forEach((it,i) => {
    const y0 = Y(it.from), y1 = Y(it.to);
    const bar = svgEl("path",{d:roundedBar(X(i)-bw/2, y0, y1, bw, 3), fill:css(it.color), opacity:it.opacity||1});
    svg.appendChild(bar);
    if(cfg.connect && i < n-1){
      svg.appendChild(svgEl("line",{x1:X(i)+bw/2, x2:X(i+1)-bw/2, y1:y1, y2:y1, stroke:ink3, "stroke-width":1, "stroke-dasharray":"2 3", opacity:.7}));
    }
    const monte = it.to >= it.from;
    const ty = monte ? Math.min(y0,y1) - 7 : Math.max(y0,y1) + 14;
    const tv = svgEl("text",{x:X(i), y:ty, "text-anchor":"middle", fill:css(it.textColor || encre(it.color)), "font-size":"11.5", "font-weight":"600", class:"chiffre"});
    tv.textContent = it.text;
    svg.appendChild(tv);
    String(it.label).split("\n").forEach((l,k) => {
      const tl = svgEl("text",{x:X(i), y:H-M.b+15+k*13, "text-anchor":"middle", fill:it.strong?css("--text"):ink3, "font-size":"11", "font-weight":it.strong?"600":"400"});
      tl.textContent = l;
      svg.appendChild(tl);
    });
  });
  let courant = -1;
  const montrer = i => {
    courant = Math.max(0, Math.min(n-1, i));
    tip.innerHTML = cfg.tip(courant); tip.classList.add("on");
    placerInfobulle(tip, host, X(courant)*(host.clientWidth/W));
  };
  const cacher = () => { courant = -1; tip.classList.remove("on"); };
  items.forEach((it,i) => {
    const hit = svgEl("rect",{x:M.l+slot*i, y:M.t, width:slot, height:ih+M.b, fill:"transparent"});
    if(cfg.onClick){ hit.classList.add("clickable"); hit.addEventListener("click", () => cfg.onClick(i)); }
    hit.addEventListener("pointermove", () => montrer(i));
    hit.addEventListener("pointerleave", cacher);
    svg.appendChild(hit);
  });
  // Le SVG entier est un seul arrêt de tabulation : les flèches parcourent les
  // colonnes, Entrée active celle qui est sous le curseur quand elle est
  // cliquable. Dix colonnes ne font ainsi pas dix arrêts de plus.
  svg.addEventListener("focus", () => montrer(courant < 0 ? 0 : courant));
  svg.addEventListener("blur", cacher);
  svg.addEventListener("keydown", ev => {
    if(cfg.onClick && courant >= 0 && (ev.key === "Enter" || ev.key === " ")){
      ev.preventDefault(); cfg.onClick(courant); return;
    }
    auClavier(ev, n, courant, montrer, cacher);
  });
  host.appendChild(svg);
  resumeTexte(host, cfg.label || "", [cfg.colLabel || "Poste", "Montant"],
    items.map(it => [String(it.label).replace(/\n/g, " "), it.text]));
}

/* ---------- tornade : sensibilité ---------- */
// Une ligne par paramètre. L'axe est le rendement lui-même, pas un écart : la
// ligne verticale est celui du projet, et chaque barre part de là vers le
// rendement qu'on obtiendrait si ce seul paramètre bougeait — à gauche le
// scénario défavorable, à droite le favorable. Sous le nom, l'écart essayé ;
// sur un téléphone, nom et écart passent au-dessus de la barre, qui prend
// alors toute la largeur.
function drawTornado(host, tip, cfg){
  const rows = cfg.rows, n = rows.length, ref = cfg.ref;
  const W = Math.max(320, host.clientWidth), etroit = W < 520, rh = etroit ? 46 : 38;
  const M = etroit ? {t:24, r:44, b:30, l:44} : {t:24, r:56, b:30, l:Math.min(170, Math.max(120, W*0.28))};
  const H = M.t + n*rh + M.b;
  host.querySelectorAll("svg").forEach(el=>el.remove());
  const svg = svgEl("svg",{viewBox:`0 0 ${W} ${H}`, height:H, role:"img",
    tabindex:"0", "aria-label":cfg.label||""});
  if(!n){ host.appendChild(svg); return; }
  // Une plage d'au moins un demi-point, pour qu'un projet peu sensible ne
  // dessine pas des écarts minuscules en barres géantes.
  let lo = Math.min(ref, ...rows.map(r => r.lo)), hi = Math.max(ref, ...rows.map(r => r.hi));
  if(hi - lo < 0.005){ const c = (hi+lo)/2; lo = c - 0.0025; hi = c + 0.0025; }
  const ticks = niceTicks(lo, hi, etroit ? 3 : 4);
  const xMin = ticks[0], xMax = ticks[ticks.length-1];
  const iw = W - M.l - M.r;
  const X = v => M.l + iw*(v-xMin)/(xMax-xMin || 1);
  const gridC = css("--border"), ink = css("--text"), ink3 = css("--text-muted"), up = css("--up"), down = css("--down");
  ticks.forEach(t => {
    svg.appendChild(svgEl("line",{x1:X(t),x2:X(t),y1:M.t,y2:H-M.b,stroke:gridC,"stroke-width":1}));
    const lb = svgEl("text",{x:X(t), y:H-10, "text-anchor":"middle", fill:ink3, "font-size":"11"});
    lb.textContent = cfg.fmtAxis(t);
    svg.appendChild(lb);
  });
  let courant = -1;
  const montrer = i => {
    courant = Math.max(0, Math.min(n-1, i));
    tip.innerHTML = cfg.tip(courant); tip.classList.add("on");
    placerInfobulle(tip, host, X(ref)*(host.clientWidth/W),
      Math.max(0, (M.t + rh*courant - 4)*(host.clientWidth/W) - 40));
  };
  const cacher = () => { courant = -1; tip.classList.remove("on"); };
  rows.forEach((r,i) => {
    const yc = M.t + rh*i + (etroit ? 30 : rh/2), h = 16;
    [[r.lo, down, r.loText], [r.hi, up, r.hiText]].forEach(([v, col, txt]) => {
      // Au bout d'une échelle, un côté ne bouge pas : ni barre ni chiffre.
      if(Math.abs(v - ref) < 1e-9) return;
      const enc = css(col === up ? "--up-ink" : "--down-ink");
      const x0 = X(ref), x1 = X(v);
      const w = Math.abs(x1-x0);
      if(w > 0.5) svg.appendChild(svgEl("rect",{x:Math.min(x0,x1), y:yc-h/2, width:w, height:h, rx:2, fill:col}));
      const droite = v >= ref;
      const tv = svgEl("text",{x:droite ? x1+5 : x1-5, y:yc+4, "text-anchor":droite?"start":"end", fill:enc, "font-size":"11", "font-weight":"600"});
      tv.textContent = txt;
      svg.appendChild(tv);
    });
    const lb = svgEl("text", etroit ? {x:0, y:yc-14, fill:ink, "font-size":"12"}
      : {x:M.l-10, y:yc-2, "text-anchor":"end", fill:ink, "font-size":"12"});
    lb.textContent = r.label;
    const ec = svgEl(etroit ? "tspan" : "text", etroit ? {dx:8, fill:ink3, "font-size":"11"}
      : {x:M.l-10, y:yc+12, "text-anchor":"end", fill:ink3, "font-size":"11"});
    ec.textContent = r.ecart;
    (etroit ? lb : svg).appendChild(ec);
    svg.appendChild(lb);
    const hit = svgEl("rect",{x:0, y:M.t + rh*i, width:W, height:rh, fill:"transparent"});
    hit.addEventListener("pointermove", () => montrer(i));
    hit.addEventListener("pointerleave", cacher);
    svg.appendChild(hit);
  });
  // La référence par-dessus les barres, et son chiffre au-dessus du tracé.
  svg.appendChild(svgEl("line",{x1:X(ref),x2:X(ref),y1:M.t-4,y2:H-M.b,stroke:ink,"stroke-width":1.5}));
  const rl = svgEl("text",{x:X(ref), y:M.t-9, "text-anchor":"middle", fill:ink, "font-size":"11", "font-weight":"600"});
  rl.textContent = cfg.refText;
  svg.appendChild(rl);
  svg.addEventListener("focus", () => montrer(courant < 0 ? 0 : courant));
  svg.addEventListener("blur", cacher);
  svg.addEventListener("keydown", ev => auClavier(ev, n, courant, montrer, cacher));
  host.appendChild(svg);
  resumeTexte(host, cfg.label || "", ["Paramètre", "Écart essayé", "Scénario défavorable", "Scénario favorable"],
    rows.map(r => [r.label, r.ecart, r.loText, r.hiText]));
}

function tipRow(color, label, value){
  return `<div class="tr"><span class="tl"><i class="dot" style="background:${color}"></i>${label}</span><span class="tv">${value}</span></div>`;
}

/* ---------- infobulles ---------- */
// Une explication à la demande. Le texte vit dans un `.ibody` masqué, posé à côté
// de son bouton : il reste dans le balisage — donc lisible par un robot et par un
// lecteur d'écran — mais n'occupe l'écran que le temps qu'on le demande. C'est ce
// qui a permis de retirer la vingtaine de lignes grises du panneau et les sept
// paragraphes qui coiffaient les graphiques.
// Un seul panneau pour toute la page, posé en `fixed` et borné au viewport : à
// 390 px il ne peut pas déborder, quel que soit le bord où vit le déclencheur.
function brancherInfobulles(){
  if(document.getElementById("pop")) return;
  const pop = document.createElement("div");
  pop.id = "pop"; pop.className = "pop"; pop.setAttribute("role", "tooltip");
  pop.hidden = true;
  document.body.appendChild(pop);

  let ouvert = null;
  const fermer = () => {
    if(!ouvert) return;
    ouvert.setAttribute("aria-expanded", "false");
    ouvert.removeAttribute("aria-describedby");
    ouvert = null;
    pop.hidden = true;
  };
  const ouvrir = bouton => {
    if(ouvert === bouton) return;
    const corps = bouton.parentElement && bouton.parentElement.querySelector(".ibody");
    if(!corps) return;
    fermer();
    ouvert = bouton;
    pop.innerHTML = corps.innerHTML;
    // Mesurer d'abord, placer ensuite : la largeur dépend du texte.
    pop.hidden = false;
    pop.style.left = "0px"; pop.style.top = "0px";
    const b = bouton.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width/2 - w/2)) + "px";
    // Sous le bouton, sauf s'il n'y a plus la place en bas et qu'il y en a en haut.
    pop.style.top = (b.bottom + 10 + h > innerHeight && b.top - 10 - h > 0
      ? b.top - 10 - h : b.bottom + 10) + "px";
    bouton.setAttribute("aria-expanded", "true");
    bouton.setAttribute("aria-describedby", "pop");
  };
  const cible = ev => ev.target.closest ? ev.target.closest(".i") : null;
  const dansPop = ev => !!(ev.target.closest && ev.target.closest(".pop"));

  // Survol à la souris seulement : au doigt, l'ouverture reste au toucher, sinon
  // le premier appui ouvrirait et le second refermerait aussitôt.
  document.addEventListener("pointerover", ev => {
    if(ev.pointerType && ev.pointerType !== "mouse") return;
    const b = cible(ev);
    if(b) ouvrir(b);
    else if(!dansPop(ev)) fermer();
  });
  document.addEventListener("click", ev => {
    const b = cible(ev);
    // Un bouton logé dans un <summary> replierait la section : on lui coupe
    // l'événement, l'infobulle n'est pas un geste de navigation.
    if(b){ ev.preventDefault(); ev.stopPropagation(); ouvrir(b); }
    else if(!dansPop(ev)) fermer();
  });
  document.addEventListener("focusin", ev => {
    const b = cible(ev);
    if(b) ouvrir(b); else fermer();
  });
  document.addEventListener("keydown", ev => {
    if(ev.key !== "Escape" || !ouvert) return;
    const b = ouvert;
    fermer();
    b.focus();
  });
  // La bulle est ancrée à un point de l'écran : dès que la page bouge sous elle,
  // elle ment. On la referme plutôt que de la suivre.
  addEventListener("scroll", fermer, true);
  addEventListener("resize", fermer);
}

/* ---------- configurations partagées ---------- */
// Les seuils fiscaux créent de vraies ruptures de pente : sans repère, elles
// passent pour des artefacts de calcul.
function jalonsFiscaux(p, rows){
  // Un bien déjà détenu a entamé le compte : les seuils se rapprochent d'autant,
  // et ceux qui sont déjà franchis n'ont plus rien à marquer.
  const deja = p.situation === "detenu" ? Math.max(0, Math.round(Number(p.depuis) || 0)) : 0;
  const j = [
    {y:6,  text:"seuil 5 ans"},
    {y:22, text:"exonéré IR"},
    {y:30, text:"exonéré PS"}
  ].map(j => ({y:j.y - deja, text:j.text}))
   .filter(j => j.y >= 1 && j.y <= p.horizon).map(j => ({i:j.y-1, text:j.text}));
  if(p.regime === "reel-foncier" && p.horizon >= 4 && rows.some(r => r.repriseDF > 0.5)){
    j.unshift({i:3, text:"fin de reprise"});
  }
  return j;
}

// « Gagné ou perdu » : la calculatrice et la page d'accueil tracent le même
// graphique des mêmes données. Écrit une seule fois — l'entretenir en double
// avait déjà fait perdre les repères de seuils fiscaux côté accueil.
function cfgGainNet(p, R, opts){
  const rows = R.rows;
  const mort = rows.findIndex(r => r.gainImmo >= 0);
  return Object.assign({
    x: rows.map(r => String(r.y)),
    height: 270, padLeft: 78, zero: true,
    label: "Gain net immobilier comparé à trois placements",
    fmtAxis: kEur,
    fmtVal: sEur,
    mark: mort > 0 ? {i:mort, text:`point mort · année ${rows[mort].y}`} : null,
    milestones: jalonsFiscaux(p, rows),
    // Pas d'aire ici : quatre courbes se croisent, des remplissages superposés
    // rendraient les zones d'intersection illisibles. Les trois placements
    // forment une rampe ordonnée du plus risqué au plus sûr, doublée d'un
    // motif de trait distinct : l'identité ne repose jamais sur la seule couleur.
    // La bourse garde le tiret du graphique de rendement, où elle sert déjà de
    // référence ; le fonds euros passe au trait mixte pour ne pas s'y confondre.
    series: [
      {color:"--d1", nom:"Immobilier", values: rows.map(r=>r.gainImmo), width:2.4},
      {color:"--d2", nom:"Bourse", values: rows.map(r=>r.gainBourse), dash:true},
      {color:"--d3", nom:"Fonds euros", values: rows.map(r=>r.gainFonds), dash:"9 3 2 3"},
      {color:"--d4", nom:"Livret A", values: rows.map(r=>r.gainLivret), dash:"2 3"}
    ],
    tip: i => {
      const r = rows[i];
      const meilleur = Math.max(r.gainBourse, r.gainFonds, r.gainLivret);
      return `<div class="th">Revente fin d'année ${r.y}</div>` +
        tipRow(css("--d1"),"Immobilier", sEur(r.gainImmo)) +
        tipRow(css("--d2"),"Bourse", sEur(r.gainBourse)) +
        tipRow(css("--d3"),"Fonds euros", sEur(r.gainFonds)) +
        tipRow(css("--d4"),"Livret A", sEur(r.gainLivret)) +
        `<div class="tr" style="margin-top:7px;padding-top:6px;border-top:1px solid var(--border)">` +
        `<span class="tl">${r.gainImmo>=meilleur?"Avance sur le meilleur placement":"Retard sur le meilleur placement"}</span>` +
        `<span class="tv">${eur.format(Math.abs(r.gainImmo-meilleur))}</span></div>` +
        tipRow("transparent","sorti de votre poche", eur.format(r.mise)) +
        tipRow("transparent","net de la revente", eur.format(r.netVente));
    }
  }, opts || {});
}

// Les toutes premières années d'un rendement par année de revente sont
// massivement négatives (frais d'acquisition non amortis). En « zone lisible »
// on plafonne le bas du graphe sans jamais masquer une année à partir de la
// 5e ; en « échelle complète » on montre tout.
function plancherLisible(listes, complete){
  if(complete) return undefined;
  const tard = listes.flatMap(l => l.slice(4)).filter(v => v !== null && isFinite(v));
  return tard.length ? Math.min(-0.30, Math.min.apply(null, tard)) : -0.30;
}

// Les quatre régimes selon l'année de revente : la calculatrice et la page
// d'accueil tracent le même graphique. Une couleur par régime, dans l'ordre
// de REGIMES ; le régime en cours en trait fort ; la bourse en tirets, la même
// référence que sur le graphique de rendement.
const COULEURS_REGIMES = ["--d1", "--d2", "--d3", "--d4"];
function cfgRegimesTemps(p, R, regs, opts){
  const rows = R.rows;
  const brut = p.avantImpot === true;
  const nom = r => r.label.replace("\n", ", ");
  return Object.assign({
    x: rows.map(r => String(r.y)),
    height: 270, zero: true,
    label: "Rendement annualisé de chaque régime selon l'année de revente",
    fmtAxis: v => (v*100).toFixed(0)+" %",
    fmtVal: sPct,
    milestones: jalonsFiscaux(p, rows),
    series: regs.map((r, k) => ({color: COULEURS_REGIMES[k], nom: nom(r), values: r.tris,
        width: r.rg === p.regime ? 2.6 : 1.5}))
      .concat([{color:"--text-muted", nom: brut ? "Bourse, avant impôt" : "Bourse, nette d'impôt",
        values: rows.map(r => r.triBourse), dash:true}]),
    tip: i => {
      const meilleur = regs.reduce((m, r) =>
        r.tris[i] !== null && (m === null || r.tris[i] > m.tris[i]) ? r : m, null);
      return `<div class="th">Revente année ${rows[i].y}</div>` +
        regs.map((r, k) => tipRow(css(COULEURS_REGIMES[k]),
          (r === meilleur ? "<b>" + nom(r) + "</b>" : nom(r)) + (r.rg === p.regime ? " · en cours" : ""),
          r.tris[i] === null ? "—" : sPct(r.tris[i]))).join("") +
        tipRow(css("--text-muted"), brut ? "Bourse, avant impôt" : "Bourse, nette d'impôt",
          rows[i].triBourse === null ? "—" : sPct(rows[i].triBourse));
    }
  }, opts || {});
}

// Qui mène, et jusqu'à quand : la phrase sous le graphique des régimes dans le
// temps. Les quatre premières années ne départagent rien — tout le monde y perd
// ses frais d'acquisition —, on lit à partir de la cinquième.
function meneurRegimes(regs, horizon){
  const nom = r => r.label.replace("\n", " ");
  const meneurs = [];
  for(let i = Math.min(4, horizon - 1); i < horizon; i++){
    const m = regs.reduce((m, r) => r.tris[i] !== null && (m === null || r.tris[i] > m.tris[i]) ? r : m, null);
    if(!m) continue;
    if(!meneurs.length || meneurs[meneurs.length-1].r !== m) meneurs.push({r:m, i});
  }
  if(!meneurs.length) return "";
  if(meneurs.length === 1) return `Sur vos hypothèses, ${nom(meneurs[0].r)} reste devant à toute date de revente.`;
  const [a, b] = meneurs;
  let phrase = `${nom(a.r)} mène jusqu'à l'année ${b.i}, puis ${nom(b.r)} prend le relais`;
  if(meneurs.length > 2) phrase += `, avant ${nom(meneurs[2].r)} à partir de l'année ${meneurs[2].i + 1}`;
  return phrase + ".";
}

// Sensibilité : même graphique des deux côtés, mêmes libellés. Tout se lit en
// rendement annualisé à l'horizon, celui du projet au centre.
function cfgSensibilite(sens, triRef){
  // Au bout d'une échelle — la tranche à 0 % ou à 45 % —, un côté ne bouge
  // pas : il n'a rien à dire, on ne l'affiche pas.
  const bouge = c => Math.abs(c.d) > 1e-9;
  const pas = v => { const x = Math.round(v*1000)/10; return (x < 0 ? "−" : "") + String(Math.abs(x)).replace(".", ",") + " %"; };
  return {
    label: "Sensibilité du rendement annualisé",
    ref: triRef, refText: "Ce projet : " + pct(triRef),
    fmtAxis: pas,
    rows: sens.map(s => ({label:s.nom,
      ecart: bouge(s.fav) && bouge(s.def) ? "± " + s.txt : (bouge(s.fav) ? s.fav.s : s.def.s) + " " + s.txt,
      lo:triRef + s.lo, hi:triRef + s.hi, loText:pct(s.def.tri), hiText:pct(s.fav.tri)})),
    tip: i => {
      const s = sens[i];
      const ligne = (c, col) => tipRow(col, `${s.nom} ${c.s}${s.txt}`, `${pct(c.tri)} <span style="color:var(--text-muted)">(${pts(c.d)})</span>`);
      return `<div class="th">${s.nom}</div>` +
        (bouge(s.fav) ? ligne(s.fav, css("--up")) : "") +
        (bouge(s.def) ? ligne(s.def, css("--down")) : "") +
        tipRow(css("--text"), "Ce projet", pct(triRef));
    }
  };
}
// La phrase sous le graphique : le paramètre le plus sensible, dans les deux
// sens, en rendement plutôt qu'en points.
function phraseSensibilite(sens, triRef, horizon){
  if(!sens.length) return "";
  const s = sens[0];
  const sens1 = c => `avec ${s.txt} ${c.s === "+" ? "de plus" : "de moins"}`;
  const cotes = [s.def, s.fav].filter(c => Math.abs(c.d) > 1e-9);
  const [a, b] = cotes;
  // Espaces insécables : ni « 5,9 » séparé de son %, ni guillemet orphelin.
  return (`À ${horizon} ans, c'est « ${s.nom} » qui pèse le plus : ${sens1(a)}, le rendement passe de ${pct(triRef)} à ${pct(a.tri)} par an`
    + (b ? ` ; ${sens1(b)}, à ${pct(b.tri)}.` : ".")).replace(/ (%|»)/g, "\u00a0$1").replace(/« /g, "«\u00a0");
}

// Ce qu'il faudrait pour faire jeu égal avec la bourse, ou avec l'inflation :
// une tuile par paramètre, la valeur de bascule, et l'écart avec la saisie —
// une marge quand le projet est devant, un effort à obtenir quand il est
// derrière. Partagé par la calculatrice et la page d'accueil.
const FORMAT_SEUIL = {
  prix:      {v: x => eur.format(Math.round(x/100)*100), ecart: (x, a) => sPct(x/a - 1)},
  loyer:     {v: x => eur.format(Math.round(x)) + " /mois", ecart: (x, a) => sPct(x/a - 1)},
  taux:      {v: x => pct(x/100), ecart: (x, a) => pts((x - a)/100)},
  indexPrix: {v: x => pct(x/100) + " /an", ecart: (x, a) => pts((x - a)/100)},
  vacance:   {v: x => pct(x/100), ecart: (x, a) => pts((x - a)/100)},
  bourse:    {v: x => pct(x/100) + " /an", ecart: (x, a) => pts((x - a)/100)}
};
// `cible` : la bourse ou l'inflation pour un investissement ; « location » pour
// la résidence principale, où l'achat se mesure à la location.
function tuilesSeuils(liste, cible){
  const rival = cible === "pouvoir" ? `l'inflation` : cible === "location" ? "la location" : "la bourse";
  return liste.map(s => {
    const F = FORMAT_SEUIL[s.k];
    const valeur = s.valeur === null ? "—" : F.v(s.valeur);
    const sous = s.valeur === null
      ? (s.toujours ? `devant ${rival} sur toute la plage` : `hors de portée : ${rival} reste devant`)
      : `vous : ${F.v(s.actuel)} · <b class="${s.devant ? "pos" : "neg"}">${F.ecart(s.valeur, s.actuel)}</b>`;
    return `<div class="tile"><span class="k">${s.nom}</span><span class="v num">${valeur}</span><span class="s">${sous}</span></div>`;
  }).join("");
}

let sensTimer = null;
function planifier(fn){
  if(sensTimer !== null){ (window.cancelIdleCallback || clearTimeout)(sensTimer); }
  sensTimer = window.requestIdleCallback
    ? requestIdleCallback(() => { sensTimer = null; fn(); }, {timeout:400})
    : setTimeout(() => { sensTimer = null; fn(); }, 60);
}

/* ---------- acheter ou louer ---------- */
// Le patrimoine des deux ménages, année par année : la calculatrice « acheter ou
// louer » et la page d'accueil tracent le même graphique. `reel` : en euros
// d'aujourd'hui, inflation retirée ; sinon en euros courants.
function cfgPatrimoineRP(R, reel, opts){
  const rows = R.rows, i0 = R.bascule !== null && R.bascule <= rows.length ? R.bascule - 1 : -1;
  const v = (r, cle) => reel ? r[cle + "Reel"] : r[cle];
  return Object.assign({
    x: rows.map(r => String(r.y)),
    height: 270, padLeft: 78, zero: true,
    label: "Patrimoine net du propriétaire et du locataire selon l'année de départ",
    fmtAxis: kEur, fmtVal: v => eur.format(v),
    mark: i0 > 0 ? {i:i0, text:`l'achat passe devant · année ${rows[i0].y}`} : null,
    series: [
      {color:"--d1", nom:"Acheter", values: rows.map(r => v(r, "liquidation")), width:2.4},
      {color:"--d2", nom:"Louer et placer", values: rows.map(r => v(r, "patrimoineLoc")), dash:true}
    ],
    tip: i => {
      const r = rows[i], e = reel ? r.ecartReel : r.ecart;
      return `<div class="th">Départ fin d'année ${r.y}${reel ? ", en euros d'aujourd'hui" : ""}</div>` +
        tipRow(css("--d1"), "Acheter", eur.format(v(r, "liquidation"))) +
        tipRow(css("--d2"), "Louer et placer", eur.format(v(r, "patrimoineLoc"))) +
        `<div class="tr" style="margin-top:7px;padding-top:6px;border-top:1px solid var(--border)">` +
        `<span class="tl">${e >= 0 ? "Avance de l'achat" : "Avance de la location"}</span>` +
        `<span class="tv">${eur.format(Math.abs(e))}</span></div>`;
    }
  }, opts || {});
}
// Sensibilité de la réponse : même tornade que pour l'investissement, lue en
// euros d'aujourd'hui — l'avance de l'achat au bout de la durée d'occupation.
function cfgSensibiliteRP(sens, ref){
  const bouge = c => Math.abs(c.d) > 0.5;
  return {
    label: "Sensibilité de l'avance de l'achat",
    ref, refText: "Ce projet : " + sEur(ref),
    fmtAxis: v => kEur(v, 10000),
    rows: sens.map(s => ({label:s.nom,
      ecart: bouge(s.fav) && bouge(s.def) ? "± " + s.txt : (bouge(s.fav) ? s.fav.s : s.def.s) + " " + s.txt,
      lo:ref + s.lo, hi:ref + s.hi, loText:kEur(s.def.tri, 10000), hiText:kEur(s.fav.tri, 10000)})),
    tip: i => {
      const s = sens[i];
      const ligne = (c, col) => tipRow(col, `${s.nom} ${c.s}${s.txt}`, `${sEur(c.tri)} <span style="color:var(--text-muted)">(${sEur(c.d)})</span>`);
      return `<div class="th">${s.nom}</div>` +
        (bouge(s.fav) ? ligne(s.fav, css("--up")) : "") +
        (bouge(s.def) ? ligne(s.def, css("--down")) : "") +
        tipRow(css("--text"), "Ce projet", sEur(ref));
    }
  };
}
function phraseSensibiliteRP(sens, horizon){
  if(!sens.length) return "";
  const s = sens[0];
  const e = Math.max(Math.abs(s.fav.d), Math.abs(s.def.d));
  return (`À ${horizon} ans, c'est « ${s.nom} » qui pèse le plus : un écart de ${s.txt} déplace l'avance de l'achat de ${eur.format(e)}, en euros d'aujourd'hui.`)
    .replace(/ (%|»|€)/g, "\u00a0$1").replace(/« /g, "«\u00a0");
}
