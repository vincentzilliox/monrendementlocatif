/* ═════════════════════════════════════════════════════════════════
   vitrine — pilote de la page d'accueil.
   Rejoue le scénario par défaut avec le moteur et les graphiques de
   la calculatrice : les deux pages ne peuvent pas diverger.
   Les valeurs par défaut sont relues dans index.html par build.py,
   qui remplace la ligne DEFAUTS ci-dessous.
   ═════════════════════════════════════════════════════════════════ */

const DEFAUTS = {/* build.py : valeurs par défaut */};

function scenario(){
  const p = Object.assign({}, DEFAUTS);
  p.items = TVX_DEFAUT.map(o => ({...o}));
  p.travaux = p.items.reduce((s, it) => s + it.montant, 0);
  // La case « prix, loyers et charges suivent l'inflation » est cochée par défaut.
  p.indexPrix = p.indexLoyer = p.indexCharges = p.inflation;
  return p;
}

function vitrine(){
  oublierTheme();
  const p = scenario(), R = compute(p), f = R.final, b = R.best;
  const g = id => document.getElementById(id);
  const ecrire = (id, txt) => { const el = g(id); if(el) el.textContent = txt; };

  ecrire("vTri", sPct(f.tri));
  ecrire("vReel", sPct(f.triReel));
  ecrire("vGain", sEur(f.gain));
  ecrire("vMise", eur.format(f.mise));
  ecrire("vBest", "Année " + b.y);
  ecrire("vBestTri", sPct(b.tri));
  ecrire("vBestNet", eur.format(b.netVente));
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

  const sens = sensibilite(p, f.tri);
  drawTornado(g("vPlotSens"), g("vTipSens"), cfgSensibilite(sens, f.tri));
  if(sens.length) ecrire("vSens", sens[0].nom.toLowerCase());
}

let vid;
addEventListener("resize", () => { clearTimeout(vid); vid = setTimeout(vitrine, 140); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => setTimeout(vitrine, 30));
document.addEventListener("theme", vitrine);
vitrine();
