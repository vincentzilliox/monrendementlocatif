"use strict";
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
  "surface": 0.0,
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
  "revenus": 0.0,
  "credits": 0.0,
  "situation": "achat",
  "regime": "lmnp-reel",
  "tmi": 30.0,
  "dpe": "",
  "typeBien": "appartement",
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
// Les valeurs d'ouverture de la calculatrice « acheter ou louer », relues de
// même dans acheter-ou-louer.html.
const DEFAUTS_RP = {
  "prix": 300000.0,
  "notairePct": 7.5,
  "travaux": 10000.0,
  "demenagement": 1500.0,
  "surface": 0.0,
  "apport": 50000.0,
  "duree": 25.0,
  "taux": 3.4,
  "assur": 0.34,
  "fraisDossier": 3000.0,
  "ptzMontant": 0.0,
  "ptzDiffere": 0.0,
  "ptzDuree": 15.0,
  "personnes": 2.0,
  "rfr": 0.0,
  "revenus": 0.0,
  "credits": 0.0,
  "tf": 1500.0,
  "tfExo": 40.0,
  "copro": 80.0,
  "entretien": 0.5,
  "assurProprio": 250.0,
  "loyer": 1100.0,
  "fraisAgenceLoc": 800.0,
  "depotMois": 1.0,
  "assurLocataire": 150.0,
  "partBourse": 60.0,
  "partFonds": 30.0,
  "partLivret": 10.0,
  "bourse": 4.0,
  "fondsEuros": 0.0,
  "livretA": -0.8,
  "psCapital": 18.6,
  "psAV": 17.2,
  "horizon": 15.0,
  "inflation": 2.5,
  "indexPrix": 2.5,
  "indexLoyer": 2.5,
  "indexCharges": 2.5,
  "fraisVente": 5.0,
  "typeBien": "appartement",
  "etat": "ancien",
  "ptzMode": "auto",
  "zone": "",
  "enveloppe": "pea",
  "comptant": false,
  "ira": true,
  "primo": true,
  "couple": true,
  "dejaLocataire": false,
  "prixSuitInflation": true
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
  const p = scenario(), R = compute(p), f = R.final;
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
  // Le meilleur moment pour revendre, dit comme sur la calculatrice.
  const rv = R.revente;
  ecrire("vBest", rv.garder ? "Ne revendez pas" : "Année " + rv.y);
  ecrire("vBestTri", sPct(rv.row.tri));
  ecrire("vBestNet", eur.format(rv.row.netVente));
  ecrire("vBestText", rv.garder
    ? `Garder le bien ${p.horizon} ans fait mieux que le revendre plus tôt pour placer l'argent en bourse, après impôt.`
    : rv.battu
    ? `À aucune date ce bien ne rattrape la bourse, après impôt : ${rv.y === p.horizon ? "c'est en le gardant jusqu'au bout" : "c'est en revendant cette année-là"} que l'écart reste le plus faible.`
    : "Au-delà, garder le bien rapporte moins que placer en bourse ce que sa vente rendrait, après impôt.");
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
  // Le prix à négocier et le loyer à obtenir, sur le scénario présenté.
  const vs = g("vSeuils");
  if(vs) vs.innerHTML = tuilesSeuils(seuils(p), "bourse");
}

