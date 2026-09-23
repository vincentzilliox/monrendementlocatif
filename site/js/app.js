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
    const loyers = p.loyer*12*Math.pow(1+indexLoyer/100, y-1)*(1-p.vacance/100);
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
// Rendement du projet moins celui de la bourse, à l'horizon. Sans TRI, deux cas
// opposés : rien n'est jamais sorti de la poche (infiniment bon), ou rien n'y
// revient (infiniment mauvais).
function ecartBourse(q){
  const f = compute(Object.assign({}, q, {horizonSeul:true})).final;
  if(f.tri === null) return f.mise <= 1 ? 1 : -1;
  return f.triBourse === null ? f.tri : f.tri - f.triBourse;
}
function seuils(p){
  const detenu = p.situation === "detenu";
  const credit = !p.comptant && (detenu ? p.crd > 0 : true);
  const devant = ecartBourse(p) >= 0;
  return SEUILS.filter(s => !(s.achat && detenu) && !(s.credit && !credit)).map(s => {
    const essai = v => ecartBourse(Object.assign({}, p, {[s.k]: v}));
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
      tendance: tendancePrix(marche.d && marche.d.ev && marche.d.ev[cle])}
  };
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
   calculatrice — lecture du formulaire, rendu, persistance.
   Seul fichier autorisé à connaître les identifiants des champs.
   ═════════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
// Une explication produite au fil du rendu : même balisage que celles écrites à
// la main dans index.html, donc même bulle et même comportement au clavier.
const bulle = txt => `<span class="ihint"><button type="button" class="i" aria-label="Explication" aria-expanded="false">i</button><span class="ibody" hidden>${txt}</span></span>`;

/* ---------- formulaire ---------- */
const FIELDS = ["prix","notairePct","fraisAcq","mobilier","apport","duree","taux","assur",
  "valeur","prixAchat","depuis","travauxPasses","crd","dureeRestante","surface",
  "fraisDossier","loyer","vacance","copro","tf","pno","gestion","entretien",
  "ps","psPV","cfe","compta","abattement","plafondDeficit","partBati","amortBatiAns","amortTvxAns","amortMobAns","horizon",
  "inflation","indexPrix","indexLoyer","indexCharges","fraisVente","bourse","fondsEuros","livretA","fiscBourse","fiscFonds",
  "revenus","credits"];
// Ce qui décrit le foyer et non le projet : retenu dans ce navigateur, jamais
// inscrit dans un lien, et conservé quand on ouvre le lien de quelqu'un d'autre.
const PRIVES = ["revenus","credits"];
const SELECTS = ["situation","regime","tmi","dpe","typeBien"];
const DEFAULTS = {};
FIELDS.concat(SELECTS).forEach(k => DEFAULTS[k] = $(k).value);
DEFAULTS.ira = true;
DEFAULTS.prixSuitInflation = true;
DEFAULTS.comptant = false;
DEFAULTS.commune = "";
// La commune voyage par son code INSEE ; le champ, lui, montre son nom.
let communeCode = "";

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
  p.situation = $("situation").value;
  p.regime = $("regime").value;
  p.tmi = parseFloat($("tmi").value);
  p.dpe = $("dpe").value;
  p.typeBien = $("typeBien").value;
  p.commune = communeCode;
  p.ira = $("ira").checked;
  p.comptant = $("comptant").checked;
  p.avantImpot = fiscalite === "brut";
  // Par défaut prix, loyers et charges suivent l'inflation : pas de gain réel sur
  // la pierre, seuls le levier et les loyers créent de la valeur.
  if($("prixSuitInflation").checked){
    p.indexPrix = p.inflation;
    p.indexLoyer = p.inflation;
    p.indexCharges = p.inflation;
  }
  p.horizon = Math.max(1, Math.min(40, Math.round(p.horizon)));
  // Un champ vidé donnait duree=0, donc un emprunt jamais remboursé.
  p.duree = Math.max(1, Math.min(40, Math.round(p.duree)));
  // Un crédit en cours peut n'avoir plus rien à courir ; les années déjà
  // détenues, elles, ne sont jamais négatives.
  p.dureeRestante = Math.max(0, Math.min(40, Math.round(p.dureeRestante)));
  p.depuis = Math.max(0, Math.min(60, Math.round(p.depuis)));
  p.items = items;
  p.travaux = items.reduce((s, it) => s + it.montant, 0);
  return p;
}

/* ---------- render ---------- */
let R = null;
let echelleTri = "lisible";   // « lisible » borne le bas du graphe, « complete » montre tout
// Année de revente explorée dans la cascade. null = l'horizon retenu ; la valeur
// est bornée à chaque rendu, pour suivre un horizon qu'on raccourcirait.
let anneeCascade = null;
try{
  const e = localStorage.getItem("rentaloc.echelle");
  if(e === "lisible" || e === "complete") echelleTri = e;
}catch(e){}
// « net » : tout s'affiche après impôt, comme le verdict l'a toujours fait.
// « brut » : le même projet avant impôt, pour mesurer ce que coûte la fiscalité.
// La page s'ouvre toujours en net : le brut se consulte, il ne se retient pas.
// Un visiteur revenu lire un rendement avant impôt le prendrait pour le sien.
// Une version précédente retenait ce choix : on efface ce qu'elle a laissé.
let fiscalite = "net";
try{ localStorage.removeItem("rentaloc.fiscalite"); }catch(e){}

