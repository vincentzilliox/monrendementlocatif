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

/* ═════════ fin du bloc partagé — l'interface commence ici ═════════ */

/* ---------- formulaire ---------- */
const FIELDS = ["prix","notairePct","fraisAcq","mobilier","apport","duree","taux","assur",
  "fraisDossier","loyer","vacance","copro","tf","pno","gestion","entretien",
  "ps","psPV","cfe","abattement","plafondDeficit","partBati","amortBatiAns","amortTvxAns","amortMobAns","horizon",
  "inflation","indexPrix","indexLoyer","indexCharges","fraisVente","bourse","fondsEuros","livretA","fiscBourse","fiscFonds"];
const SELECTS = ["regime","tmi"];
const DEFAULTS = {};
FIELDS.concat(SELECTS).forEach(k => DEFAULTS[k] = $(k).value);
DEFAULTS.ira = true;
DEFAULTS.prixSuitInflation = true;

let items = TVX_DEFAUT.map(o => ({...o}));
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
        <label class="deduc">Déductible<span class="tw"><input type="number" step="5" min="0" max="100" data-i="${i}" data-f="deduc" value="${it.deduc}"><span class="u">%</span></span></label>
      </div>
    </div>`).join("");
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

/* ---------- render ---------- */
let R = null;
let echelleTri = "lisible";   // « lisible » borne le bas du graphe, « complete » montre tout
try{
  const e = localStorage.getItem("rentaloc.echelle");
  if(e === "lisible" || e === "complete") echelleTri = e;
}catch(e){}

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
  $("hLivret").textContent = `soit ${pct(enNominal(p.livretA))} en euros courants, exonéré`;
  $("hFonds").textContent = `soit ${pct(enNominal(p.fondsEuros))} en euros courants, avant impôt`;
  $("hBourse").textContent = `soit ${pct(bourse)} en euros courants, avant impôt`;

  const pill = $("benchPill");
  if(triF===null){ pill.textContent="n/a"; pill.className="pill flat"; $("benchText").textContent=""; }
  else {
    const bNet = final.triBourseReel === null ? bourseReelle : final.triBourseReel;
    const d = triReel - bNet;
    pill.textContent = pts(d);
    pill.className = "pill " + (Math.abs(d)<0.002 ? "flat" : d>0 ? "win" : "lose");
    const bourseTxt = `la bourse, qui rend ${pct(bNet)} par an hors inflation une fois l'impôt payé (${pct(bourseReelle)} avant)`;
    $("benchText").innerHTML = d>0
      ? `de mieux que ${bourseTxt}.`
      : Math.abs(d)<0.002 ? `— équivalent à ${bourseTxt}.`
      : `de moins que ${bourseTxt}.`;
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
    ["les frais d'agence", p.fraisAcq], ["le mobilier", R.mobilier], ["les frais de dossier", p.fraisDossier]]
    .filter(x => x[1] > 0).map(x => x[0]);
  $("dCap").textContent = R.emprunt > 0
    ? "Coût total = " + postes.join(", ") + "."
    : "Votre apport couvre la totalité : achat comptant, aucun emprunt.";

  const cf = R.cfMensuel1;
  const r1 = rows[0];
  const couverture = r1.annuite > 0 ? r1.loyers/r1.annuite : null;
  const impotsLoyers = rows.reduce((s,x) => s + x.impot, 0);
  const impotsTotal = impotsLoyers + final.impotPV + final.repriseDF;

  $("indicateurs").innerHTML = [
    ["Rentabilité brute", pct(R.brute),
      `Loyers annuels ÷ prix d'achat, comme dans les annonces. Sur le coût total, frais et travaux compris : ${pct(R.bruteCout)}.`, ""],
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
      {color:"--d1", values: rows.map(r=>r.tri), fill:true},
      {color:"--d2", values: rows.map(r=>r.triBourse), dash:true}
    ],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Revente année ${r.y}</div>` +
        tipRow(css("--d1"),"Rendement du projet", r.tri===null?"—":sPct(r.tri)) +
        tipRow("transparent","dont pouvoir d'achat", r.triReel===null?"—":sPct(r.triReel)) +
        tipRow(css("--d2"),"Bourse, nette d'impôt", r.triBourse===null?"—":pct(r.triBourse)) +
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
      {color:"--d1", values: rows.map(r=>r.gainImmo), width:2.4},
      {color:"--d2", values: rows.map(r=>r.gainBourse)},
      {color:"--d3", values: rows.map(r=>r.gainFonds), dash:"7 4"},
      {color:"--d4", values: rows.map(r=>r.gainLivret), dash:"2 3"}
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
  });

  drawChart($("plotCf"), $("tipCf"), {
    x: xs, height: 200, padLeft: 78, band:true, zero:true, label:"Trésorerie annuelle après impôt",
    fmtAxis: (v,ref) => ref>=10000 ? eur1.format(v/1000)+" k€" : eur1.format(v)+" €",
    series: [{color:"--d1", values: rows.map(r=>r.cfNet)}],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Année ${r.y}</div>` +
        tipRow(r.cfNet>=0?css("--up"):css("--down"),"Trésorerie nette", sEur(r.cfNet)) +
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
  if(p.regime==="lmnp-micro" && rows[0].loyers>77700)
    warns.push("Vos recettes dépassent 77 700 € par an : le micro-BIC n'est pas accessible, le LMNP au réel s'applique d'office.");
  if(R.cash0 < 1)
    warns.push("Sans apport ni frais payés comptant, le rendement sur fonds propres n'a pas de sens mathématique. Ajoutez au moins les frais de dossier.");
  if(p.duree > 0 && R.emprunt > 0 && p.horizon < p.duree)
    warns.push(`Votre horizon (${p.horizon} ans) est plus court que le prêt (${p.duree} ans) : chaque revente simulée solde le capital restant dû.`);
  $("warnBox").innerHTML = warns.map(w=>`<div class="warn">${w}</div>`).join("");

  renderComplements(p);
  save();
  planifierHash();
}

