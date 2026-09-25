/* ═════════════════════════════════════════════════════════════════
   vitrine — pilote de la page d'accueil.
   Rejoue le scénario par défaut avec le moteur et les graphiques de
   la calculatrice : les deux pages ne peuvent pas diverger.
   Les valeurs par défaut sont relues dans index.html par build.py,
   qui remplace la ligne DEFAUTS ci-dessous.
   ═════════════════════════════════════════════════════════════════ */

const DEFAUTS = {/* build.py : valeurs par défaut */};
// Les choix offerts par les listes déroulantes du formulaire : l'assistant pose
// les mêmes tranches d'imposition et les mêmes régimes que la calculatrice.
const OPTIONS = {/* build.py : listes de choix */};
// Les valeurs d'ouverture de la calculatrice « acheter ou louer », relues de
// même dans acheter-ou-louer.html.
const DEFAUTS_RP = {/* build.py : valeurs par défaut RP */};

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
