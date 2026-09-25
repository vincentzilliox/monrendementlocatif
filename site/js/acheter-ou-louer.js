"use strict";
/* ═════════════════════════════════════════════════════════════════
   residence-calc — la calculatrice « acheter ou louer » : lecture du
   formulaire, rendu, persistance. Seul fichier autorisé à connaître les
   identifiants de ses champs. Il partage la portée globale de commun.js
   (moteur, graphiques, residence) : ses noms n'y figurent pas.
   ═════════════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const bulle = txt => `<span class="ihint"><button type="button" class="i" aria-label="Explication" aria-expanded="false">i</button><span class="ibody" hidden>${txt}</span></span>`;

/* ---------- formulaire ---------- */
const FIELDS_RP = ["prix","notairePct","travaux","demenagement","surface","apport","duree","taux","assur",
  "fraisDossier","ptzMontant","ptzDiffere","ptzDuree","personnes","rfr","revenus","credits",
  "tf","tfExo","copro","entretien","assurProprio","loyer","fraisAgenceLoc","depotMois","assurLocataire",
  "partBourse","partFonds","partLivret","bourse","fondsEuros","livretA","psCapital","psAV",
  "horizon","inflation","indexPrix","indexLoyer","indexCharges","fraisVente"];
// Ce qui décrit le foyer et non le projet : retenu dans ce navigateur, jamais
// inscrit dans un lien, et conservé quand on ouvre le lien de quelqu'un d'autre.
const PRIVES_RP = ["rfr","revenus","credits"];
const SELECTS_RP = ["typeBien","etat","ptzMode","zone","enveloppe"];
const BOOLS_RP = ["comptant","ira","primo","couple","dejaLocataire","prixSuitInflation"];
const DEFAULTS_RP = {};
FIELDS_RP.concat(SELECTS_RP).forEach(k => DEFAULTS_RP[k] = $(k).value);
BOOLS_RP.forEach(k => DEFAULTS_RP[k] = $(k).checked);
// Frais de notaire proposés quand on passe de l'ancien au neuf, et retour.
const NOTAIRE_RP = {ancien:"7.5", neuf:"2.5"};
let communeCode = "";

function lire(){
  const p = {};
  FIELDS_RP.forEach(k => { const v = parseFloat($(k).value); p[k] = isFinite(v) ? v : 0; });
  SELECTS_RP.forEach(k => { p[k] = $(k).value; });
  BOOLS_RP.forEach(k => { p[k] = $(k).checked; });
  p.commune = communeCode;
  if(p.prixSuitInflation){
    p.indexPrix = p.inflation;
    p.indexLoyer = p.inflation;
    p.indexCharges = p.inflation;
  }
  p.horizon = Math.max(1, Math.min(40, Math.round(p.horizon)));
  p.duree = Math.max(1, Math.min(30, Math.round(p.duree)));
  p.personnes = Math.max(1, Math.min(8, Math.round(p.personnes)));
  p.depotMois = Math.max(0, Math.min(2, p.depotMois));
  ["prix","travaux","apport","loyer"].forEach(k => { p[k] = Math.max(0, p[k]); });
  return p;
}

/* ---------- rendu ---------- */
let R = null;
// Euros d'aujourd'hui par défaut : un patrimoine dans quinze ans ne se lit
// qu'inflation retirée. Les euros courants se consultent et se retiennent.
let echelleRP = "reel";
try{ if(localStorage.getItem("rentaloc.rp.echelle") === "courant") echelleRP = "courant"; }catch(e){}

// Ce qui ne concerne pas les choix faits est masqué, donc neutralisé par le
// moteur : un champ masqué ne pèse jamais sur le résultat.
function syncChamps(){
  const comptant = $("comptant").checked, mode = $("ptzMode").value;
  ["fApport","fDuree","fTaux","fAssur","dCredit","mPtz","mCredit","mCapacite"].forEach(id => { $(id).hidden = comptant; });
  const deja = $("dejaLocataire").checked;
  $("fFraisAgenceLoc").hidden = deja; $("fDepot").hidden = deja;
  $("fTfExo").hidden = $("etat").value !== "neuf";
  ["fPrimo","fZone","fPersonnes","fRfr"].forEach(id => { $(id).hidden = mode !== "auto"; });
  ["fPtzMontant","fPtzDiffere","fPtzDuree"].forEach(id => { $(id).hidden = mode !== "manuel"; });
  $("repPtz").hidden = mode === "non";
  const suit = $("prixSuitInflation").checked;
  ["fIndexPrix","fIndexLoyer","fIndexCharges"].forEach(id => { $(id).hidden = suit; });
  if(suit) ["indexPrix","indexLoyer","indexCharges"].forEach(k => { $(k).value = $("inflation").value; });
}

