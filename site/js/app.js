"use strict";
const $ = id => document.getElementById(id);
const eur = new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const eur1 = new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const pct = v => (v<0?"−":"") + Math.abs(v*100).toFixed(1).replace(".",",")+" %";
const sPct = v => (v>=0?"+":"−") + Math.abs(v*100).toFixed(1).replace(".",",")+" %";
const sEur = v => Math.abs(v)<0.5 ? eur.format(0) : (v>0?"+":"−")+eur.format(Math.abs(v));
/* un coût : positif = sortie d'argent, affichée en négatif */
const cost = v => Math.abs(v)<0.5 ? eur.format(0) : (v>0?"−":"+")+eur.format(Math.abs(v));

const FIELDS = ["prix","notairePct","fraisAcq","mobilier","apport","duree","taux","assur",
  "fraisDossier","loyer","vacance","copro","tf","pno","gestion","entretien",
  "ps","psPV","cfe","abattement","plafondDeficit","partBati","amortBatiAns","amortTvxAns","amortMobAns","horizon",
  "inflation","indexPrix","indexLoyer","indexCharges","fraisVente","bourse","fondsEuros","livretA"];
const SELECTS = ["regime","tmi"];
const DEFAULTS = {};
FIELDS.concat(SELECTS).forEach(k => DEFAULTS[k] = $(k).value);
DEFAULTS.ira = true;
DEFAULTS.prixSuitInflation = true;

/* ---------- postes de travaux ---------- */
const TVX_DEFAUT = [{nom:"Rénovation", montant:20000, taux:5, duree:20, deduc:100}];
let items = TVX_DEFAUT.map(o => ({...o}));