function renderComplements(p){
  const {rows, final} = R;
  // Les quatre régimes, mêmes hypothèses.
  const regs = comparerRegimes(p, R);
  const meilleur = regs.reduce((m,r) => r.tri !== null && (m===null || r.tri > m.tri) ? r : m, null);
  drawColumns($("plotReg"), $("tipReg"), {
    height:230, label:"Rendement annualisé à l'horizon selon le régime fiscal",
    fmtAxis: v => (v*100).toFixed(0)+" %",
    items: regs.map(r => ({
      label: r.label, from:0, to: r.tri === null ? 0 : r.tri,
      color: r.rg === p.regime ? "--d1" : "--text-muted", opacity: r.rg === p.regime ? 1 : .55,
      text: r.tri === null ? "—" : sPct(r.tri), textColor: r.tri === null ? "--text-muted" : r.tri >= 0 ? "--up" : "--down",
      strong: r.rg === p.regime
    })),
    tip: i => {
      const r = regs[i];
      return `<div class="th">${r.label.replace("\n"," · ")}${r.rg===p.regime?" · en cours":""}</div>` +
        tipRow("transparent","Rendement annualisé", r.tri===null?"—":sPct(r.tri)) +
        tipRow("transparent","En pouvoir d'achat", r.triReel===null?"—":sPct(r.triReel)) +
        tipRow("transparent","Gain net à l'horizon", sEur(r.gain)) +
        tipRow("transparent","Impôts cumulés", r.impots >= 0 ? cost(r.impots) : "+"+eur.format(-r.impots)) +
        (r.rg===p.regime ? "" : `<div class="tr" style="margin-top:6px;color:var(--text-muted)">Cliquer pour adopter ce régime</div>`);
    },
    onClick: i => { if(regs[i].rg !== p.regime){ appliquerRegime(regs[i].rg); render(); toast("Régime : " + regs[i].label.replace("\n"," ")); } }
  });
  const enCours = regs.find(r => r.rg === p.regime);
  $("regNote").textContent = !meilleur || meilleur.tri === null ? "" :
    meilleur.rg === p.regime
      ? `Sur vos hypothèses, votre régime est déjà le plus favorable des quatre.`
      : `Sur vos hypothèses, ${meilleur.label.replace("\n"," ").toLowerCase()} ferait mieux : ${sPct(meilleur.tri)} contre ${sPct(enCours.tri)} par an, soit ${sEur(meilleur.gain - enCours.gain)} de gain sur ${p.horizon} ans. Vérifiez que vous y êtes éligible.`;

  // D'où vient le gain : une cascade dont la somme des marches est exactement le gain.
  const f = final;
  // Les frais d'acquisition et les travaux sont sortis de la revalorisation :
  // ils sont payés le premier jour et doivent se voir. La somme est inchangée,
  // puisque besoin = prix + notaire + travaux + agence + mobilier + dossier.
  const fraisAcquisition = R.notaire + p.fraisAcq + R.mobilier + p.fraisDossier;
  const marches = [
    {label:"Loyers\nencaissés",        v: f.cumulLoyers},
    {label:"Charges",                  v: -f.cumulCharges},
    {label:"Intérêts et\nassurance",   v: -f.cumulCredit},
    {label:"Impôt sur\nles loyers",    v: -f.cumulImpot},
    {label:"Frais\nd'acquisition",     v: -fraisAcquisition,
     detail: [["Frais de notaire", R.notaire], ["Frais d'agence", p.fraisAcq],
              ["Mobilier", R.mobilier], ["Dossier et garantie", p.fraisDossier]]},
    {label:"Travaux",                  v: -p.travaux},
    {label:"Revalorisation\ndu bien",  v: f.valeur - p.prix},
    {label:"Frais de\nrevente",        v: -(f.fraisVente + f.ira)},
    {label:"Impôt sur la\nplus-value", v: -(f.impotPV + f.repriseDF)}
  ];
  let acc = 0;
  const items = marches.map(m => {
    const it = {label:m.label, from:acc, to:acc+m.v, color: m.v >= 0 ? "--up" : "--down",
      text: sEur(m.v), detail: m.detail};
    acc += m.v; return it;
  });
  items.push({label:"Gain net", from:0, to:f.gain, color:"--text", text:sEur(f.gain), textColor:"--text", strong:true});
  drawColumns($("plotCasc"), $("tipCasc"), {
    height:250, padLeft:78, connect:true, label:"Décomposition du gain à l'horizon",
    fmtAxis: kEur,
    items,
    tip: i => {
      const it = items[i];
      return `<div class="th">${it.label.replace("\n"," ")} · ${p.horizon} ans</div>` +
        tipRow("transparent", i < items.length-1 ? "Montant" : "Total", it.text) +
        (it.detail || []).filter(d => d[1] > 0.5).map(d => tipRow("transparent", "dont " + d[0].toLowerCase(), cost(d[1]))).join("") +
        (i < items.length-1 ? tipRow("transparent","Cumul à cette étape", sEur(it.to)) : "");
    }
  });
  const revalorisation = f.valeur - p.prix;
  $("cascNote").textContent =
    `Sur ${p.horizon} ans, les loyers apportent ${eur.format(f.cumulLoyers)} et le bien se revend ${revalorisation >= 0 ? eur.format(revalorisation) + " au-dessus" : eur.format(-revalorisation) + " en dessous"} de son prix d'achat. En face, ${eur.format(fraisAcquisition)} de frais d'acquisition — dont ${eur.format(R.notaire)} de notaire — sont perdus dès la signature, le crédit coûte ${eur.format(f.cumulCredit)} et la fiscalité ${eur.format(f.cumulImpot + f.impotPV + f.repriseDF)}.`;

  // Patrimoine net et dette.
  const xs = rows.map(r => String(r.y));
  drawChart($("plotPat"), $("tipPat"), {
    x: xs, height:250, padLeft:78, zero:true, label:"Valeur du bien, capital restant dû et patrimoine net",
    fmtAxis: kEur,
    series: [
      {color:"--d1", values: rows.map(r => r.patrimoine), fill:true, width:2.4},
      {color:"--d2", values: rows.map(r => r.valeur)},
      {color:"--text-muted", values: rows.map(r => r.crd)},
      {color:"--d4", values: rows.map(r => r.mise), dash:"2 3"}
    ],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Fin d'année ${r.y}</div>` +
        tipRow(css("--d1"),"Patrimoine net", eur.format(r.patrimoine)) +
        tipRow(css("--d2"),"Valeur du bien", eur.format(r.valeur)) +
        tipRow(css("--text-muted"),"Capital restant dû", eur.format(r.crd)) +
        tipRow(css("--d4"),"Sorti de votre poche", eur.format(r.mise)) +
        tipRow("transparent","Net si revente", eur.format(r.netVente));
    }
  });

  // Sensibilité : douze calculs de plus, différés pour ne pas freiner la saisie.
  const host = $("plotSens");
  if(!host.querySelector("svg")) host.insertAdjacentHTML("beforeend", '<p class="pending">Calcul…</p>');
  planifier(() => {
    host.querySelectorAll(".pending").forEach(el => el.remove());
    if(f.tri === null){ host.querySelectorAll("svg").forEach(el => el.remove()); $("sensNote").textContent = ""; return; }
    const sens = sensibilite(p, f.tri);
    drawTornado(host, $("tipSens"), {
      label:"Sensibilité du rendement annualisé",
      fmtAxis: v => (v>0?"+":v<0?"−":"") + Math.abs(v*100).toFixed(1).replace(".",",") + " pt",
      rows: sens.map(s => ({label:s.nom, lo:s.lo, hi:s.hi, loText:pts(s.lo), hiText:pts(s.hi)})),
      tip: i => {
        const s = sens[i];
        return `<div class="th">${s.nom} · ±${s.txt}</div>` +
          tipRow(css("--up"), `${s.nom} ${s.fav.s}${s.txt}`, sPct(s.fav.tri)) +
          tipRow(css("--down"), `${s.nom} ${s.def.s}${s.txt}`, sPct(s.def.tri)) +
          tipRow("transparent","Aujourd'hui", sPct(f.tri));
      }
    });
    $("sensNote").textContent = sens.length
      ? `Le paramètre le plus sensible est ${sens[0].nom.toLowerCase()} : ${sens[0].txt} d'écart déplace le rendement de ${pts(sens[0].lo)} à ${pts(sens[0].hi)} par an.`
      : "";
  });
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