/* ---------- acheter pour y vivre ---------- */
// Le scénario d'ouverture de la calculatrice « acheter ou louer », ou celui que
// son questionnaire construit : ce qui n'est pas répondu garde sa valeur
// d'ouverture, et les prix suivent l'inflation tant que la case est cochée.
function scenarioRP(surcharges){
  const p = Object.assign({}, DEFAUTS_RP, surcharges || {});
  if(p.prixSuitInflation) p.indexPrix = p.indexLoyer = p.indexCharges = p.inflation;
  return p;
}
function vitrineRP(){
  const g = id => document.getElementById(id);
  const ecrire = (id, txt) => { const el = g(id); if(el) el.textContent = txt; };
  const p = scenarioRP(), R = acheterOuLouer(p), f = R.final, b = R.bascule;
  const an = n => n + (n > 1 ? " ans" : " an");
  ecrire("vrPrix", eur.format(p.prix));
  ecrire("vrApport", eur.format(p.apport));
  ecrire("vrLoyer", eur.format(p.loyer));
  ecrire("vrHorizon", an(p.horizon));
  const Vd = verdictRP(R), grand = g("vrBascule");
  ecrire("vrSur", Vd.sur);
  ecrire("vrBascule", Vd.titre);
  if(grand){ grand.classList.toggle("bad", Vd.perdant); grand.classList.toggle("phrase", Vd.phrase); }
  const pill = g("vrPill");
  if(pill){
    pill.textContent = sEur(f.ecartReel);
    pill.className = "pill num " + (Math.abs(f.ecartReel) < 500 ? "flat" : f.ecartReel > 0 ? "win" : "lose");
  }
  ecrire("vrPer", (f.ecartReel >= 0 ? "d'avance pour l'achat" : "d'avance pour la location")
    + ` au bout de ${an(p.horizon)}, en euros d'aujourd'hui`);
  ecrire("vrRatio", R.ratioPrixLoyer.toFixed(1).replace(".", ",") + " ans de loyer");
  ecrire("vrCout", eur.format(R.couts1.proprio/12) + " par mois");
  ecrire("vrLoc", eur.format(R.couts1.locataire/12) + " par mois");
  const mot = avisRP(R), boite = g("vrAvisBox");
  if(boite) boite.hidden = !mot;
  ecrire("vrAvis", mot || "");
  ecrire("vrHorizonTitre", `Au bout de ${an(p.horizon)}, en euros d'aujourd'hui`);
  const liste = g("vrHorizonListe");
  if(liste) liste.innerHTML =
    `<dt>Propriétaire, tout revendu</dt><dd>${eur.format(f.liquidationReel)}</dd>` +
    `<dt>Locataire, tout retiré</dt><dd>${eur.format(f.patrimoineLocReel)}</dd>` +
    `<dt>Rendement net du placement</dt><dd>${pct(R.rendementPlacement)} /an</dd>`;
  ecrire("vrHorizonTexte", "Les deux ménages ont sorti exactement les mêmes sommes de leur poche : seul l'usage qu'ils en ont fait diffère.");
  drawChart(g("vrPlotPat"), g("vrTipPat"), cfgPatrimoineRP(R, true, {height: 280}));
  const tuile = (nom, x, r) => `<div class="tile"><span class="k">${nom}</span><span class="v num">${x === null ? "Louer" : "Année " + x}</span>`
    + `<span class="s">${x === null ? "plus intéressant qu'acheter" : "l'achat passe devant"} · ${pct(r).replace(" ", "\u00a0")}\u00a0/an net</span></div>`;
  const pl = g("vrPlacements");
  if(pl) pl.innerHTML = tuile("Répartition par défaut", b, R.rendementPlacement)
    + comparerPlacementsRP(p).map(x => tuile(x.nom, x.bascule, x.rendement)).join("");
  const vs = g("vrSeuils");
  if(vs) vs.innerHTML = tuilesSeuils(seuilsRP(p), "location");
}

/* ---------- deux parcours ---------- */
// Investir pour louer, ou acheter pour y vivre : chaque carte ouvre son
// questionnaire. Les deux exemples restent affichés plus bas, l'un sous l'autre.
function choisirParcours(v, defiler){
  const vivre = v === "vivre", g = id => document.getElementById(id);
  g("choixInvestir").setAttribute("aria-pressed", vivre ? "false" : "true");
  g("choixVivre").setAttribute("aria-pressed", vivre ? "true" : "false");
  g("assistant").hidden = vivre; g("assistantRP").hidden = !vivre;
  if(defiler) g(vivre ? "assistantRP" : "assistant").scrollIntoView({behavior:"smooth", block:"center"});
}
function redessiner(){ vitrine(); vitrineRP(); }
const parcoursDuLien = () => location.hash === "#acheter-pour-y-vivre" ? "vivre" : location.hash === "#investir" ? "investir" : null;
document.getElementById("choixInvestir").addEventListener("click", () => choisirParcours("investir"));
document.getElementById("choixVivre").addEventListener("click", () => choisirParcours("vivre"));
addEventListener("hashchange", () => { const v = parcoursDuLien(); if(v) choisirParcours(v, true); });

brancherInfobulles();