const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const nombre = (v, def, min, max) => {
  const n = parseFloat(v);
  return isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
function assainir(list){
  if(!Array.isArray(list)) return TVX_DEFAUT.map(o => ({...o}));
  return list.slice(0, 20).map(o => ({
    nom: String((o && o.nom) || "Poste").slice(0, 40),
    montant: nombre(o && o.montant, 0, 0, 1e9),
    taux: nombre(o && o.taux, 5, 0, 100),
    duree: nombre(o && o.duree, 20, 0, 60),
    deduc: nombre(o && o.deduc, 100, 0, 100)   // absent des sauvegardes antérieures
  }));
}

// Valeur qu'il reste aux travaux après y années : chaque poste perd `taux` %
// de son coût par an, pendant `duree` années au plus.
function residuTravaux(list, y){
  return (list || []).reduce((s, it) => {
    const perte = Math.min(1, (it.taux/100) * Math.min(y, it.duree));
    return s + it.montant*(1 - perte);
  }, 0);
}

function renderItems(){
  $("tvxList").innerHTML = items.map((it, i) => `
    <div class="tvxrow">
      <div class="tvxhead">
        <input type="text" data-i="${i}" data-f="nom" value="${esc(it.nom)}" aria-label="Nom du poste">
        <button type="button" class="del" data-i="${i}" aria-label="Supprimer ${esc(it.nom)}">&times;</button>
      </div>
      <div class="tgrid">
        <label>Montant<span class="tw"><input type="number" step="500" min="0" data-i="${i}" data-f="montant" value="${it.montant}"><span class="u">€</span></span></label>
        <label>Perte / an<span class="tw"><input type="number" step="0.5" min="0" max="100" data-i="${i}" data-f="taux" value="${it.taux}"><span class="u">%</span></span></label>
        <label>Pendant<span class="tw"><input type="number" step="1" min="0" max="60" data-i="${i}" data-f="duree" value="${it.duree}"><span class="u">ans</span></span></label>
        <label>Déductible<span class="tw"><input type="number" step="5" min="0" max="100" data-i="${i}" data-f="deduc" value="${it.deduc}"><span class="u">%</span></span></label>
      </div>
    </div>`).join("");
}

/* ---------- finance ---------- */
function schedule(capital, tauxPct, dureeAns, assurPct){
  const n = Math.max(0, Math.round(dureeAns*12));
  const r = tauxPct/100/12;
  const assurM = capital>0 ? capital*(assurPct/100)/12 : 0;
  let m = 0;
  if(capital>0 && n>0) m = r>1e-12 ? capital*r/(1-Math.pow(1+r,-n)) : capital/n;
  let crd = capital;
  const years = [];
  for(let y=1; y<=60; y++){
    let int=0, pri=0, ass=0;
    for(let k=0;k<12;k++){
      const idx=(y-1)*12+k;
      if(idx>=n || crd<=0.005) continue;
      const i = crd*r;
      let p = m-i;
      if(p>crd) p=crd;
      if(p<0) p=0;
      crd -= p; int+=i; pri+=p; ass+=assurM;
    }
    years.push({int,pri,ass,crd:Math.max(0,crd)});
  }
  return {mensualite:m+assurM, years};
}

function irr(flows){
  const f = r => flows.reduce((s,c,i)=> s + c/Math.pow(1+r,i), 0);
  let lo=-0.9999, hi=10, flo=f(lo), fhi=f(hi);
  if(!isFinite(flo)||!isFinite(fhi)||flo*fhi>0) return null;
  for(let i=0;i<200;i++){
    const mid=(lo+hi)/2, fm=f(mid);
    if(flo*fm<=0){hi=mid; fhi=fm;} else {lo=mid; flo=fm;}
  }
  return (lo+hi)/2;
}

function abattementIR(h){ return h<6 ? 0 : h<22 ? Math.min(1,0.06*(h-5)) : 1; }
function abattementPS(h){
  if(h<6) return 0;
  if(h<22) return 0.0165*(h-5);
  if(h===22) return 0.28;
  if(h<30) return 0.28+0.09*(h-22);
  return 1;
}
function surtaxePV(base){
  if(base<=50000) return 0;
  const t = base<=100000?0.02 : base<=150000?0.03 : base<=200000?0.04 : base<=250000?0.05 : 0.06;
  return base*t;
}

function read(){
  const p = {};
  FIELDS.forEach(k => { const v = parseFloat($(k).value); p[k] = isFinite(v) ? v : 0; });
  p.regime = $("regime").value;
  p.tmi = parseFloat($("tmi").value);
  p.ira = $("ira").checked;
  // Par défaut prix, loyers et charges suivent l'inflation : pas de gain réel sur
  // la pierre, seuls le levier et les loyers créent de la valeur.
  if($("prixSuitInflation").checked){
    p.indexPrix = p.inflation;
    p.indexLoyer = p.inflation;
    p.indexCharges = p.inflation;
  }
  p.horizon = Math.max(1, Math.min(40, Math.round(p.horizon)));
  p.items = items;
  p.travaux = items.reduce((s, it) => s + it.montant, 0);
  return p;
}

function compute(p){
  const notaire = p.prix * p.notairePct/100;
  const besoin = p.prix + notaire + p.travaux + p.fraisAcq + p.mobilier + p.fraisDossier;
  const emprunt = Math.max(0, besoin - p.apport);
  const cash0 = Math.max(0, besoin - emprunt);
  const sch = schedule(emprunt, p.taux, p.duree, p.assur);
  const valeur0 = p.prix + p.travaux;
  const tauxImpot = (p.tmi + p.ps)/100;

  // Part des travaux ouvrant droit à déduction, poste par poste.
  const travauxDeductibles = (p.items || []).reduce((s, it) => s + it.montant*(it.deduc/100), 0);
  const travauxNonDeduits = p.travaux - travauxDeductibles;

  const surAns = (montant, ans) => ans > 0 ? montant/ans : 0;
  const amortBati = surAns((p.prix + notaire + p.fraisAcq)*(p.partBati/100), p.amortBatiAns);
  const amortTvx = surAns(p.travaux, p.amortTvxAns);
  const amortMob = surAns(p.mobilier, p.amortMobAns);
  // Un champ masqué ne doit jamais peser sur le résultat : la CFE relève du BIC.
  const cfeApplicable = p.regime === "lmnp-micro" || p.regime === "lmnp-reel";

  // Déficits fonciers reportables : chaque millésime expire au bout de 10 ans.
  // Imputations sur le revenu global : reprises si le bien est vendu avant le
  // 31 décembre de la 3e année qui suit.
  let deficits = [], imputations = [];
  // Comparaison à mise de fonds identique. Les deux scénarios partent du même
  // apport et exigent exactement les mêmes versements : chaque euro d'effort
  // d'épargne que le bien réclame est, côté bourse, investi au taux de référence.
  // Symétriquement, chaque euro de trésorerie dégagé par le bien est replacé au
  // même taux. Les deux courbes sont donc bien deux capitaux comparables.
  let stockAmort=0, amortCumul=0, cumulCF=0, cumulLoyers=0, portefeuille=cash0, potImmo=0;
  let pFonds = cash0, pLivret = cash0;   // mêmes versements, placés ailleurs
  let miseTotale = cash0; // apport, puis chaque euro d'effort d'épargne versé ensuite
  const rows=[], cfHist=[];
  // Les taux de placement sont saisis hors inflation ; on les repasse en nominal
  // pour capitaliser dans la même monnaie que les flux du bien.
  const nominal = r => (1 + r/100)*(1 + p.inflation/100) - 1;
  const bourse = nominal(p.bourse), rFonds = nominal(p.fondsEuros), rLivret = nominal(p.livretA);

  for(let y=1; y<=p.horizon; y++){
    const loyers = p.loyer*12*Math.pow(1+p.indexLoyer/100, y-1)*(1-p.vacance/100);
    // CFE : exonérée la première année d'activité, et sous 5 000 € de recettes.
    const cfeAn = (!cfeApplicable || y === 1 || loyers <= 5000) ? 0 : p.cfe;
    const chargesFixes = (p.copro*12 + p.tf + p.pno + cfeAn)*Math.pow(1+p.indexCharges/100, y-1);
    const charges = chargesFixes + loyers*(p.gestion+p.entretien)/100;
    const L = sch.years[y-1] || {int:0,pri:0,ass:0,crd:0};
    const annuite = L.int + L.pri + L.ass;
    const fraisEmprunt = L.int + L.ass;

    let impot = 0, amortAn = 0;
    if(p.regime === "micro-foncier" || p.regime === "lmnp-micro"){
      impot = loyers*(1 - p.abattement/100)*tauxImpot;
    } else if(p.regime === "reel-foncier"){
      // Les travaux déductibles s'imputent en totalité l'année de leur paiement.
      // Ce n'est pas une sortie de trésorerie supplémentaire : elle est déjà
      // comptée dans le coût d'acquisition.
      const travauxDeduits = y===1 ? travauxDeductibles : 0;
      const chargesDeduc = charges + travauxDeduits;
      const base = loyers - chargesDeduc - fraisEmprunt;
      deficits = deficits.filter(d => y - d.y <= 10);
      if(base >= 0){
        let reste = base;
        deficits.forEach(d => { const u = Math.min(d.amt, reste); d.amt -= u; reste -= u; });
        deficits = deficits.filter(d => d.amt > 0.01);
        impot = reste*tauxImpot;
      } else {
        const netHorsEmprunt = loyers - chargesDeduc;
        let global = 0, report = 0;
        if(netHorsEmprunt < 0){ global = -netHorsEmprunt; report = fraisEmprunt; }
        else { report = -base; }
        const impute = Math.min(global, p.plafondDeficit);
        report += global - impute;
        if(report > 0.01) deficits.push({y, amt:report});
        if(impute > 0.01) imputations.push({y, amt:impute});
        impot = -impute*(p.tmi/100);
      }
    } else {
      amortAn = (y<=p.amortBatiAns?amortBati:0) + (y<=p.amortTvxAns?amortTvx:0) + (y<=p.amortMobAns?amortMob:0);
      const base = loyers - charges - fraisEmprunt;
      const dispo = amortAn + stockAmort;
      const used = Math.max(0, Math.min(dispo, base));
      stockAmort = dispo - used;
      amortCumul += used;
      impot = Math.max(0, base - used)*tauxImpot;
    }

    const cfAvant = loyers - charges - annuite;
    const cfNet = cfAvant - impot;
    cumulCF += cfNet;
    cumulLoyers += loyers;
    cfHist.push(cfNet);

    // Le prix du marché progresse, mais les travaux s'usent : seule leur valeur
    // résiduelle s'ajoute encore au bien.
    const valeur = (p.prix + residuTravaux(p.items, y))*Math.pow(1+p.indexPrix/100, y);
    const fraisVente = valeur*p.fraisVente/100;
    const ira = (p.ira && L.crd>0) ? Math.min(0.03*L.crd, L.crd*(p.taux/100)/2) : 0;

    const notaireRetenu = Math.max(notaire, 0.075*p.prix);
    const forfaitTvx = y>5 ? 0.15*p.prix : 0;
    // Des travaux déjà déduits des revenus fonciers ne peuvent pas majorer une
    // seconde fois le prix d'acquisition.
    const travauxPV = p.regime === "reel-foncier" ? travauxNonDeduits : p.travaux;
    let prixAcq = p.prix + notaireRetenu + Math.max(travauxPV, forfaitTvx);
    if(p.regime === "lmnp-reel") prixAcq -= amortCumul;
    const pvBrute = Math.max(0, valeur - prixAcq);
    const baseIR = pvBrute*(1-abattementIR(y));
    const basePS = pvBrute*(1-abattementPS(y));
    const impotPV = baseIR*0.19 + basePS*(p.psPV/100) + surtaxePV(baseIR);

    // Vendre avant le 31/12 de la 3e année suivant une imputation la fait reprendre.
    const repriseDF = p.regime === "reel-foncier"
      ? imputations.reduce((s,d) => s + (d.y > y-3 ? d.amt : 0), 0)*(p.tmi/100)
      : 0;

    const netVente = valeur - fraisVente - L.crd - ira - impotPV - repriseDF;

    const effort = Math.max(0, -cfNet), surplus = Math.max(0, cfNet);
    portefeuille = portefeuille*(1+bourse) + effort;
    pFonds = pFonds*(1+rFonds) + effort;
    pLivret = pLivret*(1+rLivret) + effort;
    potImmo = potImmo*(1+bourse) + surplus;
    miseTotale += effort;

    const flows = [-cash0].concat(cfHist.slice(0,-1)).concat([cfNet + netVente]);
    const tri = cash0 > 1 ? irr(flows) : null;
    const gain = cumulCF + netVente - cash0;

    rows.push({y, loyers, charges, interets:L.int, assurance:L.ass, principal:L.pri, annuite,
      impot, cfNet, cumulCF, valeur, crd:L.crd, impotPV, repriseDF, netVente, tri, gain,
      patrimoine: valeur - L.crd, recupere: netVente + potImmo, potImmo, portefeuille, amortCumul,
      mise: miseTotale, pFonds, pLivret,
      gainImmo: netVente + potImmo - miseTotale,
      gainBourse: portefeuille - miseTotale,
      gainFonds: pFonds - miseTotale,
      gainLivret: pLivret - miseTotale});
  }

  let best = null;
  rows.forEach(r => { if(r.tri !== null && (best===null || r.tri > best.tri)) best = r; });

  const r1 = rows[0];
  const loyerBrutAn = p.loyer*12;
  // Rendement en pouvoir d'achat : ce que le TRI vaut une fois l'inflation retirée.
  const reel = t => t === null ? null : (1 + t)/(1 + p.inflation/100) - 1;
  rows.forEach(r => {
    r.triReel = reel(r.tri);
    r.gainConstant = r.gainImmo/Math.pow(1 + p.inflation/100, r.y);
  });
  return {
    p, rows, best, notaire, besoin, emprunt, cash0, mensualite:sch.mensualite, valeur0,
    coutCredit: sch.years.reduce((s,L) => s + L.int + L.ass, 0),
    brute: loyerBrutAn/besoin,
    nette: (r1.loyers - r1.charges)/besoin,
    netteNette: (r1.loyers - r1.charges - r1.impot)/besoin,
    cfMensuel1: r1.cfNet/12,
    final: rows[rows.length-1],
    cumulEffort: rows.reduce((s,r)=> s + Math.min(0, r.cfNet), 0)
  };
}

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
const css = n => getComputedStyle(document.body).getPropertyValue(n).trim();

function roundedBar(x, y0, y1, w, r){
  const up = y1 <= y0;
  const h = Math.abs(y1-y0);
  const rr = Math.min(r, w/2, h);
  if(h < 0.5) return `M${x},${y0}h${w}`;
  return up
    ? `M${x},${y0} L${x},${y1+rr} Q${x},${y1} ${x+rr},${y1} L${x+w-rr},${y1} Q${x+w},${y1} ${x+w},${y1+rr} L${x+w},${y0} Z`
    : `M${x},${y0} L${x},${y1-rr} Q${x},${y1} ${x+rr},${y1} L${x+w-rr},${y1} Q${x+w},${y1} ${x+w},${y1-rr} L${x+w},${y0} Z`;
}

function drawChart(host, tip, cfg){
  const W = Math.max(320, host.clientWidth);
  const H = cfg.height || 260;
  const M = {t:14, r:cfg.padRight||14, b:28, l:cfg.padLeft||62};
  host.querySelectorAll("svg").forEach(n=>n.remove());
  const svg = svgEl("svg",{viewBox:`0 0 ${W} ${H}`, height:H, role:"img","aria-label":cfg.label||""});

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

  const gridC = css("--grid"), ink3 = css("--ink-3"), lineC = css("--line");

  const scaleRef = Math.max(Math.abs(yMin), Math.abs(yMax));
  ticks.forEach(t => {
    svg.appendChild(svgEl("line",{x1:M.l,x2:W-M.r,y1:Y(t),y2:Y(t),stroke:Math.abs(t)<1e-9?lineC:gridC,"stroke-width":Math.abs(t)<1e-9?1.2:1}));
    const lb = svgEl("text",{x:M.l-9,y:Y(t)+4,"text-anchor":"end",fill:ink3,"font-size":"11","font-family":'"IBM Plex Mono",monospace'});
    lb.textContent = cfg.fmtAxis(t, scaleRef);
    svg.appendChild(lb);
  });

  const every = n>26 ? 5 : n>14 ? 2 : 1;
  cfg.x.forEach((lab,i) => {
    if(i % every !== 0 && i !== n-1) return;
    const tx = svgEl("text",{x:X(i), y:H-8, "text-anchor":"middle", fill:ink3, "font-size":"11","font-family":'"IBM Plex Mono",monospace'});
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
      const c = v>=0 ? css("--pos") : css("--neg");
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
      plot.appendChild(svgEl("circle",{cx:last[0],cy:last[1],r:4.5,fill:col,stroke:css("--raised"),"stroke-width":2}));
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
      "text-anchor":atRight?"end":"start", fill:ink3, "font-size":"10",
      "font-family":'"Public Sans",sans-serif', opacity:.85});
    lb.textContent = ms.text;
    svg.appendChild(lb);
  });

  if(cfg.mark){
    const mx = X(cfg.mark.i);
    svg.appendChild(svgEl("line",{x1:mx, x2:mx, y1:M.t, y2:M.t+ih,
      stroke:ink3, "stroke-width":1, "stroke-dasharray":"2 4"}));
    const atRight = cfg.mark.i > n*0.6;
    const lab = svgEl("text",{x:mx + (atRight?-8:8), y:M.t+10,
      "text-anchor":atRight?"end":"start", fill:ink3, "font-size":"11.5",
      "font-family":'"Public Sans",sans-serif'});
    lab.textContent = cfg.mark.text;
    svg.appendChild(lab);
  }

  const focus = svgEl("g",{opacity:"0"});
  const vline = svgEl("line",{y1:M.t,y2:M.t+ih,stroke:css("--ink-3"),"stroke-width":1,"stroke-dasharray":"3 3"});
  focus.appendChild(vline);
  const knobs = cfg.series.map(s => {
    const c = svgEl("circle",{r:5,fill:css(s.color||"--c1"),stroke:css("--raised"),"stroke-width":2});
    focus.appendChild(c); return c;
  });
  svg.appendChild(focus);

  const hit = svgEl("rect",{x:M.l,y:M.t,width:iw,height:ih,fill:"transparent"});
  svg.appendChild(hit);
  host.appendChild(svg);

  const move = ev => {
    const box = svg.getBoundingClientRect();
    const px = (ev.clientX - box.left) * (W/box.width);
    let i = cfg.band
      ? Math.floor((px - M.l)/(iw/n))
      : Math.round((px - M.l)/(iw/Math.max(1,n-1)));
    i = Math.max(0, Math.min(n-1, i));
    focus.setAttribute("opacity","1");
    vline.setAttribute("x1",X(i)); vline.setAttribute("x2",X(i));
    knobs.forEach((c,si) => {
      const v = cfg.series[si].values[i];
      if(v===null||!isFinite(v)||cfg.band||v<yMin||v>yMax){ c.setAttribute("opacity","0"); return; }
      c.setAttribute("opacity","1"); c.setAttribute("cx",X(i)); c.setAttribute("cy",Y(v));
    });
    tip.innerHTML = cfg.tip(i);
    tip.classList.add("on");
    const tw = tip.offsetWidth, hw = host.clientWidth;
    const cx = X(i)*(hw/W);
    tip.style.left = Math.max(4, Math.min(hw-tw-4, cx - tw/2)) + "px";
    tip.style.top = "6px";
  };
  svg.addEventListener("mousemove", move);
  svg.addEventListener("mouseleave", () => { focus.setAttribute("opacity","0"); tip.classList.remove("on"); });
}