// Chaque régime n'expose que les réglages qui le concernent : afficher un plafond
// de déficit foncier à quelqu'un qui a choisi le micro-BIC n'a aucun sens.
const CHAMPS_REGIME = {
  "micro-foncier": ["fAbattement"],
  "reel-foncier":  ["fPlafondDeficit"],
  "lmnp-micro":    ["fAbattement", "fCfe", "fMobilier"],
  "lmnp-reel":     ["fCfe", "fMobilier", "fPartBati", "fAmortBati", "fAmortTvx", "fAmortMob"]
};
const TOUS_CHAMPS_REGIME = [...new Set(Object.values(CHAMPS_REGIME).flat())];
function syncRegime(){
  const rg = $("regime").value;
  const visibles = CHAMPS_REGIME[rg] || [];
  TOUS_CHAMPS_REGIME.forEach(id => { $(id).hidden = !visibles.includes(id); });
  // La part déductible d'un poste de travaux ne vaut qu'au réel foncier. Les
  // lignes étant reconstruites à chaque frappe, c'est le conteneur qui porte
  // l'état, jamais les champs eux-mêmes.
  $("tvxList").classList.toggle("sans-deduc", rg !== "reel-foncier");
}
FIELDS.concat(SELECTS).forEach(k => {
  if(k === "regime") return;
  $(k).addEventListener("input", render);
  $(k).addEventListener("change", render);
});
$("regime").addEventListener("change", () => { appliquerRegime($("regime").value); render(); });
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
  retablirDefauts();
  renderItems(); render(); toast("Hypothèses réinitialisées");
});

