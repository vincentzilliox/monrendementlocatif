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