const an = n => n + (n > 1 ? " ans" : " an");
function render(){
  oublierTheme();
  zoneDuMarche();
  syncChamps();
  const p = lire();
  R = acheterOuLouer(p);
  const reel = echelleRP === "reel";
  const {final} = R, r1 = R.rows[0];
  const e = reel ? final.ecartReel : final.ecart;
  const unite = reel ? "en euros d'aujourd'hui" : "en euros courants";

  // Le verdict : l'année où l'achat prend l'avantage, et l'écart à la date prévue.
  const b = R.bascule;
  const V = verdictRP(R);
  $("rpSur").textContent = V.sur;
  $("rpBascule").textContent = V.titre;
  $("rpBascule").classList.toggle("bad", V.perdant);
  $("rpBascule").classList.toggle("phrase", V.phrase);
  const pill = $("rpPill");
  pill.textContent = sEur(e);
  pill.className = "pill num " + (Math.abs(e) < 500 ? "flat" : e > 0 ? "win" : "lose");
  $("rpPer").textContent = (e >= 0 ? "d'avance pour l'achat" : "d'avance pour la location")
    + ` au bout de ${an(p.horizon)}, ${unite}`;
  const autre = reel ? final.ecart : final.ecartReel;
  $("rpEcartCourant").textContent = sEur(autre);
  $("rpEcartCourant").classList.toggle("bad", autre < 0);
  $("rpEcartTxt").textContent = reel ? `en euros courants de l'année ${p.horizon}` : "en euros d'aujourd'hui";
  $("rpRatio").textContent = R.ratioPrixLoyer === null ? "—"
    : R.ratioPrixLoyer.toFixed(1).replace(".", ",") + " ans de loyer";
  $("rpMise").textContent = eur.format(R.cash0Achat);
  $("rpTri").textContent = final.triAchat === null ? "—"
    : sPct(final.triAchat) + " /an, contre " + pct(R.rendementPlacement) + " placé";
  const mot = avisRP(R);
  $("rpAvisBox").hidden = !mot;
  $("rpAvis").textContent = mot || "";
  $("railTri").textContent = b === null ? "louer plus intéressant" : "achat gagnant dès l'an " + b;
  $("navTri").innerHTML = `<b>${b === null ? "Louer est plus intéressant" : "Achat gagnant dès l'année " + b}</b> · ${sEur(e)} à ${an(p.horizon)}`;

  const v = (r, cle) => reel ? r[cle + "Reel"] : r[cle];
  $("rpHorizonTitre").textContent = `Au bout de ${an(p.horizon)}, ${unite}`;
  const def = reel ? Math.pow(1 + p.inflation/100, p.horizon) : 1;
  $("rpHorizonListe").innerHTML =
    `<dt>Propriétaire, tout revendu</dt><dd>${eur.format(v(final, "liquidation"))}</dd>` +
    `<dt>dont logement, net de dettes</dt><dd>${eur.format(final.netLogement/def)}</dd>` +
    `<dt>Locataire, tout retiré</dt><dd>${eur.format(v(final, "patrimoineLoc"))}</dd>`;
  const placeLoc = R.suite.slice(0, p.horizon).reduce((s, r) => s + r.versLoc, Math.max(0, R.mise0));
  const placeProp = R.suite.slice(0, p.horizon).reduce((s, r) => s + r.versProp, Math.max(0, -R.mise0));
  $("rpHorizonTexte").textContent = `Le locataire aura placé ${eur.format(placeLoc)}`
    + (placeProp > 1 ? `, le propriétaire ${eur.format(placeProp)}` : "")
    + `, à ${pct(R.rendementPlacement)} par an nets d'impôt. Les deux ont sorti les mêmes sommes de leur poche.`;

  // Récapitulatif du financement, sous l'apport.
  $("dCout").textContent = eur.format(R.besoin);
  $("dApport").textContent = "− " + eur.format(Math.max(0, R.besoin - R.emprunt - R.ptz));
  $("dPtz").textContent = R.ptz > 0 ? "− " + eur.format(R.ptz) : "—";
  $("dEmprunt").textContent = eur.format(R.emprunt);
  $("dMens").textContent = eur.format(R.mensualite) + (R.ptz > 0 ? " + PTZ" : "");
  $("dCout2").textContent = eur.format(R.coutCredit);
  renderPtz(p);
  const E = endettementRP(p, R);
  $("dEndet").textContent = E ? pct(E.taux) : "—";
  $("dEndet").className = E && E.taux > PLAFOND_ENDETTEMENT ? "neg" : "";
  $("dMensMax").textContent = E ? eur.format(Math.max(0, E.mensualiteMax)) : "—";
  $("dCapCap").textContent = E
    ? `35 % de vos revenus, moins vos crédits en cours : la mensualité la plus lourde que la banque accepte en principe, assurance comprise.`
    : "Renseignez vos revenus pour connaître le taux d'endettement que la banque calculera.";

  const marche = renderMarche(p);
  renderTaux(p);
  $("hBourse").textContent = `Soit ${pct((1 + p.bourse/100)*(1 + p.inflation/100) - 1)} en euros courants, avant impôt.`;
  $("hFonds").textContent = `Soit ${pct((1 + p.fondsEuros/100)*(1 + p.inflation/100) - 1)} en euros courants, avant impôt.`;
  $("hLivret").textContent = `Soit ${pct((1 + p.livretA/100)*(1 + p.inflation/100) - 1)} en euros courants, exonéré d'impôt.`;

  // Les indicateurs de la première année.
  const C = R.couts1;
  $("indicateurs").innerHTML = [
    ["Dépense mensuelle, propriétaire", eur.format(r1.coutProprio/12),
      `La première année : mensualités ${R.ptz > 0 ? "des deux prêts" : "du prêt"}, taxe foncière, charges non récupérables, entretien et assurance. Le capital remboursé en fait partie : il reste à vous.`, ""],
    ["Dépense mensuelle, locataire", eur.format(r1.coutLoc/12),
      `Loyer et assurance habitation, la première année. ${r1.coutProprio >= r1.coutLoc ? `Le locataire place la différence : ${eur.format((r1.coutProprio - r1.coutLoc)/12)} par mois.` : `Le propriétaire dépense moins : c'est lui qui place la différence.`}`, ""],
    ["Coût réel de la propriété", eur.format(C.proprio/12) + " /mois",
      `Ce qui part sans retour la première année, capital remboursé exclu, coût d'opportunité de l'apport compris, hausse de la valeur déduite. Le locataire, lui, perd ${eur.format(C.locataire/12)} par mois.`,
      C.proprio <= C.locataire ? "pos" : "neg"],
    ["Coût du crédit", R.emprunt <= 0 ? "Aucun crédit" : eur.format(R.coutCredit),
      R.emprunt <= 0 ? (R.comptant ? "Achat comptant : ni intérêts, ni assurance emprunteur." : "Votre apport couvre tout le coût de l'achat : rien à emprunter.") : `Intérêts et assurance sur les ${an(p.duree)} du prêt principal, soit ${pct(R.coutCredit/Math.max(1, R.emprunt))} du capital emprunté.`, ""],
    ["Prêt à taux zéro", R.ptz > 0 ? eur.format(R.ptz) : "Aucun",
      R.ptz > 0 ? `Sans intérêt : ${R.differe > 0 ? `rien à rembourser pendant ${an(R.differe)}, puis ` : ""}${eur.format(R.mensualitePTZ)} par mois pendant ${an(R.remboursement)}.` : "Aucun prêt à taux zéro dans ce scénario : le détail est dans le panneau, sous le financement.", ""],
    ["Placement, net d'impôt", pct(R.rendementPlacement) + " /an",
      `Le rendement de votre répartition, impôt de sortie payé au bout de ${an(p.horizon)}, en euros courants. En pouvoir d'achat : ${pct((1 + R.rendementPlacement)/(1 + p.inflation/100) - 1)}.`, ""]
  ].map(([k, val, nn, cl]) => `<div class="tile"><span class="k">${k}${bulle(nn)}</span><span class="v ${cl} num">${val}</span></div>`).join("");

  // Patrimoine des deux ménages.
  drawChart($("plotPat"), $("tipPat"), cfgPatrimoineRP(R, reel));
  $("patNote").textContent = b === null
    ? `Jusqu'à quarante ans, louer et placer reste plus intéressant : la courbe du propriétaire reste sous celle du locataire.`
    : b > p.horizon
      ? `La courbe du propriétaire ne passe devant qu'en année ${b}, après votre départ prévu.`
      : b === 1 ? `Le propriétaire est devant dès la première année.`
      : `Les frais d'achat se rattrapent en ${an(b - 1)} : le propriétaire passe devant en année ${b}.`
        + (R.repli ? ` Le locataire repasse devant en année ${R.repli}.` : "");

  // Le vrai coût de la propriété, en cascade, face au loyer.
  const marches = [
    ["Intérêts et\nassurance", C.interets], ["Taxe\nfoncière", C.tf], ["Copropriété", C.copro],
    ["Entretien", C.entretien], ["Assurance\nhabitation", C.assurHab],
    ["Coût\nd'opportunité", C.opportunite], ["Frais d'achat\net de revente", C.frais],
    ["Hausse de\nla valeur", C.plusValue]
  ];
  let acc = 0;
  const colonnes = marches.map(([label, m]) => {
    const it = {label, from:acc, to:acc + m, color: m >= 0 ? "--down" : "--up", text: kEur(m, 10000)};
    acc += m; return it;
  });
  colonnes.push({label:"Coût réel\nde la propriété", from:0, to:C.proprio, color:"--text", text:kEur(C.proprio, 10000), textColor:"--text", strong:true});
  colonnes.push({label:"Loyer et\nassurance", from:0, to:C.locataire, color:"--d2", text:kEur(C.locataire, 10000), textColor:"--text", strong:true});
  drawColumns($("plotCouts"), $("tipCouts"), {
    height:240, padLeft:70, connect:true, label:"Coût annuel de la propriété comparé au loyer, première année",
    colLabel:"Poste", fmtAxis: kEur, items: colonnes,
    tip: i => {
      const it = colonnes[i];
      return `<div class="th">${it.label.replace("\n", " ")}</div>` +
        tipRow("transparent", "Par an", eur.format(it.to - it.from)) +
        tipRow("transparent", "Par mois", eur.format((it.to - it.from)/12));
    }
  });
  const capital = (r1.principal + r1.principalPTZ)/12;
  $("coutsNote").textContent = `La première année, le logement vous coûte réellement ${eur.format(C.proprio/12)} par mois, contre ${eur.format(C.locataire/12)} en louant.`
    + (capital >= 1 ? ` Le capital remboursé, ${eur.format(capital)} par mois, reste à vous.` : "");

  renderPlacements(p, reel);

  // L'écart, jusqu'à quarante ans.
  const S = R.suite, xs = S.map(r => String(r.y));
  drawChart($("plotEcart"), $("tipEcart"), {
    x: xs, height: 210, padLeft: 78, band:true, zero:true,
    label: "Avance de l'achat sur la location selon l'année de départ",
    fmtAxis: kEur, fmtVal: sEur,
    milestones: [{i: p.horizon - 1, text:"départ prévu"}],
    series: [{color:"--d1", nom:"Avance de l'achat", values: S.map(r => reel ? r.ecartReel : r.ecart)}],
    tip: i => `<div class="th">Départ fin d'année ${S[i].y}</div>` +
      tipRow((reel ? S[i].ecartReel : S[i].ecart) >= 0 ? css("--up") : css("--down"),
        (reel ? S[i].ecartReel : S[i].ecart) >= 0 ? "Avance de l'achat" : "Avance de la location",
        eur.format(Math.abs(reel ? S[i].ecartReel : S[i].ecart)))
  });

  // Tableau annuel, jusqu'à quarante ans, en euros courants.
  const cols = ["Année","Dépense propriétaire","Dépense locataire","Placé propriétaire","Placé locataire","Valeur du logement","Capital dû","Patrimoine propriétaire","Patrimoine locataire","Écart","Écart, euros d'aujourd'hui"];
  $("tbl").tHead.innerHTML = "<tr>" + cols.map(c => `<th>${c}</th>`).join("") + "</tr>";
  $("tbl").tBodies[0].innerHTML = S.map(r =>
    `<tr${r.y === p.horizon ? ' class="peak"' : ""}><td>Année ${r.y}</td>` +
    [r.coutProprio, r.coutLoc, r.versProp, r.versLoc, r.valeur, r.crd + r.crdPTZ, r.liquidation, r.patrimoineLoc]
      .map(x => `<td>${eur.format(x)}</td>`).join("") +
    `<td class="${r.ecart >= 0 ? "pos" : "neg"}">${sEur(r.ecart)}</td><td class="${r.ecartReel >= 0 ? "pos" : "neg"}">${sEur(r.ecartReel)}</td></tr>`).join("");

  // Alertes.
  const warns = [];
  if(E && E.taux > PLAFOND_ENDETTEMENT)
    warns.push(`Avec ce crédit, vos mensualités atteindraient ${pct(E.taux)} de vos revenus : au-delà de 35 %, les banques refusent en général, sauf pour une part de leurs dossiers, d'abord la résidence principale.`);
  if(R.emprunt > 0 && p.duree > (R.neuf ? 27 : 25))
    warns.push(`Un prêt de ${an(p.duree)} dépasse la durée que le Haut Conseil de stabilité financière autorise en principe : 25 ans, 27 dans le neuf quand la livraison diffère le remboursement.`);
  const est = R.estimation;
  if(est && est.montant > R.ptz + 1 && !R.comptant)
    warns.push(`Le barème accorderait ${eur.format(est.montant)} de prêt à taux zéro, mais celui-ci ne peut dépasser le prêt principal : le calcul en retient ${eur.format(R.ptz)}.`);
  if(R.comptant && (p.ptzMode === "manuel" ? p.ptzMontant > 0 : p.ptzMode === "auto" && est && est.montant > 0))
    warns.push("Achat comptant : le prêt à taux zéro complète un autre prêt, il ne s'obtient pas seul.");
  const parts = p.partBourse + p.partFonds + p.partLivret;
  if(Math.abs(parts - 100) > 0.5)
    warns.push(parts > 0 ? `Les parts de placement totalisent ${eur1.format(parts)} % : le calcul les ramène à 100 % en gardant leurs proportions.` : "Aucune part de placement : le calcul place tout en actions.");
  if(R.repli && R.repli > b && R.repli <= HORIZON_MAX_RP)
    warns.push(`L'achat passe devant en année ${b}, puis louer et placer repasse devant en année ${R.repli} : sans crédit, le portefeuille du locataire capitalise sur tout le prix, et finit par rattraper le logement.`);
  if(b !== null && b <= p.horizon && p.horizon - b <= 2)
    warns.push(`L'achat ne passe devant qu'en année ${b}, pour un départ prévu en année ${p.horizon} : une mutation, une séparation ou une famille qui s'agrandit plus tôt que prévu inverserait la réponse.`);
  if(marche && marche.contexte.encadre)
    warns.push(`${esc(marche.nom)} applique l'encadrement des loyers${marche.contexte.encadre === 2 ? " dans une partie de la commune" : ""} : le loyer d'un logement équivalent ne peut dépasser le loyer de référence majoré de son adresse.`);
  $("warnBox").innerHTML = warns.map(w => `<div class="warn">${w}</div>`).join("");

  // Sensibilité et seuils : quelques dizaines de calculs, différés pour ne pas
  // freiner la saisie.
  const host = $("plotSens");
  if(!host.querySelector("svg")) host.insertAdjacentHTML("beforeend", '<p class="pending">Calcul…</p>');
  planifier(() => {
    host.querySelectorAll(".pending").forEach(el => el.remove());
    $("rpSeuils").innerHTML = tuilesSeuils(seuilsRP(p), "location");
    const sens = sensibiliteRP(p, final.ecartReel);
    drawTornado(host, $("tipSens"), cfgSensibiliteRP(sens, final.ecartReel));
    $("sensNote").textContent = phraseSensibiliteRP(sens, p.horizon);
  });
  sauver();
  planifierHash();
}

// Le locataire place autrement : même comparaison, un seul support.
function renderPlacements(p, reel){
  const rows = R.rows, variantes = comparerPlacementsRP(p);
  // Mêmes codes que le graphique du patrimoine : l'achat en trait plein, votre
  // répartition en tirets. Les trois supports pris seuls, en traits fins, ne
  // sont que des repères.
  const couleurs = {bourse:["--d3", "9 3 2 3"], fonds:["--d4", "2 3"], livret:["--text-muted", "1 4"]};
  const achat = r => reel ? r.liquidationReel : r.liquidation;
  const loc = r => reel ? r.patrimoineLocReel : r.patrimoineLoc;
  drawChart($("plotPlac"), $("tipPlac"), {
    x: rows.map(r => String(r.y)), height: 260, padLeft: 78, zero: true,
    label: "Patrimoine du propriétaire comparé au locataire selon son placement",
    fmtAxis: kEur, fmtVal: v => eur.format(v),
    series: [{color:"--d1", nom:"Acheter", values: rows.map(achat), width:2.4},
             {color:"--d2", nom:"Votre répartition", values: rows.map(loc), dash:true, width:2}]
      .concat(variantes.map(x => ({color:couleurs[x.k][0], nom:x.nom, values: reel ? x.rowsReel : x.rows,
        dash:couleurs[x.k][1], width:1.5}))),
    tip: i => {
      const e = achat(rows[i]) - loc(rows[i]);
      return `<div class="th">Départ fin d'année ${rows[i].y}</div>` +
        tipRow(css("--d1"), "Acheter", eur.format(achat(rows[i]))) +
        tipRow(css("--d2"), "Votre répartition", eur.format(loc(rows[i]))) +
        variantes.map(x => tipRow(css(couleurs[x.k][0]), x.nom, eur.format((reel ? x.rowsReel : x.rows)[i]))).join("") +
        `<div class="tr" style="margin-top:7px;padding-top:6px;border-top:1px solid var(--border)">` +
        `<span class="tl">${e >= 0 ? "Avance de l'achat" : "Avance de votre répartition"}</span><span class="tv">${eur.format(Math.abs(e))}</span></div>`;
    }
  });
  // « 4,5 % /an » ne se coupe pas en fin de ligne.
  const taux = r => pct(r).replace(" ", "\u00a0") + "\u00a0/an net";
  const tuile = (nom, bascule, rendement) =>
    `<div class="tile"><span class="k">${nom}</span><span class="v num">${bascule === null ? "Louer" : "Année " + bascule}</span>`
    + `<span class="s">${bascule === null ? "plus intéressant qu'acheter" : "l'achat passe devant"} · ${taux(rendement)}</span></div>`;
  $("rpPlacTuiles").innerHTML = tuile("Votre répartition", R.bascule, R.rendementPlacement)
    + variantes.map(x => tuile(x.nom, x.bascule, x.rendement)).join("");
}

// Le prêt à taux zéro : ce que le barème accorde, ou pourquoi il n'accorde rien.
const RAISONS_PTZ = {
  primo: "Réservé à qui n'a pas été propriétaire de sa résidence principale ces deux dernières années.",
  zone: "Choisissez la commune, ou la zone du logement, pour estimer le prêt à taux zéro.",
  ancienZone: "Dans l'ancien, le prêt à taux zéro n'existe qu'en zones B2 et C.",
  ancienTravaux: "Dans l'ancien, il faut des travaux d'au moins le quart du coût total de l'opération.",
  revenus: "Vos revenus dépassent le plafond de la zone pour ce foyer."
};
function renderPtz(p){
  const E = R.estimation;
  if(p.ptzMode === "non") return;
  if(p.ptzMode === "manuel"){
    $("repPtz").textContent = R.ptz > 0 ? `${eur.format(R.ptz)} sans intérêt, ${R.differe > 0 ? `différé ${an(R.differe)}, ` : ""}remboursés en ${an(R.remboursement)}.` : "Saisissez le montant de votre offre de prêt.";
    return;
  }
  $("repPtz").innerHTML = E.montant > 0
    ? `<b>${eur.format(E.montant)}</b> : tranche ${E.tranche} en zone ${E.zone}, ${E.quotite} % de ${eur.format(E.coutRetenu)} retenus. `
      + `${E.differe > 0 ? `Rien à rembourser pendant ${an(E.differe)}, puis ` : "Remboursement "}sur ${an(E.remboursement)}.`
      + (Number(p.rfr) > 0 ? "" : " Revenu non renseigné : estimation la plus favorable.")
    : RAISONS_PTZ[E.raison] + (E.raison === "revenus" ? ` Plafond : ${eur.format(E.plafond)}.` : "");
}

function setEchelleRP(v){
  echelleRP = v;
  $("echReel").setAttribute("aria-pressed", v === "reel" ? "true" : "false");
  $("echCourant").setAttribute("aria-pressed", v === "courant" ? "true" : "false");
  try{ localStorage.setItem("rentaloc.rp.echelle", v); }catch(e){}
}
$("echReel").addEventListener("click", () => { setEchelleRP("reel"); render(); });
$("echCourant").addEventListener("click", () => { setEchelleRP("courant"); render(); });

/* ---------- taux du marché ---------- */
// Relevés par outils/donnees.py et inscrits ici par build.py, comme dans la
// calculatrice d'investissement.
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
      + `Taux de dépôt de la BCE : ${pct2(T.depot.valeur)} depuis ${quand(T.depot.periode)}.`
      + (T.irl ? ` Loyers : l'IRL a progressé de ${pct2(T.irl.valeur)} sur un an, ${quand(T.irl.periode)}.` : "");
    $("repInflation").hidden = false;
  }
}

