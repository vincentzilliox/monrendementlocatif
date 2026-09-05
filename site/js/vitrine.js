"use strict";
/* ═════════ modèle et dessin — bloc partagé avec la vitrine ═════════
   Tout ce qui calcule ou dessine, et rien qui touche au formulaire :
   build.py en fait aussi js/vitrine.js, le script de la page d'accueil.
   Ne rien ajouter ici qui lise le DOM de la calculatrice.
   ══════════════════════════════════════════════════════════════════ */

"use strict";
const $ = id => document.getElementById(id);
const eur = new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0});
const eur1 = new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const pct = v => (v<0?"−":"") + Math.abs(v*100).toFixed(1).replace(".",",")+" %";
const sPct = v => (v>=0?"+":"−") + Math.abs(v*100).toFixed(1).replace(".",",")+" %";
const sEur = v => Math.abs(v)<0.5 ? eur.format(0) : (v>0?"+":"−")+eur.format(Math.abs(v));
/* un coût : positif = sortie d'argent, affichée en négatif */
const cost = v => Math.abs(v)<0.5 ? eur.format(0) : (v>0?"−":"+")+eur.format(Math.abs(v));

/* ---------- postes de travaux ---------- */
const TVX_DEFAUT = [{nom:"Rénovation", montant:20000, taux:5, duree:20, deduc:100}];

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

// Réglages propres à chaque régime, partagés par le formulaire et le comparatif.
// Le meublé subit la CSG à 10,6 %, le nu reste à 9,2 % : le taux suit le régime.
const PS_LOYERS = {"micro-foncier":"17.2", "reel-foncier":"17.2", "lmnp-micro":"18.6", "lmnp-reel":"18.6"};
// La CFE relève d'une activité BIC : elle ne concerne pas la location nue.
const CFE_DEFAUT = {"micro-foncier":"0", "reel-foncier":"0", "lmnp-micro":"400", "lmnp-reel":"400"};
// Le mobilier ne concerne que le meublé : repasser en nu remet le champ à zéro.
const MOBILIER_DEFAUT = {"micro-foncier":"0", "reel-foncier":"0"};
const ABATT_DEFAUT = {"micro-foncier":"30", "lmnp-micro":"50"};