$("copy").addEventListener("click", async () => {
  if(!R) return;
  try{ await navigator.clipboard.writeText(csvTexte()); toast("Tableau copié — collez-le dans un tableur"); }
  catch(e){ toast("Copie impossible dans ce contexte"); }
});

// L'interrupteur reflète le thème réellement affiché, y compris quand aucun choix
// n'a été fait et que c'est le système qui décide.
// Sombre par défaut : seule une préférence système explicitement claire, ou
// un choix manuel, fait basculer en clair.
function estSombre(){
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
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
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { syncTheme(); render(); });

/* ---------- exemples, régime, lien, export ---------- */
function appliquerRegime(rg){
  $("regime").value = rg;
  $("ps").value = PS_LOYERS[rg] || "17.2";
  $("cfe").value = CFE_DEFAUT[rg] || "0";
  if(ABATT_DEFAUT[rg]) $("abattement").value = ABATT_DEFAUT[rg];
  if(MOBILIER_DEFAUT[rg] !== undefined) $("mobilier").value = MOBILIER_DEFAUT[rg];
}
function retablirDefauts(){
  Object.keys(DEFAULTS).forEach(k => {
    if(typeof DEFAULTS[k] === "boolean") $(k).checked = DEFAULTS[k];
    else $(k).value = DEFAULTS[k];
  });
  items = TVX_DEFAUT.map(o => ({...o}));
}