/* ---------- données de marché ---------- */
// Les mêmes fichiers que la calculatrice d'investissement, chargés à la demande.
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
// La zone suit la commune dès que son département est chargé ; une zone choisie
// à la main, sans commune, reste telle quelle.
let zoneAppliquee = "";
function zoneDuMarche(){
  if(!communeCode) { zoneAppliquee = ""; return; }
  const dep = departementDe(communeCode), m = DONNEES.pret[dep];
  const fiche = m && m.c && m.c[communeCode];
  const z = fiche ? zonePTZ(fiche.z) || "" : "";
  if(fiche && zoneAppliquee !== communeCode){ $("zone").value = z; zoneAppliquee = communeCode; }
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
  if(communeCode){ communeCode = ""; render(); }
  if(normaliser(saisie).length < 2){ $("communesListe").innerHTML = ""; suggestions = []; return; }
  communesDe(initiale(saisie)).then(liste => {
    if($("commune").value !== saisie) return;
    suggestions = chercherCommunes(liste, saisie, 8);
    $("communesListe").innerHTML = suggestions.map(c => `<option value="${esc(libelleCommune(c[0], c[1]))}"></option>`).join("");
  });
});
$("commune").addEventListener("change", () => {
  if(communeCode) return;
  const exactes = suggestions.filter(c => normaliser(c[1]) === normaliser($("commune").value));
  if(exactes.length === 1) choisirCommune(exactes[0][0], exactes[0][1]);
});