function compute(p){
  const notaire = p.prix * p.notairePct/100;
  // Meublé ou nu : ce qui ne concerne pas le régime choisi est masqué à l'écran,
  // donc neutralisé ici. Un champ masqué ne doit jamais peser sur le résultat.
  const meuble = p.regime === "lmnp-micro" || p.regime === "lmnp-reel";
  const mobilier = meuble ? p.mobilier : 0;
  const besoin = p.prix + notaire + p.travaux + p.fraisAcq + mobilier + p.fraisDossier;
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
  const amortMob = surAns(mobilier, p.amortMobAns);
  // La CFE relève du BIC : elle ne concerne pas la location nue.
  const cfeApplicable = meuble;

  // Déficits fonciers reportables : chaque millésime expire au bout de 10 ans.
  // Imputations sur le revenu global : reprises si le bien est vendu avant le
  // 31 décembre de la 3e année qui suit.
  let deficits = [], imputations = [];
  // LMNP au réel : un déficit hors amortissement (charges et intérêts supérieurs
  // aux loyers) se reporte dix ans sur les BIC non professionnels ; il s'impute
  // avant l'amortissement, qui lui se reporte sans limite.
  let deficitsBIC = [];
  // Deux stocks d'amortissement : le bâti et les travaux sont réintégrés dans
  // la plus-value depuis la loi de finances 2025, confirmée en 2026 ; le mobilier
  // non — il n'entre
  // pas dans la cession immobilière.
  let stockImm = 0, stockMob = 0, amortCumul = 0, amortReintegre = 0;
  // Comparaison à mise de fonds identique. Les deux scénarios partent du même
  // apport et exigent exactement les mêmes versements : chaque euro d'effort
  // d'épargne que le bien réclame est, côté bourse, investi au taux de référence.
  // Symétriquement, chaque euro de trésorerie dégagé par le bien est replacé au
  // même taux. Les deux courbes sont donc bien deux capitaux comparables — et,
  // comme le bien, ils sont pris nets de l'impôt dû sur leurs gains à la sortie.
  let cumulCF=0, cumulLoyers=0, cumulCharges=0, cumulCredit=0, cumulImpot=0;
  let portefeuille=cash0, potImmo=0, surplusCumul=0;
  let pFonds = cash0, pLivret = cash0;   // mêmes versements, placés ailleurs
  let miseTotale = cash0; // apport, puis chaque euro d'effort d'épargne versé ensuite
  const efforts = [];
  const rows=[], cfHist=[];
  // Les taux de placement sont saisis hors inflation ; on les repasse en nominal
  // pour capitaliser dans la même monnaie que les flux du bien.
  const nominal = r => (1 + r/100)*(1 + p.inflation/100) - 1;
  const bourse = nominal(p.bourse), rFonds = nominal(p.fondsEuros), rLivret = nominal(p.livretA);
  const part = v => Math.max(0, Math.min(1, (Number(v) || 0)/100));
  const fiscB = part(p.fiscBourse), fiscF = part(p.fiscFonds);
  // Capital net de l'impôt sur le gain, le gain étant ce qui dépasse les versements.
  const netDe = (capital, verse, fisc) => capital - Math.max(0, capital - verse)*fisc;

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
      const dotImm = (y<=p.amortBatiAns?amortBati:0) + (y<=p.amortTvxAns?amortTvx:0);
      const dotMob = y<=p.amortMobAns ? amortMob : 0;
      amortAn = dotImm + dotMob;
      let base = loyers - charges - fraisEmprunt;
      deficitsBIC = deficitsBIC.filter(d => y - d.y <= 10);
      if(base < 0){
        deficitsBIC.push({y, amt:-base});
        base = 0;
      } else {
        deficitsBIC.forEach(d => { const u = Math.min(d.amt, base); d.amt -= u; base -= u; });
        deficitsBIC = deficitsBIC.filter(d => d.amt > 0.01);
      }
      const dispoImm = dotImm + stockImm, dispoMob = dotMob + stockMob, dispo = dispoImm + dispoMob;
      const used = Math.min(dispo, base);
      const usedImm = dispo > 0 ? used*dispoImm/dispo : 0;
      stockImm = dispoImm - usedImm;
      stockMob = dispoMob - (used - usedImm);
      amortCumul += used;
      amortReintegre += usedImm;
      impot = (base - used)*tauxImpot;
    }

    const cfAvant = loyers - charges - annuite;
    const cfNet = cfAvant - impot;
    cumulCF += cfNet;
    cumulLoyers += loyers;
    cumulCharges += charges;
    cumulCredit += fraisEmprunt;
    cumulImpot += impot;
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
    if(p.regime === "lmnp-reel") prixAcq -= amortReintegre;
    // Les frais supportés par le vendeur viennent en moins du prix de cession.
    const pvBrute = Math.max(0, valeur - fraisVente - prixAcq);
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
    surplusCumul += surplus;
    miseTotale += effort;
    efforts.push(effort);

    const portefeuilleNet = netDe(portefeuille, miseTotale, fiscB);
    const fondsNet = netDe(pFonds, miseTotale, fiscF);
    const potImmoNet = netDe(potImmo, surplusCumul, fiscB);

    const flows = [-cash0].concat(cfHist.slice(0,-1)).concat([cfNet + netVente]);
    const tri = cash0 > 1 ? irr(flows) : null;
    // Même chronique de versements, placée en bourse : le rendement annualisé
    // net d'impôt directement opposable au TRI du bien.
    const flowsBourse = [-cash0].concat(efforts.slice(0,-1).map(e => -e)).concat([portefeuilleNet - effort]);
    const triBourse = cash0 > 1 ? irr(flowsBourse) : null;
    const gain = cumulCF + netVente - cash0;

    rows.push({y, loyers, charges, interets:L.int, assurance:L.ass, principal:L.pri, annuite,
      impot, cfNet, cumulCF, valeur, crd:L.crd, fraisVente, ira, impotPV, repriseDF, netVente, tri, triBourse, gain,
      cumulLoyers, cumulCharges, cumulCredit, cumulImpot,
      patrimoine: valeur - L.crd, recupere: netVente + potImmoNet, potImmo: potImmoNet, portefeuille: portefeuilleNet,
      amortCumul, amortReintegre, mise: miseTotale, pFonds: fondsNet, pLivret,
      gainImmo: netVente + potImmoNet - miseTotale,
      gainBourse: portefeuilleNet - miseTotale,
      gainFonds: fondsNet - miseTotale,
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
    r.triBourseReel = reel(r.triBourse);
    r.gainConstant = r.gainImmo/Math.pow(1 + p.inflation/100, r.y);
  });
  return {
    p, rows, best, notaire, mobilier, besoin, emprunt, cash0, mensualite:sch.mensualite, valeur0,
    coutCredit: sch.years.reduce((s,L) => s + L.int + L.ass, 0),
    brute: p.prix > 0 ? loyerBrutAn/p.prix : 0,
    bruteCout: loyerBrutAn/besoin,
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
  const vline = svgEl("line",{y1:M.t,y2:M.t+ih,stroke:css("--ink-3"),"stroke-width":1,"stroke-dasharray":"3 3"});
  focus.appendChild(vline);
  const knobs = cfg.series.map(s => {
    const c = svgEl("circle",{r:5,fill:css(s.color||"--d1"),stroke:css("--surface"),"stroke-width":2});
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
  const svg = svgEl("svg",{viewBox:`0 0 ${W} ${H}`, height:H, role:"img","aria-label":cfg.label||""});
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
    const tv = svgEl("text",{x:X(i), y:ty, "text-anchor":"middle", fill:css(it.textColor || it.color), "font-size":"11.5", "font-weight":"600"});
    tv.textContent = it.text;
    svg.appendChild(tv);
    String(it.label).split("\n").forEach((l,k) => {
      const tl = svgEl("text",{x:X(i), y:H-M.b+15+k*13, "text-anchor":"middle", fill:it.strong?css("--text"):ink3, "font-size":"11", "font-weight":it.strong?"600":"400"});
      tl.textContent = l;
      svg.appendChild(tl);
    });
  });
  items.forEach((it,i) => {
    const hit = svgEl("rect",{x:M.l+slot*i, y:M.t, width:slot, height:ih+M.b, fill:"transparent"});
    if(cfg.onClick){ hit.classList.add("clickable"); hit.addEventListener("click", () => cfg.onClick(i)); }
    hit.addEventListener("mousemove", () => {
      tip.innerHTML = cfg.tip(i); tip.classList.add("on");
      const tw = tip.offsetWidth, hw = host.clientWidth, cx = X(i)*(hw/W);
      tip.style.left = Math.max(4, Math.min(hw-tw-4, cx - tw/2)) + "px";
      tip.style.top = "6px";
    });
    hit.addEventListener("mouseleave", () => tip.classList.remove("on"));
    svg.appendChild(hit);
  });
  host.appendChild(svg);
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
  const svg = svgEl("svg",{viewBox:`0 0 ${W} ${H}`, height:H, role:"img","aria-label":cfg.label||""});
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
  rows.forEach((r,i) => {
    const yc = M.t + rh*i + rh/2, h = rh*0.5;
    [[r.lo, down, r.loText], [r.hi, up, r.hiText]].forEach(([v, col, txt]) => {
      const x0 = X(0), x1 = X(v);
      const w = Math.abs(x1-x0);
      if(w > 0.5) svg.appendChild(svgEl("rect",{x:Math.min(x0,x1), y:yc-h/2, width:w, height:h, rx:2, fill:col}));
      const droite = v >= 0;
      const tv = svgEl("text",{x:droite ? x1+5 : x1-5, y:yc+4, "text-anchor":droite?"start":"end", fill:col, "font-size":"11", "font-weight":"600"});
      tv.textContent = txt;
      svg.appendChild(tv);
    });
    const lb = svgEl("text",{x:M.l-10, y:yc+4, "text-anchor":"end", fill:css("--text"), "font-size":"12"});
    lb.textContent = r.label;
    svg.appendChild(lb);
    const hit = svgEl("rect",{x:0, y:yc-rh/2, width:W, height:rh, fill:"transparent"});
    hit.addEventListener("mousemove", () => {
      tip.innerHTML = cfg.tip(i); tip.classList.add("on");
      const tw = tip.offsetWidth, hw = host.clientWidth;
      tip.style.left = Math.max(4, Math.min(hw-tw-4, X(0)*(hw/W) - tw/2)) + "px";
      tip.style.top = Math.max(0, (yc - rh/2 - 4)*(hw/W) - 40) + "px";
    });
    hit.addEventListener("mouseleave", () => tip.classList.remove("on"));
    svg.appendChild(hit);
  });
  host.appendChild(svg);
}