// L'état complet tient dans l'URL : un lien suffit à partager une simulation, et
// un guide peut ouvrir le calculateur pré-réglé (/#regime=reel-foncier).
const BOOLS = ["ira","prixSuitInflation"];
const codeItem = it => [it.nom, it.montant, it.taux, it.duree, it.deduc]
  .map(v => encodeURIComponent(String(v).replace(/[|:]/g, " "))).join(":");
function versHash(){
  const q = [];
  FIELDS.concat(SELECTS).forEach(k => { const v = $(k).value; if(String(v) !== String(DEFAULTS[k])) q.push(k + "=" + encodeURIComponent(v)); });
  BOOLS.forEach(k => { if($(k).checked !== DEFAULTS[k]) q.push(k + "=" + ($(k).checked ? 1 : 0)); });
  const tvx = items.map(codeItem).join("|");
  if(tvx !== TVX_DEFAUT.map(codeItem).join("|")) q.push("tvx=" + tvx);
  const h = q.length ? "#" + q.join("&") : "";
  const actuel = location.hash.indexOf("=") >= 0 ? location.hash : "";
  if(h !== actuel) history.replaceState(null, "", location.pathname + location.search + h);
}
function depuisHash(){
  const h = location.hash.slice(1);
  if(!h || h.indexOf("=") < 0) return false;
  const vus = new Set();
  let regime = null;
  h.split("&").forEach(part => {
    const i = part.indexOf("="); if(i < 0) return;
    const k = part.slice(0, i), v = decodeURIComponent(part.slice(i+1));
    if(k === "tvx"){
      items = assainir(v.split("|").filter(Boolean).map(t => {
        const f = t.split(":").map(x => { try{ return decodeURIComponent(x); }catch(e){ return ""; } });
        return {nom:f[0], montant:f[1], taux:f[2], duree:f[3], deduc:f[4]};
      }));
    } else if(BOOLS.includes(k)){
      $(k).checked = v === "1";
    } else if(SELECTS.includes(k)){
      if(![...$(k).options].some(o => o.value === v)) return;
      $(k).value = v; vus.add(k);
      if(k === "regime") regime = v;
    } else if(FIELDS.includes(k)){
      if(!isFinite(parseFloat(v))) return;
      $(k).value = v; vus.add(k);
    }
  });
  // Un lien qui ne fixe que le régime emporte les réglages qui en découlent.
  if(regime){
    if(!vus.has("ps")) $("ps").value = PS_LOYERS[regime] || "17.2";
    if(!vus.has("cfe")) $("cfe").value = CFE_DEFAUT[regime] || "0";
    if(!vus.has("abattement") && ABATT_DEFAUT[regime]) $("abattement").value = ABATT_DEFAUT[regime];
  }
  return true;
}
let hashTimer;
function planifierHash(){ clearTimeout(hashTimer); hashTimer = setTimeout(versHash, 250); }