const m2 = v => v.toFixed(1).replace(".", ",") + " €/m²";
const annee = mois => mois.slice(0, 4);
function renderMarche(p){
  const rp = $("repPrix"), rl = $("repLoyer"), resume = $("marcheResume");
  const cacher = () => { rp.hidden = rl.hidden = resume.hidden = true; return null; };
  if(!communeCode) return cacher();
  const dep = departementDe(communeCode);
  if(!(dep in DONNEES.pret)){ cacher(); if(!DONNEES.marche[dep]) marcheDe(dep).then(render); return null; }
  const M = reperesMarche(DONNEES.pret[dep], communeCode, p), S = DONNEES.sources;
  if(!M || !S) return cacher();
  if(!$("commune").value) $("commune").value = libelleCommune(communeCode, M.nom);
  const periode = annee(S.dvf.periode[0]) === annee(S.dvf.periode[1]) ? annee(S.dvf.periode[0]) : `${annee(S.dvf.periode[0])}-${annee(S.dvf.periode[1])}`;
  const ecart = (saisi, marche) => {
    const e = saisi/marche - 1;
    if(Math.abs(e) < 0.03) return `<b>dans la moyenne</b>`;
    return `<b>${Math.round(Math.abs(e)*100)} % ${e > 0 ? "au-dessus" : "en dessous"}</b>`;
  };
  const tuiles = [];
  if(M.prix){
    const X = M.prix, type = M.maison ? "les maisons" : "les appartements";
    const ou = X.echelle === "commune" ? `à ${esc(M.nom)}` : `dans le département — trop peu de ventes à ${esc(M.nom)}`;
    const vente = `${type} se sont vendus ${eur1.format(X.marche)} €/m² ${ou} en ${periode}, sur ${eur1.format(X.ventes)} ventes`;
    rp.innerHTML = X.saisi === null
      ? `${vente.charAt(0).toUpperCase() + vente.slice(1)}. Renseignez la surface pour situer votre prix.`
      : `<b>${eur1.format(Math.round(X.saisi))} €/m²</b> : ${vente}. Vous êtes ${ecart(X.saisi, X.marche)}.`;
    rp.hidden = false;
    tuiles.push(["Prix au m²", X.saisi === null ? "—" : eur1.format(Math.round(X.saisi)) + " €",
      `ventes${X.echelle === "commune" ? "" : " du département"} : ${eur1.format(X.marche)} €${X.saisi === null ? "" : " · " + ecart(X.saisi, X.marche)}`]);
  } else rp.hidden = true;
  if(M.loyer){
    const L = M.loyer, ref = S.loyers.references[L.cle];
    const annonces = `les annonces à ${esc(M.nom)} affichent ${m2(L.marche)} charges comprises pour ${M.maison ? "une maison" : "un appartement"} de ${ref} m², la plupart entre ${m2(L.bas)} et ${m2(L.haut)}`;
    rl.innerHTML = L.saisi === null
      ? `${annonces.charAt(0).toUpperCase() + annonces.slice(1)}. Renseignez la surface pour situer le loyer.`
      : `<b>${m2(L.saisi)}</b> hors charges : ${annonces}. Pour ${eur1.format(M.surface)} m², l'annonce équivalente serait d'environ ${eur.format(Math.round(L.marche*M.surface/10)*10)} par mois, charges comprises.`;
    rl.hidden = false;
    tuiles.push(["Loyer au m², hors charges", L.saisi === null ? "—" : m2(L.saisi).replace(" €/m²", " €"),
      `annonces : ${m2(L.marche).replace(" €/m²", " €")} charges comprises`]);
    // Le ratio du marché : un prix de vente au m² rapporté à un an de loyer
    // d'annonce, charges comprises — un ordre de grandeur, pas une mesure.
    if(M.prix) tuiles.push(["Ratio prix / loyer du marché", (M.prix.marche/(L.marche*12)).toFixed(1).replace(".", ",") + " ans",
      `vous : ${R.ratioPrixLoyer === null ? "—" : R.ratioPrixLoyer.toFixed(1).replace(".", ",") + " ans"} · plus il est haut, plus louer est avantageux`]);
  } else rl.hidden = true;
  const Cx = M.contexte;
  if(Cx.tendance){
    const T = Cx.tendance, retenu = p.indexPrix/100;
    tuiles.push([`Prix de l'ancien, département`, `${sPct(T.taux)} /an`,
      `${T.an0}-${T.an1} · vous retenez <b class="${retenu > T.taux + 0.01 ? "neg" : ""}">${sPct(retenu)} /an</b>`]);
  }
  if(Cx.zone){
    tuiles.push(["Zone du logement", `Zone ${Cx.zone === "Abis" ? "A bis" : Cx.zone}`,
      Cx.zone === "B2" || Cx.zone === "C" ? "prêt à taux zéro dans le neuf, ou dans l'ancien avec travaux" : "prêt à taux zéro dans le neuf seulement"]);
  }
  $("marcheTitre").textContent = `Face au marché : ${M.nom}`;
  $("marcheTuiles").innerHTML = tuiles.map(([k, val, sous]) =>
    `<div class="tile"><span class="k">${k}</span><span class="v num">${val}</span><span class="s">${sous}</span></div>`).join("");
  resume.hidden = false;
  return M;
}