function tipRow(color, label, value){
  return `<div class="tr"><span class="tl"><i class="dot" style="background:${color}"></i>${label}</span><span class="tv">${value}</span></div>`;
}

/* ---------- comparatif des régimes ---------- */
const REGIMES = [
  ["micro-foncier", "Nu\nmicro-foncier"],
  ["reel-foncier",  "Nu\nau réel"],
  ["lmnp-micro",    "Meublé\nmicro-BIC"],
  ["lmnp-reel",     "Meublé\nLMNP au réel"]
];
// Chaque régime emporte ses réglages par défaut (prélèvements sociaux, CFE,
// abattement) ; le régime en cours garde les valeurs saisies, pour coller au verdict.
function comparerRegimes(p, courant){
  return REGIMES.map(([rg, label]) => {
    let r;
    if(rg === p.regime) r = courant;
    else {
      const q = Object.assign({}, p, {regime:rg, ps:parseFloat(PS_LOYERS[rg]), cfe:parseFloat(CFE_DEFAUT[rg])});
      if(ABATT_DEFAUT[rg]) q.abattement = parseFloat(ABATT_DEFAUT[rg]);
      r = compute(q);
    }
    const f = r.final;
    return {rg, label, tri:f.tri, triReel:f.triReel, gain:f.gain,
      impots: r.rows.reduce((s,x) => s + x.impot, 0) + f.impotPV + f.repriseDF};
  });
}

