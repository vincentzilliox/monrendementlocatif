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
  // Les explorations — sensibilité, seuils — ne lisent que le rendement à
  // l'horizon : inutile de résoudre un TRI pour chacune des années d'avant.
  // Leurs lignes intermédiaires portent alors tri = null, et `best` n'a pas de sens.
  const horizonSeul = p.horizonSeul === true;
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
    // Un logement qu'on ne peut plus donner à bail ne rapporte plus rien, à
    // partir de l'année `finLocation` ; charges, crédit et taxes continuent.
    const loue = !(p.finLocation >= 1 && y >= p.finLocation);
    const loyers = loue ? p.loyer*12*Math.pow(1+indexLoyer/100, y-1)*(1-p.vacance/100) : 0;
    // CFE : exonérée la première année d'activité, et sous 5 000 € de recettes.
    const cfeAn = (!cfeApplicable || (y === 1 && !detenu) || loyers <= 5000) ? 0 : p.cfe;
    const chargesFixes = (p.copro*12 + p.tf + p.pno + cfeAn + compta)*Math.pow(1+p.indexCharges/100, y-1);
    const charges = chargesFixes + loyers*(p.gestion+p.entretien)/100;
    const L = sch.years[y-1] || {int:0,pri:0,ass:0,crd:0};
    const annuite = L.int + L.pri + L.ass;
    const fraisEmprunt = L.int + L.ass;
    // Au réel, les frais de dossier et de garantie se déduisent l'année de leur
    // paiement, avec les intérêts : comme eux, ils ne créent au foncier qu'un
    // déficit reportable. Payés le premier jour, ils sont déjà dans le coût : la
    // déduction joue sur l'impôt, pas sur la trésorerie.
    const fraisEmpruntDeduc = fraisEmprunt + (y === 1 ? fraisDossier : 0);

    let impot = 0, amortAn = 0;
    if(p.regime === "micro-foncier" || p.regime === "lmnp-micro"){
      impot = loyers*(1 - p.abattement/100)*tauxImpot;
    } else if(p.regime === "reel-foncier"){
      // Les travaux déductibles s'imputent en totalité l'année de leur paiement.
      // Ce n'est pas une sortie de trésorerie supplémentaire : elle est déjà
      // comptée dans le coût d'acquisition.
      const travauxDeduits = y===1 ? travauxDeductibles : 0;
      const chargesDeduc = charges + travauxDeduits;
      const base = loyers - chargesDeduc - fraisEmpruntDeduc;
      deficits = deficits.filter(d => y - d.y <= 10);
      if(base >= 0){
        let reste = base;
        deficits.forEach(d => { const u = Math.min(d.amt, reste); d.amt -= u; reste -= u; });
        deficits = deficits.filter(d => d.amt > 0.01);
        impot = reste*tauxImpot;
      } else {
        const netHorsEmprunt = loyers - chargesDeduc;
        let global = 0, report = 0;
        if(netHorsEmprunt < 0){ global = -netHorsEmprunt; report = fraisEmpruntDeduc; }
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
      let base = loyers - charges - fraisEmpruntDeduc;
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
    const calcule = !horizonSeul || y === p.horizon;
    const tri = calcule ? irr(flows) : null;
    // Même chronique de versements, placée en bourse : le rendement annualisé
    // net d'impôt directement opposable au TRI du bien.
    const flowsBourse = [-cash0].concat(efforts.slice(0,-1).map(e => -e)).concat([portefeuilleNet - effort]);
    const triBourse = calcule ? irr(flowsBourse) : null;
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

  // Le pic du rendement annualisé : ce que le guide « Quand revendre » décrit.
  let best = null;
  rows.forEach(r => { if(r.tri !== null && (best===null || r.tri > best.tri)) best = r; });

  // Le meilleur moment pour revendre n'est pas le pic : passé le pic, garder le
  // bien rapporte moins que sa moyenne, mais souvent encore plus que la bourse.
  // On garde tant que le bien fait mieux que le produit de sa vente placé en
  // bourse, après impôt : l'année retenue est celle qui laisse le plus de
  // richesse à l'horizon, soit la valeur actuelle la plus haute au taux de la
  // bourse. Une comparaison année par année s'arrêterait avant un palier fiscal
  // qui rend l'attente payante ; celle-ci voit les paliers.
  // `garder` : conserver jusqu'à l'horizon fait mieux que toute revente.
  // `battu` : à aucune date le bien ne rattrape la bourse — pour un bien
  // détenu, le vendre aujourd'hui (y = 0) est alors la meilleure option.
  const rb = rows[rows.length-1].triBourse !== null ? rows[rows.length-1].triBourse : bourse*(1 - fiscB);
  let revente = null, actu = -cash0;
  rows.forEach((r, i) => {
    const d = Math.pow(1 + rb, r.y);
    const v = actu + (r.cfNet + r.netVente)/d;
    if(revente === null || v > revente.valeur) revente = {y:r.y, row:r, valeur:v};
    actu += r.cfNet/d;
  });
  if(revente){
    revente.taux = rb;
    revente.battu = revente.valeur <= 0;
    revente.garder = !revente.battu && revente.y === rows.length;
    if(revente.battu && detenu) revente.y = 0;
  }

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
    p, rows, best, revente, detenu, deja, comptant, gelLoyer, notaire, fraisAcq, fraisDossier, mobilier, besoin, emprunt, cash0,
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

/* ---------- capacité d'emprunt ---------- */
// Norme du Haut Conseil de stabilité financière : les mensualités de crédit,
// assurance comprise, ne dépassent pas 35 % des revenus nets. La banque ne
// retient en général que 70 % du loyer attendu, pour la vacance et les charges.
const PLAFOND_ENDETTEMENT = 0.35, LOYER_RETENU = 0.70;
// `revenus` et `credits` sont mensuels ; sans revenus, pas de ratio. Le capital
// maximal se déduit de la mensualité : à taux et durée fixés, elle est
// proportionnelle au capital, assurance comprise.
function endettement(p, R){
  const revenus = Number(p.revenus) || 0;
  if(revenus <= 0 || R.emprunt <= 0) return null;
  const credits = Math.max(0, Number(p.credits) || 0);
  const assiette = revenus + LOYER_RETENU*p.loyer;
  const mensualiteMax = PLAFOND_ENDETTEMENT*assiette - credits;
  return {
    taux: (credits + R.mensualite)/assiette,
    assiette, mensualiteMax,
    empruntMax: R.mensualite > 0 ? Math.max(0, R.emprunt*mensualiteMax/R.mensualite) : null
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
    q.horizonSeul = true;
    return compute(q).final.tri;
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
/* ---------- seuils : ce qu'il faudrait pour égaler la bourse ---------- */
// Pour chaque paramètre, la valeur à laquelle le rendement du projet rejoint
// celui du même argent placé en bourse, net d'impôt, les autres hypothèses
// restant fixes. Au-dessus d'un prix maximal ou sous un loyer minimal, la
// bourse fait mieux. `borne` encadre la recherche, `precision` l'arrête.
const SEUILS = [
  {k:"prix",      nom:"Prix d'achat maximal",     achat:true,  borne:v => [v*0.2, v*4], precision:50},
  {k:"loyer",     nom:"Loyer minimal",            borne:v => [v*0.2, v*4], precision:1},
  {k:"taux",      nom:"Taux du crédit maximal",   credit:true, borne:() => [0, 12], precision:0.005},
  {k:"indexPrix", nom:"Revalorisation minimale",  borne:() => [-5, 10], precision:0.005},
  {k:"vacance",   nom:"Vacance maximale",         borne:() => [0, 90], precision:0.05}
];
// Rendement du projet moins celui de la cible, à l'horizon : la bourse à mêmes
// versements, ou l'inflation — la frontière où le projet cesse d'enrichir en
// pouvoir d'achat. Ce sont les deux frontières de l'avis. Sans TRI, deux cas
// opposés : rien n'est jamais sorti de la poche (infiniment bon), ou rien n'y
// revient (infiniment mauvais).
function ecartBourse(q, cible){
  const f = compute(Object.assign({}, q, {horizonSeul:true})).final;
  if(f.tri === null) return f.mise <= 1 ? 1 : -1;
  if(cible === "pouvoir") return f.tri - q.inflation/100;
  return f.triBourse === null ? f.tri : f.tri - f.triBourse;
}
function seuils(p, cible){
  const detenu = p.situation === "detenu";
  const credit = !p.comptant && (detenu ? p.crd > 0 : true);
  const devant = ecartBourse(p, cible) >= 0;
  return SEUILS.filter(s => !(s.achat && detenu) && !(s.credit && !credit)).map(s => {
    const essai = v => ecartBourse(Object.assign({}, p, {[s.k]: v}), cible);
    const actuel = p[s.k];
    let [a, b] = s.borne(actuel), fa = essai(a), fb = essai(b);
    // Pas de changement de signe : la bourse gagne, ou perd, sur toute la plage.
    if(fa*fb > 0) return {k:s.k, nom:s.nom, actuel, valeur:null, toujours: fa > 0, devant};
    while(b - a > s.precision){
      const m = (a + b)/2, fm = essai(m);
      if(fa*fm <= 0){ b = m; fb = fm; } else { a = m; fa = fm; }
    }
    return {k:s.k, nom:s.nom, actuel, valeur:(a + b)/2, devant};
  });
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

/* ---------- repères de marché ---------- */
// Les données viennent de donnees/, qu'écrit outils/donnees.py : prix de vente
// DVF et loyers d'annonce de l'ANIL, commune par commune. Ici, rien que du
// calcul : la page charge les fichiers, le moteur les confronte à la saisie.

// Un nom de commune comparable à ce qu'on tape : sans accent ni tiret, « oe »
// pour « œ », « saint » pour « st ».
const normaliser = t => String(t).replace(/œ/gi, "oe").replace(/æ/gi, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[-'’]/g, " ").replace(/\b(st|ste)\b/g, m => m === "st" ? "saint" : "sainte")
  .replace(/\s+/g, " ").trim();
const initiale = t => { const c = normaliser(t).charAt(0); return c >= "a" && c <= "z" ? c : "_"; };
const departementDe = code => code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2);
// Un code commune INSEE : cinq caractères, la Corse en 2A et 2B.
const CODE_COMMUNE = /^[0-9][0-9AB][0-9]{3}$/;

// `liste` : [code, nom, ventes] d'une initiale. Chaque mot tapé doit ouvrir un mot
// du nom ; le nom qui commence par la saisie passe devant, puis les communes
// les plus actives — à nom égal, c'est celle qu'on cherche.
function chercherCommunes(liste, requete, n){
  const mots = normaliser(requete).split(" ").filter(Boolean);
  if(!mots.length) return [];
  const debut = mots.join(" ");
  return liste.map(c => ({c, nom: normaliser(c[1])}))
    .filter(x => { const w = x.nom.split(" "); return mots.every(m => w.some(v => v.startsWith(m))); })
    .sort((a, b) => (b.nom.startsWith(debut) - a.nom.startsWith(debut)) || b.c[2] - a.c[2])
    .slice(0, n).map(x => x.c);
}
const libelleCommune = (code, nom) => `${nom} (${departementDe(code)})`;

// Sous ce nombre de ventes sur la période, la médiane d'une commune dit peu :
// on se replie sur celle du département, et on le dit.
const REPERE_MIN_VENTES = 10;
// `marche` : le fichier du département, {c: {code: fiche}, d: {pa, pm}}. Les
// loyers d'annonce sont charges comprises, pour un logement de référence ; le
// type retenu suit la surface — un studio ne se loue pas au m² d'un T4.
function reperesMarche(marche, code, p){
  const fiche = marche && marche.c && marche.c[code];
  if(!fiche) return null;
  const maison = p.typeBien === "maison";
  const surface = Number(p.surface) || 0;
  const cle = maison ? "pm" : "pa";
  let ventes = fiche[cle], echelle = "commune";
  if(!ventes || ventes[1] < REPERE_MIN_VENTES){ ventes = marche.d && marche.d[cle]; echelle = "departement"; }
  const cleLoyer = maison ? "lm" : surface > 0 && surface <= 45 ? "l12" : surface >= 60 ? "l3" : "la";
  const annonces = fiche[cleLoyer];
  const prixSaisi = p.situation === "detenu" ? p.valeur : p.prix;
  return {
    nom: fiche.n, maison, surface,
    prix: ventes ? {echelle, marche: ventes[0], ventes: ventes[1],
                    saisi: surface > 0 ? prixSaisi/surface : null} : null,
    loyer: annonces ? {cle: cleLoyer, marche: annonces[0], bas: annonces[1], haut: annonces[2],
                       annonces: annonces[3], saisi: surface > 0 ? p.loyer/surface : null} : null,
    // Zone A/B/C, zone tendue (1 : agglomération, 2 : touristique), encadrement
    // des loyers (1 : toute la commune, 2 : une partie), et la tendance des prix
    // du département — une commune a trop peu de ventes pour en avoir une.
    contexte: {zone: fiche.z || null, tension: fiche.t || 0, encadre: fiche.e || 0,
      tendance: tendancePrix(marche.d && marche.d.ev && marche.d.ev[cle]),
      passoires: partPassoires(fiche.dpe, marche.d && marche.d.dpe),
      // [taux an0, taux an1, hausse annuelle en %] : la taxe d'un même logement,
      // taux votés et revalorisation légale des bases compris.
      taxeFonciere: fiche.tf ? {taux0: fiche.tf[0], taux1: fiche.tf[1], evolution: fiche.tf[2]/100} : null}
  };
}
// [DPE classés F ou G, DPE] de la commune, sinon du département — l'import ne
// garde une commune qu'au-delà de trente diagnostics.
function partPassoires(commune, departement){
  const d = commune || departement;
  return d && d[1] > 0 ? {part: d[0]/d[1], dpe: d[1], echelle: commune ? "commune" : "departement"} : null;
}
// [prix an0, prix an1, an0, an1] → variation annuelle moyenne entre les deux.
function tendancePrix(ev){
  if(!ev || !(ev[0] > 0) || ev[3] <= ev[2]) return null;
  return {an0: ev[2], an1: ev[3], taux: Math.pow(ev[1]/ev[0], 1/(ev[3] - ev[2])) - 1};
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
      : `vous : ${F.v(s.actuel)} · <b class="${s.devant ? "pos" : "neg"}">${F.ecart(s.valeur, s.actuel).replace(/ /g, "\u00a0")}</b>`;
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
/* ═════════════════════════════════════════════════════════════════
   residence — acheter sa résidence principale, ou louer et placer.
   Calcul pur, comme moteur.js dont il reprend l'échéancier, le TRI et
   le format des liens : aucun accès au document (outils/verifier.py le
   contrôle). Tous les noms de premier niveau portent RP ou PTZ : ce
   fichier partage la portée globale de chaque page qui le charge.
   ═════════════════════════════════════════════════════════════════ */

/* ---------- prêt à taux zéro ---------- */
// Règles des offres émises depuis le 1er avril 2025, prolongées jusqu'au
// 31 décembre 2027 : service-public.gouv.fr, fiche F10871 (vérifiée le
// 15 septembre 2026), et l'ANIL pour les durées de remboursement.
// La zone A bis se confond avec la zone A : mêmes plafonds, mêmes quotités.
const PTZ_ZONES = ["A", "B1", "B2", "C"];
const zonePTZ = z => z === "Abis" || z === "A bis" ? "A" : PTZ_ZONES.indexOf(z) >= 0 ? z : null;
// Coefficient familial, de une à huit personnes et plus.
const PTZ_COEF = [1, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.3];
// Revenus par part (ressources ÷ coefficient) : haut des tranches 1 à 4. Au-delà
// de la tranche 4, pas de PTZ — le plafond de ressources en découle.
const PTZ_TRANCHES = {A:[25000, 31000, 37000, 49000], B1:[21500, 26000, 30000, 34500],
                      B2:[18000, 22500, 27000, 31500], C:[15000, 19500, 24000, 28500]};
// Coût de l'opération retenu pour une personne ; il suit le coefficient
// familial, plafonné à cinq personnes.
const PTZ_COUT = {A:150000, B1:135000, B2:110000, C:100000};
// Part du coût financée, par tranche : moindre pour une maison individuelle neuve.
const PTZ_QUOTITE = {collectif:[50, 40, 40, 20], maison:[30, 20, 20, 10], ancien:[50, 40, 40, 20]};
// [différé, remboursement] en années, par tranche : plus les revenus sont
// modestes, plus le remboursement attend.
const PTZ_DUREES = [[10, 15], [8, 12], [2, 13], [0, 10]];

// Ce que la réglementation accorderait sur ces hypothèses. `ressources` : le
// revenu fiscal de référence du foyer, ou à défaut — et au minimum — le coût
// de l'opération divisé par neuf. Le coût de l'opération ne compte pas les
// frais de notaire. Rend {montant, tranche, differe, remboursement} ou
// {montant: 0, raison} : la raison dit pourquoi, pour que l'écran l'explique.
function estimerPTZ(p){
  const zone = zonePTZ(p.zone);
  const neuf = p.etat === "neuf";
  const cout = Math.max(0, p.prix) + Math.max(0, p.travaux);
  if(!p.primo) return {montant:0, raison:"primo"};
  if(!zone) return {montant:0, raison:"zone"};
  // Dans l'ancien : zones B2 et C seulement, et des travaux d'au moins le
  // quart du coût total.
  if(!neuf && zone !== "B2" && zone !== "C") return {montant:0, raison:"ancienZone", zone};
  if(!neuf && p.travaux < 0.25*cout) return {montant:0, raison:"ancienTravaux", zone};
  const n = Math.max(1, Math.min(8, Math.round(Number(p.personnes) || 1)));
  const coef = PTZ_COEF[n - 1];
  const ressources = Math.max(Number(p.rfr) || 0, cout/9);
  const parPart = ressources/coef;
  const tranche = PTZ_TRANCHES[zone].findIndex(t => parPart <= t);
  if(tranche < 0) return {montant:0, raison:"revenus", zone, plafond: PTZ_TRANCHES[zone][3]*coef};
  const coutRetenu = Math.min(cout, PTZ_COUT[zone]*PTZ_COEF[Math.min(n, 5) - 1]);
  const type = !neuf ? "ancien" : p.typeBien === "maison" ? "maison" : "collectif";
  const quotite = PTZ_QUOTITE[type][tranche];
  const [differe, remboursement] = PTZ_DUREES[tranche];
  return {montant: Math.round(coutRetenu*quotite/100), tranche: tranche + 1, zone, quotite,
          coutRetenu, differe, remboursement};
}

// Échéancier du PTZ, au format de schedule() : aucun intérêt, rien pendant le
// différé, puis le capital en mensualités égales.
function echeancierPTZ(capital, differe, remboursement){
  const n = Math.max(0, Math.round(remboursement*12)), d = Math.max(0, Math.round(differe*12));
  const m = capital > 0 && n > 0 ? capital/n : 0;
  let crd = n > 0 ? capital : 0;
  const years = [];
  for(let y=1; y<=60; y++){
    let pri = 0;
    for(let k=0; k<12; k++){
      const idx = (y-1)*12 + k;
      if(idx < d || idx >= d + n || crd <= 0.005) continue;
      const q = Math.min(m, crd);
      crd -= q; pri += q;
    }
    years.push({int:0, pri, ass:0, crd:Math.max(0, crd)});
  }
  return {mensualite: m, years};
}

/* ---------- placements ---------- */
// Plafonds de versement, et fiscalité à la sortie. Prélèvements sociaux : 18,6 %
// sur les gains du PEA et du compte-titres depuis la LFSS 2026, 17,2 % sur
// l'assurance-vie, rien sur le Livret A (service-public.gouv.fr, fiche F2329).
const PLAFOND_PEA = 150000, PLAFOND_LIVRET = 22950;
const PFU_IR = 12.8;
// Assurance-vie après huit ans : 7,5 % sur les gains au-delà de l'abattement
// annuel, pour les versements jusqu'à 150 000 € ; 12,8 % au-delà.
const AV_TAUX_REDUIT = 7.5, AV_SEUIL = 150000;
const AV_ABATTEMENT = {seul:4600, couple:9200};

// Un portefeuille, en quatre compartiments. La part « bourse » va au PEA, au
// compte-titres ou en unités de compte selon l'enveloppe choisie ; ce que le
// plafond du PEA refuse va au compte-titres, ce que celui du Livret A refuse va
// au fonds euros.
function portefeuilleRP(){
  return {pea:{cap:0, verse:0}, cto:{cap:0, verse:0}, avUC:{cap:0, verse:0},
          avFonds:{cap:0, verse:0}, livret:{cap:0, verse:0}};
}
function verserRP(pf, montant, p){
  if(!(montant > 0)) return;
  const tot = Math.max(0, p.partBourse) + Math.max(0, p.partFonds) + Math.max(0, p.partLivret);
  const part = k => tot > 0 ? Math.max(0, p[k])/tot : (k === "partBourse" ? 1 : 0);
  const mettre = (c, v) => { c.cap += v; c.verse += v; };
  let bourse = montant*part("partBourse"), fonds = montant*part("partFonds"), livret = montant*part("partLivret");
  const place = Math.max(0, PLAFOND_LIVRET - pf.livret.verse);
  if(livret > place){ fonds += livret - place; livret = place; }
  mettre(pf.livret, livret);
  mettre(pf.avFonds, fonds);
  if(p.enveloppe === "av") mettre(pf.avUC, bourse);
  else if(p.enveloppe === "cto") mettre(pf.cto, bourse);
  else {
    const peaPlace = Math.max(0, PLAFOND_PEA - pf.pea.verse);
    mettre(pf.pea, Math.min(bourse, peaPlace));
    mettre(pf.cto, Math.max(0, bourse - peaPlace));
  }
}
function capitaliserRP(pf, taux){
  pf.pea.cap *= 1 + taux.bourse; pf.cto.cap *= 1 + taux.bourse; pf.avUC.cap *= 1 + taux.bourse;
  pf.avFonds.cap *= 1 + taux.fonds; pf.livret.cap *= 1 + taux.livret;
}
// Ce que le portefeuille rend, impôt payé, s'il est vidé au bout de `age`
// années. L'âge fiscal est celui du plan ou du contrat, ouvert au premier jour :
// c'est lui, pas l'âge de chaque versement, qui fixe le taux.
function netRP(pf, age, p){
  if(p.avantImpot) return pf.pea.cap + pf.cto.cap + pf.avUC.cap + pf.avFonds.cap + pf.livret.cap;
  const gain = c => Math.max(0, c.cap - c.verse);
  const ps = Math.max(0, p.psCapital)/100, psAV = Math.max(0, p.psAV)/100, ir = PFU_IR/100;
  let impot = gain(pf.cto)*(ir + ps);
  impot += gain(pf.pea)*(age >= 5 ? ps : ir + ps);
  const gAV = gain(pf.avUC) + gain(pf.avFonds);
  const verseAV = pf.avUC.verse + pf.avFonds.verse;
  if(age >= 8){
    // L'abattement s'impute sur les gains ; la part des versements au-delà de
    // 150 000 € relève du taux de 12,8 %, au prorata.
    const reduit = verseAV > 0 ? Math.min(1, AV_SEUIL/verseAV) : 1;
    const imposable = Math.max(0, gAV - (p.couple ? AV_ABATTEMENT.couple : AV_ABATTEMENT.seul));
    impot += gAV*psAV + imposable*(reduit*AV_TAUX_REDUIT/100 + (1 - reduit)*ir);
  } else {
    impot += gAV*(ir + psAV);
  }
  return pf.pea.cap + pf.cto.cap + pf.avUC.cap + pf.avFonds.cap + pf.livret.cap - impot;
}

// Les travaux perdent leur valeur au même rythme que le poste par défaut de la
// calculatrice d'investissement : 5 % par an, pendant vingt ans.
const TVX_RP = {taux:5, duree:20};
// Au-delà de l'horizon, la simulation continue jusqu'à quarante ans : l'année
// où l'achat prend l'avantage peut tomber après la date de départ envisagée.
const HORIZON_MAX_RP = 40;

/* ---------- acheter ou louer ---------- */
// Deux ménages identiques, dans deux logements identiques. L'un achète, l'autre
// loue. Chaque année, ils sortent exactement la même somme de leur poche : le
// plus grand des deux coûts de logement. Celui dont le logement coûte le moins
// place la différence. À chaque date, on compare ce que chacun possède, une fois
// tout vendu et l'impôt payé : le logement et le portefeuille du propriétaire,
// le portefeuille et le dépôt de garantie du locataire.
function acheterOuLouer(p){
  const comptant = p.comptant === true;
  const neuf = p.etat === "neuf";
  const horizonSeul = p.horizonSeul === true;
  const notaire = p.prix*p.notairePct/100;
  const fraisDossier = comptant ? 0 : p.fraisDossier;
  const besoin = p.prix + notaire + p.travaux + fraisDossier;
  // Le PTZ complète un autre prêt, sans jamais le dépasser : il ne finance donc
  // au plus que la moitié de ce qu'il reste à emprunter. Sans crédit, pas de PTZ.
  const estimation = p.ptzMode === "auto" ? estimerPTZ(p) : null;
  const ptzDemande = p.ptzMode === "auto" ? estimation.montant : p.ptzMode === "manuel" ? Math.max(0, p.ptzMontant) : 0;
  const reste = Math.max(0, besoin - p.apport);
  const ptz = comptant ? 0 : Math.min(ptzDemande, reste/2);
  const emprunt = comptant ? 0 : Math.max(0, reste - ptz);
  const differe = estimation && estimation.montant > 0 ? estimation.differe : Math.max(0, p.ptzDiffere);
  const remboursement = estimation && estimation.montant > 0 ? estimation.remboursement : Math.max(0, p.ptzDuree);
  const sch = schedule(emprunt, p.taux, p.duree, p.assur);
  const schPTZ = echeancierPTZ(ptz, differe, remboursement);

  // Le premier jour. L'acheteur paie ce que les prêts ne couvrent pas, et son
  // déménagement ; le locataire, s'il change de logement, les frais d'agence, le
  // dépôt de garantie et le même déménagement.
  const cash0Achat = Math.max(0, besoin - emprunt - ptz) + p.demenagement;
  const depot = p.dejaLocataire ? 0 : p.depotMois*p.loyer;
  const cash0Loc = p.dejaLocataire ? 0 : p.fraisAgenceLoc + depot + p.demenagement;
  const mise0 = cash0Achat - cash0Loc;

  const nominal = r => (1 + r/100)*(1 + p.inflation/100) - 1;
  const taux = {bourse: nominal(p.bourse), fonds: nominal(p.fondsEuros), livret: nominal(p.livretA)};
  const pfLoc = portefeuilleRP(), pfProp = portefeuilleRP();
  verserRP(pfLoc, Math.max(0, mise0), p);
  verserRP(pfProp, Math.max(0, -mise0), p);

  const valeur0 = p.prix + p.travaux;
  const valeurAn = y => (p.prix + residuTravaux([{montant:p.travaux, taux:TVX_RP.taux, duree:TVX_RP.duree}], y))
    *Math.pow(1 + p.indexPrix/100, y);
  const fin = horizonSeul ? p.horizon : Math.max(p.horizon, HORIZON_MAX_RP);
  const rows = [], flux = [-mise0];
  let cumulProp = 0, cumulLoc = 0;
  for(let y=1; y<=fin; y++){
    const ic = Math.pow(1 + p.indexCharges/100, y-1);
    const L = sch.years[y-1] || {int:0, pri:0, ass:0, crd:0};
    const P = schPTZ.years[y-1] || {int:0, pri:0, ass:0, crd:0};
    // Le neuf est exonéré de taxe foncière deux ans, à hauteur de ce que la
    // commune a voté : 40 % au moins.
    const tf = p.tf*ic*(neuf && y <= 2 ? 1 - p.tfExo/100 : 1);
    const copro = p.copro*12*ic;
    const entretien = valeurAn(y-1)*p.entretien/100;
    const assurHab = p.assurProprio*ic;
    const credit = L.int + L.pri + L.ass + P.pri;
    const coutProprio = credit + tf + copro + entretien + assurHab;
    const loyerAn = p.loyer*12*Math.pow(1 + p.indexLoyer/100, y-1);
    const coutLoc = loyerAn + p.assurLocataire*ic;
    const D = coutProprio - coutLoc;
    const versLoc = Math.max(0, D), versProp = Math.max(0, -D);
    capitaliserRP(pfLoc, taux); capitaliserRP(pfProp, taux);
    verserRP(pfLoc, versLoc, p); verserRP(pfProp, versProp, p);
    cumulProp += coutProprio; cumulLoc += coutLoc;

    const valeur = valeurAn(y);
    const fraisVente = valeur*p.fraisVente/100;
    const ira = (p.ira && L.crd > 0) ? Math.min(0.03*L.crd, L.crd*(p.taux/100)/2) : 0;
    const netPortProp = netRP(pfProp, y, p), netPortLoc = netRP(pfLoc, y, p);
    // Une résidence principale se revend sans impôt sur la plus-value
    // (art. 150 U, II, 1° du CGI) : seuls les frais et les dettes s'en vont.
    const netLogement = valeur - fraisVente - L.crd - P.crd - ira;
    const liquidation = netLogement + netPortProp;
    const patrimoineLoc = netPortLoc + depot;
    const ecart = liquidation - patrimoineLoc;
    const deflateur = Math.pow(1 + p.inflation/100, y);
    // Le rendement de l'achat : ce que rapporte l'argent que l'achat coûte en
    // plus de la location — la mise du premier jour, puis chaque écart annuel —,
    // récupéré à la revente, dépôt de garantie déduit.
    const calcule = y <= p.horizon && (!horizonSeul || y === p.horizon);
    const triAchat = calcule ? irr(flux.concat([-D + netLogement - depot])) : null;
    flux.push(-D);
    rows.push({y, valeur, crd:L.crd, crdPTZ:P.crd, ira, fraisVente, interets:L.int, assurance:L.ass,
      principal:L.pri, principalPTZ:P.pri, tf, copro, entretien, assurHab, credit, coutProprio,
      loyerAn, coutLoc, versProp, versLoc, sortie:Math.max(coutProprio, coutLoc), cumulProp, cumulLoc,
      portProp:netPortProp, portLoc:netPortLoc, depot, netLogement, liquidation, patrimoineLoc, ecart,
      ecartReel: ecart/deflateur, liquidationReel: liquidation/deflateur, patrimoineLocReel: patrimoineLoc/deflateur,
      triAchat});
  }
  // `bascule` : la première année où acheter passe devant. `repli` : la
  // première année d'après où louer repasse devant, s'il y en a une — un achat
  // comptant laisse le portefeuille du locataire capitaliser, et le rattraper
  // parfois au bout de trente ans. Aucune des deux ne dépend de l'unité : en
  // euros courants ou d'aujourd'hui, l'écart change de taille, jamais de signe.
  const iB = rows.findIndex(r => r.ecart >= 0);
  const bascule = iB < 0 ? null : rows[iB].y;
  const iR = iB < 0 ? -1 : rows.findIndex((r, i) => i > iB && r.ecart < 0);
  const repli = iR < 0 ? null : rows[iR].y;
  const final = rows[p.horizon - 1];

  // Le rendement net du placement du locataire : un euro versé le premier jour,
  // selon la répartition, retiré à l'horizon impôt payé.
  const unite = portefeuilleRP();
  verserRP(unite, 1, p);
  for(let y=1; y<=p.horizon; y++) capitaliserRP(unite, taux);
  const rendementPlacement = Math.pow(Math.max(1e-9, netRP(unite, p.horizon, p)), 1/p.horizon) - 1;

  const r1 = rows[0];
  // Le coût annuel d'être propriétaire, la première année : ce qui part sans
  // retour. Le capital remboursé n'en est pas — il reste à soi. Le coût
  // d'opportunité, lui, en est : l'argent immobilisé dans le logement ne
  // rapporte plus ce que rapporterait le placement. Les frais d'entrée et de
  // sortie s'étalent sur la durée prévue ; la hausse de la valeur vient en moins.
  const h = p.horizon;
  const couts1 = {
    interets: r1.interets + r1.assurance, tf: r1.tf, copro: r1.copro, entretien: r1.entretien,
    assurHab: r1.assurHab,
    opportunite: Math.max(0, cash0Achat - p.demenagement)*rendementPlacement,
    frais: (notaire + fraisDossier + final.fraisVente + final.ira)/h,
    plusValue: -(valeurAn(1) - valeur0),
    loyer: r1.loyerAn, assurLoc: p.assurLocataire,
    fraisLoc: p.dejaLocataire ? 0 : p.fraisAgenceLoc/h
  };
  couts1.proprio = couts1.interets + couts1.tf + couts1.copro + couts1.entretien + couts1.assurHab
    + couts1.opportunite + couts1.frais + couts1.plusValue;
  couts1.locataire = couts1.loyer + couts1.assurLoc + couts1.fraisLoc;

  return {p, comptant, neuf, notaire, fraisDossier, besoin, emprunt, ptz, estimation, differe, remboursement,
    cash0Achat, cash0Loc, mise0, depot, valeur0,
    mensualite: sch.mensualite, mensualitePTZ: schPTZ.mensualite,
    coutCredit: sch.years.reduce((s, L) => s + L.int + L.ass, 0),
    ratioPrixLoyer: p.loyer > 0 ? p.prix/(p.loyer*12) : null,
    rows: rows.slice(0, p.horizon), suite: rows, final, bascule, repli,
    rendementPlacement, couts1};
}

// La même comparaison, le locataire plaçant tout sur un seul support : ce que
// la répartition choisie change au verdict.
const PLACEMENTS_RP = [
  {k:"bourse", nom:"Tout en actions", parts:{partBourse:100, partFonds:0, partLivret:0}},
  {k:"fonds",  nom:"Tout en fonds euros", parts:{partBourse:0, partFonds:100, partLivret:0}},
  {k:"livret", nom:"Tout sur Livret A", parts:{partBourse:0, partFonds:0, partLivret:100}}
];
function comparerPlacementsRP(p){
  return PLACEMENTS_RP.map(s => {
    const R = acheterOuLouer(Object.assign({}, p, s.parts));
    return {k:s.k, nom:s.nom, bascule:R.bascule, ecart:R.final.ecart, ecartReel:R.final.ecartReel,
      rendement:R.rendementPlacement, rows:R.rows.map(r => r.patrimoineLoc),
      rowsReel:R.rows.map(r => r.patrimoineLocReel)};
  });
}

/* ---------- sensibilité ---------- */
// Chaque paramètre bouge seul, d'un écart plausible ; on lit l'avance de l'achat
// à l'horizon, en euros d'aujourd'hui.
const SENS_RP = [
  {k:"prix",       nom:"Prix d'achat",             pas:v => v*0.10, txt:"10 %"},
  {k:"loyer",      nom:"Loyer",                    pas:v => v*0.10, txt:"10 %"},
  {k:"indexPrix",  nom:"Revalorisation du logement", pas:() => 1,   txt:"1 pt/an", libre:true},
  {k:"indexLoyer", nom:"Hausse des loyers",        pas:() => 1,     txt:"1 pt/an", libre:true},
  {k:"taux",       nom:"Taux du crédit",           pas:() => 1,     txt:"1 pt", credit:true},
  {k:"bourse",     nom:"Rendement de la bourse",   pas:() => 1,     txt:"1 pt/an", libre:true},
  {k:"entretien",  nom:"Entretien",                pas:() => 0.5,   txt:"0,5 pt"},
  {k:"tf",         nom:"Taxe foncière",            pas:v => v*0.20, txt:"20 %"},
  {k:"horizon",    nom:"Durée d'occupation",       pas:() => 5,     txt:"5 ans"}
];
const ecartRP = q => acheterOuLouer(Object.assign({}, q, {horizonSeul:true})).final.ecartReel;
// Sans crédit — comptant, ou un apport qui couvre tout —, le taux ne joue pas.
const sansCreditRP = p => p.comptant || acheterOuLouer(Object.assign({}, p, {horizonSeul:true})).emprunt <= 0;
function sensibiliteRP(p, ref){
  const sansCredit = sansCreditRP(p);
  return SENS_RP.filter(s => !(s.credit && sansCredit)).map(s => {
    const essai = signe => {
      const q = Object.assign({}, p);
      const v = p[s.k] + signe*s.pas(p[s.k]);
      q[s.k] = s.libre ? v : s.k === "horizon" ? Math.max(1, Math.min(HORIZON_MAX_RP, Math.round(v))) : Math.max(0, v);
      return ecartRP(q);
    };
    const moins = essai(-1), plus = essai(1);
    const dm = moins - ref, dp = plus - ref;
    const fav = dp >= dm ? {d:dp, tri:plus, s:"+"} : {d:dm, tri:moins, s:"−"};
    const def = dp >= dm ? {d:dm, tri:moins, s:"−"} : {d:dp, tri:plus, s:"+"};
    return {k:s.k, nom:s.nom, txt:s.txt, hi:fav.d, lo:def.d, fav, def,
      amplitude: Math.max(Math.abs(dp), Math.abs(dm))};
  }).filter(r => r.amplitude > 1).sort((a, b) => b.amplitude - a.amplitude);
}

/* ---------- seuils : ce qu'il faudrait pour que l'achat fasse jeu égal ---------- */
// La valeur de chaque paramètre à laquelle acheter et louer se valent à
// l'horizon, les autres restant fixes. Au-dessus d'un prix maximal, sous un
// loyer minimal, sous une revalorisation minimale, louer l'emporte.
const SEUILS_RP = [
  {k:"prix",      nom:"Prix d'achat maximal",       borne:v => [v*0.3, v*3], precision:100},
  {k:"loyer",     nom:"Loyer minimal",              borne:v => [v*0.3, v*3], precision:1},
  {k:"indexPrix", nom:"Revalorisation minimale",    borne:() => [-5, 10],   precision:0.005},
  {k:"taux",      nom:"Taux du crédit maximal",     borne:() => [0, 12],    precision:0.005, credit:true},
  {k:"bourse",    nom:"Rendement boursier maximal", borne:() => [-5, 15],   precision:0.005}
];
function seuilsRP(p){
  const devant = ecartRP(p) >= 0, sansCredit = sansCreditRP(p);
  return SEUILS_RP.filter(s => !(s.credit && sansCredit)).map(s => {
    const essai = v => ecartRP(Object.assign({}, p, {[s.k]: v}));
    const actuel = p[s.k];
    let [a, b] = s.borne(actuel), fa = essai(a), fb = essai(b);
    if(fa*fb > 0) return {k:s.k, nom:s.nom, actuel, valeur:null, toujours: fa > 0, devant};
    while(b - a > s.precision){
      const m = (a + b)/2, fm = essai(m);
      if(fa*fm <= 0){ b = m; fb = fm; } else { a = m; fa = fm; }
    }
    return {k:s.k, nom:s.nom, actuel, valeur:(a + b)/2, devant};
  });
}

/* ---------- capacité d'emprunt ---------- */
// Même norme que pour l'investissement (PLAFOND_ENDETTEMENT, moteur.js), sans
// loyer à retenir. Le PTZ différé ne pèse pas tant qu'il ne se rembourse pas ;
// on retient la mensualité la plus lourde, PTZ compris, par prudence.
function endettementRP(p, R){
  const revenus = Number(p.revenus) || 0;
  if(revenus <= 0 || (R.emprunt <= 0 && R.ptz <= 0)) return null;
  const credits = Math.max(0, Number(p.credits) || 0);
  const mensualite = R.mensualite + R.mensualitePTZ;
  return {taux: (credits + mensualite)/revenus, mensualite,
    mensualiteMax: PLAFOND_ENDETTEMENT*revenus - credits};
}

// Le verdict en une phrase, écrit ici pour que la calculatrice et l'accueil
// disent la même chose. Il répond pour la durée d'occupation prévue, et situe
// l'année où la réponse change.
function avisRP(R){
  const h = R.p.horizon, b = R.bascule, r = R.repli, e = R.final.ecartReel;
  const somme = eur.format(Math.abs(e)), eme = n => n === 1 ? "1re" : n + "e";
  const ans = n => n + (n > 1 ? " ans" : " an");
  if(b === null)
    return `Sur vos hypothèses, louer et placer la différence reste plus avantageux à toute date, jusqu'à ${HORIZON_MAX_RP} ans : acheter vous laisserait ${somme} de moins dans ${ans(h)}, en euros d'aujourd'hui.`;
  if(e < 0)
    return b > h
      ? `Pour ${ans(h)}, louer l'emporte de ${somme} en euros d'aujourd'hui. Acheter ne devient gagnant qu'à partir de la ${eme(b)} année : c'est la durée d'occupation qui décide.`
      : `Acheter passe devant la ${eme(b)} année, mais louer et placer repasse devant la ${eme(r)} : au bout de ${ans(h)}, louer l'emporte de ${somme}, en euros d'aujourd'hui.`;
  const fragile = h - b <= 2 ? " La marge est mince : un départ un peu plus tôt que prévu inverserait la réponse." : "";
  const retour = r ? ` Au-delà de ${ans(r - 1)}, louer et placer repasserait devant.` : "";
  return (b <= 3
    ? `Acheter l'emporte presque d'emblée, dès la ${eme(b)} année. Dans ${ans(h)}, vous posséderiez ${somme} de plus qu'en louant, en euros d'aujourd'hui.`
    : `Acheter devient gagnant à partir de la ${eme(b)} année. Dans ${ans(h)}, vous posséderiez ${somme} de plus qu'en louant et plaçant la différence, en euros d'aujourd'hui.`)
    + fragile + retour;
}