/* ---------- persistance ---------- */
const STORE_RP = "rentaloc.rp.v1";
function sauver(){
  try{
    const o = {v:1, commune:communeCode, communeNom:$("commune").value};
    FIELDS_RP.concat(SELECTS_RP).forEach(k => o[k] = $(k).value);
    BOOLS_RP.forEach(k => o[k] = $(k).checked);
    localStorage.setItem(STORE_RP, JSON.stringify(o));
  }catch(e){}
}
function charge(){
  try{
    const raw = localStorage.getItem(STORE_RP);
    if(!raw) return;
    const o = JSON.parse(raw);
    FIELDS_RP.concat(SELECTS_RP).forEach(k => { if(o[k] !== undefined) $(k).value = o[k]; });
    BOOLS_RP.forEach(k => { if(typeof o[k] === "boolean") $(k).checked = o[k]; });
    if(CODE_COMMUNE.test(o.commune || "")){ communeCode = o.commune; zoneAppliquee = o.commune; $("commune").value = String(o.communeNom || ""); }
  }catch(e){}
}
function toast(msg){
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 2200);
}
function retablirDefautsRP(){
  Object.keys(DEFAULTS_RP).forEach(k => {
    if(typeof DEFAULTS_RP[k] === "boolean") $(k).checked = DEFAULTS_RP[k];
    else $(k).value = DEFAULTS_RP[k];
  });
  communeCode = ""; zoneAppliquee = ""; $("commune").value = "";
}