/* ---------- sensibilité ---------- */
const SENS = [
  {k:"prix",      nom:"Prix d'achat",            pas:v => v*0.10, txt:"10 %"},
  {k:"loyer",     nom:"Loyer",                   pas:v => v*0.10, txt:"10 %"},
  {k:"taux",      nom:"Taux du crédit",          pas:() => 1,     txt:"1 pt"},
  {k:"vacance",   nom:"Vacance locative",        pas:() => 5,     txt:"5 pts"},
  {k:"indexPrix", nom:"Revalorisation du bien",  pas:() => 1,     txt:"1 pt/an"},
  {k:"travaux",   nom:"Montant des travaux",     pas:v => v*0.20, txt:"20 %"}
];
function sensibilite(p, triRef){
  const essai = (s, signe) => {
    const q = Object.assign({}, p);
    if(s.k === "travaux"){
      q.items = p.items.map(it => Object.assign({}, it, {montant: it.montant*(1 + signe*0.2)}));
      q.travaux = q.items.reduce((a,it) => a + it.montant, 0);
    } else {
      const v = p[s.k] + signe*s.pas(p[s.k]);
      q[s.k] = s.k === "indexPrix" ? v : Math.max(0, v);
    }
    const t = compute(q).final.tri;
    return t === null ? null : t;
  };
  return SENS.map(s => {
    const moins = essai(s, -1), plus = essai(s, 1);
    if(moins === null || plus === null) return null;
    const dm = moins - triRef, dp = plus - triRef;
    const fav = dp >= dm ? {d:dp, tri:plus, s:"+"} : {d:dm, tri:moins, s:"−"};
    const def = dp >= dm ? {d:dm, tri:moins, s:"−"} : {d:dp, tri:plus, s:"+"};
    return {nom:s.nom, txt:s.txt, hi:fav.d, lo:def.d, fav, def,
      amplitude: Math.max(Math.abs(dp), Math.abs(dm))};
  }).filter(r => r && r.amplitude > 1e-6).sort((a,b) => b.amplitude - a.amplitude);
}
let sensTimer = null;
function planifier(fn){
  if(sensTimer !== null){ (window.cancelIdleCallback || clearTimeout)(sensTimer); }
  sensTimer = window.requestIdleCallback
    ? requestIdleCallback(() => { sensTimer = null; fn(); }, {timeout:400})
    : setTimeout(() => { sensTimer = null; fn(); }, 60);
}

const pts = v => (v>=0?"+":"−") + Math.abs(v*100).toFixed(1).replace(".",",") + " pt" + (Math.abs(v*100) >= 1.95 ? "s" : "");
const kEur = (v, ref) => ref >= 10000 ? eur1.format(v/1000)+" k€" : eur1.format(v)+" €";

/* ---------- page d'accueil ---------- */
const DEFAUTS = {
  "prix": 200000.0,
  "notairePct": 8.0,
  "fraisAcq": 0.0,
  "mobilier": 0.0,
  "apport": 35000.0,
  "duree": 20.0,
  "taux": 3.4,
  "assur": 0.34,
  "fraisDossier": 2500.0,
  "loyer": 900.0,
  "vacance": 5.0,
  "copro": 60.0,
  "tf": 1200.0,
  "pno": 180.0,
  "gestion": 0.0,
  "entretien": 5.0,
  "ps": 18.6,
  "psPV": 17.2,
  "cfe": 400.0,
  "abattement": 50.0,
  "plafondDeficit": 10700.0,
  "partBati": 85.0,
  "amortBatiAns": 30.0,
  "amortTvxAns": 15.0,
  "amortMobAns": 7.0,
  "horizon": 25.0,
  "inflation": 2.0,
  "indexPrix": 2.0,
  "indexLoyer": 2.0,
  "indexCharges": 2.0,
  "fraisVente": 5.0,
  "bourse": 4.0,
  "fondsEuros": 0.0,
  "livretA": -0.3,
  "fiscBourse": 31.4,
  "fiscFonds": 30.0,
  "regime": "lmnp-reel",
  "tmi": 30.0,
  "ira": true
};

