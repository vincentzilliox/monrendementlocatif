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
function sensibiliteRP(p, ref){
  return SENS_RP.filter(s => !(s.credit && p.comptant)).map(s => {
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
  const devant = ecartRP(p) >= 0;
  return SEUILS_RP.filter(s => !(s.credit && p.comptant)).map(s => {
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
  if(b === null)
    return `Sur vos hypothèses, louer et placer la différence reste plus avantageux à toute date, jusqu'à ${HORIZON_MAX_RP} ans : acheter vous laisserait ${somme} de moins dans ${h} ans, en euros d'aujourd'hui.`;
  if(e < 0)
    return b > h
      ? `Pour ${h} ans, louer l'emporte de ${somme} en euros d'aujourd'hui. Acheter ne devient gagnant qu'à partir de la ${eme(b)} année : c'est la durée d'occupation qui décide.`
      : `Acheter passe devant la ${eme(b)} année, mais louer et placer repasse devant la ${eme(r)} : au bout de ${h} ans, louer l'emporte de ${somme}, en euros d'aujourd'hui.`;
  const fragile = h - b <= 2 ? " La marge est mince : un départ un peu plus tôt que prévu inverserait la réponse." : "";
  const retour = r ? ` Au-delà de ${r - 1} ans, louer et placer repasserait devant.` : "";
  return (b <= 3
    ? `Acheter l'emporte presque d'emblée, dès la ${eme(b)} année. Dans ${h} ans, vous posséderiez ${somme} de plus qu'en louant, en euros d'aujourd'hui.`
    : `Acheter devient gagnant à partir de la ${eme(b)} année. Dans ${h} ans, vous posséderiez ${somme} de plus qu'en louant et plaçant la différence, en euros d'aujourd'hui.`)
    + fragile + retour;
}
