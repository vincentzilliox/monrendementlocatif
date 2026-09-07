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
  "fraisDossier","loyer","vacance","copro","tf","pno","gestion","entretien",
  "ps","psPV","cfe","abattement","plafondDeficit","partBati","amortBatiAns","amortTvxAns","amortMobAns","horizon",
  "inflation","indexPrix","indexLoyer","indexCharges","fraisVente","bourse","fondsEuros","livretA","fiscBourse","fiscFonds"];
const SELECTS = ["regime","tmi"];
const DEFAULTS = {};
FIELDS.concat(SELECTS).forEach(k => DEFAULTS[k] = $(k).value);
DEFAULTS.ira = true;
DEFAULTS.prixSuitInflation = true;

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
  p.regime = $("regime").value;
  p.tmi = parseFloat($("tmi").value);
  p.ira = $("ira").checked;
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

function render(){
  oublierTheme();
  // Tant que la case est cochée, prix, loyers et charges recopient l'inflation
  // et disparaissent du panneau : trois champs de moins à régler.
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
  const {rows, best, final} = R;
  // Point mort : première année où revendre cesse de laisser une perte.
  const mort = rows.findIndex(r => r.gainImmo >= 0);

  const triF = final.tri;
  const heroEl = $("heroTri");
  heroEl.textContent = triF===null ? "—" : sPct(triF);
  heroEl.classList.toggle("bad", triF!==null && triF<0);
  $("heroAns").textContent = p.horizon + " ans";

  // Le pouvoir d'achat tenait en trois phrases ; il tient en un nombre étiqueté.
  const triReel = final.triReel;
  const reelEl = $("heroReel");
  reelEl.textContent = triF===null ? "—" : sPct(triReel);
  reelEl.classList.toggle("bad", triF!==null && triReel<0);
  $("heroReelTxt").textContent = triF===null
    ? "renseignez un apport ou des frais payés comptant"
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
      + ` la bourse, qui rend ${pct(bNet)} par an nette d'impôt`;
  }
  // Le chiffre du verdict suit le lecteur dans la sous-navigation collante.
  $("navTri").innerHTML = triF===null ? ""
    : `<b>${sPct(triF)}</b> par an${ecart===null ? "" : " · " + pts(ecart) + " vs bourse"}`;
  const mot = triF === null ? null : avis(triReel, final.triBourseReel === null ? bourseReelle : final.triBourseReel);
  $("avisBox").hidden = mot === null;
  if(mot) $("avisText").textContent = mot;

  if(best){
    $("bestEyebrow").textContent = `Meilleur moment pour revendre, sur ${p.horizon} ans`;
    $("bestYear").textContent = "Année " + best.y;
    $("bestText").textContent = best.y === p.horizon
      ? "Le rendement progresse encore en fin de période : allongez l'horizon pour voir s'il plafonne."
      : "Au-delà, les abattements de plus-value ne compensent plus la fin de l'effet de levier.";
    $("bestList").innerHTML =
      `<dt>Rendement annualisé</dt><dd>${sPct(best.tri)}</dd>` +
      `<dt>Net récupéré à la vente</dt><dd>${eur.format(best.netVente)}</dd>` +
      `<dt>Gain net total</dt><dd>${sEur(best.gain)}</dd>`;
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
    ["les frais d'agence", p.fraisAcq], ["le mobilier", R.mobilier], ["les frais de dossier", p.fraisDossier]]
    .filter(x => x[1] > 0).map(x => x[0]);
  $("dCap").textContent = R.emprunt > 0
    ? "Coût total = " + postes.join(", ") + "."
    : "Votre apport couvre la totalité : achat comptant, aucun emprunt.";

  const cf = R.cfMensuel1;
  const r1 = rows[0];
  const couverture = r1.annuite > 0 ? r1.loyers/r1.annuite : null;
  const impotsLoyers = rows.reduce((s,x) => s + x.impot, 0);
  const impotsTotal = impotsLoyers + final.impotPV + final.repriseDF;

  // Le point mort a rejoint le verdict ; sa place revient à l'effort d'épargne,
  // qui répond à la question qu'on se pose vraiment : combien ça me coûte, et
  // pendant combien de temps. Chaque phrase d'explication part en infobulle.
  const effort = -R.cumulEffort;
  $("indicateurs").innerHTML = [
    ["Rentabilité brute", pct(R.brute),
      `Loyers annuels divisés par le prix d'achat, comme dans les annonces. Rapportée au coût total — frais de notaire, agence et travaux compris — elle vaut ${pct(R.bruteCout)}.`, ""],
    ["Rentabilité nette-nette", pct(R.netteNette),
      `Après charges et impôt, sur la première année, rapportée au coût total de l'opération. ` + (
      r1.impot < -0.5
        ? `La déduction des travaux crée une économie d'impôt, d'où un chiffre supérieur aux ${pct(R.nette)} d'avant impôt.`
        : Math.abs(R.nette - R.netteNette) < 0.0005
          ? `La fiscalité ne coûte rien cette année-là.`
          : `Avant impôt : ${pct(R.nette)}.`), ""],
    ["Cash-flow mensuel", (cf>=0?"+":"−")+eur.format(Math.abs(cf)),
      `Loyers encaissés moins charges, mensualité et impôt, la première année. ` +
      (cf>=0 ? `Le bien s'autofinance dès le départ.` : `C'est ce qu'il vous réclame chaque mois.`),
      cf>=0?"pos":"neg"],
    ["Le loyer couvre", couverture===null ? "—" : pct(couverture),
      couverture===null ? `Aucun crédit : il n'y a pas de mensualité à couvrir.`
        : `de la mensualité de crédit, la première année. Les charges et la fiscalité viennent en plus.`, ""],
    ["Effort d'épargne cumulé", eur.format(effort),
      effort < 1
        ? `Sur ${p.horizon} ans, le bien ne vous réclame jamais rien : les loyers couvrent tout, chaque année.`
        : `Ce que le bien vous réclame en plus de l'apport sur ${p.horizon} ans, les années où les loyers ne couvrent pas tout — soit ${eur.format(effort/(p.horizon*12))} par mois en moyenne.`, ""],
    ["Impôts sur "+p.horizon+" ans",
      impotsTotal>=0 ? eur.format(impotsTotal) : "+"+eur.format(-impotsTotal),
      impotsTotal < 0
        ? `Les économies d'impôt dépassent ce que vous versez : le projet allège votre imposition.`
        : Math.abs(impotsLoyers) < 1
          ? `Entièrement dû à la revente : l'impôt sur les loyers est nul sur toute la période.`
          : impotsLoyers < 0
            ? `La revente coûte ${eur.format(final.impotPV)} ; les loyers vous font économiser ${eur.format(-impotsLoyers)}.`
            : `${eur.format(impotsLoyers)} sur les loyers, ${eur.format(final.impotPV)} sur la plus-value.`,
      impotsTotal>=0 ? "" : "pos"]
  ].map(([k,v,nn,cl]) => `<div class="tile"><span class="k">${k}${bulle(nn)}</span><span class="v ${cl} num">${v}</span></div>`).join("");

  $("dMens").textContent = eur.format(R.mensualite);
  $("dCout2").textContent = eur.format(R.coutCredit);
  $("dCap2").textContent = R.emprunt > 0
    ? `Intérêts et assurance versés sur les ${p.duree} ans du prêt, soit ${pct(R.coutCredit/R.emprunt)} du capital emprunté.`
    : "Aucun crédit.";

  const xs = rows.map(r=>String(r.y));

  const jalons = jalonsFiscaux(p, rows);

  // Les toutes premières années sont massivement négatives (frais d'acquisition non
  // amortis). En « zone lisible » on plafonne le bas du graphe sans jamais masquer
  // une année à partir de la 5e ; en « échelle complète » on montre tout.
  const late = rows.slice(4).map(r=>r.tri).filter(v => v!==null);
  const floor = echelleTri === "complete"
    ? undefined
    : (late.length ? Math.min(-0.30, Math.min.apply(null, late)) : -0.30);
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
      {color:"--d2", nom:"Bourse, nette d'impôt", values: rows.map(r=>r.triBourse), dash:true}
    ],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Revente année ${r.y}</div>` +
        tipRow(css("--d1"),"Rendement du projet", r.tri===null?"—":sPct(r.tri)) +
        tipRow("transparent","dont pouvoir d'achat", r.triReel===null?"—":sPct(r.triReel)) +
        tipRow(css("--d2"),"Bourse, nette d'impôt", r.triBourse===null?"—":pct(r.triBourse)) +
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

  drawChart($("plotNet"), $("tipNet"), cfgGainNet(p, R));

  drawChart($("plotCf"), $("tipCf"), {
    x: xs, height: 200, padLeft: 78, band:true, zero:true, label:"Trésorerie annuelle après impôt",
    fmtAxis: (v,ref) => ref>=10000 ? eur1.format(v/1000)+" k€" : eur1.format(v)+" €",
    fmtVal: sEur,
    series: [{color:"--d1", nom:"Trésorerie nette", values: rows.map(r=>r.cfNet)}],
    tip: i => {
      const r = rows[i];
      return `<div class="th">Année ${r.y}</div>` +
        tipRow(r.cfNet>=0?css("--up"):css("--down"),"Trésorerie nette", sEur(r.cfNet)) +
        tipRow("transparent","Loyers encaissés", eur.format(r.loyers)) +
        tipRow("transparent","Charges", cost(r.charges)) +
        tipRow("transparent","Mensualités", cost(r.annuite)) +
        tipRow("transparent","Impôt", cost(r.impot));
    }
  });

  const cols = ["Année","Loyers","Charges","Intérêts","Mensualités","Impôt","Trésorerie","Trésorerie cumulée","Valeur du bien","Capital dû","Impôt plus-value","Net si revente","Rendement annualisé"];
  $("tbl").tHead.innerHTML = "<tr>"+cols.map(c=>`<th>${c}</th>`).join("")+"</tr>";
  $("tbl").tBodies[0].innerHTML = rows.map(r => {
    const cls = best && r.y===best.y ? ' class="peak"' : "";
    return `<tr${cls}><td>Année ${r.y}</td>`+[
      eur.format(r.loyers), cost(r.charges), cost(r.interets), cost(r.annuite), cost(r.impot)
    ].map(v=>`<td>${v}</td>`).join("")
    + `<td class="${r.cfNet>=0?"pos":"neg"}">${sEur(r.cfNet)}</td>`
    + `<td class="${r.cumulCF>=0?"pos":"neg"}">${sEur(r.cumulCF)}</td>`
    + `<td>${eur.format(r.valeur)}</td><td>${eur.format(r.crd)}</td><td>${cost(r.impotPV)}</td><td>${eur.format(r.netVente)}</td>`
    + `<td class="${r.tri!==null&&r.tri>=0?"pos":"neg"}">${r.tri===null?"—":sPct(r.tri)}</td></tr>`;
  }).join("");

  const warns = [];
  if(p.regime==="micro-foncier" && rows[0].loyers>15000)
    warns.push("Vos loyers dépassent 15 000 € par an : le micro-foncier n'est pas accessible, le régime réel s'applique d'office.");
  if(p.regime==="lmnp-micro" && rows[0].loyers>77700)
    warns.push("Vos recettes dépassent 77 700 € par an : le micro-BIC n'est pas accessible, le LMNP au réel s'applique d'office.");
  if(R.cash0 < 1)
    warns.push("Sans apport ni frais payés comptant, le rendement sur fonds propres n'a pas de sens mathématique. Ajoutez au moins les frais de dossier.");
  if(p.duree > 0 && R.emprunt > 0 && p.horizon < p.duree)
    warns.push(`Votre horizon (${p.horizon} ans) est plus court que le prêt (${p.duree} ans) : chaque revente simulée solde le capital restant dû.`);
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
        tipRow("transparent","Impôts cumulés", r.impots >= 0 ? cost(r.impots) : "+"+eur.format(-r.impots)) +
        (r.rg===p.regime ? "" : `<div class="tr" style="margin-top:6px;color:var(--text-muted)">Cliquer pour adopter ce régime</div>`);
    },
    onClick: i => { if(regs[i].rg !== p.regime){ appliquerRegime(regs[i].rg); render(); toast("Régime : " + regs[i].label.replace("\n"," ")); } }
  });
  const enCours = regs.find(r => r.rg === p.regime);
  // L'hypothèse de mobilier explique une partie de l'écart : elle est dite dans
  // l'infobulle du panneau, pas dans une phrase de plus sous le graphique.
  $("regNote").textContent = !meilleur || meilleur.tri === null ? ""
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
  const fraisAcquisition = R.notaire + p.fraisAcq + p.fraisDossier;
  const equipement = p.travaux + R.mobilier;
  const marches = [
    {label:"Loyers\nencaissés",        v: f.cumulLoyers},
    {label:"Charges",                  v: -f.cumulCharges},
    {label:"Intérêts et\nassurance",   v: -f.cumulCredit},
    {label:"Impôt sur\nles loyers",    v: -f.cumulImpot},
    {label:"Frais\nd'acquisition",     v: -fraisAcquisition,
     detail: [["Frais de notaire", R.notaire], ["Frais d'agence", p.fraisAcq],
              ["Dossier et garantie", p.fraisDossier]]},
    {label: R.mobilier > 0 ? "Travaux et\nmobilier" : "Travaux", v: -equipement,
     detail: [["Travaux", p.travaux], ["Mobilier", R.mobilier]]},
    {label:"Revalorisation\ndu bien",  v: f.valeur - p.prix},
    {label:"Frais de\nrevente",        v: -(f.fraisVente + f.ira)},
    {label:"Impôt sur la\nplus-value", v: -(f.impotPV + f.repriseDF)}
  ];
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
  const revalorisation = f.valeur - p.prix;
  const sorties = f.cumulCharges + f.cumulCredit + f.cumulImpot + fraisAcquisition
    + equipement + f.fraisVente + f.ira + f.impotPV + f.repriseDF;
  $("cascNote").textContent =
    `Fin d'année ${anCasc} : ${eur.format(f.cumulLoyers)} de loyers et ${revalorisation >= 0 ? eur.format(revalorisation) + " de revalorisation" : eur.format(-revalorisation) + " de dévalorisation"}, contre ${eur.format(sorties)} de charges, frais, intérêts et impôts.`;

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
    if(f.tri === null){ host.querySelectorAll("svg").forEach(el => el.remove()); $("sensNote").textContent = ""; return; }
    const sens = sensibilite(p, f.tri);
    drawTornado(host, $("tipSens"), cfgSensibilite(sens, f.tri));
    $("sensNote").textContent = sens.length
      ? `Le paramètre le plus sensible est ${sens[0].nom.toLowerCase()} : ${sens[0].txt} d'écart déplace le rendement de ${pts(sens[0].lo)} à ${pts(sens[0].hi)} par an.`
      : "";
  });
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
    const o = {v:2, ira:$("ira").checked, prixSuitInflation:$("prixSuitInflation").checked, items};
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
    if(o.items !== undefined) items = assainir(o.items);
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
  "lmnp-reel":     ["fCfe", "fMobilier", "fPartBati", "fAmortBati", "fAmortTvx", "fAmortMob"]
};
const TOUS_CHAMPS_REGIME = [...new Set(Object.values(CHAMPS_REGIME).flat())];
function syncRegime(){
  const rg = $("regime").value;
  const visibles = CHAMPS_REGIME[rg] || [];
  TOUS_CHAMPS_REGIME.forEach(id => { $(id).hidden = !visibles.includes(id); });
  // La part déductible d'un poste de travaux ne vaut qu'au réel foncier. Les
  // lignes étant reconstruites à chaque frappe, c'est le conteneur qui porte
  // l'état, jamais les champs eux-mêmes.
  $("tvxList").classList.toggle("sans-deduc", rg !== "reel-foncier");
}
// Chaque frappe redessinait les sept graphiques. On laisse retomber la frappe
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
// Sombre par défaut : seule une préférence système explicitement claire, ou
// un choix manuel, fait basculer en clair.
function estSombre(){
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
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
try{
  const t = localStorage.getItem("rentaloc.theme");
  if(t) document.documentElement.setAttribute("data-theme", t);
}catch(e){}

let rid;
addEventListener("resize", () => { clearTimeout(rid); rid = setTimeout(render, 140); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { syncTheme(); render(); });

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
}

// L'état complet tient dans l'URL : un lien suffit à partager une simulation, et
// un guide peut ouvrir le calculateur pré-réglé (/#regime=reel-foncier).
const BOOLS = ["ira","prixSuitInflation"];
// Le format du lien vit dans le moteur : l'assistant de la page d'accueil en
// produit un sans jamais voir ce formulaire. Ici on ne fait que lire les champs.
function versHash(){
  const valeurs = {};
  FIELDS.concat(SELECTS).forEach(k => valeurs[k] = $(k).value);
  BOOLS.forEach(k => valeurs[k] = $(k).checked);
  const h = lienHypotheses(valeurs, DEFAULTS, items);
  const actuel = location.hash.indexOf("=") >= 0 ? location.hash : "";
  if(h !== actuel) history.replaceState(null, "", location.pathname + location.search + h);
}
function depuisHash(){
  const h = location.hash.slice(1);
  if(!h || h.indexOf("=") < 0) return false;
  const vus = new Set();
  let regime = null;
  h.split("&").forEach(part => {
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
    } else if(FIELDS.includes(k)){
      if(!isFinite(parseFloat(v))) return;
      $(k).value = v; vus.add(k);
    }
  });
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

$("share").addEventListener("click", async () => {
  versHash();
  try{ await navigator.clipboard.writeText(location.href); toast("Lien copié — il contient toutes vos hypothèses"); }
  catch(e){ toast("Copie impossible dans ce contexte : copiez l'adresse de la page"); }
});

function csvTexte(){
  const head = ["Annee","Loyers","Charges","Interets","Mensualites","Impot","Tresorerie","Tresorerie cumulee","Valeur","Capital du","Impot plus-value","Net si revente","Rendement annualise"];
  return [head.join(";")].concat(R.rows.map(r => [
    r.y, r.loyers, r.charges, r.interets, r.annuite, r.impot, r.cfNet, r.cumulCF,
    r.valeur, r.crd, r.impotPV, r.netVente, r.tri===null?"":(r.tri*100)
  ].map(v => typeof v==="number" ? v.toFixed(2).replace(".",",") : v).join(";"))).join("\n");
}
$("csv").addEventListener("click", () => {
  if(!R) return;
  const blob = new Blob(["﻿" + csvTexte()], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "rendement-locatif.csv";
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
// Sur petit écran le panneau d'hypothèses se replie sous le verdict ; sur grand
// écran il est toujours déployé.
const mqEtroit = matchMedia("(max-width:1040px)");
$("railbox").open = !mqEtroit.matches;
mqEtroit.addEventListener("change", () => { if(!mqEtroit.matches) $("railbox").open = true; });
document.querySelectorAll("a.mail").forEach(a => { a.href = "mailto:" + a.dataset.u + "@" + a.dataset.d; });

load();
depuisHash();
renderItems();
syncTheme();
setRail(railMode);
brancherInfobulles();
$("echLisible").setAttribute("aria-pressed", echelleTri === "lisible" ? "true" : "false");
$("echComplete").setAttribute("aria-pressed", echelleTri === "complete" ? "true" : "false");
render();