function scenario(){
  const p = Object.assign({}, DEFAUTS);
  p.items = TVX_DEFAUT.map(o => ({...o}));
  p.travaux = p.items.reduce((s, it) => s + it.montant, 0);
  // La case « prix, loyers et charges suivent l'inflation » est cochée par défaut.
  p.indexPrix = p.indexLoyer = p.indexCharges = p.inflation;
  return p;
}

function vitrine(){
  const p = scenario(), R = compute(p), f = R.final, b = R.best;
  const g = id => document.getElementById(id);
  const ecrire = (id, txt) => { const el = g(id); if(el) el.textContent = txt; };

  ecrire("vTri", sPct(f.tri));
  ecrire("vReel", sPct(f.triReel));
  ecrire("vGain", sEur(f.gain));
  ecrire("vMise", eur.format(f.mise));
  ecrire("vBest", "Année " + b.y);
  ecrire("vBestTri", sPct(b.tri));
  ecrire("vBestNet", eur.format(b.netVente));
  ecrire("vPrix", eur.format(p.prix));
  ecrire("vApport", eur.format(p.apport));
  ecrire("vLoyer", eur.format(p.loyer));
  ecrire("vHorizon", p.horizon + " ans");
  const mort = R.rows.findIndex(r => r.gainImmo >= 0);
  ecrire("vMort", mort < 0 ? "jamais" : "année " + R.rows[mort].y);

  const ecart = f.triReel - f.triBourseReel;
  const pastille = g("vPastille");
  if(pastille){
    pastille.textContent = pts(ecart);
    pastille.className = "pill num " + (Math.abs(ecart) < 0.002 ? "flat" : ecart > 0 ? "win" : "lose");
  }
  ecrire("vBourse", sPct(f.triBourseReel));

  const xs = R.rows.map(r => String(r.y));
  drawChart(g("vPlotNet"), g("vTipNet"), {
    x: xs, height: 280, padLeft: 78, zero: true,
    label: "Gain net de l'immobilier comparé à trois placements",
    fmtAxis: kEur,
    mark: mort > 0 ? {i: mort, text: "point mort · année " + R.rows[mort].y} : null,
    series: [
      {color: "--d1", values: R.rows.map(r => r.gainImmo), width: 2.4},
      {color: "--d2", values: R.rows.map(r => r.gainBourse)},
      {color: "--d3", values: R.rows.map(r => r.gainFonds), dash: "7 4"},
      {color: "--d4", values: R.rows.map(r => r.gainLivret), dash: "2 3"}
    ],
    tip: i => {
      const r = R.rows[i];
      return `<div class="th">Revente fin d'année ${r.y}</div>` +
        tipRow(css("--d1"), "Immobilier", sEur(r.gainImmo)) +
        tipRow(css("--d2"), "Bourse", sEur(r.gainBourse)) +
        tipRow(css("--d3"), "Fonds euros", sEur(r.gainFonds)) +
        tipRow(css("--d4"), "Livret A", sEur(r.gainLivret)) +
        tipRow("transparent", "sorti de votre poche", eur.format(r.mise));
    }
  });

  const sens = sensibilite(p, f.tri);
  drawTornado(g("vPlotSens"), g("vTipSens"), {
    label: "Sensibilité du rendement annualisé",
    fmtAxis: v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v*100).toFixed(1).replace(".", ",") + " pt",
    rows: sens.map(s => ({label: s.nom, lo: s.lo, hi: s.hi, loText: pts(s.lo), hiText: pts(s.hi)})),
    tip: i => {
      const s = sens[i];
      return `<div class="th">${s.nom} · ±${s.txt}</div>` +
        tipRow(css("--up"), "Scénario favorable", sPct(s.fav.tri)) +
        tipRow(css("--down"), "Scénario défavorable", sPct(s.def.tri)) +
        tipRow("transparent", "Hypothèse retenue", sPct(f.tri));
    }
  });
  if(sens.length) ecrire("vSens", sens[0].nom.toLowerCase());
}

let vid;
addEventListener("resize", () => { clearTimeout(vid); vid = setTimeout(vitrine, 140); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => setTimeout(vitrine, 30));
document.addEventListener("theme", vitrine);
vitrine();
