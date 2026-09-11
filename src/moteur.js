/* ═════════════════════════════════════════════════════════════════
   moteur — calcul pur, aucun accès au document.
   Rien ici ne doit lire le DOM : outils/verifier.py le contrôle,
   et le harnais JavaScriptCore exécute ce fichier tel quel.
   ═════════════════════════════════════════════════════════════════ */

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
  // Une durée nulle n'est pas un prêt : sans cette garde, le capital restait dû
  // pour toujours, jamais amorti ni facturé d'intérêts, mais retranché du prix
  // de vente à chaque année — une dette fantôme, gratuite et éternelle.
  if(n<=0) capital = 0;
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
// Surtaxe des plus-values immobilières (art. 1609 nonies G du CGI). Le taux
// monte par tranche de 50 000 €, mais chaque palier s'ouvre par une bande de
// 10 000 € où une décote lisse la marche : sans elle, passer de 50 000 € à
// 50 001 € coûterait 1 000 € d'impôt d'un coup.
const SURTAXE_PV = [
  [ 60000, 0.02, 1/20],
  [100000, 0.02, 0],
  [110000, 0.03, 1/10],
  [150000, 0.03, 0],
  [160000, 0.04, 15/100],
  [200000, 0.04, 0],
  [210000, 0.05, 20/100],
  [250000, 0.05, 0],
  [260000, 0.06, 25/100],
];
function surtaxePV(base){
  if(base<=50000) return 0;
  for(const [plafond, taux, decote] of SURTAXE_PV){
    if(base<=plafond) return base*taux - (plafond-base)*decote;
  }
  return base*0.06;
}

// Réglages propres à chaque régime, partagés par le formulaire et le comparatif.
// Le meublé subit la CSG à 10,6 %, le nu reste à 9,2 % : le taux suit le régime.
const PS_LOYERS = {"micro-foncier":"17.2", "reel-foncier":"17.2", "lmnp-micro":"18.6", "lmnp-reel":"18.6"};
// La CFE relève d'une activité BIC : elle ne concerne pas la location nue.
const CFE_DEFAUT = {"micro-foncier":"0", "reel-foncier":"0", "lmnp-micro":"400", "lmnp-reel":"400"};
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
  // Affichage brut : le même projet sans aucun impôt — ni sur les loyers, ni sur
  // la plus-value, ni sur les gains des placements comparés. Charges, crédit,
  // taxe foncière et CFE restent dus : le bien les coûte quelle que soit la
  // fiscalité. L'écart entre les deux affichages est donc ce que coûte l'impôt.
  const avantImpot = p.avantImpot === true;

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
  const fiscB = avantImpot ? 0 : part(p.fiscBourse), fiscF = avantImpot ? 0 : part(p.fiscFonds);
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
    if(avantImpot) impot = 0;

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
    const impotPV = avantImpot ? 0 : baseIR*0.19 + basePS*(p.psPV/100) + surtaxePV(baseIR);

    // Vendre avant le 31/12 de la 3e année suivant une imputation la fait reprendre.
    const repriseDF = p.regime === "reel-foncier" && !avantImpot
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
    bruteCout: besoin > 0 ? loyerBrutAn/besoin : 0,
    nette: besoin > 0 ? (r1.loyers - r1.charges)/besoin : 0,
    netteNette: besoin > 0 ? (r1.loyers - r1.charges - r1.impot)/besoin : 0,
    cfMensuel1: r1.cfNet/12,
    final: rows[rows.length-1],
    cumulEffort: rows.reduce((s,r)=> s + Math.min(0, r.cfNet), 0)
  };
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
const pts = v => (v>=0?"+":"−") + Math.abs(v*100).toFixed(1).replace(".",",") + " pt" + (Math.abs(v*100) >= 1.95 ? "s" : "");
const kEur = (v, ref) => ref >= 10000 ? eur1.format(v/1000)+" k€" : eur1.format(v)+" €";

// Le verdict en une phrase, sur le rendement en pouvoir d'achat : battre la
// bourse, battre seulement l'inflation, ou ne rien battre du tout. Écrit ici
// pour que la calculatrice et la page d'accueil disent exactement la même chose.
function avis(triReel, bourseReel){
  if(triReel === null || !isFinite(triReel)) return null;
  if(triReel > bourseReel)
    return `Excellente affaire. Sur vos hypothèses, le projet fait mieux que la bourse — l'un des placements les plus rentables sur longue période, et le plus difficile à battre une fois l'impôt payé.`;
  if(triReel > 0)
    return `Belle réserve de valeur. Le projet ne rattrape pas la bourse, mais il bat l'inflation : votre capital garde son pouvoir d'achat, ce que ni un compte courant ni un livret réglementé ne permettent aujourd'hui.`;
  return `Le rendement ne suit pas l'inflation. Vous récupérerez plus d'euros qu'engagés, mais ils achèteront moins : à ces hypothèses, l'opération vous appauvrit en pouvoir d'achat.`;
}

/* ---------- le lien qui porte les hypothèses ---------- */
// Un fragment d'URL suffit à transmettre une simulation entière. Le format est
// écrit ici, et lu par depuisHash() : la calculatrice le produit à partir de son
// formulaire, l'assistant de la page d'accueil à partir de ses réponses. Deux
// appelants, une seule grammaire — sinon les liens de l'un cesseraient un jour
// d'être compris par l'autre.
const codeItem = it => [it.nom, it.montant, it.taux, it.duree, it.deduc]
  .map(v => encodeURIComponent(String(v).replace(/[|:]/g, " "))).join(":");

// `valeurs` : les hypothèses à transmettre, `defauts` : celles de l'ouverture.
// Seul ce qui diffère voyage — un fragment vide est donc exactement le
// scénario par défaut, celui que la page d'accueil affiche. Sans `defauts`,
// tout voyage, travaux compris : c'est le lien qu'on partage, qui ne doit pas
// changer de sens le jour où une valeur d'ouverture évolue.
//
// Un lien ordinaire se pose sur ce que le visiteur a déjà saisi : un guide ouvre
// son projet au régime réel sans lui faire tout ressaisir. `complet` dit
// l'inverse : le lien décrit un projet entier, et ce qu'il ne fixe pas reprend la
// valeur d'ouverture, pas celle qu'une visite précédente a laissée dans le
// navigateur. Il porte alors un marqueur, et n'est donc jamais vide.
const LIEN_COMPLET = "complet=1";
function lienHypotheses(valeurs, defauts, items, complet){
  const q = complet ? [LIEN_COMPLET] : [];
  const tout = !defauts;
  Object.keys(valeurs).forEach(k => {
    const v = valeurs[k];
    if(typeof v === "boolean"){
      if(tout || v !== defauts[k]) q.push(k + "=" + (v ? 1 : 0));
    } else if(tout || String(v) !== String(defauts[k])){
      q.push(k + "=" + encodeURIComponent(v));
    }
  });
  if(items){
    const tvx = items.map(codeItem).join("|");
    if(tout || tvx !== TVX_DEFAUT.map(codeItem).join("|")) q.push("tvx=" + tvx);
  }
  return q.length ? "#" + q.join("&") : "";
}
