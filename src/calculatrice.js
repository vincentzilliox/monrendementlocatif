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
const TAUX_MARCHE = {/* build.py : taux du marché */};
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
  if(C.taxeFonciere && S.taxeFonciere){
    const F = C.taxeFonciere, P = S.taxeFonciere.periode, retenu = p.indexCharges/100;
    const tx = v => v.toFixed(1).replace(".", ",") + " %";
    // Des charges indexées bien sous la hausse récente de la taxe foncière
    // sous-estiment ce qu'elle coûtera.
    tuiles.push(["Taxe foncière de la commune", `${sPct(F.evolution)} /an`,
      `${P[0]}-${P[1]} · taux ${tx(F.taux0)} → ${tx(F.taux1)} · vous indexez les charges de <b class="${retenu < F.evolution - 0.01 ? "neg" : ""}">${sPct(retenu)} /an</b>`]);
  }
  if(C.passoires){
    const P = C.passoires;
    tuiles.push(["Passoires thermiques", `${Math.round(P.part*100)} %`,
      `des ${eur1.format(P.dpe)} DPE ${P.echelle === "commune" ? "de la commune" : "du département"} depuis 2021 classés F ou G`]);
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