$("share").addEventListener("click", async () => {
  versHash();
  try{ await navigator.clipboard.writeText(location.href); toast("Lien copié — il contient toutes vos hypothèses"); }
  catch(e){ toast("Copie impossible dans ce contexte : copiez l'adresse de la page"); }
});

function csvTexte(){
  const head = ["Annee","Loyers","Charges","Interets","Mensualites","Impot","Tresorerie","Tresorerie cumulee","Valeur","Capital du","Impot plus-value","Net si revente","Rendement annualise"];
  return [head.join(";")].concat(R.rows.map(r => [
    r.y, r.loyers, r.charges, r.interets, r.annuite, r.impot, r.cfNet, r.cumulCF,
    r.valeur, r.crd, r.impotPV, r.netVente, r.tri===null?"":(r.tri*100)
  ].map(v => typeof v==="number" ? v.toFixed(2).replace(".",",") : v).join(";"))).join("\n");
}
$("csv").addEventListener("click", () => {
  if(!R) return;
  const blob = new Blob(["﻿" + csvTexte()], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "rendement-locatif.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("CSV téléchargé — ouvrez-le dans un tableur");
});

/* ---------- navigation de page ---------- */
const liensSections = [...document.querySelectorAll(".subnav a")];
const sections = liensSections.map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
liensSections.forEach(a => a.addEventListener("click", e => {
  const cible = document.querySelector(a.getAttribute("href"));
  if(!cible) return;
  e.preventDefault();
  cible.scrollIntoView({behavior:"smooth", block:"start"});
}));
if("IntersectionObserver" in window){
  const visibles = new Map();
  const io = new IntersectionObserver(entrees => {
    entrees.forEach(en => visibles.set(en.target.id, en.isIntersecting));
    const haut = sections.find(s => visibles.get(s.id));
    liensSections.forEach(a => {
      if(haut && a.getAttribute("href") === "#" + haut.id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }, {rootMargin:"-48px 0px -55% 0px", threshold:[0, .05]});
  sections.forEach(s => io.observe(s));
}
// Sur petit écran le panneau d'hypothèses se replie sous le verdict ; sur grand
// écran il est toujours déployé.
const mqEtroit = matchMedia("(max-width:1040px)");
$("railbox").open = !mqEtroit.matches;
mqEtroit.addEventListener("change", () => { if(!mqEtroit.matches) $("railbox").open = true; });
document.querySelectorAll("a.mail").forEach(a => { a.href = "mailto:" + a.dataset.u + "@" + a.dataset.d; });

load();
depuisHash();
renderItems();
syncTheme();
$("echLisible").setAttribute("aria-pressed", echelleTri === "lisible" ? "true" : "false");
$("echComplete").setAttribute("aria-pressed", echelleTri === "complete" ? "true" : "false");
render();
