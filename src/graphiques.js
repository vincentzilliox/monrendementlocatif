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
  host.querySelectorAll("table.visually-hidden").forEach(el => el.remove());
  if(!lignes.length) return;
  const t = document.createElement("table");
  t.className = "visually-hidden";
  t.innerHTML = `<caption>${esc(titre)}</caption><thead><tr>`
    + entetes.map(h => `<th scope="col">${esc(h)}</th>`).join("")
    + `</tr></thead><tbody>`
    + lignes.map(l => `<tr><th scope="row">${esc(l[0])}</th>`
        + l.slice(1).map(c => `<td>${esc(c)}</td>`).join("") + `</tr>`).join("")
    + `</tbody></table>`;
  host.appendChild(t);
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
    const tv = svgEl("text",{x:X(i), y:ty, "text-anchor":"middle", fill:css(it.textColor || encre(it.color)), "font-size":"11.5", "font-weight":"600", class:"valeur"});
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
// Une ligne par paramètre, une barre vers la gauche pour le scénario défavorable
// et une vers la droite pour le favorable, en points de rendement annualisé.
function drawTornado(host, tip, cfg){
  const rows = cfg.rows, n = rows.length;
  const W = Math.max(320, host.clientWidth), rh = 32;
  const M = {t:8, r:64, b:30, l:Math.min(170, Math.max(120, W*0.28))};
  const H = M.t + n*rh + M.b;
  host.querySelectorAll("svg").forEach(el=>el.remove());
  const svg = svgEl("svg",{viewBox:`0 0 ${W} ${H}`, height:H, role:"img",
    tabindex:"0", "aria-label":cfg.label||""});
  if(!n){ host.appendChild(svg); return; }
  const ext = Math.max(0.0025, ...rows.flatMap(r => [Math.abs(r.lo), Math.abs(r.hi)]));
  const ticks = niceTicks(-ext, ext, 4);
  const xMin = ticks[0], xMax = ticks[ticks.length-1];
  const iw = W - M.l - M.r;
  const X = v => M.l + iw*(v-xMin)/(xMax-xMin || 1);
  const gridC = css("--border"), ink3 = css("--text-muted"), up = css("--up"), down = css("--down");
  ticks.forEach(t => {
    const zero = Math.abs(t) < 1e-9;
    svg.appendChild(svgEl("line",{x1:X(t),x2:X(t),y1:M.t,y2:H-M.b,stroke:zero?ink3:gridC,"stroke-width":zero?1.2:1}));
    const lb = svgEl("text",{x:X(t), y:H-10, "text-anchor":"middle", fill:ink3, "font-size":"11"});
    lb.textContent = cfg.fmtAxis(t);
    svg.appendChild(lb);
  });
  let courant = -1;
  const montrer = i => {
    courant = Math.max(0, Math.min(n-1, i));
    tip.innerHTML = cfg.tip(courant); tip.classList.add("on");
    const yc = M.t + rh*courant + rh/2;
    placerInfobulle(tip, host, X(0)*(host.clientWidth/W),
      Math.max(0, (yc - rh/2 - 4)*(host.clientWidth/W) - 40));
  };
  const cacher = () => { courant = -1; tip.classList.remove("on"); };
  rows.forEach((r,i) => {
    const yc = M.t + rh*i + rh/2, h = rh*0.5;
    [[r.lo, down, r.loText], [r.hi, up, r.hiText]].forEach(([v, col, txt]) => {
      const enc = css(col === up ? "--up-ink" : "--down-ink");
      const x0 = X(0), x1 = X(v);
      const w = Math.abs(x1-x0);
      if(w > 0.5) svg.appendChild(svgEl("rect",{x:Math.min(x0,x1), y:yc-h/2, width:w, height:h, rx:2, fill:col}));
      const droite = v >= 0;
      const tv = svgEl("text",{x:droite ? x1+5 : x1-5, y:yc+4, "text-anchor":droite?"start":"end", fill:enc, "font-size":"11", "font-weight":"600"});
      tv.textContent = txt;
      svg.appendChild(tv);
    });
    const lb = svgEl("text",{x:M.l-10, y:yc+4, "text-anchor":"end", fill:css("--text"), "font-size":"12"});
    lb.textContent = r.label;
    svg.appendChild(lb);
    const hit = svgEl("rect",{x:0, y:yc-rh/2, width:W, height:rh, fill:"transparent"});
    hit.addEventListener("pointermove", () => montrer(i));
    hit.addEventListener("pointerleave", cacher);
    svg.appendChild(hit);
  });
  svg.addEventListener("focus", () => montrer(courant < 0 ? 0 : courant));
  svg.addEventListener("blur", cacher);
  svg.addEventListener("keydown", ev => auClavier(ev, n, courant, montrer, cacher));
  host.appendChild(svg);
  resumeTexte(host, cfg.label || "", ["Paramètre", "Scénario défavorable", "Scénario favorable"],
    rows.map(r => [r.label, r.loText, r.hiText]));
}

function tipRow(color, label, value){
  return `<div class="tr"><span class="tl"><i class="dot" style="background:${color}"></i>${label}</span><span class="tv">${value}</span></div>`;
}

/* ---------- configurations partagées ---------- */
// Les seuils fiscaux créent de vraies ruptures de pente : sans repère, elles
// passent pour des artefacts de calcul.
function jalonsFiscaux(p, rows){
  const j = [
    {y:6,  text:"seuil 5 ans"},
    {y:22, text:"exonéré IR"},
    {y:30, text:"exonéré PS"}
  ].filter(j => j.y <= p.horizon).map(j => ({i:j.y-1, text:j.text}));
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
    series: [
      {color:"--d1", nom:"Immobilier", values: rows.map(r=>r.gainImmo), width:2.4},
      {color:"--d2", nom:"Bourse", values: rows.map(r=>r.gainBourse)},
      {color:"--d3", nom:"Fonds euros", values: rows.map(r=>r.gainFonds), dash:"7 4"},
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

// Sensibilité : même graphique des deux côtés, mêmes libellés.
function cfgSensibilite(sens, triRef){
  return {
    label: "Sensibilité du rendement annualisé",
    fmtAxis: v => (v>0?"+":v<0?"−":"") + Math.abs(v*100).toFixed(1).replace(".",",") + " pt",
    rows: sens.map(s => ({label:s.nom, lo:s.lo, hi:s.hi, loText:pts(s.lo), hiText:pts(s.hi)})),
    tip: i => {
      const s = sens[i];
      return `<div class="th">${s.nom} · ±${s.txt}</div>` +
        tipRow(css("--up"), `${s.nom} ${s.fav.s}${s.txt}`, sPct(s.fav.tri)) +
        tipRow(css("--down"), `${s.nom} ${s.def.s}${s.txt}`, sPct(s.def.tri)) +
        tipRow("transparent","Aujourd'hui", sPct(triRef));
    }
  };
}

let sensTimer = null;
function planifier(fn){
  if(sensTimer !== null){ (window.cancelIdleCallback || clearTimeout)(sensTimer); }
  sensTimer = window.requestIdleCallback
    ? requestIdleCallback(() => { sensTimer = null; fn(); }, {timeout:400})
    : setTimeout(() => { sensTimer = null; fn(); }, 60);
}