/* ---------- render ---------- */
let R = null;
let echelleTri = "lisible";   // « lisible » borne le bas du graphe, « complete » montre tout
try{
  const e = localStorage.getItem("rentaloc.echelle");
  if(e === "lisible" || e === "complete") echelleTri = e;
}catch(e){}

function tipRow(color, label, value){
  return `<div class="tr"><span class="tl"><i class="dot" style="background:${color}"></i>${label}</span><span class="tv">${value}</span></div>`;
}

function render(){
  // Tant que la case est cochée, prix, loyers et charges recopient l'inflation
  // et disparaissent du panneau : trois champs de moins à régler.
  syncRegime();
  const suit = $("prixSuitInflation").checked;
  ["fIndexPrix","fIndexLoyer","fIndexCharges"].forEach(id => { $(id).hidden = suit; });
  if(suit){
    const v = $("inflation").value;
    $("indexPrix").value = v;
    $("indexLoyer").value = v;
    $("indexCharges").value = v;
  }

  const p = read();
  R = compute(p);
  const {rows, best, final} = R;
  // Point mort : première année où revendre cesse de laisser une perte.
  const mort = rows.findIndex(r => r.gainImmo >= 0);

  const triF = final.tri;
  const heroEl = $("heroTri");
  heroEl.textContent = triF===null ? "—" : sPct(triF);
  heroEl.classList.toggle("bad", triF!==null && triF<0);

  const triReel = final.triReel;
  $("heroReel").innerHTML = triF===null ? ""
    : `<b class="${triReel<0?"bad":""}">${sPct(triReel)}</b> par an en pouvoir d'achat, une fois retirés ${pct(p.inflation/100)} d'inflation. ` +
      (triReel < 0
        ? `Votre capital progresse en euros, mais recule en pouvoir d'achat.`
        : `Votre gain de ${eur.format(final.gain)} vaut ${eur.format(final.gain/Math.pow(1+p.inflation/100, p.horizon))} en euros d'aujourd'hui.`);

  $("heroSub").innerHTML = triF===null
    ? `Renseignez un apport ou des frais payés comptant pour calculer un rendement sur fonds propres.`
    : `Sur <b>${p.horizon} ans</b>, vous sortez <b>${eur.format(final.mise)}</b> de votre poche, apport et effort d'épargne compris. Vous en récupérez <b>${eur.format(final.gain + final.mise)}</b> en revendant à cette date — soit un gain net de <b>${sEur(final.gain)}</b>.`;

  // Les taux de placement sont réels ; on les convertit en nominal pour les hints
  // et pour la ligne de référence du graphique, qui trace un TRI nominal.
  const enNominal = r => (1 + r/100)*(1 + p.inflation/100) - 1;
  const bourseReelle = p.bourse/100;
  const bourse = enNominal(p.bourse);
  $("hLivret").textContent = `soit ${pct(enNominal(p.livretA))} en euros courants`;
  $("hFonds").textContent = `soit ${pct(enNominal(p.fondsEuros))} en euros courants`;
  $("hBourse").textContent = `soit ${pct(bourse)} en euros courants`;

  const pill = $("benchPill");
  if(triF===null){ pill.textContent="n/a"; pill.className="pill flat"; $("benchText").textContent=""; }
  else {
    const d = triReel - bourseReelle;
    pill.textContent = (d>=0?"+":"−") + Math.abs(d*100).toFixed(1).replace(".",",") + " pts";
    pill.className = "pill " + (Math.abs(d)<0.002 ? "flat" : d>0 ? "win" : "lose");
    $("benchText").innerHTML = d>0
      ? `de mieux qu'une bourse à ${pct(bourseReelle)} par an hors inflation.`
      : Math.abs(d)<0.002 ? `— équivalent à une bourse à ${pct(bourseReelle)} par an hors inflation.`
      : `de moins qu'une bourse à ${pct(bourseReelle)} par an hors inflation.`;
  }

  if(best){
    $("bestYear").textContent = "Année " + best.y;
    $("bestText").textContent = best.y === p.horizon
      ? "Le rendement progresse encore à la fin de la période analysée : allongez l'horizon pour voir s'il finit par plafonner."
      : `Au-delà, le rendement annualisé décroît : les abattements de plus-value ne compensent plus la fin de l'effet de levier.`;
    $("bestList").innerHTML =
      `<dt>Rendement annualisé</dt><dd>${sPct(best.tri)}</dd>` +
      `<dt>En pouvoir d'achat</dt><dd>${sPct(best.triReel)}</dd>` +
      `<dt>Prix de revente estimé</dt><dd>${eur.format(best.valeur)}</dd>` +
      `<dt>Net récupéré à la vente</dt><dd>${eur.format(best.netVente)}</dd>` +
      `<dt>Gain net total</dt><dd>${sEur(best.gain)}</dd>`;
  } else {
    $("bestYear").textContent = "—"; $("bestText").textContent = ""; $("bestList").innerHTML = "";
  }

  // Récapitulatif des travaux et de ce qu'il en reste à l'horizon.
  const residuFin = residuTravaux(items, p.horizon);
  const deductible = items.reduce((s, it) => s + it.montant*(it.deduc/100), 0);
  $("tvxTotal").textContent = eur.format(p.travaux);
  $("tvxResid").textContent = eur.format(residuFin);
  $("tvxDeduc").textContent = eur.format(deductible);
  $("tvxCap").textContent = items.length === 0
    ? "Aucun poste : le bien est acheté en l'état."
    : p.travaux === 0
      ? "Renseignez un montant pour que ces postes pèsent sur le calcul."
      : residuFin < 1
        ? `Après ${p.horizon} ans, vos travaux n'ajoutent plus rien à la valeur du bien.`
        : `Après ${p.horizon} ans, il reste ${pct(residuFin/p.travaux)} de la valeur apportée par les travaux.`;

  // Récapitulatif du financement, affiché sous le champ « apport ».
  $("dCout").textContent = eur.format(R.besoin);
  $("dApport").textContent = "− " + eur.format(R.cash0);
  $("dEmprunt").textContent = eur.format(R.emprunt);
  const postes = [["le prix", p.prix], ["les frais de notaire", R.notaire], ["les travaux", p.travaux],
    ["les frais d'agence", p.fraisAcq], ["le mobilier", p.mobilier], ["les frais de dossier", p.fraisDossier]]
    .filter(x => x[1] > 0).map(x => x[0]);
  $("dCap").textContent = R.emprunt > 0
    ? "Coût total = " + postes.join(", ") + "."
    : "Votre apport couvre la totalité : achat comptant, aucun emprunt.";

  const cf = R.cfMensuel1;
  const r1 = rows[0];
  const couverture = r1.annuite > 0 ? r1.loyers/r1.annuite : null;
  const impotsLoyers = rows.reduce((s,x) => s + x.impot, 0);
  const impotsTotal = impotsLoyers + final.impotPV + final.repriseDF;

  $("tiles").innerHTML = [
    ["Rentabilité brute", pct(R.brute),
      "Loyers annuels ÷ coût total. C'est le chiffre affiché dans les annonces.", ""],
    ["Rentabilité nette-nette", pct(R.netteNette),
      r1.impot < -0.5
        ? `Après charges et impôt, année 1. La déduction des travaux crée une économie d'impôt, d'où un chiffre supérieur aux ${pct(R.nette)} d'avant impôt.`
        : Math.abs(R.nette - R.netteNette) < 0.0005
          ? "Après charges et impôt, année 1. La fiscalité ne coûte rien cette année-là."
          : `Après charges et impôt, année 1. Avant impôt : ${pct(R.nette)}.`, ""],
    ["Cash-flow mensuel", (cf>=0?"+":"−")+eur.format(Math.abs(cf)),
      cf>=0 ? "Le bien s'autofinance dès la première année" : "Ce que le bien vous réclame chaque mois, année 1",
      cf>=0?"pos":"neg"],
    ["Le loyer couvre", couverture===null ? "—" : pct(couverture),
      couverture===null ? "Aucun crédit : rien à couvrir."
        : "de la mensualité de crédit. Les charges et la fiscalité viennent en plus.", ""],
    ["Point mort", mort===-1 ? "jamais" : mort===0 ? "immédiat" : "Année "+rows[mort].y,
      mort===-1 ? `Sur ${p.horizon} ans, revendre reste perdant à chaque date.`
        : mort===0 ? "L'opération est gagnante dès la première année."
        : "Avant cette date, revendre laisse une perte : les frais d'acquisition ne sont pas amortis.", ""],
    ["Impôts sur "+p.horizon+" ans",
      impotsTotal>=0 ? eur.format(impotsTotal) : "+"+eur.format(-impotsTotal),
      impotsTotal < 0
        ? "Les économies d'impôt dépassent ce que vous versez."
        : Math.abs(impotsLoyers) < 1
          ? "Entièrement dû à la revente : l'impôt sur les loyers est nul."
          : impotsLoyers < 0
            ? `La revente coûte ${eur.format(final.impotPV)} ; les loyers vous font économiser ${eur.format(-impotsLoyers)}.`
            : `${eur.format(impotsLoyers)} sur les loyers, ${eur.format(final.impotPV)} sur la plus-value.`,
      impotsTotal>=0 ? "" : "pos"]
  ].map(([k,v,nn,cl]) => `<div class="tile"><span class="k">${k}</span><span class="v ${cl} num">${v}</span><span class="n">${nn}</span></div>`).join("");

  $("dMens").textContent = eur.format(R.mensualite);
  $("dCout2").textContent = eur.format(R.coutCredit);
  $("dCap2").textContent = R.emprunt > 0
    ? `Intérêts et assurance versés sur les ${p.duree} ans du prêt, soit ${pct(R.coutCredit/R.emprunt)} du capital emprunté.`
    : "Aucun crédit.";

  const xs = rows.map(r=>String(r.y));

  // Seuils de la fiscalité des plus-values, qui créent de vraies ruptures de pente.
  const jalons = [
    {y:6,  text:"seuil 5 ans"},
    {y:22, text:"exonéré IR"},
    {y:30, text:"exonéré PS"}
  ].filter(j => j.y <= p.horizon).map(j => ({i:j.y-1, text:j.text}));
  if(p.regime === "reel-foncier" && p.horizon >= 4 && rows.some(r => r.repriseDF > 0.5)){
    jalons.unshift({i:3, text:"fin de reprise"});
  }

  // Les toutes premières années sont massivement négatives (frais d'acquisition non
  // amortis). En « zone lisible » on plafonne le bas du graphe sans jamais masquer
  // une année à partir de la 5e ; en « échelle complète » on montre tout.
  const late = rows.slice(4).map(r=>r.tri).filter(v => v!==null);
  const floor = echelleTri === "complete"
    ? undefined
    : (late.length ? Math.min(-0.30, Math.min.apply(null, late)) : -0.30);
  const hidden = floor === undefined ? 0 : rows.filter(r => r.tri !== null && r.tri < floor).length;
  const pire = rows.reduce((m,r) => r.tri !== null && r.tri < m ? r.tri : m, 0);
  $("triNote").textContent = echelleTri === "complete"
    ? (pire < -0.30
        ? `Échelle complète : l'année 1 descend à ${sPct(pire)}, ce qui écrase la zone où se joue la décision. Revenez sur « zone lisible » pour détailler les rendements courants.`
        : "")
    : hidden === 0 ? ""
      : hidden === 1
        ? "La première année sort de l'échelle : revendre immédiatement ne laisse pas le temps d'amortir les frais d'acquisition. Basculez sur « échelle complète » pour la voir."
        : `Les ${hidden} premières années sortent de l'échelle : revendre aussi tôt ne laisse pas le temps d'amortir les frais d'acquisition. Basculez sur « échelle complète » pour les voir.`;

  drawChart($("plotTri"), $("tipTri"), {
    x: xs, height: 270, label:"Rendement annualisé selon l'année de revente",
    fmtAxis: v => (v*100).toFixed(0)+" %",
    zero:true, floor, milestones: jalons,
    series: [
      {color:"--c1", values: rows.map(r=>r.tri), fill:true},
      {color:"--c3", values: rows.map(()=>bourse), dash:true}
    ],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Revente année ${r.y}</div>` +
        tipRow(css("--c1"),"Rendement du projet", r.tri===null?"—":sPct(r.tri)) +
        tipRow("transparent","dont pouvoir d'achat", r.triReel===null?"—":sPct(r.triReel)) +
        tipRow(css("--c3"),"Référence boursière", pct(bourse)) +
        tipRow("transparent","Gain net cumulé", sEur(r.gain));
    }
  });

  const phraseMort = mort === -1
    ? `Sur ${p.horizon} ans, l'opération ne repasse jamais dans le vert : revendre reste perdant à chaque date.`
    : mort === 0
      ? `L'opération est bénéficiaire dès la première année.`
      : `Il faut attendre l'année ${rows[mort].y} pour que l'opération cesse d'être en perte : avant, la revente ne couvre pas les frais d'acquisition.`;

  // Où se situe l'immobilier face aux trois placements, à l'horizon retenu.
  const liste = n => n.length === 1 ? n[0] : n.slice(0,-1).join(", ") + " et " + n[n.length-1];
  const rivaux = [
    {nom:"le Livret A", v:final.gainLivret},
    {nom:"le fonds euros", v:final.gainFonds},
    {nom:"la bourse", v:final.gainBourse}
  ];
  const bat = rivaux.filter(r => final.gainImmo >= r.v).map(r => r.nom);
  const perd = rivaux.filter(r => final.gainImmo < r.v);
  const phraseRang = bat.length === 3
    ? ` À ${p.horizon} ans, il devance les trois placements comparés.`
    : perd.length === 3
      ? ` À ${p.horizon} ans, les trois placements comparés font mieux, à commencer par ${perd[perd.length-1].nom} qui finit ${eur.format(perd[perd.length-1].v - final.gainImmo)} devant.`
      : ` À ${p.horizon} ans, il devance ${liste(bat)} mais reste derrière ${liste(perd.map(r=>r.nom))}.`;
  $("netNote").textContent = phraseMort + phraseRang;

  drawChart($("plotNet"), $("tipNet"), {
    x: xs, height: 270, padLeft: 78, label:"Gain net immobilier comparé à un placement boursier",
    fmtAxis: (v,ref) => ref>=10000 ? eur1.format(v/1000)+" k€" : eur1.format(v)+" €",
    zero:true,
    mark: (mort > 0) ? {i:mort, text:`point mort · année ${rows[mort].y}`} : null,
    milestones: jalons,
    // Pas d'aire ici : quatre courbes se croisent, des remplissages superposés
    // rendraient les zones d'intersection illisibles. Les trois placements
    // forment une rampe ordonnée du plus risqué au plus sûr, doublée d'un
    // motif de trait distinct : l'identité ne repose jamais sur la seule couleur.
    series: [
      {color:"--c2", values: rows.map(r=>r.gainImmo), width:2.4},
      {color:"--c3", values: rows.map(r=>r.gainBourse)},
      {color:"--c5", values: rows.map(r=>r.gainFonds), dash:"7 4"},
      {color:"--c6", values: rows.map(r=>r.gainLivret), dash:"2 3"}
    ],
    tip: i => {
      const r = rows[i];
      const meilleur = Math.max(r.gainBourse, r.gainFonds, r.gainLivret);
      return `<div class="th">Revente fin d'année ${r.y}</div>` +
        tipRow(css("--c2"),"Immobilier", sEur(r.gainImmo)) +
        tipRow(css("--c3"),"Bourse", sEur(r.gainBourse)) +
        tipRow(css("--c5"),"Fonds euros", sEur(r.gainFonds)) +
        tipRow(css("--c6"),"Livret A", sEur(r.gainLivret)) +
        `<div class="tr" style="margin-top:7px;padding-top:6px;border-top:1px solid var(--line-soft)">` +
        `<span class="tl">${r.gainImmo>=meilleur?"Avance sur le meilleur placement":"Retard sur le meilleur placement"}</span>` +
        `<span class="tv">${eur.format(Math.abs(r.gainImmo-meilleur))}</span></div>` +
        tipRow("transparent","sorti de votre poche", eur.format(r.mise)) +
        tipRow("transparent","net de la revente", eur.format(r.netVente));
    }
  });

  drawChart($("plotCf"), $("tipCf"), {
    x: xs, height: 200, padLeft: 78, band:true, zero:true, label:"Trésorerie annuelle après impôt",
    fmtAxis: (v,ref) => ref>=10000 ? eur1.format(v/1000)+" k€" : eur1.format(v)+" €",
    series: [{color:"--c1", values: rows.map(r=>r.cfNet)}],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Année ${r.y}</div>` +
        tipRow(r.cfNet>=0?css("--pos"):css("--neg"),"Trésorerie nette", sEur(r.cfNet)) +
        tipRow("transparent","Loyers encaissés", eur.format(r.loyers)) +
        tipRow("transparent","Charges", cost(r.charges)) +
        tipRow("transparent","Mensualités", cost(r.annuite)) +
        tipRow("transparent","Impôt", cost(r.impot));
    }
  });

  const cols = ["Année","Loyers","Charges","Intérêts","Mensualités","Impôt","Trésorerie","Trésorerie cumulée","Valeur du bien","Capital dû","Impôt plus-value","Net si revente","Rendement annualisé"];
  $("tbl").tHead.innerHTML = "<tr>"+cols.map(c=>`<th>${c}</th>`).join("")+"</tr>";
  $("tbl").tBodies[0].innerHTML = rows.map(r => {
    const cls = best && r.y===best.y ? ' class="peak"' : "";
    return `<tr${cls}><td>Année ${r.y}</td>`+[
      eur.format(r.loyers), cost(r.charges), cost(r.interets), cost(r.annuite), cost(r.impot)
    ].map(v=>`<td>${v}</td>`).join("")
    + `<td class="${r.cfNet>=0?"pos":"neg"}">${sEur(r.cfNet)}</td>`
    + `<td class="${r.cumulCF>=0?"pos":"neg"}">${sEur(r.cumulCF)}</td>`
    + `<td>${eur.format(r.valeur)}</td><td>${eur.format(r.crd)}</td><td>${cost(r.impotPV)}</td><td>${eur.format(r.netVente)}</td>`
    + `<td class="${r.tri!==null&&r.tri>=0?"pos":"neg"}">${r.tri===null?"—":sPct(r.tri)}</td></tr>`;
  }).join("");

  const warns = [];
  if(p.regime==="micro-foncier" && rows[0].loyers>15000)
    warns.push("Vos loyers dépassent 15 000 € par an : le micro-foncier n'est pas accessible, le régime réel s'applique d'office.");
  if(R.cash0 < 1)
    warns.push("Sans apport ni frais payés comptant, le rendement sur fonds propres n'a pas de sens mathématique. Ajoutez au moins les frais de dossier.");
  if(p.duree > 0 && R.emprunt > 0 && p.horizon < p.duree)
    warns.push(`Votre horizon (${p.horizon} ans) est plus court que le prêt (${p.duree} ans) : chaque revente simulée solde le capital restant dû.`);
  $("warnBox").innerHTML = warns.map(w=>`<div class="warn">${w}</div>`).join("");

  save();
}

/* ---------- persistence & chrome ---------- */
const STORE = "rentaloc.v2";
// v1 enregistrait les taux de placement en nominal ; ils sont désormais saisis
// hors inflation. Les relire tels quels donnerait une bourse à 7 % réels, soit
// plus de 9 % nominal. On reprend donc les nouvelles valeurs par défaut pour ces
// trois champs, et on conserve tout le reste.
const TAUX_REDEFINIS = ["bourse","fondsEuros","livretA"];

function save(){
  try{
    const o = {v:2, ira:$("ira").checked, prixSuitInflation:$("prixSuitInflation").checked, items};
    FIELDS.concat(SELECTS).forEach(k => o[k] = $(k).value);
    localStorage.setItem(STORE, JSON.stringify(o));
  }catch(e){}
}
function load(){
  try{
    let raw = localStorage.getItem(STORE), migre = false;
    if(!raw){
      raw = localStorage.getItem("rentaloc.v1");
      if(!raw) return;
      migre = true;
    }
    const o = JSON.parse(raw);
    if(migre || o.v !== 2){
      TAUX_REDEFINIS.forEach(k => delete o[k]);
      try{ localStorage.removeItem("rentaloc.v1"); }catch(e){}
    }
    FIELDS.concat(SELECTS).forEach(k => { if(o[k]!==undefined && $(k)) $(k).value = o[k]; });
    if(typeof o.ira === "boolean") $("ira").checked = o.ira;
    if(typeof o.prixSuitInflation === "boolean") $("prixSuitInflation").checked = o.prixSuitInflation;
    if(o.items !== undefined) items = assainir(o.items);
  }catch(e){}
}
function toast(msg){
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  setTimeout(()=>t.classList.remove("on"), 2200);
}

// Le meublé subit la CSG à 10,6 %, le nu reste à 9,2 % : le taux suit le régime.
const PS_LOYERS = {"micro-foncier":"17.2", "reel-foncier":"17.2", "lmnp-micro":"18.6", "lmnp-reel":"18.6"};
// La CFE relève d'une activité BIC : elle ne concerne pas la location nue.
const CFE_DEFAUT = {"micro-foncier":"0", "reel-foncier":"0", "lmnp-micro":"400", "lmnp-reel":"400"};
const ABATT_DEFAUT = {"micro-foncier":"30", "lmnp-micro":"50"};

// Chaque régime n'expose que les réglages qui le concernent : afficher un plafond
// de déficit foncier à quelqu'un qui a choisi le micro-BIC n'a aucun sens.
const CHAMPS_REGIME = {
  "micro-foncier": ["fAbattement"],
  "reel-foncier":  ["fPlafondDeficit"],
  "lmnp-micro":    ["fAbattement", "fCfe"],
  "lmnp-reel":     ["fCfe", "fPartBati", "fAmortBati", "fAmortTvx", "fAmortMob"]
};
const TOUS_CHAMPS_REGIME = [...new Set(Object.values(CHAMPS_REGIME).flat())];
function syncRegime(){
  const visibles = CHAMPS_REGIME[$("regime").value] || [];
  TOUS_CHAMPS_REGIME.forEach(id => { $(id).hidden = !visibles.includes(id); });
}
FIELDS.concat(SELECTS).forEach(k => {
  if(k === "regime") return;
  $(k).addEventListener("input", render);
  $(k).addEventListener("change", render);
});
$("regime").addEventListener("change", () => {
  const rg = $("regime").value;
  $("ps").value = PS_LOYERS[rg] || "17.2";
  $("cfe").value = CFE_DEFAUT[rg] || "0";
  if(ABATT_DEFAUT[rg]) $("abattement").value = ABATT_DEFAUT[rg];
  render();
});
$("prixSuitInflation").addEventListener("change", render);
$("ira").addEventListener("change", render);

// Les champs des postes sont délégués : on met à jour le modèle sans reconstruire
// la liste, sinon la saisie perdrait le focus à chaque frappe.
$("tvxList").addEventListener("input", e => {
  const el = e.target, i = parseInt(el.dataset.i, 10), f = el.dataset.f;
  if(!f || !(i >= 0) || !items[i]) return;
  items[i][f] = f === "nom" ? el.value : (parseFloat(el.value) || 0);
  render();
});
$("tvxList").addEventListener("click", e => {
  const b = e.target.closest(".del");
  if(!b) return;
  items.splice(parseInt(b.dataset.i, 10), 1);
  renderItems(); render();
});
function setEchelle(v){
  echelleTri = v;
  $("echLisible").setAttribute("aria-pressed", v === "lisible" ? "true" : "false");
  $("echComplete").setAttribute("aria-pressed", v === "complete" ? "true" : "false");
  try{ localStorage.setItem("rentaloc.echelle", v); }catch(e){}
  render();
}
$("echLisible").addEventListener("click", () => setEchelle("lisible"));
$("echComplete").addEventListener("click", () => setEchelle("complete"));

$("tvxAdd").addEventListener("click", () => {
  items.push({nom:"Nouveau poste", montant:5000, taux:5, duree:20, deduc:100});
  renderItems(); render();
  const noms = $("tvxList").querySelectorAll(".tvxhead input");
  const last = noms[noms.length-1];
  if(last){ last.focus(); last.select(); }
});

$("reset").addEventListener("click", () => {
  Object.keys(DEFAULTS).forEach(k => {
    if(typeof DEFAULTS[k] === "boolean") $(k).checked = DEFAULTS[k];
    else $(k).value = DEFAULTS[k];
  });
  items = TVX_DEFAUT.map(o => ({...o}));
  renderItems(); render(); toast("Hypothèses réinitialisées");
});

$("copy").addEventListener("click", async () => {
  if(!R) return;
  const head = ["Annee","Loyers","Charges","Interets","Mensualites","Impot","Tresorerie","Tresorerie cumulee","Valeur","Capital du","Impot plus-value","Net si revente","Rendement annualise"];
  const lines = [head.join(";")].concat(R.rows.map(r => [
    r.y, r.loyers, r.charges, r.interets, r.annuite, r.impot, r.cfNet, r.cumulCF,
    r.valeur, r.crd, r.impotPV, r.netVente, r.tri===null?"":(r.tri*100)
  ].map(v => typeof v==="number" ? v.toFixed(2).replace(".",",") : v).join(";")));
  try{ await navigator.clipboard.writeText(lines.join("\n")); toast("Tableau copié — collez-le dans un tableur"); }
  catch(e){ toast("Copie impossible dans ce contexte"); }
});

// L'interrupteur reflète le thème réellement affiché, y compris quand aucun choix
// n'a été fait et que c'est le système qui décide.
function estSombre(){
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function syncTheme(){
  const nuit = estSombre();
  $("theme").setAttribute("aria-checked", nuit ? "true" : "false");
  $("theme").setAttribute("aria-label", nuit ? "Mode nuit activé" : "Mode jour activé");
}
$("theme").addEventListener("click", () => {
  const suivant = estSombre() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", suivant);
  try{ localStorage.setItem("rentaloc.theme", suivant); }catch(e){}
  syncTheme();
  render();
});
try{
  const t = localStorage.getItem("rentaloc.theme");
  if(t) document.documentElement.setAttribute("data-theme", t);
}catch(e){}

let rid;
addEventListener("resize", () => { clearTimeout(rid); rid = setTimeout(render, 140); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { syncTheme(); render(); });

load();
renderItems();
syncTheme();
$("echLisible").setAttribute("aria-pressed", echelleTri === "lisible" ? "true" : "false");
$("echComplete").setAttribute("aria-pressed", echelleTri === "complete" ? "true" : "false");
render();