/* ---------- le lien qui porte les hypothèses ---------- */
// Même grammaire que la calculatrice d'investissement (lienHypotheses, dans le
// moteur) : l'assistant de la page d'accueil produit ces liens sans jamais voir
// ce formulaire.
function valeursRP(){
  const valeurs = {};
  FIELDS_RP.concat(SELECTS_RP).forEach(k => { if(!PRIVES_RP.includes(k)) valeurs[k] = $(k).value; });
  BOOLS_RP.forEach(k => valeurs[k] = $(k).checked);
  valeurs.commune = communeCode;
  return valeurs;
}
function versHashRP(){
  const ecarts = lienHypotheses(valeursRP(), DEFAULTS_RP, null);
  const h = ecarts ? lienHypotheses(valeursRP(), DEFAULTS_RP, null, true) : "";
  const actuel = location.hash.indexOf("=") >= 0 ? location.hash : "";
  if(h !== actuel) history.replaceState(null, "", location.pathname + location.search + h);
}
function depuisHashRP(){
  const h = location.hash.slice(1);
  if(!h || h.indexOf("=") < 0) return false;
  const parts = h.split("&");
  if(parts.includes(LIEN_COMPLET)){
    const foyer = PRIVES_RP.map(k => $(k).value);
    retablirDefautsRP();
    PRIVES_RP.forEach((k, i) => { $(k).value = foyer[i]; });
  }
  parts.forEach(part => {
    const i = part.indexOf("="); if(i < 0) return;
    const k = part.slice(0, i), v = decodeURIComponent(part.slice(i+1));
    if(BOOLS_RP.includes(k)) $(k).checked = v === "1";
    else if(SELECTS_RP.includes(k)){
      if([...$(k).options].some(o => o.value === v)) $(k).value = v;
    } else if(k === "commune"){
      if(v !== "" && !CODE_COMMUNE.test(v)) return;
      communeCode = v; zoneAppliquee = v; $("commune").value = "";
    } else if(FIELDS_RP.includes(k) && !PRIVES_RP.includes(k)){
      if(isFinite(parseFloat(v))) $(k).value = v;
    }
  });
  return true;
}
let hashTimer;
function planifierHash(){ clearTimeout(hashTimer); hashTimer = setTimeout(versHashRP, 250); }
addEventListener("hashchange", () => { if(depuisHashRP()) render(); });
$("share").addEventListener("click", async () => {
  versHashRP();
  const lien = location.origin + location.pathname + lienHypotheses(valeursRP(), null, null, true);
  try{ await navigator.clipboard.writeText(lien); toast("Lien copié — il contient toutes vos hypothèses"); }
  catch(e){ toast("Copie impossible dans ce contexte : copiez l'adresse de la page"); }
});

