/* ═════════════════════════════════════════════════════════════════
   chiffres — les nombres que publient les guides, recalculés.
   Chaque chiffre d'un guide qui découle du moteur porte data-calc="clé" ;
   outils/verifier.py compare le texte affiché à la valeur calculée ici, sur
   le scénario d'ouverture de la calculatrice (DEFAUTS_SITE, relu dans
   index.html). Un guide ne peut donc plus dériver de l'outil.

   Les taux sont en pour cent (4,8 % → 4.8), les montants en euros.
   Exécuté après src/moteur.js, qui fournit compute() et ses voisines.
   ═════════════════════════════════════════════════════════════════ */

function scenarioGuide(o){
  const p = Object.assign({}, DEFAUTS_SITE, {items: TVX_DEFAUT.map(t => Object.assign({}, t))});
  // La case « prix, loyers et charges suivent l'inflation » est cochée à l'ouverture.
  p.indexPrix = p.indexLoyer = p.indexCharges = p.inflation;
  Object.assign(p, o || {});
  p.travaux = p.items.reduce((s, i) => s + i.montant, 0);
  return compute(p);
}
// Les deux régimes nus emportent leurs réglages, comme appliquerRegime() le fait.
const NU = {ps: 17.2, cfe: 0};

function chiffresGuides(){
  const c = {};
  const pc = v => v === null ? null : v*100;
  const R = scenarioGuide({horizon: 30});          // les lignes 1 à 30
  const r = y => R.rows[y - 1];
  const R40 = scenarioGuide({horizon: 40});

  // Scénario.
  c.inflation = R.p.inflation;
  c.bourseReel = R.p.bourse;
  c.bourseNominal = ((1 + R.p.bourse/100)*(1 + R.p.inflation/100) - 1)*100;
  c.livretA = R.p.livretA;
  c.compta = R.p.compta;

  // Rentabilités de la première année.
  c.brute = pc(R.brute);
  c.bruteCout = pc(R.bruteCout);
  c.besoin = R.besoin;
  c.loyersAn1 = r(1).loyers;
  c.chargesAn1 = r(1).charges;
  c.netAn1 = r(1).loyers - r(1).charges;
  c.nette = pc(R.nette);
  c.netteNette = pc(R.netteNette);
  const MF = scenarioGuide(Object.assign({horizon: 30, regime: "micro-foncier", abattement: 30}, NU));
  c.mfImpotAn1 = MF.rows[0].impot;
  c.mfBesoin = MF.besoin;
  c.mfNetteNette = pc(MF.netteNette);

  // Rendement et gains, année par année.
  [1, 5, 9, 15, 20, 25, 30].forEach(y => {
    c["tri" + y] = pc(r(y).tri);
    c["gain" + y] = r(y).gain;
    c["impotPV" + y] = r(y).impotPV + r(y).repriseDF;
    c["cf" + y] = r(y).cfNet;
    c["netVente" + y] = r(y).netVente;
  });
  c.pointMort = R.rows.findIndex(x => x.gainImmo >= 0) + 1;
  const m = c.pointMort;
  c.triPointMort = pc(r(m).tri);
  c.gainPointMort = r(m).gain;
  c.impotPVPointMort = r(m).impotPV;
  c.cfPointMort = r(m).cfNet;
  c.netVentePointMort = r(m).netVente;
  c.triReel25 = pc(r(25).triReel);
  c.picAnnee = R40.best.y;
  c.effortMoisAn1 = -r(1).cfNet/12;
  c.mise20 = r(20).mise;

  // Face aux placements, à mise de fonds identique.
  [15, 25, 30].forEach(y => {
    c["gainImmo" + y] = r(y).gainImmo;
    c["gainBourse" + y] = r(y).gainBourse;
    c["gainLivret" + y] = r(y).gainLivret;
    c["gainFonds" + y] = r(y).gainFonds;
    c["avanceBourse" + y] = r(y).gainBourse - r(y).gainImmo;
  });
  c.triBourse25 = pc(r(25).triBourse);
  c.triBourseReel25 = pc(r(25).triBourseReel);
  c.mfAvanceBourse25 = MF.rows[24].gainBourse - MF.rows[24].gainImmo;
  const tri25 = r(25).tri;
  c.gainPrixMoins10 = (scenarioGuide({horizon: 25, prix: R.p.prix*0.9}).final.tri - tri25)*100;
  c.gainLoyerPlus10 = (scenarioGuide({horizon: 25, loyer: R.p.loyer*1.1}).final.tri - tri25)*100;

  // LMNP : micro-BIC face au réel.
  const MB = scenarioGuide({horizon: 25, regime: "lmnp-micro"});
  const LR = scenarioGuide({horizon: 25});
  c.mbImpotAn1 = MB.rows[0].impot;
  c.mbImpotsLoyers25 = MB.rows.reduce((s, x) => s + x.impot, 0);
  c.lrImpotsLoyers25 = LR.rows.reduce((s, x) => s + x.impot, 0);
  c.mbTri25 = pc(MB.final.tri);
  c.lrTri25 = pc(LR.final.tri);
  const L1 = LR.rows[0];
  c.lrDeductionsAn1 = L1.charges + L1.interets + L1.assurance + LR.fraisDossier;
  // Les dotations annuelles, telles que le moteur les calcule.
  c.amortBati = (LR.p.prix + LR.notaire + LR.fraisAcq)*LR.p.partBati/100/LR.p.amortBatiAns;
  c.amortTvx = LR.p.travaux/LR.p.amortTvxAns;
  c.amortMob = LR.mobilier/LR.p.amortMobAns;
  c.amortTotal = c.amortBati + c.amortTvx + c.amortMob;
  c.notaire = LR.notaire;
  // La réintégration des amortissements, rejouée sur la revente à 25 ans : l'impôt
  // de plus-value avec et sans elle, mêmes abattements, même surtaxe.
  const f = LR.final, p = LR.p, h = 25;
  const prixAcq = p.prix + Math.max(LR.notaire, 0.075*p.prix) + Math.max(p.travaux, 0.15*p.prix);
  const impot = pv => { const b = pv*(1 - abattementIR(h)), s = pv*(1 - abattementPS(h));
    return b*0.19 + s*(p.psPV/100) + surtaxePV(b); };
  const pvSans = Math.max(0, f.valeur - f.fraisVente - prixAcq);
  const pvAvec = Math.max(0, f.valeur - f.fraisVente - (prixAcq - f.amortReintegre));
  c.reintegration25 = impot(pvAvec) - impot(pvSans);

  // Nu : micro-foncier face au réel, travaux déduits la première année.
  const RF = scenarioGuide(Object.assign({horizon: 25, regime: "reel-foncier"}, NU));
  const MF25 = scenarioGuide(Object.assign({horizon: 25, regime: "micro-foncier", abattement: 30}, NU));
  const F1 = RF.rows[0];
  c.rfDeficitHorsInterets = F1.charges + RF.p.items.reduce((s, i) => s + i.montant*i.deduc/100, 0) - F1.loyers;
  c.rfImpute = Math.min(c.rfDeficitHorsInterets, RF.p.plafondDeficit);
  c.rfEconomieAn1 = -F1.impot;
  c.rfFraisEmpruntAn1 = F1.interets + F1.assurance + RF.fraisDossier;
  c.rfImpotNulJusqua = RF.rows.reduce((d, x) => x.impot <= 0.5 && d === x.y - 1 ? x.y : d, 0);
  c.mfImpotAns2a6 = MF25.rows.slice(1, 6).reduce((s, x) => s + x.impot, 0)/5;
  c.rfImpotAns2a6 = RF.rows.slice(1, 6).reduce((s, x) => s + Math.max(0, x.impot), 0);
  c.mfImpotAn15 = MF25.rows[14].impot;
  c.rfImpotAn15 = RF.rows[14].impot;
  const cumul = R => R.rows.reduce((s, x) => s + x.impot, 0) + R.final.impotPV + R.final.repriseDF;
  c.mfImpots25 = cumul(MF25);
  c.rfImpots25 = cumul(RF);
  c.rfEconomie25 = c.mfImpots25 - c.rfImpots25;
  c.mfTri25 = pc(MF25.final.tri);
  c.rfTri25 = pc(RF.final.tri);
  c.rfGainTri25 = c.rfTri25 - c.mfTri25;
  c.mfGain25 = MF25.final.gain;
  // Le point mort de chaque régime, sur trente ans.
  const pm = o => { const X = scenarioGuide(Object.assign({horizon: 30}, o)); return X.rows.findIndex(x => x.gainImmo >= 0) + 1; };
  c.pointMortReelFoncier = pm(Object.assign({regime: "reel-foncier"}, NU));
  c.pointMortMicroFoncier = pm(Object.assign({regime: "micro-foncier", abattement: 30}, NU));
  c.pointMortMicroBic = pm({regime: "lmnp-micro"});
  c.rfImpotAn1 = F1.impot;
  c.rfGain25 = RF.final.gain;
  return c;
}
