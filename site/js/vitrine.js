"use strict";
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
  // Un rendement suppose une mise, puis un retour. Si le premier flux est une
  // rentrée, le taux trouvé serait celui d'un emprunt, pas d'un placement ; si
  // aucun flux ne revient, il n'existe pas.
  const premier = flows.find(c => Math.abs(c) > 1e-9);
  if(!(premier < 0) || !flows.some(c => c > 0)) return null;
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
// Loi Climat et résilience : un logement trop énergivore ne peut plus être donné
// à bail — classé G depuis 2025, F en 2028, E en 2034 (France métropolitaine).
// Le calcul signale la date, il ne la simule pas : il suppose des travaux.
const INTERDICTION_DPE = {G:2025, F:2028, E:2034};

function compute(p){
  // Deux situations. « achat » : le bien est à acheter, la mise est l'apport et
  // le crédit part de zéro. « detenu » : le bien est déjà à soi ; les frais
  // d'acquisition sont payés, le crédit est en cours, et la mise est ce qu'une
  // vente aujourd'hui rendrait — c'est cet argent-là qu'on choisit de laisser
  // dans le bien plutôt que de le placer ailleurs.
  const detenu = p.situation === "detenu";
  const deja = detenu ? Math.max(0, Math.round(Number(p.depuis) || 0)) : 0;
  // Achat comptant : pas d'emprunt, donc ni frais de dossier ni assurance.
  const comptant = p.comptant === true;
  const notaire = detenu ? 0 : p.prix * p.notairePct/100;
  const fraisAcq = detenu ? 0 : p.fraisAcq;
  const fraisDossier = (detenu || comptant) ? 0 : p.fraisDossier;
  // Meublé ou nu : ce qui ne concerne pas le régime choisi est masqué à l'écran,
  // donc neutralisé ici. Un champ masqué ne doit jamais peser sur le résultat.
  const meuble = p.regime === "lmnp-micro" || p.regime === "lmnp-reel";
  const mobilier = meuble && !detenu ? p.mobilier : 0;
  // Le prix qui sert d'assiette à la plus-value et à l'amortissement : celui
  // qui a été payé. La valeur d'aujourd'hui, elle, est le point de départ du
  // marché et de la revente.
  const prixRef = detenu ? p.prixAchat : p.prix;
  const valeur0 = (detenu ? p.valeur : p.prix) + p.travaux;
  const besoin = detenu ? p.travaux : p.prix + notaire + p.travaux + fraisAcq + mobilier + fraisDossier;
  const emprunt = comptant ? 0 : detenu ? Math.max(0, p.crd) : Math.max(0, besoin - p.apport);
  // Un capital encore dû se rembourse : « 0 an restant » vaut une dernière année,
  // sans quoi la dette retranchée de la mise disparaîtrait sans jamais être payée.
  const dureePret = detenu ? Math.max(emprunt > 0 ? 1 : 0, p.dureeRestante) : p.duree;
  const sch = schedule(emprunt, p.taux, dureePret, p.assur);
  const tauxImpot = (p.tmi + p.ps)/100;
  // Affichage brut : le même projet sans aucun impôt — ni sur les loyers, ni sur
  // la plus-value, ni sur les gains des placements comparés. Charges, crédit,
  // taxe foncière et CFE restent dus : le bien les coûte quelle que soit la
  // fiscalité. L'écart entre les deux affichages est donc ce que coûte l'impôt.
  const avantImpot = p.avantImpot === true;
  // Classé F ou G, le loyer ne peut plus augmenter depuis août 2022 : ni
  // révision annuelle, ni hausse entre deux locataires.
  const gelLoyer = p.dpe === "F" || p.dpe === "G";
  const indexLoyer = gelLoyer ? 0 : p.indexLoyer;

  // Part des travaux ouvrant droit à déduction, poste par poste.
  const travauxDeductibles = (p.items || []).reduce((s, it) => s + it.montant*(it.deduc/100), 0);
  const travauxNonDeduits = p.travaux - travauxDeductibles;

  const surAns = (montant, ans) => ans > 0 ? montant/ans : 0;
  // Bien détenu : la base amortissable est le prix payé et ses frais, retenus au
  // forfait de 7,5 % faute de les connaître.
  const baseBati = detenu ? prixRef*1.075 : p.prix + notaire + fraisAcq;
  const amortBati = surAns(baseBati*(p.partBati/100), p.amortBatiAns);
  const amortTvx = surAns(p.travaux, p.amortTvxAns);
  const amortMob = surAns(mobilier, p.amortMobAns);
  // La CFE relève du BIC : elle ne concerne pas la location nue.
  const cfeApplicable = meuble;
  // Le LMNP au réel exige une liasse fiscale : un expert-comptable, déductible
  // comme toute charge. Les autres régimes se déclarent seuls, sans ce coût.
  const compta = p.regime === "lmnp-reel" ? Math.max(0, Number(p.compta) || 0) : 0;

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
  // Bien détenu au LMNP réel : le bâti déjà amorti pendant les années écoulées
  // sera réintégré à la cession, comme celui des années à venir.
  const amortAcquis = p.regime === "lmnp-reel" ? amortBati*Math.min(deja, p.amortBatiAns) : 0;
  let stockImm = 0, stockMob = 0, amortCumul = amortAcquis, amortReintegre = amortAcquis;
  // Comparaison à mise de fonds identique. Les deux scénarios partent du même
  // apport et exigent exactement les mêmes versements : chaque euro d'effort
  // d'épargne que le bien réclame est, côté bourse, investi au taux de référence.
  // Symétriquement, chaque euro de trésorerie dégagé par le bien est replacé au
  // même taux. Les deux courbes sont donc bien deux capitaux comparables — et,
  // comme le bien, ils sont pris nets de l'impôt dû sur leurs gains à la sortie.
  let cumulCF=0, cumulLoyers=0, cumulCharges=0, cumulCredit=0, cumulImpot=0;
  let portefeuille, potImmo=0, surplusCumul=0;
  let pFonds, pLivret;   // mêmes versements, placés ailleurs
  let miseTotale; // la mise du premier jour, puis chaque euro d'effort d'épargne versé ensuite
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

  // Ce que rend une vente à la fin de l'année y (0 : aujourd'hui). La durée de
  // détention fiscale compte les années déjà écoulées : c'est elle qui fixe les
  // abattements et le forfait travaux, pas l'année de la simulation.
  const cession = (valeur, y, crd, reintegre) => {
    const h = deja + y;
    const fraisVente = valeur*p.fraisVente/100;
    const ira = (p.ira && crd>0) ? Math.min(0.03*crd, crd*(p.taux/100)/2) : 0;
    const notaireRetenu = Math.max(notaire, 0.075*prixRef);
    const forfaitTvx = h>5 ? 0.15*prixRef : 0;
    // Des travaux déjà déduits des revenus fonciers ne peuvent pas majorer une
    // seconde fois le prix d'acquisition. Les travaux réalisés avant aujourd'hui
    // sur un bien détenu s'ajoutent à ceux de la simulation.
    const travauxPV = (detenu ? Math.max(0, Number(p.travauxPasses) || 0) : 0)
      + (y === 0 ? 0 : p.regime === "reel-foncier" ? travauxNonDeduits : p.travaux);
    let prixAcq = prixRef + notaireRetenu + Math.max(travauxPV, forfaitTvx);
    if(p.regime === "lmnp-reel") prixAcq -= reintegre;
    // Les frais supportés par le vendeur viennent en moins du prix de cession.
    const pvBrute = Math.max(0, valeur - fraisVente - prixAcq);
    const baseIR = pvBrute*(1-abattementIR(h));
    const basePS = pvBrute*(1-abattementPS(h));
    const impotPV = avantImpot ? 0 : baseIR*0.19 + basePS*(p.psPV/100) + surtaxePV(baseIR);
    return {fraisVente, ira, impotPV, net: valeur - fraisVente - crd - ira - impotPV};
  };
  // Bien détenu : la mise est le produit net d'une vente aujourd'hui, plus les
  // travaux engagés maintenant. Achat : l'apport, ou tout le coût si comptant.
  const vente0 = detenu ? cession(valeur0 - p.travaux, 0, emprunt, amortAcquis) : null;
  const net0 = vente0 ? vente0.net : 0;
  const cash0 = detenu ? net0 + p.travaux : comptant ? besoin : Math.max(0, besoin - emprunt);
  portefeuille = pFonds = pLivret = miseTotale = cash0;

  for(let y=1; y<=p.horizon; y++){
    const loyers = p.loyer*12*Math.pow(1+indexLoyer/100, y-1)*(1-p.vacance/100);
    // CFE : exonérée la première année d'activité, et sous 5 000 € de recettes.
    const cfeAn = (!cfeApplicable || (y === 1 && !detenu) || loyers <= 5000) ? 0 : p.cfe;
    const chargesFixes = (p.copro*12 + p.tf + p.pno + cfeAn + compta)*Math.pow(1+p.indexCharges/100, y-1);
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
      const dotImm = (deja+y<=p.amortBatiAns?amortBati:0) + (y<=p.amortTvxAns?amortTvx:0);
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
    const valeur = (valeur0 - p.travaux + residuTravaux(p.items, y))*Math.pow(1+p.indexPrix/100, y);
    const {fraisVente, ira, impotPV} = cession(valeur, y, L.crd, amortReintegre);

    // Vendre avant le 31/12 de la 3e année suivant une imputation la fait reprendre.
    const repriseDF = p.regime === "reel-foncier" && !avantImpot
      ? imputations.reduce((s,d) => s + (d.y > y-3 ? d.amt : 0), 0)*(p.tmi/100)
      : 0;

    const netVente = valeur - fraisVente - L.crd - ira - impotPV - repriseDF;
    // Revalorisation depuis le départ : du prix payé en achat, de la valeur
    // d'aujourd'hui pour un bien détenu.
    const revalorisation = valeur - (valeur0 - p.travaux);

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

    // Sans apport, la mise est l'effort d'épargne : les mensualités que les loyers
    // ne couvrent pas sortent de votre poche, et le rendement se mesure sur elles.
    // Quand l'argent commence par rentrer — loyers qui couvrent tout sans mise,
    // bien détenu dont la vente coûterait de l'argent —, irr() rend null.
    const flows = [-cash0].concat(cfHist.slice(0,-1)).concat([cfNet + netVente]);
    const tri = irr(flows);
    // Même chronique de versements, placée en bourse : le rendement annualisé
    // net d'impôt directement opposable au TRI du bien.
    const flowsBourse = [-cash0].concat(efforts.slice(0,-1).map(e => -e)).concat([portefeuilleNet - effort]);
    const triBourse = irr(flowsBourse);
    const gain = cumulCF + netVente - cash0;

    rows.push({y, loyers, charges, interets:L.int, assurance:L.ass, principal:L.pri, annuite,
      impot, cfNet, cumulCF, valeur, revalorisation, crd:L.crd, fraisVente, ira, impotPV, repriseDF, netVente, tri, triBourse, gain,
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
  // Les rentabilités classiques se rapportent au prix, puis au coût complet de
  // l'opération ; pour un bien détenu, à sa valeur d'aujourd'hui.
  const prixRenta = detenu ? valeur0 - p.travaux : p.prix;
  const coutRenta = detenu ? valeur0 : besoin;
  return {
    p, rows, best, detenu, deja, comptant, gelLoyer, notaire, fraisAcq, fraisDossier, mobilier, besoin, emprunt, cash0,
    vente0, net0, mensualite:sch.mensualite, valeur0,
    coutCredit: sch.years.reduce((s,L) => s + L.int + L.ass, 0),
    brute: prixRenta > 0 ? loyerBrutAn/prixRenta : 0,
    bruteCout: coutRenta > 0 ? loyerBrutAn/coutRenta : 0,
    nette: coutRenta > 0 ? (r1.loyers - r1.charges)/coutRenta : 0,
    netteNette: coutRenta > 0 ? (r1.loyers - r1.charges - r1.impot)/coutRenta : 0,
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
      // Le rendement de chaque année de revente : les quatre régimes se
      // comparent aussi dans le temps, pas seulement à l'horizon.
      tris: r.rows.map(x => x.tri),
      impots: r.rows.reduce((s,x) => s + x.impot, 0) + f.impotPV + f.repriseDF};
  });
}

/* ---------- sensibilité ---------- */
// Pour un bien détenu, c'est la valeur d'aujourd'hui qui joue, pas le prix payé.
const SENS = [
  {k:"prix",      kDetenu:"valeur", nom:"Prix d'achat", nomDetenu:"Valeur du bien", pas:v => v*0.10, txt:"10 %"},
  {k:"loyer",     nom:"Loyer",                   pas:v => v*0.10, txt:"10 %"},
  {k:"taux",      nom:"Taux du crédit",          pas:() => 1,     txt:"1 pt"},
  {k:"vacance",   nom:"Vacance locative",        pas:() => 5,     txt:"5 pts"},
  {k:"indexPrix", nom:"Revalorisation du bien",  pas:() => 1,     txt:"1 pt/an"},
  {k:"travaux",   nom:"Montant des travaux",     pas:v => v*0.20, txt:"20 %"},
  // La tranche ne se déplace pas d'un pourcentage : elle change de palier. Elle
  // change aussi dans la vie d'un investisseur — à la retraite, ou quand les
  // loyers eux-mêmes font franchir un seuil —, alors que le calcul la tient fixe.
  {k:"tmi",       nom:"Tranche d'imposition",    txt:"1 tranche"}
];
// Les tranches du barème, dans l'ordre : ce sont les choix de la liste « tmi »
// de index.html, et outils/verifier.py contrôle qu'elles n'en divergent pas.
const TRANCHES = [0, 11, 30, 41, 45];
function sensibilite(p, triRef){
  const detenu = p.situation === "detenu";
  const cle = s => detenu && s.kDetenu ? s.kDetenu : s.k;
  const essai = (s, signe) => {
    const q = Object.assign({}, p);
    if(s.k === "travaux"){
      q.items = p.items.map(it => Object.assign({}, it, {montant: it.montant*(1 + signe*0.2)}));
      q.travaux = q.items.reduce((a,it) => a + it.montant, 0);
    } else if(s.k === "tmi"){
      // Au bout du barème, il n'y a pas de palier suivant : ce côté ne bouge pas.
      const i = TRANCHES.reduce((m, t, j) => Math.abs(t - p.tmi) < Math.abs(TRANCHES[m] - p.tmi) ? j : m, 0);
      q.tmi = TRANCHES[Math.max(0, Math.min(TRANCHES.length - 1, i + signe))];
    } else {
      const k = cle(s);
      const v = p[k] + signe*s.pas(p[k]);
      q[k] = k === "indexPrix" ? v : Math.max(0, v);
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
    return {nom: detenu && s.nomDetenu ? s.nomDetenu : s.nom, txt:s.txt, hi:fav.d, lo:def.d, fav, def,
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
/* ═════════════════════════════════════════════════════════════════
   vitrine — pilote de la page d'accueil.
   Rejoue le scénario par défaut avec le moteur et les graphiques de
   la calculatrice : les deux pages ne peuvent pas diverger.
   Les valeurs par défaut sont relues dans index.html par build.py,
   qui remplace la ligne DEFAUTS ci-dessous.
   ═════════════════════════════════════════════════════════════════ */

const DEFAUTS = {
  "prix": 200000.0,
  "notairePct": 8.0,
  "fraisAcq": 0.0,
  "mobilier": 8000.0,
  "apport": 35000.0,
  "duree": 20.0,
  "taux": 3.4,
  "assur": 0.34,
  "valeur": 200000.0,
  "prixAchat": 160000.0,
  "depuis": 8.0,
  "travauxPasses": 0.0,
  "crd": 90000.0,
  "dureeRestante": 12.0,
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
  "compta": 500.0,
  "abattement": 50.0,
  "plafondDeficit": 10700.0,
  "partBati": 85.0,
  "amortBatiAns": 30.0,
  "amortTvxAns": 15.0,
  "amortMobAns": 7.0,
  "horizon": 25.0,
  "inflation": 2.5,
  "indexPrix": 2.5,
  "indexLoyer": 2.5,
  "indexCharges": 2.5,
  "fraisVente": 5.0,
  "bourse": 4.0,
  "fondsEuros": 0.0,
  "livretA": -0.8,
  "fiscBourse": 31.4,
  "fiscFonds": 30.0,
  "situation": "achat",
  "regime": "lmnp-reel",
  "tmi": 30.0,
  "dpe": "",
  "ira": true,
  "comptant": false
};
// Les choix offerts par les listes déroulantes du formulaire : l'assistant pose
// les mêmes tranches d'imposition et les mêmes régimes que la calculatrice.
const OPTIONS = {
  "regime": [
    {
      "valeur": "micro-foncier",
      "libelle": "Nu — micro-foncier (abattement 30 %)"
    },
    {
      "valeur": "reel-foncier",
      "libelle": "Nu — réel (charges + déficit foncier)"
    },
    {
      "valeur": "lmnp-micro",
      "libelle": "Meublé — micro-BIC (abattement 50 %)"
    },
    {
      "valeur": "lmnp-reel",
      "libelle": "Meublé — LMNP au réel (amortissement)"
    }
  ],
  "tmi": [
    {
      "valeur": "0",
      "libelle": "0 %"
    },
    {
      "valeur": "11",
      "libelle": "11 %"
    },
    {
      "valeur": "30",
      "libelle": "30 %"
    },
    {
      "valeur": "41",
      "libelle": "41 %"
    },
    {
      "valeur": "45",
      "libelle": "45 %"
    }
  ]
};

// Sans argument : le scénario d'ouverture de la calculatrice, celui que la
// vitrine met en scène. Avec `surcharges`, celui que l'assistant construit au
// fil des réponses — le reste des hypothèses restant aux valeurs par défaut.
function scenario(surcharges){
  const p = Object.assign({}, DEFAUTS, surcharges || {});
  p.items = (surcharges && surcharges.items ? surcharges.items : TVX_DEFAUT).map(o => ({...o}));
  p.travaux = p.items.reduce((s, it) => s + it.montant, 0);
  // La case « prix, loyers et charges suivent l'inflation » est cochée par défaut.
  p.indexPrix = p.indexLoyer = p.indexCharges = p.inflation;
  return p;
}

function vitrine(){
  oublierTheme();
  const p = scenario(), R = compute(p), f = R.final, b = R.best;
  const g = id => document.getElementById(id);
  const ecrire = (id, txt) => { const el = g(id); if(el) el.textContent = txt; };

  ecrire("vTri", sPct(f.tri));
  ecrire("vReel", sPct(f.triReel));
  ecrire("vAns", p.horizon + " ans");
  const reelEl = g("vReel");
  if(reelEl) reelEl.classList.toggle("bad", f.triReel < 0);
  ecrire("vGain", sEur(f.gain));
  const gainEl = g("vGain");
  if(gainEl) gainEl.className = f.gain >= 0 ? "up" : "down";
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
  const mot = avis(f.triReel, f.triBourseReel);
  const boite = g("vAvisBox");
  if(boite) boite.hidden = mot === null;
  if(mot) ecrire("vAvis", mot);

  drawChart(g("vPlotNet"), g("vTipNet"), cfgGainNet(p, R, {height: 280}));

  // Les quatre régimes dans le temps, tracés comme sur la calculatrice.
  const regs = comparerRegimes(p, R);
  drawChart(g("vPlotReg"), g("vTipReg"), cfgRegimesTemps(p, R, regs,
    {height: 280, floor: plancherLisible(regs.map(r => r.tris), false)}));
  ecrire("vRegNote", meneurRegimes(regs, p.horizon));

  const sens = sensibilite(p, f.tri);
  drawTornado(g("vPlotSens"), g("vTipSens"), cfgSensibilite(sens, f.tri));
  if(sens.length) ecrire("vSens", sens[0].nom.toLowerCase());
}

brancherInfobulles();

let vid;
addEventListener("resize", () => { clearTimeout(vid); vid = setTimeout(vitrine, 140); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => setTimeout(vitrine, 30));
document.addEventListener("theme", vitrine);
vitrine();
/* ═════════════════════════════════════════════════════════════════
   assistant — l'accroche pose les questions, la calculatrice répond.
   Aucun chiffre n'est écrit ici : tout se déduit de DEFAUTS, de
   OPTIONS et de TVX_DEFAUT, à proportion du prix saisi. Répondre par
   les valeurs proposées produit donc un lien qui ne fixe aucune
   hypothèse, c'est-à-dire très exactement le scénario que la vitrine
   affiche plus bas.
   Deux situations, deux jeux de questions : « j'achète un bien », et
   « je possède déjà un bien », où la question n'est plus « faut-il
   acheter ? » mais « faut-il garder ? ».
   ═════════════════════════════════════════════════════════════════ */
(function(){
const racine = document.getElementById("assistant");
if(!racine) return;

const el = id => document.getElementById(id);
const coche = nom => {
  const e = racine.querySelector('input[name="' + nom + '"]:checked');
  return e ? e.value : "";
};
const nb = v => String(v).replace(".", ",");

// La seule valeur que le balisage ne porte pas : les droits de mutation réduits
// du neuf. index.html annonce 2 à 3 %, la calculatrice s'ouvre sur l'ancien.
const NOTAIRE_NEUF = 2.5;

// Les étapes, dans l'ordre. `pour` : la situation qui pose cette question (les
// autres sont communes) ; `actif` : une condition de plus ; `champs` : les
// saisies chiffrées que l'étape prérègle ; `skip` : elle accepte un « je ne
// sais pas encore ».
const ETAPES = [
  {id:"qEtapeBien",     pour:"achat",  champs:["qPrix"],      skip:true},
  {id:"qEtapeValeur",   pour:"detenu", champs:["qValeur"],    skip:true},
  {id:"qEtapeAchat",    pour:"detenu", champs:["qPrixAchat"], skip:true},
  {id:"qEtapeDepuis",   pour:"detenu", champs:["qDepuis"]},
  {id:"qEtapeLoyer",                   champs:["qLoyer"],     skip:true},
  {id:"qEtapeLocation"},
  {id:"qEtapeTravaux",  pour:"achat",  champs:["qTravaux"]},
  {id:"qEtapeApport",   pour:"achat",  champs:["qApport"],    skip:true},
  // Payer comptant, c'est n'avoir aucune durée de prêt à choisir.
  {id:"qEtapeDuree",    pour:"achat",  actif: () => coche("qFinancement") !== "comptant"},
  {id:"qEtapeCredit",   pour:"detenu", champs:["qCrd", "qDureeRestante"]},
  {id:"qEtapeTmi"},
  {id:"qEtapeRecap",    recap:true}
];
let situation = "achat";
const detenu = () => situation === "detenu";
const actives = () => ETAPES.filter(e => (!e.pour || e.pour === situation) && (!e.actif || e.actif()));

/* ---------- ce que l'assistant propose ---------- */
const arrondi = (v, pas) => Math.max(0, Math.round(v/pas)*pas);
// « 200 000 » se lit, « 200000 » se déchiffre. Les montants s'affichent donc
// groupés ; à la lecture on ne retient que les chiffres — l'espace fine des
// milliers ne survivrait pas à un parseFloat, qui rendrait 200.
const chiffres = v => String(v).replace(/[^\d]/g, "");
const lu = (id, defaut) => {
  const v = parseInt(chiffres(el(id).value), 10);
  return isFinite(v) && v > 0 ? v : defaut;
};
// Le prix du bien à acheter, ou la valeur de celui qu'on possède : c'est lui
// qui donne l'échelle.
const prixSaisi = () => detenu() ? lu("qValeur", DEFAUTS.valeur) : lu("qPrix", DEFAUTS.prix);
// Tout se met à l'échelle du prix : un bien deux fois plus cher se loue plus
// cher, coûte plus de taxe foncière et se meuble plus cher. À prix inchangé, le
// facteur vaut 1 et les propositions retombent sur les valeurs d'ouverture.
const facteur = () => prixSaisi() / (detenu() ? DEFAUTS.valeur : DEFAUTS.prix);
const PROPOSE = {
  qPrix:          () => DEFAUTS.prix,
  qValeur:        () => DEFAUTS.valeur,
  qPrixAchat:     () => arrondi(DEFAUTS.prixAchat * facteur(), 1000),
  qDepuis:        () => DEFAUTS.depuis,
  qCrd:           () => arrondi(DEFAUTS.crd * facteur(), 1000),
  qDureeRestante: () => DEFAUTS.dureeRestante,
  qLoyer:         () => arrondi(DEFAUTS.loyer * facteur(), 10),
  qApport:        () => arrondi(DEFAUTS.apport * facteur(), 1000),
  qTravaux:       () => arrondi(TVX_DEFAUT[0].montant * facteur(), 1000)
};
const saisi = id => {
  const v = parseInt(chiffres(el(id).value), 10);
  return isFinite(v) ? v : PROPOSE[id]();
};
const ecrire = (id, v) => { el(id).value = eur1.format(v); };

/* ---------- les réponses, assemblées ---------- */
// Le visiteur choisit nu ou meublé ; le régime, lui, se départage au moteur.
// Poser la question « micro-BIC ou LMNP au réel ? » à quelqu'un qui n'a pas
// encore acheté n'aurait aucun sens : on retient le plus favorable, et la
// calculatrice affiche le comparatif des quatre.
const FAMILLES = {meuble:["lmnp-micro","lmnp-reel"], nu:["micro-foncier","reel-foncier"]};
function regimeRetenu(base){
  const famille = FAMILLES[coche("qLocation")] || null;
  const p = scenario(Object.assign({}, base, {regime: DEFAUTS.regime}));
  let comparaison;
  try{ comparaison = comparerRegimes(p, compute(p)); }
  catch(e){ return famille ? famille[famille.length-1] : DEFAUTS.regime; }
  const candidats = comparaison.filter(r =>
    r.tri !== null && isFinite(r.tri) && (!famille || famille.indexOf(r.rg) >= 0));
  if(!candidats.length) return famille ? famille[famille.length-1] : DEFAUTS.regime;
  return candidats.reduce((m, r) => r.tri > m.tri ? r : m).rg;
}

function reponses(){
  const k = facteur();
  const r = {
    situation: situation,
    loyer: saisi("qLoyer"),
    tmi: coche("qTmi") === "" ? DEFAUTS.tmi : parseFloat(coche("qTmi")),
    tf: arrondi(DEFAUTS.tf * k, 50),
    copro: arrondi(DEFAUTS.copro * k, 5)
  };
  if(detenu()){
    // Un bien qu'on possède : rien à acheter, pas de travaux prévus par défaut.
    r.valeur = prixSaisi();
    r.prixAchat = saisi("qPrixAchat");
    r.depuis = saisi("qDepuis");
    r.comptant = coche("qCredit") === "non";
    r.crd = saisi("qCrd");
    r.dureeRestante = saisi("qDureeRestante");
    r.items = [];
    r.travaux = 0;
  } else {
    const prix = prixSaisi();
    const neuf = coche("qNeuf") === "neuf";
    const tvx = coche("qTvx");
    const items = tvx === "aucun" ? [] : [Object.assign({}, TVX_DEFAUT[0], {
      montant: tvx === "inconnu" ? PROPOSE.qTravaux() : saisi("qTravaux")
    })];
    Object.assign(r, {
      prix: prix,
      neuf: neuf,
      notairePct: neuf ? NOTAIRE_NEUF : DEFAUTS.notairePct,
      duree: parseFloat(coche("qDuree")) || DEFAUTS.duree,
      mobilier: arrondi(DEFAUTS.mobilier * k, 500),
      comptant: coche("qFinancement") === "comptant",
      items: items,
      travaux: items.reduce((s, it) => s + it.montant, 0)
    });
    // Un apport supérieur au coût de l'opération n'a plus rien à financer : on le
    // ramène au plafond, et le récapitulatif le dit. Même assiette que compute().
    // Payer comptant, c'est apporter tout le coût.
    const meuble = coche("qLocation") !== "nu";
    const besoin = Math.round(prix + prix*r.notairePct/100 + r.travaux
      + DEFAUTS.fraisAcq + (meuble ? r.mobilier : 0) + (r.comptant ? 0 : DEFAUTS.fraisDossier));
    const voulu = r.comptant ? besoin : saisi("qApport");
    r.apport = Math.min(voulu, besoin);
    r.plafonne = voulu > r.apport;
  }
  r.regime = regimeRetenu(r);
  r.meuble = r.regime === "lmnp-micro" || r.regime === "lmnp-reel";
  return r;
}

// Ce qui part dans le lien. Le mobilier ne suit qu'en meublé : en nu, la
// calculatrice l'écarte du coût de l'opération, l'inscrire n'apprendrait rien.
// « Comptant » ne voyage que s'il est coché ; la situation, que si elle n'est
// pas celle de l'ouverture.
function valeurs(r){
  const v = {loyer:r.loyer, regime:r.regime, tmi:r.tmi, tf:r.tf, copro:r.copro};
  if(detenu()){
    Object.assign(v, {situation:"detenu", valeur:r.valeur, prixAchat:r.prixAchat, depuis:r.depuis,
      crd:r.crd, dureeRestante:r.dureeRestante});
  } else {
    Object.assign(v, {prix:r.prix, notairePct:r.notairePct, apport:r.apport, duree:r.duree});
    if(r.meuble) v.mobilier = r.mobilier;
  }
  if(r.comptant) v.comptant = true;
  return v;
}

/* ---------- rendu ---------- */
const touches = new Set();
let etape = 0, demarre = false;

// Le lien est complet : les réponses décrivent un projet entier. Sans cela, tout
// ce que le visiteur laisse à sa valeur proposée garderait, dans la calculatrice,
// la saisie de sa visite précédente.
function majLiens(r){
  const cible = "/calculatrice/" + lienHypotheses(valeurs(r), DEFAUTS, r.items, true);
  el("qGo").setAttribute("href", cible);
  el("qSauter").setAttribute("href", cible);
}

const libelleRegime = rg => {
  const o = (OPTIONS.regime || []).filter(x => x.valeur === rg)[0];
  return o ? o.libelle : rg;
};
const ans = n => n + (n > 1 ? " ans" : " an");

// Chaque ligne : le terme, la valeur retenue, la note qui l'explique, et
// l'étape à rouvrir. Le bouton suit la valeur, la note passe en dessous.
function dessinerRecap(r){
  const demande = coche("qLocation");
  const location = ["Location", libelleRegime(r.regime), demande === "inconnu"
      ? "le plus favorable des quatre régimes sur vos chiffres"
      : "le plus favorable des deux régimes possibles", "qEtapeLocation"];
  const loyer = ["Loyer mensuel", eur.format(r.loyer) + " hors charges", "", "qEtapeLoyer"];
  const tranche = ["Tranche d'imposition", r.tmi + " %", "", "qEtapeTmi"];
  const lignes = detenu() ? [
    ["Le bien", eur.format(r.valeur) + " aujourd'hui", "", "qEtapeValeur"],
    ["Acheté", eur.format(r.prixAchat) + " il y a " + ans(r.depuis), "", "qEtapeAchat"],
    loyer, location,
    ["Crédit", r.comptant ? "aucun" : eur.format(r.crd) + " restant dû sur " + ans(r.dureeRestante),
      r.comptant ? "" : "au taux et à l'assurance de la calculatrice", "qEtapeCredit"],
    tranche
  ] : [
    ["Le bien", eur.format(r.prix) + (r.neuf ? " · neuf" : " · ancien"), "", "qEtapeBien"],
    loyer, location,
    ["Travaux", r.travaux ? eur.format(r.travaux) : "aucun", "", "qEtapeTravaux"],
    r.comptant
      ? ["Financement", "comptant, " + eur.format(r.apport), "tout le coût de l'opération, sans crédit", "qEtapeApport"]
      : ["Apport", eur.format(r.apport),
          r.plafonne ? "ramené au coût de l’opération : au-delà, il n’y a plus rien à emprunter" : "", "qEtapeApport"],
    r.comptant ? null : ["Prêt", r.duree + " ans", "", "qEtapeDuree"],
    tranche
  ].filter(Boolean);
  el("qRecap").innerHTML = lignes.map(([terme, valeur, note, id]) =>
    "<dt>" + terme + "</dt><dd><span>" + valeur + "</span>"
    + '<button type="button" class="qmod" data-etape="' + id + '">Modifier<span class="visually-hidden"> : '
    + esc(terme.toLowerCase()) + "</span></button>"
    + (note ? "<small>" + note + "</small>" : "") + "</dd>").join("");

  const suppose = ["la taxe foncière à " + eur.format(r.tf),
                   "les charges de copropriété à " + eur.format(r.copro) + " par mois"];
  if(r.meuble && !detenu()) suppose.push("le mobilier à " + eur.format(r.mobilier));
  const ouverture = [];
  if(!r.comptant) ouverture.push("un crédit à " + nb(DEFAUTS.taux) + " %");
  ouverture.push("une inflation de " + nb(DEFAUTS.inflation) + " % par an");
  ouverture.push("une revente " + (detenu() ? "dans " : "au bout de ") + DEFAUTS.horizon + " ans");
  el("qHypo").innerHTML = "Nous avons supposé, à proportion " + (detenu() ? "de la valeur" : "du prix") + ", "
    + suppose.join(", ") + ". Et, comme la calculatrice à l’ouverture : " + ouverture.join(", ")
    + ". Toutes ces hypothèses restent modifiables dans l’outil.";
}

function montrer(n){
  const liste = actives();
  etape = Math.max(0, Math.min(liste.length - 1, n));
  const e = liste[etape];
  ETAPES.forEach(x => { el(x.id).hidden = x !== e; });
  // Une saisie que le visiteur n'a pas touchée suit le prix : changer le prix
  // après coup remet le loyer proposé à l'échelle, sans écraser une vraie saisie.
  (e.champs || []).forEach(c => { if(!touches.has(c)) ecrire(c, PROPOSE[c]()); });
  el("qCompteur").textContent = e.recap
    ? "Récapitulatif" : "Question " + (etape + 1) + " sur " + (liste.length - 1);
  el("qJauge").style.width = Math.round((etape + 1)/liste.length*100) + "%";
  el("qBack").hidden = etape === 0;
  el("qNext").hidden = !!e.recap;
  el("qSkip").hidden = !e.skip;
  // Sur le récapitulatif, « passer les questions » ferait doublon avec le bouton
  // qui mène au même endroit.
  el("qPasser").hidden = !!e.recap;
  rafraichir();
  if(demarre){
    const titre = el(e.id).querySelector(".qtitre");
    if(titre) titre.focus();
  }
}

// Un seul point de recalcul : le lien, l'affichage des champs conditionnels et,
// sur la dernière étape, le récapitulatif.
function rafraichir(){
  el("qTravauxChamp").hidden = coche("qTvx") !== "montant";
  el("qApportChamps").hidden = coche("qFinancement") === "comptant";
  el("qCreditChamps").hidden = coche("qCredit") === "non";
  const r = reponses();
  majLiens(r);
  if(actives()[etape].recap) dessinerRecap(r);
}

/* ---------- écoutes ---------- */
racine.addEventListener("input", e => {
  if(e.target.id) touches.add(e.target.id);
  rafraichir();
});
racine.addEventListener("change", rafraichir);
// On regroupe les milliers quand le champ est quitté, jamais pendant la frappe :
// le curseur sauterait à chaque caractère.
racine.addEventListener("focusout", e => {
  if(e.target.tagName === "INPUT" && e.target.type === "text" && chiffres(e.target.value))
    ecrire(e.target.id, saisi(e.target.id));
});
racine.addEventListener("keydown", e => {
  if(e.key !== "Enter" || e.target.tagName === "A" || e.target.tagName === "BUTTON") return;
  e.preventDefault();
  demarre = true;
  montrer(etape + 1);
});
el("qNext").addEventListener("click", () => { demarre = true; montrer(etape + 1); });
el("qBack").addEventListener("click", () => { demarre = true; montrer(etape - 1); });
el("qSkip").addEventListener("click", () => {
  (actives()[etape].champs || []).forEach(c => { touches.delete(c); ecrire(c, PROPOSE[c]()); });
  demarre = true;
  montrer(etape + 1);
});
el("qRecap").addEventListener("click", e => {
  const b = e.target.closest(".qmod");
  if(!b) return;
  demarre = true;
  montrer(Math.max(0, actives().findIndex(x => x.id === b.dataset.etape)));
});
// La bascule de situation : un autre jeu de questions, reprises du début.
function choisirSituation(s){
  situation = s;
  el("qSituAchat").setAttribute("aria-pressed", s === "achat" ? "true" : "false");
  el("qSituDetenu").setAttribute("aria-pressed", s === "detenu" ? "true" : "false");
  montrer(0);
}
el("qSituAchat").addEventListener("click", () => choisirSituation("achat"));
el("qSituDetenu").addEventListener("click", () => choisirSituation("detenu"));

/* ---------- démarrage ---------- */
const radio = (nom, valeur, libelle, choisi) =>
  '<label><input type="radio" name="' + nom + '" value="' + esc(valeur) + '"'
  + (choisi ? " checked" : "") + "><span>" + esc(libelle) + "</span></label>";

// Les tranches d'imposition sont celles du formulaire, relues dans le balisage.
el("qTmiChoix").innerHTML =
  (OPTIONS.tmi || []).map(o => radio("qTmi", o.valeur, o.libelle, parseFloat(o.valeur) === DEFAUTS.tmi))
    .join("") + radio("qTmi", "", "Je ne sais pas", false);

// La durée d'ouverture doit figurer parmi les propositions, sans quoi l'assistant
// modifierait une hypothèse à laquelle personne n'a touché.
const dureeDefaut = racine.querySelector('input[name="qDuree"][value="' + DEFAUTS.duree + '"]');
if(dureeDefaut) dureeDefaut.checked = true;
else el("qDureeChoix").insertAdjacentHTML("beforeend",
  radio("qDuree", String(DEFAUTS.duree), DEFAUTS.duree + " ans", true));

montrer(0);
})();