function csvTexteRP(){
  const head = ["Annee","Depense proprietaire","Depense locataire","Place proprietaire","Place locataire","Valeur","Capital du","Patrimoine proprietaire","Patrimoine locataire","Ecart","Ecart euros d'aujourd'hui"];
  return [head.join(";")].concat(R.suite.map(r => [
    r.y, r.coutProprio, r.coutLoc, r.versProp, r.versLoc, r.valeur, r.crd + r.crdPTZ, r.liquidation, r.patrimoineLoc, r.ecart, r.ecartReel
  ].map(x => typeof x === "number" ? x.toFixed(2).replace(".", ",") : x).join(";"))).join("\n");
}
$("copy").addEventListener("click", async () => {
  if(!R) return;
  try{ await navigator.clipboard.writeText(csvTexteRP()); toast("Tableau copié — collez-le dans un tableur"); }
  catch(e){ toast("Copie impossible dans ce contexte"); }
});
$("csv").addEventListener("click", () => {
  if(!R) return;
  const blob = new Blob(["﻿" + csvTexteRP()], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "acheter-ou-louer.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("CSV téléchargé — ouvrez-le dans un tableur");
});

/* ---------- saisie ---------- */
let frappe = null;
function rendreBientot(){
  clearTimeout(frappe);
  frappe = setTimeout(() => { frappe = null; render(); }, 60);
}
FIELDS_RP.forEach(k => {
  $(k).addEventListener("input", rendreBientot);
  $(k).addEventListener("change", render);
});
SELECTS_RP.forEach(k => $(k).addEventListener("change", render));
BOOLS_RP.forEach(k => $(k).addEventListener("change", render));
// Passer de l'ancien au neuf recale les frais de notaire, s'ils n'ont pas été
// retouchés à la main.
let etatPrecedent = $("etat").value;
$("etat").addEventListener("change", () => {
  const e = $("etat").value;
  if($("notairePct").value === NOTAIRE_RP[etatPrecedent]) $("notairePct").value = NOTAIRE_RP[e];
  etatPrecedent = e;
  render();
});
$("reset").addEventListener("click", () => { retablirDefautsRP(); etatPrecedent = $("etat").value; render(); toast("Hypothèses réinitialisées"); });

/* ---------- niveau de détail, panneau, navigation ---------- */
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

// Le thème : site.js tient l'interrupteur et prévient ; les graphiques se repeignent.
document.addEventListener("theme", render);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
let rid;
addEventListener("resize", () => { clearTimeout(rid); rid = setTimeout(render, 140); });

const liensSections = [...document.querySelectorAll(".subnav a")];
const sections = liensSections.map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
liensSections.forEach(a => a.addEventListener("click", ev => {
  const cible = document.querySelector(a.getAttribute("href"));
  if(!cible) return;
  ev.preventDefault();
  if(cible.tagName === "DETAILS") cible.open = true;
  cible.scrollIntoView({behavior:"smooth", block:"start"});
}));
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
// Le panneau d'hypothèses, comme dans la calculatrice d'investissement : colonne
// repliable sur grand écran, tiroir fermé à l'ouverture sur petit écran.
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
  setTimeout(render, 240);
}
$("railToggle").addEventListener("click", () => basculerPanneau($("railToggle").getAttribute("aria-expanded") !== "true"));
$("railFermer").addEventListener("click", () => basculerPanneau(false));
$("voile").addEventListener("click", () => basculerPanneau(false));
addEventListener("keydown", ev => {
  if(ev.key === "Escape" && mqEtroit.matches && tiroirOuvert) basculerPanneau(false);
});
mqEtroit.addEventListener("change", () => { tiroirOuvert = false; syncPanneau(); });
syncPanneau();

charge();
depuisHashRP();
etatPrecedent = $("etat").value;
setRail(railMode);
setEchelleRP(echelleRP);
brancherInfobulles();
render();