function render(){
  oublierTheme();
  // Tant que la case est cochée, prix, loyers et charges recopient l'inflation
  // et disparaissent du panneau : trois champs de moins à régler.
  syncSituation();
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
  const marche = renderMarche(p);
  renderTaux(p);
  const {rows, best, final} = R;
  const brut = p.avantImpot;
  const detenu = R.detenu;
  // Les impôts restent annoncés en brut : c'est précisément ce que l'affichage
  // ne déduit pas. On les lit sur le même projet, calculé net.
  const Rnet = brut ? compute(Object.assign({}, p, {avantImpot:false})) : R;
  // Point mort : première année où revendre cesse de laisser une perte.
  const mort = rows.findIndex(r => r.gainImmo >= 0);

  const triF = final.tri;
  const heroEl = $("heroTri");
  heroEl.textContent = triF===null ? "—" : sPct(triF);
  heroEl.classList.toggle("bad", triF!==null && triF<0);
  // Dans le tiroir du téléphone, le rendement suit la saisie : les résultats sont dessous.
  $("railTri").textContent = triF===null ? "" : sPct(triF) + " par an";
  $("heroAns").textContent = p.horizon + " ans";

  // Le pouvoir d'achat tenait en trois phrases ; il tient en un nombre étiqueté.
  const triReel = final.triReel;
  const reelEl = $("heroReel");
  reelEl.textContent = triF===null ? "—" : sPct(triReel);
  reelEl.classList.toggle("bad", triF!==null && triReel<0);
  $("heroReelTxt").textContent = triF===null
    ? (detenu ? "une vente aujourd'hui ne vous rendrait rien : aucun capital n'est immobilisé"
              : "rien ne sort de votre poche : un rendement sans mise n'a pas de sens")
    : `en pouvoir d'achat, ${pct(p.inflation/100)} d'inflation retirés`;

  $("vdMise").textContent = triF===null ? "—" : eur.format(final.mise);
  const gainEl = $("vdGain");
  gainEl.textContent = sEur(final.gain);
  gainEl.className = final.gain >= 0 ? "up" : "down";
  $("vdMort").textContent = mort===-1 ? "jamais" : mort===0 ? "immédiat" : "année " + rows[mort].y;

  // Les taux de placement sont réels ; on les convertit en nominal pour les hints
  // et pour la ligne de référence du graphique, qui trace un TRI nominal.
  const enNominal = r => (1 + r/100)*(1 + p.inflation/100) - 1;
  const bourseReelle = p.bourse/100;
  const bourse = enNominal(p.bourse);
  $("hLivret").textContent = `soit ${pct(enNominal(p.livretA))} en euros courants, exonéré`;
  $("hFonds").textContent = `soit ${pct(enNominal(p.fondsEuros))} en euros courants, avant impôt`;
  $("hBourse").textContent = `soit ${pct(bourse)} en euros courants, avant impôt`;

  const pill = $("benchPill");
  let ecart = null;
  if(triF===null){ pill.textContent="n/a"; pill.className="pill num flat"; $("benchText").textContent=""; }
  else {
    const bNet = final.triBourseReel === null ? bourseReelle : final.triBourseReel;
    ecart = triReel - bNet;
    pill.textContent = pts(ecart);
    pill.className = "pill num " + (Math.abs(ecart)<0.002 ? "flat" : ecart>0 ? "win" : "lose");
    $("benchText").textContent =
      (Math.abs(ecart)<0.002 ? "à égalité avec" : ecart>0 ? "de mieux que" : "de moins que")
      + ` la bourse, qui rend ${pct(bNet)} par an ${brut ? "avant impôt" : "nette d'impôt"}`;
  }
  // Le chiffre du verdict suit le lecteur dans la sous-navigation collante.
  $("navTri").innerHTML = triF===null ? ""
    : `<b>${sPct(triF)}</b> par an${ecart===null ? "" : " · " + pts(ecart) + " vs bourse"}`;
  // L'avis juge ce que vous gardez : il ne se prononce pas sur des chiffres avant impôt.
  const mot = triF === null || brut ? null : avis(triReel, final.triBourseReel === null ? bourseReelle : final.triBourseReel);
  $("avisBox").hidden = mot === null;
  if(mot) $("avisText").textContent = mot;

  if(best){
    $("bestEyebrow").textContent = detenu
      ? `Meilleur moment pour revendre, dans les ${p.horizon} ans`
      : `Meilleur moment pour revendre, sur ${p.horizon} ans`;
    $("bestYear").textContent = detenu ? `Dans ${best.y} ${best.y > 1 ? "ans" : "an"}` : "Année " + best.y;
    $("bestText").textContent = best.y === p.horizon
      ? "Le rendement progresse encore en fin de période : allongez l'horizon pour voir s'il plafonne."
      : "Au-delà, les abattements de plus-value ne compensent plus la fin de l'effet de levier.";
    $("bestList").innerHTML =
      `<dt>Rendement annualisé</dt><dd>${sPct(best.tri)}</dd>` +
      `<dt>${brut ? "Récupéré à la vente, avant impôt" : "Net récupéré à la vente"}</dt><dd>${eur.format(best.netVente)}</dd>` +
      `<dt>${brut ? "Gain total avant impôt" : "Gain net total"}</dt><dd>${sEur(best.gain)}</dd>`;
  } else {
    $("bestEyebrow").textContent = "Meilleur moment pour revendre";
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
    ["les frais d'agence", R.fraisAcq], ["le mobilier", R.mobilier], ["les frais de dossier", R.fraisDossier]]
    .filter(x => x[1] > 0).map(x => x[0]);
  $("dCap").textContent = R.emprunt > 0
    ? "Coût total = " + postes.join(", ") + "."
    : R.comptant ? "Achat comptant : tout le coût sort de votre poche le premier jour, sans frais de dossier."
    : "Votre apport couvre la totalité : achat comptant, aucun emprunt.";
  // Bien détenu : ce qu'une vente aujourd'hui rendrait, poste par poste. C'est
  // la mise de départ, celle qu'on choisit de laisser dans le bien.
  $("dvCap").textContent = "Ce qu'une vente aujourd'hui rendrait, net de frais d'agence, de crédit et d'impôt de plus-value : la mise d'un bien déjà détenu.";
  if(R.vente0){
    const v0 = R.vente0;
    $("dvValeur").textContent = eur.format(R.valeur0 - p.travaux);
    $("dvFrais").textContent = "− " + eur.format(v0.fraisVente + v0.ira);
    $("dvCrd").textContent = "− " + eur.format(R.emprunt);
    $("dvPV").textContent = "− " + eur.format(v0.impotPV);
    $("dvNet").textContent = eur.format(R.net0);
    $("dvCap").textContent = R.net0 > 0
      ? `C'est votre mise : en gardant le bien, vous renoncez à ${eur.format(R.net0)} placés ailleurs.`
        + (p.travaux > 0 ? ` Les ${eur.format(p.travaux)} de travaux prévus s'y ajoutent.` : "")
      : "Une vente aujourd'hui ne rendrait rien : le crédit et les frais absorbent la valeur du bien.";
  }

  const cf = R.cfMensuel1;
  const r1 = rows[0];
  const couverture = r1.annuite > 0 ? r1.loyers/r1.annuite : null;
  const impotsLoyers = Rnet.rows.reduce((s,x) => s + x.impot, 0);
  const impotsTotal = impotsLoyers + Rnet.final.impotPV + Rnet.final.repriseDF;

  // Le point mort a rejoint le verdict ; sa place revient à l'effort d'épargne,
  // qui répond à la question qu'on se pose vraiment : combien ça me coûte, et
  // pendant combien de temps. Chaque phrase d'explication part en infobulle.
  // Math.max écarte le zéro négatif, que le format afficherait « -0 € ».
  const effort = Math.max(0, -R.cumulEffort);
  $("indicateurs").innerHTML = [
    ["Rentabilité brute", pct(R.brute),
      detenu
        ? `Loyers annuels divisés par la valeur actuelle du bien, comme dans les annonces.`
        : `Loyers annuels divisés par le prix d'achat, comme dans les annonces. Rapportée au coût total — frais de notaire, agence et travaux compris — elle vaut ${pct(R.bruteCout)}.`, ""],
    brut ? ["Rentabilité nette", pct(R.nette),
      `Après charges, avant impôt, sur la première année, rapportée ${detenu ? "à la valeur du bien" : "au coût total de l'opération"}. Après impôt : ${pct(Rnet.netteNette)}.`, ""] :
    ["Rentabilité nette-nette", pct(R.netteNette),
      `Après charges et impôt, sur la première année, rapportée ${detenu ? "à la valeur du bien" : "au coût total de l'opération"}. ` + (
      r1.impot < -0.5
        ? `La déduction des travaux crée une économie d'impôt, d'où un chiffre supérieur aux ${pct(R.nette)} d'avant impôt.`
        : Math.abs(R.nette - R.netteNette) < 0.0005
          ? `La fiscalité ne coûte rien cette année-là.`
          : `Avant impôt : ${pct(R.nette)}.`), ""],
    ["Cash-flow mensuel", (cf>=0?"+":"−")+eur.format(Math.abs(cf)),
      (brut ? `Loyers encaissés moins charges et mensualité, avant impôt, la première année. `
            : `Loyers encaissés moins charges, mensualité et impôt, la première année. `) +
      (cf>=0 ? `Le bien s'autofinance dès le départ.` : `C'est ce qu'il vous réclame chaque mois.`),
      cf>=0?"pos":"neg"],
    ["Le loyer couvre", couverture===null ? "—" : pct(couverture),
      couverture===null ? `Aucun crédit : il n'y a pas de mensualité à couvrir.`
        : `de la mensualité de crédit, la première année. Les charges et la fiscalité viennent en plus.`, ""],
    ["Effort d'épargne cumulé", eur.format(effort),
      effort < 1
        ? `Sur ${p.horizon} ans, le bien ne vous réclame jamais rien : les loyers couvrent tout, chaque année.`
        : `Ce que le bien vous réclame en plus de ${detenu ? "ce que vous y laissez" : "l'apport"} sur ${p.horizon} ans, les années où les loyers ne couvrent pas tout — soit ${eur.format(effort/(p.horizon*12))} par mois en moyenne.`, ""],
    ["Impôts sur "+p.horizon+" ans",
      impotsTotal>=0 ? eur.format(impotsTotal) : "+"+eur.format(-impotsTotal),
      (brut ? "Non déduits ici : l'affichage brut est avant impôt. " : "") + (impotsTotal < 0
        ? `Les économies d'impôt dépassent ce que vous versez : le projet allège votre imposition.`
        : Math.abs(impotsLoyers) < 1
          ? `Entièrement dû à la revente : l'impôt sur les loyers est nul sur toute la période.`
          : impotsLoyers < 0
            ? `La revente coûte ${eur.format(Rnet.final.impotPV)} ; les loyers vous font économiser ${eur.format(-impotsLoyers)}.`
            : `${eur.format(impotsLoyers)} sur les loyers, ${eur.format(Rnet.final.impotPV)} sur la plus-value.`),
      impotsTotal>=0 ? "" : "pos"]
  ].map(([k,v,nn,cl]) => `<div class="tile"><span class="k">${k}${bulle(nn)}</span><span class="v ${cl} num">${v}</span></div>`).join("");

  $("dMens").textContent = eur.format(R.mensualite);
  // Capacité d'emprunt : un ratio de banque, pas un accord.
  const E = endettement(p, R);
  $("dEndet").textContent = E ? pct(E.taux) : "—";
  $("dEndet").className = E && E.taux > PLAFOND_ENDETTEMENT ? "neg" : "";
  $("dEmpruntMax").textContent = E && E.empruntMax !== null ? eur.format(E.empruntMax) : "—";
  $("dCapCap").textContent = E
    ? `Le plafond de 35 % s'applique à ${eur.format(E.assiette)} de revenus par mois : les vôtres, plus 70 % du loyer. Il laisse ${eur.format(Math.max(0, E.mensualiteMax))} de mensualité, assurance comprise, au taux et sur la durée saisis.`
    : "Renseignez vos revenus pour connaître le taux d'endettement que la banque calculera.";
  $("dCout2").textContent = eur.format(R.coutCredit);
  const dureePret = detenu ? p.dureeRestante : p.duree;
  $("dCap2").textContent = R.emprunt > 0 && dureePret > 0
    ? `Intérêts et assurance versés sur les ${dureePret} ans ${detenu ? "restants" : "du prêt"}, soit ${pct(R.coutCredit/R.emprunt)} du capital ${detenu ? "restant dû" : "emprunté"}.`
    : "Aucun crédit.";

  const xs = rows.map(r=>String(r.y));

  const jalons = jalonsFiscaux(p, rows);

  // Les toutes premières années sont massivement négatives (frais d'acquisition non
  // amortis). En « zone lisible » on plafonne le bas du graphe sans jamais masquer
  // une année à partir de la 5e ; en « échelle complète » on montre tout.
  const floor = plancherLisible([rows.map(r => r.tri)], echelleTri === "complete");
  const hidden = floor === undefined ? 0 : rows.filter(r => r.tri !== null && r.tri < floor).length;
  const pire = rows.reduce((m,r) => r.tri !== null && r.tri < m ? r.tri : m, 0);
  $("triNote").textContent = echelleTri === "complete"
    ? (pire < -0.30
        ? `L'année 1 descend à ${sPct(pire)} et écrase le reste : « zone lisible » détaille les rendements courants.`
        : "")
    : hidden === 0 ? ""
      : `${hidden === 1 ? "La première année sort" : "Les " + hidden + " premières années sortent"} de l'échelle : revendre aussi tôt n'amortit pas les frais d'acquisition.`;

  drawChart($("plotTri"), $("tipTri"), {
    x: xs, height: 270, label:"Rendement annualisé selon l'année de revente",
    fmtAxis: v => (v*100).toFixed(0)+" %",
    zero:true, floor, milestones: jalons,
    fmtVal: sPct,
    series: [
      {color:"--d1", nom:"Rendement du projet", values: rows.map(r=>r.tri), fill:true},
      {color:"--d2", nom: brut ? "Bourse, avant impôt" : "Bourse, nette d'impôt", values: rows.map(r=>r.triBourse), dash:true}
    ],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Revente année ${r.y}</div>` +
        tipRow(css("--d1"),"Rendement du projet", r.tri===null?"—":sPct(r.tri)) +
        tipRow("transparent","dont pouvoir d'achat", r.triReel===null?"—":sPct(r.triReel)) +
        tipRow(css("--d2"), brut ? "Bourse, avant impôt" : "Bourse, nette d'impôt", r.triBourse===null?"—":pct(r.triBourse)) +
        tipRow("transparent","Gain net cumulé", sEur(r.gain));
    }
  });

  const phraseMort = mort === -1
    ? `Sur ${p.horizon} ans, revendre reste perdant à chaque date.`
    : mort === 0
      ? `L'opération est bénéficiaire dès la première année.`
      : `L'opération cesse d'être en perte à l'année ${rows[mort].y}.`;

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
    ? ` À ${p.horizon} ans, elle devance les trois placements comparés.`
    : perd.length === 3
      ? ` À ${p.horizon} ans, les trois placements font mieux : ${perd[perd.length-1].nom} finit ${eur.format(perd[perd.length-1].v - final.gainImmo)} devant.`
      : ` À ${p.horizon} ans, elle devance ${liste(bat)} mais reste derrière ${liste(perd.map(r=>r.nom))}.`;
  $("netNote").textContent = phraseMort + phraseRang;

  drawChart($("plotNet"), $("tipNet"), cfgGainNet(p, R,
    brut ? {label:"Gain avant impôt, immobilier comparé à trois placements"} : null));

  drawChart($("plotCf"), $("tipCf"), {
    x: xs, height: 200, padLeft: 78, band:true, zero:true,
    label: brut ? "Trésorerie annuelle avant impôt" : "Trésorerie annuelle après impôt",
    fmtAxis: (v,ref) => ref>=10000 ? eur1.format(v/1000)+" k€" : eur1.format(v)+" €",
    fmtVal: sEur,
    series: [{color:"--d1", nom: brut ? "Trésorerie avant impôt" : "Trésorerie nette", values: rows.map(r=>r.cfNet)}],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Année ${r.y}</div>` +
        tipRow(r.cfNet>=0?css("--up"):css("--down"), brut ? "Trésorerie avant impôt" : "Trésorerie nette", sEur(r.cfNet)) +
        tipRow("transparent","Loyers encaissés", eur.format(r.loyers)) +
        tipRow("transparent","Charges", cost(r.charges)) +
        tipRow("transparent","Mensualités", cost(r.annuite)) +
        (brut ? "" : tipRow("transparent","Impôt", cost(r.impot)));
    }
  });

  // Avant impôt, les deux colonnes d'impôt ne contiendraient que des zéros : elles
  // quittent le tableau, et l'export CSV fait de même.
  const cols = ["Année","Loyers","Charges","Intérêts","Mensualités","Impôt","Trésorerie","Trésorerie cumulée","Valeur du bien","Capital dû","Impôt plus-value","Net si revente","Rendement annualisé"]
    .filter(c => !(brut && c.startsWith("Impôt")));
  const celluleImpot = v => brut ? "" : `<td>${cost(v)}</td>`;
  $("tbl").tHead.innerHTML = "<tr>"+cols.map(c=>`<th>${c}</th>`).join("")+"</tr>";
  $("tbl").tBodies[0].innerHTML = rows.map(r => {
    const cls = best && r.y===best.y ? ' class="peak"' : "";
    return `<tr${cls}><td>Année ${r.y}</td>`+[
      eur.format(r.loyers), cost(r.charges), cost(r.interets), cost(r.annuite)
    ].map(v=>`<td>${v}</td>`).join("") + celluleImpot(r.impot)
    + `<td class="${r.cfNet>=0?"pos":"neg"}">${sEur(r.cfNet)}</td>`
    + `<td class="${r.cumulCF>=0?"pos":"neg"}">${sEur(r.cumulCF)}</td>`
    + `<td>${eur.format(r.valeur)}</td><td>${eur.format(r.crd)}</td>${celluleImpot(r.impotPV)}<td>${eur.format(r.netVente)}</td>`
    + `<td class="${r.tri!==null&&r.tri>=0?"pos":"neg"}">${r.tri===null?"—":sPct(r.tri)}</td></tr>`;
  }).join("");

  const warns = [];
  if(p.regime==="micro-foncier" && rows[0].loyers>15000)
    warns.push("Vos loyers dépassent 15 000 € par an : le micro-foncier n'est pas accessible, le régime réel s'applique d'office.");
  if(p.regime==="lmnp-micro" && rows[0].loyers>77700)
    warns.push("Vos recettes dépassent 77 700 € par an : le micro-BIC n'est pas accessible, le LMNP au réel s'applique d'office.");
  // Sans apport, le rendement se mesure sur l'effort d'épargne. Il n'est hors
  // de portée que si rien ne sort jamais de la poche.
  if(R.cash0 < 1 && triF === null)
    warns.push(detenu
      ? "Une vente aujourd'hui ne vous rendrait rien : aucun capital n'est immobilisé, le rendement n'a pas de sens mathématique. Vérifiez la valeur du bien et le capital restant dû."
      : "Rien ne sort de votre poche : ni apport, ni effort d'épargne, les loyers paient tout dès le premier jour. Un rendement rapporté à une mise nulle n'a pas de sens — le gain net et la trésorerie disent ce que rapporte le projet.");
  else if(R.cash0 < 1 && !detenu)
    warns.push("Sans apport, votre mise est l'effort d'épargne : le rendement se mesure sur les mensualités que les loyers ne couvrent pas. Une banque qui finance aussi les frais demandera en général un dossier solide.");
  if(E && E.taux > PLAFOND_ENDETTEMENT)
    warns.push(`Avec ce crédit, vos mensualités atteindraient ${pct(E.taux)} de vos revenus, loyer compté à 70 % : au-delà de 35 %, les banques refusent en général — elles ne peuvent déroger que pour une part de leurs dossiers, d'abord la résidence principale. À ce taux et sur cette durée, vous pourriez emprunter environ ${eur.format(E.empruntMax)}.`);
  // L'encadrement dépend de l'adresse : on le signale, avec le simulateur officiel.
  if(marche && marche.contexte.encadre){
    const E = DONNEES.sources.encadrement;
    warns.push(`${marche.contexte.encadre === 2 ? "Une partie de " + esc(marche.nom) + " applique" : esc(marche.nom) + " applique"} l'encadrement des loyers : le loyer hors charges ne peut dépasser le loyer de référence majoré de l'adresse, selon le nombre de pièces, l'époque de construction et le meublé. <a href="${esc(E.page)}" rel="noopener noreferrer">Vérifiez sur le site officiel</a>. L'expérimentation court jusqu'au ${new Date(E.fin).toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric"})}, sauf prolongation.`);
  } else if(marche && marche.contexte.tension === 1)
    warns.push(`${esc(marche.nom)} est en zone tendue : le loyer d'un nouveau bail y est en principe plafonné par celui du locataire précédent. Un bien acheté loué hérite de son loyer.`);
  // Au-delà de 23 000 € de recettes meublées, le statut dépend des revenus
  // d'activité du foyer, que la calculatrice ne connaît pas : on prévient.
  const seuilLMP = (p.regime === "lmnp-micro" || p.regime === "lmnp-reel") ? rows.find(r => r.loyers > 23000) : null;
  if(seuilLMP)
    warns.push(`Vos recettes meublées dépassent 23 000 € par an${seuilLMP.y > 1 ? ` à partir de l'année ${seuilLMP.y}` : ""} : si elles dépassent aussi les revenus d'activité de votre foyer, vous devenez loueur professionnel (LMP) — cotisations sociales à la place des prélèvements sociaux, plus-value professionnelle. Ce statut n'est pas modélisé : le résultat affiché est celui d'un LMNP.`);
  if(dureePret > 0 && R.emprunt > 0 && p.horizon < dureePret)
    warns.push(`Votre horizon (${p.horizon} ans) est plus court que le prêt (${dureePret} ans${detenu ? " restants" : ""}) : chaque revente simulée solde le capital restant dû.`);
  if(detenu && R.emprunt > 0 && p.dureeRestante < 1)
    warns.push("Un capital reste dû sans durée restante : le calcul le rembourse en totalité la première année. Indiquez les années de remboursement qu'il reste.");
  // Le DPE : le gel est calculé, l'interdiction de louer seulement signalée,
  // datée dans la simulation qui commence cette année.
  const interdit = INTERDICTION_DPE[p.dpe];
  if(interdit || R.gelLoyer){
    const an0 = new Date().getFullYear(), rang = interdit - an0 + 1;
    const gel = R.gelLoyer ? `Classé ${p.dpe}, le logement ne peut plus voir son loyer augmenter : le calcul le gèle au niveau saisi. ` : "";
    const quand = !interdit ? ""
      : rang <= 1 ? `Il ne peut plus être donné à bail depuis ${interdit} : ni nouveau locataire, ni renouvellement.`
      : rang <= p.horizon ? `À partir de ${interdit} — l'année ${rang} de la simulation —, il ne pourra plus être donné à bail.`
      : `L'interdiction de le louer, en ${interdit}, tombe après l'horizon simulé.`;
    warns.push(gel + quand + (interdit && rang <= p.horizon
      ? " Le calcul suppose qu'il reste loué : comptez les travaux qui le sortent de cette classe dans vos postes."
      : ""));
  }
  if(detenu && R.deja >= 30)
    warns.push(`Détenu depuis ${R.deja} ans : la plus-value est déjà exonérée d'impôt et de prélèvements sociaux, revendre ne coûte plus que les frais d'agence.`);
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
    colLabel:"Régime fiscal",
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
        (p.avantImpot ? "" : tipRow("transparent","Impôts cumulés", r.impots >= 0 ? cost(r.impots) : "+"+eur.format(-r.impots))) +
        (r.rg===p.regime ? "" : `<div class="tr" style="margin-top:6px;color:var(--text-muted)">Cliquer pour adopter ce régime</div>`);
    },
    onClick: i => { if(regs[i].rg !== p.regime){ appliquerRegime(regs[i].rg); render(); toast("Régime : " + regs[i].label.replace("\n"," ")); } }
  });
  const enCours = regs.find(r => r.rg === p.regime);
  // Les mêmes quatre régimes, année après année : la barre dit l'horizon, la
  // courbe dit quand chacun prend l'avantage.
  drawChart($("plotRegT"), $("tipRegT"), cfgRegimesTemps(p, R, regs,
    {floor: plancherLisible(regs.map(r => r.tris), echelleTri === "complete")}));
  $("regTNote").textContent = p.avantImpot ? "" : meneurRegimes(regs, p.horizon);
  // L'hypothèse de mobilier explique une partie de l'écart : elle est dite dans
  // l'infobulle du panneau, pas dans une phrase de plus sous le graphique.
  // Avant impôt, les régimes ne diffèrent plus que par le mobilier et la CFE : le
  // classement ne dirait rien du choix fiscal.
  $("regNote").textContent = p.avantImpot
    ? "Avant impôt, les régimes ne se distinguent que par le mobilier et la CFE : repassez en net pour les départager."
    : !meilleur || meilleur.tri === null ? ""
    : meilleur.rg === p.regime
      ? `Sur vos hypothèses, votre régime est déjà le plus favorable des quatre.`
      : `${meilleur.label.replace("\n"," ")} ferait mieux : ${sPct(meilleur.tri)} contre ${sPct(enCours.tri)} par an, soit ${sEur(meilleur.gain - enCours.gain)} de gain sur ${p.horizon} ans. Vérifiez votre éligibilité.`;

  // D'où vient le gain : une cascade dont la somme des marches est exactement le
  // gain, à l'année de revente choisie au curseur.
  const curseur = $("cascAnnee");
  curseur.max = p.horizon;
  const anCasc = Math.max(1, Math.min(p.horizon, anneeCascade === null ? p.horizon : anneeCascade));
  curseur.value = anCasc;
  $("cascAnneeVal").textContent = anCasc + (anCasc === p.horizon ? " (horizon)" : "");
  const f = rows[anCasc - 1];
  // Les frais d'acquisition, les travaux et le mobilier sont sortis de la
  // revalorisation : ils sont payés le premier jour et doivent se voir. La somme
  // reste identique, puisque besoin = prix + notaire + travaux + agence +
  // mobilier + dossier.
  const fraisAcquisition = R.notaire + R.fraisAcq + R.fraisDossier;
  const equipement = p.travaux + R.mobilier;
  // Bien détenu : la mise est le net d'une vente aujourd'hui. Les frais de
  // revente et l'impôt de plus-value ne comptent donc que pour ce qu'ils
  // ajoutent à ceux de cette vente-là — et il n'y a plus de frais d'acquisition.
  const v0 = R.vente0 || {fraisVente:0, ira:0, impotPV:0};
  const marches = [
    {label:"Loyers\nencaissés",        v: f.cumulLoyers},
    {label:"Charges",                  v: -f.cumulCharges},
    {label:"Intérêts et\nassurance",   v: -f.cumulCredit},
    {label:"Impôt sur\nles loyers",    v: -f.cumulImpot, impot:true},
    {label:"Frais\nd'acquisition",     v: -fraisAcquisition, achat:true,
     detail: [["Frais de notaire", R.notaire], ["Frais d'agence", R.fraisAcq],
              ["Dossier et garantie", R.fraisDossier]]},
    {label: R.mobilier > 0 ? "Travaux et\nmobilier" : "Travaux", v: -equipement,
     detail: [["Travaux", p.travaux], ["Mobilier", R.mobilier]]},
    {label:"Revalorisation\ndu bien",  v: f.revalorisation},
    {label:"Frais de\nrevente",        v: -(f.fraisVente + f.ira - v0.fraisVente - v0.ira)},
    {label:"Impôt sur la\nplus-value", v: -(f.impotPV + f.repriseDF - v0.impotPV), impot:true}
  // Avant impôt, ces deux marches valent zéro : on les retire plutôt que de
  // dessiner deux marches vides. La somme reste le gain.
  ].filter(m => !(p.avantImpot && m.impot) && !(R.detenu && m.achat));
  let acc = 0;
  const items = marches.map(m => {
    const it = {label:m.label, from:acc, to:acc+m.v, color: m.v >= 0 ? "--up" : "--down",
      text: sEur(m.v), detail: m.detail};
    acc += m.v; return it;
  });
  items.push({label:"Gain net", from:0, to:f.gain, color:"--text", text:sEur(f.gain), textColor:"--text", strong:true});
  drawColumns($("plotCasc"), $("tipCasc"), {
    height:250, padLeft:78, connect:true, label:"Décomposition du gain à la revente",
    fmtAxis: kEur,
    items,
    tip: i => {
      const it = items[i];
      return `<div class="th">${it.label.replace("\n"," ")} · ${anCasc} ${anCasc > 1 ? "ans" : "an"}</div>` +
        tipRow("transparent", i < items.length-1 ? "Montant" : "Total", it.text) +
        (it.detail || []).filter(d => d[1] > 0.5).map(d => tipRow("transparent", "dont " + d[0].toLowerCase(), cost(d[1]))).join("") +
        (i < items.length-1 ? tipRow("transparent","Cumul à cette étape", sEur(it.to)) : "");
    }
  });
  // Deux entrées, une sortie : la note dit exactement les trois termes de
  // l'identité que la cascade dessine, et rien de plus.
  const revalorisation = f.revalorisation;
  const sorties = f.cumulCharges + f.cumulCredit + f.cumulImpot + (R.detenu ? 0 : fraisAcquisition)
    + equipement + f.fraisVente + f.ira + f.impotPV + f.repriseDF - v0.fraisVente - v0.ira - v0.impotPV;
  $("cascNote").textContent =
    `Fin d'année ${anCasc} : ${eur.format(f.cumulLoyers)} de loyers et ${revalorisation >= 0 ? eur.format(revalorisation) + " de revalorisation" : eur.format(-revalorisation) + " de dévalorisation"}, contre ${eur.format(sorties)} de ${p.avantImpot ? "charges, frais et intérêts" : "charges, frais, intérêts et impôts"}`
    + (R.detenu ? " au-delà d'une vente aujourd'hui." : ".");

  // Patrimoine net et dette.
  const xs = rows.map(r => String(r.y));
  drawChart($("plotPat"), $("tipPat"), {
    x: xs, height:250, padLeft:78, zero:true, label:"Valeur du bien, capital restant dû et patrimoine net",
    fmtAxis: kEur,
    fmtVal: v => eur.format(v),
    series: [
      {color:"--d1", nom:"Patrimoine net", values: rows.map(r => r.patrimoine), fill:true, width:2.4},
      {color:"--d2", nom:"Valeur du bien", values: rows.map(r => r.valeur)},
      {color:"--text-muted", nom:"Capital restant dû", values: rows.map(r => r.crd)},
      {color:"--d4", nom:"Sorti de votre poche", values: rows.map(r => r.mise), dash:"2 3"}
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
    if(f.tri === null){ host.querySelectorAll("svg").forEach(el => el.remove()); $("sensNote").textContent = ""; $("seuils").innerHTML = ""; return; }
    renderSeuils(p);
    const sens = sensibilite(p, f.tri);
    drawTornado(host, $("tipSens"), cfgSensibilite(sens, f.tri));
    $("sensNote").textContent = sens.length
      ? `Le paramètre le plus sensible est ${sens[0].nom.toLowerCase()} : ${sens[0].txt} d'écart déplace le rendement de ${pts(sens[0].lo)} à ${pts(sens[0].hi)} par an.`
      : "";
  });
}

// Ce qu'il faudrait pour faire jeu égal avec la bourse : une tuile par
// paramètre, la valeur de bascule, et l'écart avec la saisie — une marge quand
// le projet est devant, un effort à obtenir quand il est derrière.
const FORMAT_SEUIL = {
  prix:      {v: x => eur.format(Math.round(x/100)*100), ecart: (x, a) => sPct(x/a - 1)},
  loyer:     {v: x => eur.format(Math.round(x)) + " /mois", ecart: (x, a) => sPct(x/a - 1)},
  taux:      {v: x => pct(x/100), ecart: (x, a) => pts((x - a)/100)},
  indexPrix: {v: x => pct(x/100) + " /an", ecart: (x, a) => pts((x - a)/100)},
  vacance:   {v: x => pct(x/100), ecart: (x, a) => pts((x - a)/100)}
};
function renderSeuils(p){
  $("seuils").innerHTML = seuils(p).map(s => {
    const F = FORMAT_SEUIL[s.k];
    const valeur = s.valeur === null ? "—" : F.v(s.valeur);
    const sous = s.valeur === null
      ? (s.toujours ? "devant la bourse sur toute la plage" : "hors de portée : la bourse reste devant")
      : `vous : ${F.v(s.actuel)} · <b class="${s.devant ? "pos" : "neg"}">${F.ecart(s.valeur, s.actuel)}</b>`;
    return `<div class="tile"><span class="k">${s.nom}</span><span class="v num">${valeur}</span><span class="s">${sous}</span></div>`;
  }).join("");
}

/* ---------- taux du marché ---------- */
// Relevés par outils/donnees.py (BCE, Eurostat, INSEE) et inscrits ici par
// build.py. Ils éclairent la saisie ; ils ne la remplacent jamais.
const TAUX_MARCHE = {"credit": {"valeur": 3.18, "periode": "2026-07"}, "depot": {"valeur": 2.5, "periode": "2026-09-16"}, "inflation": {"valeur": 2.6, "periode": "2026-08"}, "irl": {"valeur": 1.15, "periode": "2026-Q2", "depuis": "2025-Q2"}};
const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const quand = periode => {
  const t = /^(\d{4})-Q(\d)$/.exec(periode);
  if(t) return `au ${t[2] === "1" ? "1ᵉʳ" : t[2] + "ᵉ"} trimestre ${t[1]}`;
  const [a, m, j] = periode.split("-");
  return (j ? `le ${+j === 1 ? "1ᵉʳ" : +j} ` : "en ") + MOIS[+m - 1] + " " + a;
};
const pct2 = v => v.toFixed(2).replace(".", ",") + " %";
function renderTaux(p){
  const T = TAUX_MARCHE;
  if(T.credit){
    const e = p.taux - T.credit.valeur;
    $("repTaux").innerHTML = `Nouveaux crédits immobiliers en France : <b>${pct2(T.credit.valeur)}</b> en moyenne ${quand(T.credit.periode)} (BCE)`
      + (Math.abs(e) < 0.15 ? "." : ` — vous êtes <b class="${e > 0 ? "neg" : "pos"}">${pts(e/100)} ${e > 0 ? "au-dessus" : "en dessous"}</b>.`);
    $("repTaux").hidden = false;
  }
  if(T.inflation && T.depot){
    $("repInflation").innerHTML = `Inflation constatée sur un an : <b>${pct2(T.inflation.valeur)}</b> ${quand(T.inflation.periode)} (Eurostat). `
      + `Taux de dépôt de la BCE : ${pct2(T.depot.valeur)} depuis ${quand(T.depot.periode).replace(/^le /, "le ")}.`
      + (T.irl ? ` Loyers : l'IRL a progressé de ${pct2(T.irl.valeur)} sur un an, ${quand(T.irl.periode)}.` : "");
    $("repInflation").hidden = false;
  }
}

/* ---------- données de marché ---------- */
// Servies par ce site, chargées à la demande : la liste des communes d'une
// initiale quand on tape, le fichier du département quand une commune est
// choisie. Un fichier absent ou illisible efface les repères, rien de plus.
const DONNEES = {communes:{}, marche:{}, pret:{}, sources:null};
const charger = chemin => fetch(chemin).then(r => r.ok ? r.json() : Promise.reject(r.status));
const communesDe = lettre => DONNEES.communes[lettre]
  || (DONNEES.communes[lettre] = charger(`/donnees/communes/${lettre}.json`).catch(() => []));
function marcheDe(dep){
  if(!DONNEES.marche[dep]){
    DONNEES.marche[dep] = Promise.all([
      charger(`/donnees/marche/${dep}.json`),
      DONNEES.sources ? Promise.resolve(DONNEES.sources) : charger("/donnees/sources.json")
    ]).then(([m, src]) => { DONNEES.sources = src; DONNEES.pret[dep] = m; })
      .catch(() => { DONNEES.pret[dep] = null; });
  }
  return DONNEES.marche[dep];
}
let suggestions = [];
function choisirCommune(code, nom){
  communeCode = code;
  $("commune").value = libelleCommune(code, nom);
  $("communesListe").innerHTML = "";
  render();
}
$("commune").addEventListener("input", () => {
  const saisie = $("commune").value;
  const choisie = suggestions.find(c => libelleCommune(c[0], c[1]) === saisie);
  if(choisie){ choisirCommune(choisie[0], choisie[1]); return; }
  // La saisie ne désigne plus la commune retenue : les repères s'effacent.
  if(communeCode){ communeCode = ""; render(); }
  if(normaliser(saisie).length < 2){ $("communesListe").innerHTML = ""; suggestions = []; return; }
  communesDe(initiale(saisie)).then(liste => {
    if($("commune").value !== saisie) return;
    suggestions = chercherCommunes(liste, saisie, 8);
    $("communesListe").innerHTML = suggestions.map(c => `<option value="${esc(libelleCommune(c[0], c[1]))}"></option>`).join("");
  });
});
// « Reprendre » : la valeur que le marché propose pour un bien détenu.
$("repPrix").addEventListener("click", e => {
  const b = e.target.closest(".reprendre");
  if(!b) return;
  $("valeur").value = b.dataset.valeur;
  render();
  toast("Valeur reprise du marché : " + eur.format(+b.dataset.valeur));
});
// Un nom tapé en entier, sans passer par la liste, vaut choix s'il est sans ambiguïté.
$("commune").addEventListener("change", () => {
  if(communeCode) return;
  const exactes = suggestions.filter(c => normaliser(c[1]) === normaliser($("commune").value));
  if(exactes.length === 1) choisirCommune(exactes[0][0], exactes[0][1]);
});

const m2 = v => v.toFixed(1).replace(".", ",") + " €/m²";
const an = mois => mois.slice(0, 4);
const ZONES = {Abis:"très tendu", A:"tendu", B1:"tendu", B2:"intermédiaire", C:"détendu"};
// Les repères sous le prix et le loyer, et leur résumé dans les résultats, qui
// reste visible quand le panneau est replié ou fermé. Rend les repères, pour
// les alertes, ou null sans commune.
function renderMarche(p){
  const rp = $("repPrix"), rl = $("repLoyer"), resume = $("marcheResume");
  const cacher = () => { rp.hidden = rl.hidden = resume.hidden = true; return null; };
  if(!communeCode) return cacher();
  const dep = departementDe(communeCode);
  // Un seul rendu à l'arrivée du fichier, quel que soit le nombre de frappes d'ici là.
  if(!(dep in DONNEES.pret)){ cacher(); if(!DONNEES.marche[dep]) marcheDe(dep).then(render); return null; }
  const M = reperesMarche(DONNEES.pret[dep], communeCode, p), S = DONNEES.sources;
  if(!M || !S) return cacher();
  // Ouvert depuis un lien ou une visite précédente : le champ n'a que le code.
  if(!$("commune").value) $("commune").value = libelleCommune(communeCode, M.nom);
  const periode = an(S.dvf.periode[0]) === an(S.dvf.periode[1]) ? an(S.dvf.periode[0]) : `${an(S.dvf.periode[0])}-${an(S.dvf.periode[1])}`;
  const ecart = (saisi, marche, cherEstMal) => {
    const e = saisi/marche - 1;
    if(Math.abs(e) < 0.03) return `<b>dans la moyenne</b>`;
    const bien = (e < 0) === cherEstMal;
    return `<b class="${bien ? "pos" : "neg"}">${Math.round(Math.abs(e)*100)} % ${e > 0 ? "au-dessus" : "en dessous"}</b>`;
  };
  const fourchette = L => L.saisi > L.haut ? `<b class="neg">au-dessus de la fourchette</b>`
    : L.saisi < L.bas ? `<b class="pos">sous la fourchette</b>` : `<b>dans la fourchette</b>`;
  const tuiles = [];
  if(M.prix){
    const X = M.prix, type = M.maison ? "les maisons" : "les appartements";
    const ou = X.echelle === "commune" ? `à ${esc(M.nom)}` : `dans le département — trop peu de ventes à ${esc(M.nom)}`;
    const vente = `${type} se sont vendus ${eur1.format(X.marche)} €/m² ${ou} en ${periode}, sur ${eur1.format(X.ventes)} ventes`;
    // Un bien détenu n'a pas de prix affiché : le marché en propose une valeur,
    // que l'on peut reprendre d'un clic.
    const estimation = M.surface > 0 ? Math.round(X.marche*M.surface/1000)*1000 : null;
    const reprendre = p.situation === "detenu" && estimation && Math.abs(estimation - p.valeur) >= 1000
      ? ` <button type="button" class="reprendre" data-valeur="${estimation}">Reprendre ${eur.format(estimation)}</button>` : "";
    rp.innerHTML = X.saisi === null
      ? `${vente.charAt(0).toUpperCase() + vente.slice(1)}. Renseignez la surface pour situer votre prix.`
      : `<b>${eur1.format(Math.round(X.saisi))} €/m²</b> : ${vente}. Vous êtes ${ecart(X.saisi, X.marche, true)}.${reprendre}`;
    rp.hidden = false;
    tuiles.push(["Prix au m²", X.saisi === null ? "—" : eur1.format(Math.round(X.saisi)) + " €",
      `ventes${X.echelle === "commune" ? "" : " du département"} : ${eur1.format(X.marche)} €${X.saisi === null ? "" : " · " + ecart(X.saisi, X.marche, true)}`]);
  } else rp.hidden = true;
  if(M.loyer){
    const L = M.loyer, ref = S.loyers.references[L.cle];
    const secteur = L.annonces === 0 ? " — estimation de secteur, la commune ayant peu d'annonces" : "";
    const annonces = `les annonces à ${esc(M.nom)} affichent ${m2(L.marche)} charges comprises pour ${M.maison ? "une maison" : "un appartement"} de ${ref} m², la plupart entre ${m2(L.bas)} et ${m2(L.haut)}${secteur}`;
    rl.innerHTML = L.saisi === null
      ? `${annonces.charAt(0).toUpperCase() + annonces.slice(1)}. Renseignez la surface pour situer votre loyer.`
      : `<b>${m2(L.saisi)}</b> hors charges : ${annonces}. Pour vos ${eur1.format(M.surface)} m², l'annonce équivalente serait d'environ ${eur.format(Math.round(L.marche*M.surface/10)*10)} par mois, charges comprises.`
        + (L.saisi > L.haut ? ` <b class="neg">Au-dessus de la fourchette</b> : un loyer difficile à obtenir.`
          : L.saisi < L.bas ? ` <b class="pos">Sous la fourchette</b> : de la marge, ou un bien moins demandé.` : "");
    rl.hidden = false;
    tuiles.push(["Loyer au m², hors charges", L.saisi === null ? "—" : m2(L.saisi).replace(" €/m²", " €"),
      `annonces : ${m2(L.marche).replace(" €/m²", " €")} charges comprises${L.saisi === null ? "" : " · " + fourchette(L)}`]);
  } else rl.hidden = true;
  const C = M.contexte;
  if(C.tendance){
    const T = C.tendance, retenu = p.indexPrix/100;
    // Une revalorisation retenue bien au-dessus de la tendance récente est un pari.
    tuiles.push([`Prix de l'ancien, département`, `${sPct(T.taux)} /an`,
      `${T.an0}-${T.an1} · vous retenez <b class="${retenu > T.taux + 0.01 ? "neg" : ""}">${sPct(retenu)} /an</b>`]);
  }
  if(C.zone){
    const tension = C.tension === 1 ? "zone tendue" : C.tension === 2 ? "zone touristique tendue" : "hors zone tendue";
    tuiles.push(["Marché local", `Zone ${C.zone === "Abis" ? "A bis" : C.zone}`,
      `${ZONES[C.zone] || ""} · ${tension}${C.encadre ? " · <b>loyers encadrés</b>" : ""}`]);
  }
  $("marcheTitre").textContent = `Face au marché : ${M.nom}`;
  $("marcheTuiles").innerHTML = tuiles.map(([k, v, sous]) =>
    `<div class="tile"><span class="k">${k}</span><span class="v num">${v}</span><span class="s">${sous}</span></div>`).join("");
  resume.hidden = false;
  return M;
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
    const o = {v:2, ira:$("ira").checked, prixSuitInflation:$("prixSuitInflation").checked,
      comptant:$("comptant").checked, items, commune:communeCode, communeNom:$("commune").value};
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
    if(typeof o.comptant === "boolean") $("comptant").checked = o.comptant;
    if(o.items !== undefined) items = assainir(o.items);
    if(CODE_COMMUNE.test(o.commune || "")){ communeCode = o.commune; $("commune").value = String(o.communeNom || ""); }
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
  "lmnp-reel":     ["fCfe", "fCompta", "fMobilier", "fPartBati", "fAmortBati", "fAmortTvx", "fAmortMob"]
};
const TOUS_CHAMPS_REGIME = [...new Set(Object.values(CHAMPS_REGIME).flat())];
function syncRegime(){
  const rg = $("regime").value;
  // Le mobilier d'un bien déjà loué est acheté : il ne coûte plus rien.
  const visibles = (CHAMPS_REGIME[rg] || []).filter(id => !(id === "fMobilier" && $("situation").value === "detenu"));
  TOUS_CHAMPS_REGIME.forEach(id => { $(id).hidden = !visibles.includes(id); });
  // La part déductible d'un poste de travaux ne vaut qu'au réel foncier. Les
  // lignes étant reconstruites à chaque frappe, c'est le conteneur qui porte
  // l'état, jamais les champs eux-mêmes.
  $("tvxList").classList.toggle("sans-deduc", rg !== "reel-foncier");
}
// Deux situations, deux jeux de champs. À l'achat : prix, frais, apport, durée
// du prêt. Bien détenu : valeur d'aujourd'hui, prix payé, années écoulées,
// capital restant dû — et ce qu'une vente aujourd'hui rendrait. La case
// « comptant » sert aux deux : sans crédit, les champs du crédit s'effacent.
const CHAMPS_SITUATION = {
  achat:  ["fPrix", "fNotaire", "fFraisAcq", "fApport", "dFinancement", "fDuree", "mCredit", "mCapacite"],
  detenu: ["fValeur", "fPrixAchat", "fDepuis", "fTravauxPasses", "fCrd", "fDureeRestante", "dVente"]
};
const TOUS_CHAMPS_SITUATION = [...new Set(Object.values(CHAMPS_SITUATION).flat())];
const CHAMPS_CREDIT = ["fTaux", "fAssur", "dCredit"];
// Les libellés qui changent avec la situation portent leur version « détenu »
// dans le balisage (data-detenu) ; la version « achat » est leur texte, relu au
// démarrage. Jamais sur un élément qui porte déjà data-brut.
const libellesSituation = [...document.querySelectorAll("[data-detenu]")];
libellesSituation.forEach(el => { el.dataset.achat = el.textContent; });
function syncSituation(){
  const detenu = $("situation").value === "detenu";
  const comptant = $("comptant").checked;
  const visibles = CHAMPS_SITUATION[detenu ? "detenu" : "achat"];
  TOUS_CHAMPS_SITUATION.forEach(id => { $(id).hidden = !visibles.includes(id); });
  if(comptant){
    ["fApport", "fDuree", "fCrd", "fDureeRestante", "mCredit", "mCapacite"].forEach(id => { $(id).hidden = true; });
    CHAMPS_CREDIT.forEach(id => { $(id).hidden = true; });
  } else {
    CHAMPS_CREDIT.forEach(id => { $(id).hidden = false; });
  }
  libellesSituation.forEach(el => { el.textContent = detenu ? el.dataset.detenu : el.dataset.achat; });
}
// Chaque frappe redessinait les huit graphiques. On laisse retomber la frappe
// (60 ms) ; les listes et les cases gardent un rendu immédiat, le geste y étant
// unique et la sonde de outils/verifier.py comptant dessus.
let frappe = null;
function rendreBientot(){
  clearTimeout(frappe);
  frappe = setTimeout(() => { frappe = null; render(); }, 60);
}
FIELDS.concat(SELECTS).forEach(k => {
  if(k === "regime") return;
  $(k).addEventListener("input", $(k).tagName === "SELECT" ? render : rendreBientot);
  $(k).addEventListener("change", render);
});
$("regime").addEventListener("change", () => { appliquerRegime($("regime").value); render(); });
$("prixSuitInflation").addEventListener("change", render);
$("ira").addEventListener("change", render);
$("comptant").addEventListener("change", render);

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
/* ---------- niveau de détail du panneau ---------- */
// « Essentiel » ne montre que les champs marqués `key` dans le balisage : ceux
// auxquels le rendement est le plus sensible, plus ceux sans lesquels il n'y a
// pas de projet. Aucun champ n'est retiré du calcul — seulement de la vue.
let railMode = "essentiel";
try{
  const m = localStorage.getItem("rentaloc.rail");
  if(m === "essentiel" || m === "tout") railMode = m;
}catch(e){}
function setRail(v){
  railMode = v;
  $("railbox").classList.toggle("essentiel", v === "essentiel");
  $("railEssentiel").setAttribute("aria-pressed", v === "essentiel" ? "true" : "false");
  $("railTout").setAttribute("aria-pressed", v === "tout" ? "true" : "false");
  try{ localStorage.setItem("rentaloc.rail", v); }catch(e){}
}
$("railEssentiel").addEventListener("click", () => setRail("essentiel"));
$("railTout").addEventListener("click", () => setRail("tout"));

function setEchelle(v){
  echelleTri = v;
  $("echLisible").setAttribute("aria-pressed", v === "lisible" ? "true" : "false");
  $("echComplete").setAttribute("aria-pressed", v === "complete" ? "true" : "false");
  try{ localStorage.setItem("rentaloc.echelle", v); }catch(e){}
  render();
}
$("cascAnnee").addEventListener("input", () => {
  anneeCascade = parseInt($("cascAnnee").value, 10);
  render();
});
$("echLisible").addEventListener("click", () => setEchelle("lisible"));
$("echComplete").addEventListener("click", () => setEchelle("complete"));

// Les libellés qui changent avec l'affichage portent leur version brute dans le
// balisage (data-brut) ; la version nette est leur texte, relu au démarrage.
const libellesFiscaux = [...document.querySelectorAll("[data-brut]")];
libellesFiscaux.forEach(el => { el.dataset.net = el.textContent; });
function setFiscalite(v){
  fiscalite = v;
  $("fiscNet").setAttribute("aria-pressed", v === "net" ? "true" : "false");
  $("fiscBrut").setAttribute("aria-pressed", v === "brut" ? "true" : "false");
  libellesFiscaux.forEach(el => { el.textContent = v === "brut" ? el.dataset.brut : el.dataset.net; });
}
$("fiscNet").addEventListener("click", () => { setFiscalite("net"); render(); });
$("fiscBrut").addEventListener("click", () => { setFiscalite("brut"); render(); });

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
// Clair par défaut, sombre si le navigateur le préfère ; un choix manuel
// l'emporte, et le <head> l'a déjà posé avant la première peinture.
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

let rid;
addEventListener("resize", () => { clearTimeout(rid); rid = setTimeout(render, 140); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { syncTheme(); render(); });

/* ---------- exemples, régime, lien, export ---------- */
function appliquerRegime(rg){
  $("regime").value = rg;
  $("ps").value = PS_LOYERS[rg] || "17.2";
  $("cfe").value = CFE_DEFAUT[rg] || "0";
  if(ABATT_DEFAUT[rg]) $("abattement").value = ABATT_DEFAUT[rg];
  // Le mobilier n'est pas effacé en repassant en nu : il est masqué et neutralisé
  // par compute, donc la saisie survit à un aller-retour entre les régimes.
}
function retablirDefauts(){
  Object.keys(DEFAULTS).forEach(k => {
    if(typeof DEFAULTS[k] === "boolean") $(k).checked = DEFAULTS[k];
    else $(k).value = DEFAULTS[k];
  });
  items = TVX_DEFAUT.map(o => ({...o}));
  communeCode = ""; $("commune").value = "";
}

// L'état complet tient dans l'URL : un lien suffit à partager une simulation, et
// un guide peut ouvrir le calculateur pré-réglé (/#regime=reel-foncier).
const BOOLS = ["ira","prixSuitInflation","comptant"];
// Les champs que « Copier le lien » inscrit depuis qu'il existe (11 septembre
// 2026). Un lien qui les porte tous est un lien partagé, pas une adresse
// retouchée à la main ni un lien de l'assistant. Liste figée : c'est un fait passé.
const LIEN_ORIGINE = ["prix","notairePct","fraisAcq","mobilier","apport","duree","taux","assur",
  "fraisDossier","loyer","vacance","copro","tf","pno","gestion","entretien",
  "ps","psPV","cfe","abattement","plafondDeficit","partBati","amortBatiAns","amortTvxAns","amortMobAns","horizon",
  "inflation","indexPrix","indexLoyer","indexCharges","fraisVente","bourse","fondsEuros","livretA","fiscBourse","fiscFonds"];
// Les champs apparus depuis qui pèsent sur le résultat, avec la valeur qui
// reproduit un lien copié avant eux : 0 € de comptabilité, par exemple.
const CHAMPS_TARDIFS = {compta: "0"};
// Le format du lien vit dans le moteur : l'assistant de la page d'accueil en
// produit un sans jamais voir ce formulaire. Ici on ne fait que lire les champs.
function valeursFormulaire(){
  const valeurs = {};
  FIELDS.concat(SELECTS).forEach(k => { if(!PRIVES.includes(k)) valeurs[k] = $(k).value; });
  BOOLS.forEach(k => valeurs[k] = $(k).checked);
  valeurs.commune = communeCode;
  return valeurs;
}
// L'adresse de la page reste courte : seuls les écarts à l'ouverture. Mais dès
// qu'il y en a, elle porte le marqueur complet : copiée à la main et ouverte
// chez quelqu'un qui a sa propre saisie, elle rend ce scénario, pas un mélange.
function versHash(){
  const ecarts = lienHypotheses(valeursFormulaire(), DEFAULTS, items);
  const h = ecarts ? lienHypotheses(valeursFormulaire(), DEFAULTS, items, true) : "";
  const actuel = location.hash.indexOf("=") >= 0 ? location.hash : "";
  if(h !== actuel) history.replaceState(null, "", location.pathname + location.search + h);
}
function depuisHash(){
  const h = location.hash.slice(1);
  if(!h || h.indexOf("=") < 0) return false;
  const parts = h.split("&");
  // Un lien complet repart de l'ouverture avant de s'appliquer ; un lien ordinaire
  // se pose sur ce que load() vient de relire.
  if(parts.includes(LIEN_COMPLET)){
    const foyer = PRIVES.map(k => $(k).value);
    retablirDefauts();
    PRIVES.forEach((k, i) => { $(k).value = foyer[i]; });
  }
  const vus = new Set();
  let regime = null;
  parts.forEach(part => {
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
    } else if(k === "commune"){
      if(v !== "" && !CODE_COMMUNE.test(v)) return;
      communeCode = v; $("commune").value = "";
    } else if(FIELDS.includes(k) && !PRIVES.includes(k)){
      if(!isFinite(parseFloat(v))) return;
      $(k).value = v; vus.add(k);
    }
  });
  // Un lien partagé inscrit chaque hypothèse. S'il les porte toutes sauf un champ
  // apparu depuis, il a été copié avant que ce champ existe : on lui rend la
  // valeur qui reproduit le scénario d'alors, pas la valeur d'ouverture actuelle.
  if(parts.includes(LIEN_COMPLET) && LIEN_ORIGINE.every(k => vus.has(k)))
    Object.keys(CHAMPS_TARDIFS).forEach(k => { if(!vus.has(k)) $(k).value = CHAMPS_TARDIFS[k]; });
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
// Un lien collé dans l'onglet où la calculatrice est déjà ouverte ne recharge pas
// la page : seul le fragment change. On l'applique comme à l'ouverture. Réécrire
// l'adresse avec replaceState ne déclenche pas cet évènement.
addEventListener("hashchange", () => { if(depuisHash()){ renderItems(); render(); } });

// Le lien copié se suffit à lui-même : il inscrit chaque hypothèse, même égale à
// sa valeur d'ouverture. Le destinataire repart de ce lien seul, quoi que son
// navigateur ait retenu, et le scénario ne bouge pas si les valeurs par défaut
// du site évoluent après le partage.
$("share").addEventListener("click", async () => {
  versHash();
  const lien = location.origin + location.pathname + lienHypotheses(valeursFormulaire(), null, items, true);
  try{ await navigator.clipboard.writeText(lien); toast("Lien copié — il contient toutes vos hypothèses"); }
  catch(e){ toast("Copie impossible dans ce contexte : copiez l'adresse de la page"); }
});

function csvTexte(){
  const head = ["Annee","Loyers","Charges","Interets","Mensualites","Impot","Tresorerie","Tresorerie cumulee","Valeur","Capital du","Impot plus-value","Net si revente","Rendement annualise"];
  // Mêmes colonnes que le tableau : avant impôt, les deux colonnes d'impôt sortent.
  const garde = (v, i) => !(R.p.avantImpot && head[i].startsWith("Impot"));
  return [head.filter(garde).join(";")].concat(R.rows.map(r => [
    r.y, r.loyers, r.charges, r.interets, r.annuite, r.impot, r.cfNet, r.cumulCF,
    r.valeur, r.crd, r.impotPV, r.netVente, r.tri===null?"":(r.tri*100)
  ].filter(garde).map(v => typeof v==="number" ? v.toFixed(2).replace(".",",") : v).join(";"))).join("\n");
}
$("csv").addEventListener("click", () => {
  if(!R) return;
  const blob = new Blob(["﻿" + csvTexte()], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = R.p.avantImpot ? "rendement-locatif-avant-impot.csv" : "rendement-locatif.csv";
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
  if(cible.tagName === "DETAILS") cible.open = true;
  cible.scrollIntoView({behavior:"smooth", block:"start"});
}));
// Les graphiques repliés sont tracés comme les autres, mais dans un conteneur
// de largeur nulle : ils retomberaient sur leur largeur plancher de 320 px.
// On les redessine à l'ouverture, une fois la place connue.
["analyse","detail"].forEach(id => {
  $(id).addEventListener("toggle", () => { if($(id).open) render(); });
});
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
// Le panneau d'hypothèses. Sur grand écran, il tient la colonne de gauche et se
// rabat contre le bord ; le choix est retenu. Sur petit écran, il vient en tiroir
// par-dessus la page, fermé à l'ouverture : le verdict passe d'abord. Un seul
// bouton, en tête de la barre des sections, l'ouvre et le ferme partout.
const mqEtroit = matchMedia("(max-width:1040px)");
let panneauReplie = false, tiroirOuvert = false;
try{ panneauReplie = localStorage.getItem("rentaloc.panneau") === "replie"; }catch(e){}
function syncPanneau(){
  const etroit = mqEtroit.matches;
  const visible = etroit ? tiroirOuvert : !panneauReplie;
  $("shell").classList.toggle("panneau-replie", !etroit && panneauReplie);
  $("shell").classList.toggle("panneau-ouvert", etroit && tiroirOuvert);
  $("voile").hidden = !(etroit && tiroirOuvert);
  document.documentElement.classList.toggle("tiroir", etroit && tiroirOuvert);
  // Un panneau hors de vue ne doit plus recevoir le focus clavier.
  $("rail").inert = !visible;
  $("railToggle").setAttribute("aria-expanded", visible ? "true" : "false");
}
function basculerPanneau(ouvrir){
  if(mqEtroit.matches){
    tiroirOuvert = ouvrir;
    syncPanneau();
    (ouvrir ? $("railFermer") : $("railToggle")).focus();
    return;
  }
  panneauReplie = !ouvrir;
  try{ localStorage.setItem("rentaloc.panneau", panneauReplie ? "replie" : "ouvert"); }catch(e){}
  syncPanneau();
  if(!ouvrir) $("railToggle").focus();
  // La colonne des résultats change de largeur : les graphiques se redessinent
  // une fois le mouvement fini.
  setTimeout(render, 240);
}
$("railToggle").addEventListener("click", () => basculerPanneau($("railToggle").getAttribute("aria-expanded") !== "true"));
$("railFermer").addEventListener("click", () => basculerPanneau(false));
$("voile").addEventListener("click", () => basculerPanneau(false));
addEventListener("keydown", e => {
  if(e.key === "Escape" && mqEtroit.matches && tiroirOuvert) basculerPanneau(false);
});
mqEtroit.addEventListener("change", () => { tiroirOuvert = false; syncPanneau(); });
syncPanneau();
document.querySelectorAll("a.mail").forEach(a => { a.href = "mailto:" + a.dataset.u + "@" + a.dataset.d; });

load();
depuisHash();
renderItems();
syncTheme();
setRail(railMode);
setFiscalite(fiscalite);
brancherInfobulles();
$("echLisible").setAttribute("aria-pressed", echelleTri === "lisible" ? "true" : "false");
$("echComplete").setAttribute("aria-pressed", echelleTri === "complete" ? "true" : "false");
render();

(function(){
  const barre = document.querySelector(".topbar");
  const bouton = barre && barre.querySelector(".burger");
  if(!bouton) return;
  const ouvrir = oui => {
    barre.classList.toggle("ouvert", oui);
    bouton.setAttribute("aria-expanded", oui ? "true" : "false");
    bouton.setAttribute("aria-label", oui ? "Fermer le menu" : "Ouvrir le menu");
  };
  bouton.hidden = false;
  barre.classList.add("menu-pret");
  bouton.addEventListener("click", () => ouvrir(!barre.classList.contains("ouvert")));
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && barre.classList.contains("ouvert")){ ouvrir(false); bouton.focus(); }
  });
  document.addEventListener("click", e => { if(!barre.contains(e.target)) ouvrir(false); });
})();

