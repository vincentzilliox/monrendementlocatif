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