let vid;
addEventListener("resize", () => { clearTimeout(vid); vid = setTimeout(redessiner, 140); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => setTimeout(redessiner, 30));
document.addEventListener("theme", redessiner);
redessiner();
if(parcoursDuLien() === "vivre") choisirParcours("vivre");
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
/* ═════════════════════════════════════════════════════════════════
   assistant-rp — le questionnaire « acheter pour y vivre » de
   l'accroche. Comme l'assistant de l'investisseur, il n'écrit aucun
   chiffre : tout se déduit de DEFAUTS_RP, à proportion du prix saisi.
   Accepter chaque proposition rend donc un lien qui ne fixe aucune
   hypothèse — le scénario même de la vitrine « y vivre ».
   ═════════════════════════════════════════════════════════════════ */
(function(){
const racine = document.getElementById("assistantRP");
if(!racine) return;

const el = id => document.getElementById(id);
const coche = nom => {
  const e = racine.querySelector('input[name="' + nom + '"]:checked');
  return e ? e.value : "";
};
// Les frais de notaire du neuf : ceux que la calculatrice propose quand on y
// choisit « neuf ».
const NOTAIRE_NEUF = 2.5;

const ETAPES = [
  {id:"rEtapeBien",      champs:["rPrix"],    skip:true},
  {id:"rEtapeLoyer",     champs:["rLoyer"],   skip:true},
  {id:"rEtapeApport",    champs:["rApport"],  skip:true},
  {id:"rEtapeDuree",     actif: () => coche("rFinancement") !== "comptant"},
  {id:"rEtapePrimo",     champs:["rPersonnes"]},
  {id:"rEtapeHorizon"},
  {id:"rEtapePlacement"},
  {id:"rEtapeRecap",     recap:true}
];
const actives = () => ETAPES.filter(e => !e.actif || e.actif());

/* ---------- ce que l'assistant propose ---------- */
const arrondi = (v, pas) => Math.max(0, Math.round(v/pas)*pas);
const chiffres = v => String(v).replace(/[^\d]/g, "");
const prixSaisi = () => { const v = parseInt(chiffres(el("rPrix").value), 10); return isFinite(v) && v > 0 ? v : DEFAUTS_RP.prix; };
const facteur = () => prixSaisi() / DEFAUTS_RP.prix;
const PROPOSE = {
  rPrix:      () => DEFAUTS_RP.prix,
  rLoyer:     () => arrondi(DEFAUTS_RP.loyer * facteur(), 10),
  rApport:    () => arrondi(DEFAUTS_RP.apport * facteur(), 1000),
  rPersonnes: () => DEFAUTS_RP.personnes
};
const saisi = id => {
  const v = parseInt(chiffres(el(id).value), 10);
  return isFinite(v) ? v : PROPOSE[id]();
};
const ecrire = (id, v) => { el(id).value = eur1.format(v); };
// Chaque choix de placement fixe la répartition et l'enveloppe ; « un peu de
// tout » garde celles de la calculatrice.
const PLACEMENTS = {
  mix:     () => ({partBourse:DEFAUTS_RP.partBourse, partFonds:DEFAUTS_RP.partFonds, partLivret:DEFAUTS_RP.partLivret, enveloppe:DEFAUTS_RP.enveloppe}),
  actions: () => ({partBourse:100, partFonds:0, partLivret:0, enveloppe:"pea"}),
  fonds:   () => ({partBourse:0, partFonds:100, partLivret:0, enveloppe:DEFAUTS_RP.enveloppe}),
  livret:  () => ({partBourse:0, partFonds:0, partLivret:100, enveloppe:DEFAUTS_RP.enveloppe})
};

/* ---------- les réponses, assemblées ---------- */
function reponses(){
  const k = facteur(), prix = prixSaisi(), neuf = coche("rNeuf") === "neuf";
  const comptant = coche("rFinancement") === "comptant";
  const primo = coche("rPrimo") !== "non";
  const r = Object.assign({
    prix, etat: neuf ? "neuf" : "ancien",
    notairePct: neuf ? NOTAIRE_NEUF : DEFAUTS_RP.notairePct,
    loyer: saisi("rLoyer"),
    duree: parseFloat(coche("rDuree")) || DEFAUTS_RP.duree,
    comptant, primo,
    zone: primo ? coche("rZone") : DEFAUTS_RP.zone,
    personnes: primo ? Math.max(1, Math.min(8, saisi("rPersonnes") || 1)) : DEFAUTS_RP.personnes,
    horizon: parseFloat(coche("rHorizon")) || DEFAUTS_RP.horizon,
    tf: arrondi(DEFAUTS_RP.tf * k, 50),
    copro: arrondi(DEFAUTS_RP.copro * k, 5),
    travaux: arrondi(DEFAUTS_RP.travaux * k, 1000)
  }, (PLACEMENTS[coche("rPlacement")] || PLACEMENTS.mix)());
  // Un apport supérieur au coût de l'achat n'a plus rien à financer ; payer
  // comptant, c'est apporter tout le coût. Même assiette que le moteur.
  const besoin = Math.round(prix + prix*r.notairePct/100 + r.travaux + (comptant ? 0 : DEFAUTS_RP.fraisDossier));
  const voulu = comptant ? besoin : saisi("rApport");
  r.apport = Math.min(voulu, besoin);
  r.plafonne = voulu > r.apport;
  return r;
}
const CLES = ["prix","etat","notairePct","loyer","apport","duree","primo","zone","personnes","horizon",
  "tf","copro","travaux","partBourse","partFonds","partLivret","enveloppe"];
function valeurs(r){
  const v = {};
  CLES.forEach(c => { v[c] = r[c]; });
  if(r.comptant) v.comptant = true;
  return v;
}

/* ---------- rendu ---------- */
const touches = new Set();
let etape = 0, demarre = false;
function majLiens(r){
  const cible = "/acheter-ou-louer/" + lienHypotheses(valeurs(r), DEFAUTS_RP, null, true);
  el("rGo").setAttribute("href", cible);
  el("rSauter").setAttribute("href", cible);
}
const ans = n => n + (n > 1 ? " ans" : " an");
const NOMS_PLACEMENT = {mix:"un peu de tout", actions:"actions, sur un PEA", fonds:"assurance-vie, fonds euros", livret:"Livret A"};

function dessinerRecap(r){
  const lignes = [
    ["Le logement", eur.format(r.prix) + (r.etat === "neuf" ? " · neuf" : " · ancien"), "", "rEtapeBien"],
    ["Le loyer équivalent", eur.format(r.loyer) + " par mois", "", "rEtapeLoyer"],
    r.comptant
      ? ["Financement", "comptant, " + eur.format(r.apport), "tout le coût de l'achat, sans crédit", "rEtapeApport"]
      : ["Apport", eur.format(r.apport), r.plafonne ? "ramené au coût de l’achat : au-delà, il n’y a plus rien à emprunter" : "", "rEtapeApport"],
    r.comptant ? null : ["Prêt", ans(r.duree), "", "rEtapeDuree"],
    ["Premier achat", r.primo ? "oui" + (r.zone ? ", zone " + r.zone : "") : "non",
      r.primo && !r.zone ? "sans la zone, le prêt à taux zéro ne peut pas être estimé" : "", "rEtapePrimo"],
    ["Vous y vivez", r.horizon >= HORIZON_MAX_RP ? "pour toujours" : ans(r.horizon),
      r.horizon >= HORIZON_MAX_RP ? "calculé sur " + ans(HORIZON_MAX_RP) + ", logement revendu au bout" : "", "rEtapeHorizon"],
    ["En louant, vous placez", NOMS_PLACEMENT[coche("rPlacement")] || NOMS_PLACEMENT.mix, "", "rEtapePlacement"]
  ].filter(Boolean);
  el("rRecap").innerHTML = lignes.map(([terme, valeur, note, id]) =>
    "<dt>" + terme + "</dt><dd><span>" + valeur + "</span>"
    + '<button type="button" class="qmod" data-etape="' + id + '">Modifier<span class="visually-hidden"> : '
    + esc(terme.toLowerCase()) + "</span></button>"
    + (note ? "<small>" + note + "</small>" : "") + "</dd>").join("");
  // Un aperçu du verdict, calculé par le même moteur que la calculatrice.
  let R = null;
  try{ R = acheterOuLouer(scenarioRP(valeurs(r))); }catch(e){}
  el("rApercu").textContent = !R ? ""
    : R.bascule === null ? `Sur ces réponses, louer et placer la différence reste plus avantageux, même au bout de quarante ans.`
    : R.bascule > r.horizon ? `Sur ces réponses, acheter ne devient gagnant qu'en année ${R.bascule}, après votre départ prévu : louer l'emporte.`
    : `Sur ces réponses, acheter devient gagnant à partir de l'année ${R.bascule} : dans ${ans(r.horizon)}, ${eur.format(R.final.ecartReel)} de plus qu'en louant, en euros d'aujourd'hui.`;
  el("rHypo").innerHTML = "Nous avons supposé, à proportion du prix, la taxe foncière à " + eur.format(r.tf)
    + ", les charges de copropriété non récupérables à " + eur.format(r.copro) + " par mois et "
    + (r.travaux ? eur.format(r.travaux) + " de travaux" : "aucun travaux")
    + ". Et, comme la calculatrice à l’ouverture : une inflation de " + String(DEFAUTS_RP.inflation).replace(".", ",")
    + " % par an" + (r.comptant ? "" : ", un crédit à " + String(DEFAUTS_RP.taux).replace(".", ",") + " %")
    + ". Toutes ces hypothèses restent modifiables dans l’outil.";
}

function montrer(n){
  const liste = actives();
  etape = Math.max(0, Math.min(liste.length - 1, n));
  const e = liste[etape];
  ETAPES.forEach(x => { el(x.id).hidden = x !== e; });
  (e.champs || []).forEach(c => { if(!touches.has(c)) ecrire(c, PROPOSE[c]()); });
  el("rCompteur").textContent = e.recap ? "Récapitulatif" : "Question " + (etape + 1) + " sur " + (liste.length - 1);
  el("rJauge").style.width = Math.round((etape + 1)/liste.length*100) + "%";
  el("rBack").hidden = etape === 0;
  el("rNext").hidden = !!e.recap;
  el("rSkip").hidden = !e.skip;
  el("rPasser").hidden = !!e.recap;
  rafraichir();
  if(demarre){
    const titre = el(e.id).querySelector(".qtitre");
    if(titre) titre.focus();
  }
}
function rafraichir(){
  el("rApportChamps").hidden = coche("rFinancement") === "comptant";
  el("rPtzChamps").hidden = coche("rPrimo") === "non";
  const r = reponses();
  majLiens(r);
  if(actives()[etape].recap) dessinerRecap(r);
}

/* ---------- écoutes ---------- */
racine.addEventListener("input", e => { if(e.target.id) touches.add(e.target.id); rafraichir(); });
racine.addEventListener("change", rafraichir);
racine.addEventListener("focusout", e => {
  if(e.target.tagName === "INPUT" && e.target.type === "text" && chiffres(e.target.value))
    ecrire(e.target.id, saisi(e.target.id));
});
racine.addEventListener("keydown", e => {
  if(e.key !== "Enter" || e.target.tagName === "A" || e.target.tagName === "BUTTON") return;
  e.preventDefault(); demarre = true; montrer(etape + 1);
});
el("rNext").addEventListener("click", () => { demarre = true; montrer(etape + 1); });
el("rBack").addEventListener("click", () => { demarre = true; montrer(etape - 1); });
el("rSkip").addEventListener("click", () => {
  (actives()[etape].champs || []).forEach(c => { touches.delete(c); ecrire(c, PROPOSE[c]()); });
  demarre = true; montrer(etape + 1);
});
el("rRecap").addEventListener("click", e => {
  const b = e.target.closest(".qmod");
  if(!b) return;
  demarre = true;
  montrer(Math.max(0, actives().findIndex(x => x.id === b.dataset.etape)));
});

/* ---------- démarrage ---------- */
const radio = (nom, valeur, libelle, choisi) =>
  '<label><input type="radio" name="' + nom + '" value="' + esc(valeur) + '"'
  + (choisi ? " checked" : "") + "><span>" + esc(libelle) + "</span></label>";
// Les durées d'ouverture figurent parmi les propositions, à leur rang : sans
// quoi l'assistant changerait une hypothèse que personne n'a touchée.
function avecDefaut(conteneur, nom, defaut){
  const boite = el(conteneur);
  const existant = boite.querySelector('input[name="' + nom + '"][value="' + defaut + '"]');
  if(existant){ existant.checked = true; return; }
  const suivant = [...boite.querySelectorAll('input[name="' + nom + '"]')].find(i => parseFloat(i.value) > defaut);
  const html = radio(nom, String(defaut), ans(defaut), true);
  if(suivant) suivant.closest("label").insertAdjacentHTML("beforebegin", html);
  else boite.insertAdjacentHTML("beforeend", html);
}
avecDefaut("rDureeChoix", "rDuree", DEFAUTS_RP.duree);
avecDefaut("rHorizonChoix", "rHorizon", DEFAUTS_RP.horizon);
el("rMixAide").textContent = `${DEFAUTS_RP.partBourse} % en actions, ${DEFAUTS_RP.partFonds} % en fonds euros, ${DEFAUTS_RP.partLivret} % sur Livret A`;
const zone = racine.querySelector('input[name="rZone"][value="' + DEFAUTS_RP.zone + '"]');
if(zone) zone.checked = true;
if(!DEFAUTS_RP.primo) racine.querySelector('input[name="rPrimo"][value="non"]').checked = true;

montrer(0);
})();
