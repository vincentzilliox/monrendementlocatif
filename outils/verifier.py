#!/usr/bin/env python3
"""Vérifie le site avant mise en ligne.

Reconstruit site/, le sert en local, puis contrôle ce qui casse en silence :
erreurs JavaScript, valeurs NaN, débordement horizontal sur grand et petit
écran, ressources manquantes, liens internes cassés, appels vers un domaine
tiers, balisage invalide, métadonnées hors normes sur chaque page, sitemap
incomplet, entorses à la charte graphique. Contrôle aussi le moteur financier,
dont une erreur ne se voit pas à l'écran.

    python3 outils/verifier.py

Sortie : une ligne par contrôle, et un code de sortie non nul si l'un échoue.
"""

import html
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import date

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _local
from _local import CHROME, JSC, RACINE, SITE, premier_existant, servir_en_fond

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
import build   # pour relire les valeurs par défaut exactement comme lui
import donnees # pour ranger les communes exactement comme lui

SRC = RACINE / "src"
SOURCE = RACINE / "index.html"
DOMAINE = "https://monrendementlocatif.fr"

resultats = []


def sans_commentaires(js):
    """Le code seul. Un contrôle qui lirait les commentaires se ferait piéger
    par la phrase même qui décrit la règle."""
    js = re.sub(r"/\*.*?\*/", " ", js, flags=re.S)
    return re.sub(r"(^|[^:])//[^\n]*", r"\1", js)


def _luminance(rgb):
    def c(v):
        v /= 255
        return v/12.92 if v <= 0.04045 else ((v + 0.055)/1.055) ** 2.4
    return 0.2126*c(rgb[0]) + 0.7152*c(rgb[1]) + 0.0722*c(rgb[2])


def _rgb(valeur):
    """#rrggbb, #rgb ou rgba(r,g,b,a) -> (r, g, b, alpha)."""
    valeur = valeur.strip()
    m = re.fullmatch(r"rgba?\(([^)]*)\)", valeur)
    if m:
        parts = [x.strip() for x in m.group(1).split(",")]
        return (*[float(x) for x in parts[:3]], float(parts[3]) if len(parts) > 3 else 1.0)
    h = valeur.lstrip("#")
    if len(h) == 3:
        h = "".join(c*2 for c in h)
    return (*[int(h[i:i+2], 16) for i in (0, 2, 4)], 1.0)


def contraste(encre, fond, sur=None):
    """Rapport WCAG. `fond` peut être translucide : il est alors fondu sur `sur`."""
    e, f = _rgb(encre), _rgb(fond)
    if f[3] < 1 and sur is not None:
        b = _rgb(sur)
        f = tuple(f[i]*f[3] + b[i]*(1 - f[3]) for i in range(3)) + (1.0,)
    a, b = _luminance(e[:3]), _luminance(f[:3])
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def encre_de(css, selecteur):
    """Le token que cette règle pose en `color:`. None si elle n'en pose pas.

    Lire la règle plutôt que de nommer le token attendu : sinon un composant
    peut repasser à une couleur illisible sans qu'aucun contrôle ne bronche.
    """
    m = re.search(re.escape(selecteur) + r"\s*\{([^}]*)\}", css)
    if not m:
        return None
    c = re.search(r"(?<![-\w])color\s*:\s*var\((--[a-z0-9-]+)\)", m.group(1))
    return c.group(1) if c else None


def tokens_du_theme(css, selecteur):
    """Les variables déclarées par un bloc, repérées sur son sélecteur."""
    m = re.search(re.escape(selecteur) + r"\s*\{(.*?)\}", css, re.S)
    if not m:
        return {}
    return dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", m.group(1)))


def resoudre(tokens):
    """Aplatit les `var(--x)` : un token peut en aliaser un autre du même thème."""
    plat = {}
    for cle in tokens:
        valeur, vus = tokens[cle], set()
        while (m := re.fullmatch(r"var\((--[a-z0-9-]+)\)", valeur.strip())):
            if m.group(1) in vus or m.group(1) not in tokens:
                break
            vus.add(m.group(1))
            valeur = tokens[m.group(1)]
        plat[cle] = valeur.strip()
    return plat


def controle(nom, ok, detail=""):
    resultats.append(ok)
    print("  %s  %-46s %s" % ("OK  " if ok else "ECHEC", nom, detail))


def pages_html():
    """Toutes les pages générées, avec leur chemin public."""
    for f in sorted(SITE.rglob("*.html")):
        if f.name.startswith("__"):
            continue
        rel = f.relative_to(SITE)
        if f.name == "index.html":
            chemin = "/" if rel.parent == pathlib.Path(".") else "/" + rel.parent.as_posix() + "/"
        else:
            chemin = "/" + rel.as_posix()
        yield chemin, f


def fichier_pour(chemin):
    """Le fichier que Cloudflare servirait pour ce chemin, ou None."""
    chemin = chemin.split("#")[0].split("?")[0]
    if chemin == "/":
        return SITE / "index.html"
    candidat = SITE / chemin.strip("/")
    if chemin.endswith("/"):
        candidat = candidat / "index.html"
    return candidat if candidat.is_file() else None


SONDE = """
<div id="sonde"></div>
<script>
window.__err=[]; window.addEventListener("error",function(e){window.__err.push(e.message);});
setTimeout(function(){
  var d=document.documentElement, r={}, largeur=%d;
  r.erreurs   = window.__err;
  r.suspects  = (document.body.innerText.match(/NaN|undefined|Infinity/g)||[]);
  // Sous 500 px la fenetre reste plus large que la page : on mesure les elements,
  // en ignorant ceux qu'un ancetre a defilement horizontal contient volontairement.
  var defile = function(e){ for(var a=e.parentElement; a && a!==document.body; a=a.parentElement){ var o=getComputedStyle(a).overflowX; if(o==="auto"||o==="scroll") return true; } return false; };
  // Les equivalents textuels des graphiques sont hors ecran par construction :
  // leur boite deborde, mais rien ne s'affiche. Les compter serait un faux positif.
  var cache = function(e){ return !!(e.closest && e.closest(".visually-hidden")); };
  r.deborde   = largeur < 500
    ? Array.prototype.some.call(document.body.querySelectorAll("*"), function(e){ var b=e.getBoundingClientRect(); return b.width > 0 && b.right > largeur + 1 && !defile(e) && !cache(e); })
    : d.scrollWidth > d.clientWidth + 1;
  r.tuiles    = document.querySelectorAll("#indicateurs .tile").length;
  // Un SVG n'annonce que son titre : chaque graphique doit doubler ses valeurs
  // d'un tableau hors ecran, et rester atteignable au clavier.
  r.equiv     = document.querySelectorAll(".plot .visually-hidden table").length;
  r.focalisables = document.querySelectorAll(".plot svg[tabindex]").length;
  var g = document.querySelector("#plotTri svg"), tp = document.getElementById("tipTri");
  if(g && tp){
    g.dispatchEvent(new FocusEvent("focus"));
    var ouvert = tp.classList.contains("on"), a = tp.textContent;
    g.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowLeft"}));
    var b = tp.textContent;
    g.dispatchEvent(new FocusEvent("blur"));
    r.clavier = (ouvert ? "1" : "0") + (a && b && a !== b ? "1" : "0") + (tp.classList.contains("on") ? "0" : "1");
  }
  // Les couleurs sont mises en cache le temps d'un rendu : si la bascule de
  // theme ne le vidait pas, les graphiques resteraient peints comme avant.
  var trace = function(){ var e = document.querySelector("#plotTri path[stroke]"); return e ? e.getAttribute("stroke") : ""; };
  var bouton = document.getElementById("theme");
  if(bouton && trace()){
    var avant = trace();
    bouton.click();
    var apres = trace();
    bouton.click();
    r.theme = avant + " -> " + apres + (avant !== apres && trace() === avant ? " |ok" : " |ko");
  }
  // Un graphique ne doit jamais devenir une boite defilante : la molette y
  // resterait piegee au lieu de faire descendre la page. Le tableau equivalent,
  // pose nu, avait donne 423 px de defilement invisible a la cascade.
  r.piege = Array.prototype.filter.call(
    document.querySelectorAll(".plot, .plotwrap"),
    function(e){ return e.scrollHeight - e.clientHeight > 1; }
  ).map(function(e){ return (e.id || e.className) + " +" + (e.scrollHeight - e.clientHeight) + "px"; }).join(", ");
  var av = document.getElementById("vAvisBox");
  r.vAvis = av && !av.hidden ? (document.getElementById("vAvis").textContent || "").slice(0, 40) : "";
  r.graphes   = document.querySelectorAll(".plot svg").length;
  r.courbes   = document.querySelectorAll("#plotNet path[stroke]").length;
  r.regimes   = document.querySelectorAll("#plotReg svg path").length;
  r.sens      = document.querySelectorAll("#plotSens svg rect").length;
  r.seuils    = document.querySelectorAll("#seuils .tile .v").length;
  r.liens     = document.querySelectorAll("#suite a").length;
  var boite = document.getElementById("avisBox");
  r.avis = boite && !boite.hidden ? (document.getElementById("avisText").textContent || "").slice(0, 40) : "";
  // Le curseur de la cascade ne doit redessiner que sa section : on note le total
  // a l'horizon, puis a la premiere annee, et on verifie que le verdict ne bouge pas.
  var curseur = document.getElementById("cascAnnee");
  var totalCascade = function(){
    var t = document.querySelectorAll("#plotCasc svg text.chiffre");
    return t.length ? t[t.length - 1].textContent : "";
  };
  if(curseur){
    r.cascMax = curseur.max;
    r.cascHorizon = totalCascade();
    var triAvant = (document.getElementById("heroTri")||{}).textContent;
    curseur.value = 1;
    curseur.dispatchEvent(new Event("input", {bubbles:true}));
    r.cascAn1 = totalCascade();
    r.triStable = (document.getElementById("heroTri")||{}).textContent === triAvant;
    curseur.value = curseur.max;
    curseur.dispatchEvent(new Event("input", {bubbles:true}));
  }
  // Les infobulles : chaque bouton doit porter un texte, et le clavier doit
  // pouvoir l'ouvrir puis le refermer, sans quoi l'explication serait perdue
  // pour qui n'a pas de souris. La bulle doit aussi rester dans l'ecran.
  var boutons = document.querySelectorAll(".i"), vides = 0;
  Array.prototype.forEach.call(boutons, function(b){
    var c = b.parentElement.querySelector(".ibody");
    if(!c || (c.textContent || "").trim().length < 10) vides++;
  });
  r.bulles = boutons.length;
  r.bullesVides = vides;
  if(boutons.length){
    var pop0 = document.getElementById("pop");
    boutons[0].focus();
    var ouverte = !!(pop0 && !pop0.hidden && (pop0.textContent || "").length > 10
      && boutons[0].getAttribute("aria-describedby") === "pop");
    var boite = pop0 ? pop0.getBoundingClientRect() : null;
    var borne = !!(boite && boite.left >= 0 && boite.right <= innerWidth + 1);
    document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}));
    r.bulleClavier = (ouverte ? "1" : "0") + (borne ? "1" : "0")
      + (pop0 && pop0.hidden ? "1" : "0");
    boutons[0].blur();
  }
  // Le budget de texte : c'est ce controle qui empeche la verbosite de revenir.
  var trop = function(sel, max){
    return Array.prototype.map.call(document.querySelectorAll(sel), function(e){
      return (e.textContent || "").trim(); })
      .filter(function(t){ return t.length > max; })
      .map(function(t){ return t.length + " car. : " + t.slice(0, 30); }).join(" | ");
  };
  r.tropLong = trop(".phead p", 120) + trop(".axisnote", 200);
  // Ce qui sert a decider reste a l'ecran ; le reste attend d'etre demande.
  r.replie = ["analyse", "detail"].filter(function(id){
    var e = document.getElementById(id); return e && !e.open; }).join(",");
  // Le panneau a deux niveaux. Le balayage des regimes qui suit exige, lui, le
  // mode complet : en mode Essentiel la moitie de ces champs n'est pas montree.
  var champsVisibles = function(){ return Array.prototype.filter.call(
    document.querySelectorAll("#railbox .f"),
    function(e){ return e.offsetParent !== null; }).length; };
  var bEss = document.getElementById("railEssentiel"),
      bTout = document.getElementById("railTout");
  if(bEss && bTout){
    bEss.click();
    r.champsEssentiel = champsVisibles();
    bTout.click();
    r.champsTout = champsVisibles();
    r.debordeTout = largeur < 500
      ? Array.prototype.some.call(document.body.querySelectorAll("*"), function(e){ var b=e.getBoundingClientRect(); return b.width > 0 && b.right > largeur + 1 && !defile(e) && !cache(e); })
      : d.scrollWidth > d.clientWidth + 1;
  }
  // Le formulaire ne doit poser que les questions du régime choisi : on parcourt
  // les quatre régimes et on relève, pour chacun, les champs réellement visibles.
  var conditionnels = ["fAbattement","fPlafondDeficit","fCfe","fMobilier","fPartBati","fAmortBati","fAmortTvx","fAmortMob"];
  var select = document.getElementById("regime");
  if(select){
    var initial = select.value;
    r.conditionnement = {};
    ["micro-foncier","reel-foncier","lmnp-micro","lmnp-reel"].forEach(function(rg){
      select.value = rg;
      select.dispatchEvent(new Event("change", {bubbles:true}));
      var vus = conditionnels.filter(function(id){
        var el = document.getElementById(id);
        return el && !el.hidden && el.offsetParent !== null;
      });
      var ligne = document.querySelector("#tvxList .deduc");
      r.conditionnement[rg] = {champs: vus.sort().join(","),
                       deduc: !!(ligne && ligne.offsetParent !== null)};
    });
    select.value = initial;
    select.dispatchEvent(new Event("change", {bubbles:true}));
  }
  if(bEss) bEss.click();
  // Achat comptant : les champs du crédit s'effacent, le rendement change, et
  // décocher rend le chiffre de départ.
  var cComptant = document.getElementById("comptant");
  if(cComptant && select){
    var triAvantComptant = document.getElementById("heroTri").textContent;
    var cache = function(id){ var e = document.getElementById(id); return !!(e && e.hidden); };
    cComptant.checked = true; cComptant.dispatchEvent(new Event("change", {bubbles:true}));
    r.comptant = (cache("fDuree") && cache("fTaux") && cache("fApport") ? "1" : "0")
      + (document.getElementById("heroTri").textContent !== triAvantComptant ? "1" : "0")
      + (/Aucun crédit/.test(document.getElementById("indicateurs").textContent) ? "1" : "0");
    cComptant.checked = false; cComptant.dispatchEvent(new Event("change", {bubbles:true}));
    r.comptant += document.getElementById("heroTri").textContent === triAvantComptant && !cache("fDuree") ? "1" : "0";
  }
  // Trois angles morts signales : recettes meublees au-dela du seuil LMP, apport
  // nul (le rendement reste calcule, sur l'effort d'epargne), et la comptabilite
  // visible au LMNP reel seulement. Chaque champ retrouve sa valeur.
  var fLoyer = document.getElementById("loyer"), fApport = document.getElementById("apport");
  if(fLoyer && fApport && select){
    var alertes = function(){ return document.getElementById("warnBox").textContent; };
    var poser = function(el, v){ el.value = v; el.dispatchEvent(new Event("change", {bubbles:true})); };
    var loyer0 = fLoyer.value, apport0 = fApport.value;
    poser(fLoyer, "2500");
    r.alertes = /LMP/.test(alertes()) ? "1" : "0";
    poser(fLoyer, loyer0); poser(fApport, "0");
    r.alertes += (/Sans apport/.test(alertes()) && /%%/.test(document.getElementById("heroTri").textContent)) ? "1" : "0";
    poser(fApport, apport0);
    var cpt = document.getElementById("fCompta"), rg = document.getElementById("regime"), rg0 = rg.value;
    rg.value = "lmnp-reel"; rg.dispatchEvent(new Event("change", {bubbles:true}));
    var visibleReel = cpt && !cpt.hidden;
    rg.value = "micro-foncier"; rg.dispatchEvent(new Event("change", {bubbles:true}));
    r.alertes += visibleReel && cpt.hidden ? "1" : "0";
    rg.value = rg0; rg.dispatchEvent(new Event("change", {bubbles:true}));
    // Capacite d'emprunt : l'alerte tombe au-dela de 35 %%, et les revenus ne
    // voyagent jamais dans un lien, ni ne s'effacent a l'ouverture d'un lien complet.
    var rev = document.getElementById("revenus");
    if(rev && typeof lienHypotheses === "function"){
      var rev0 = rev.value;
      poser(rev, "2000");
      var lienRev = lienHypotheses(valeursFormulaire(), null, items, true);
      r.alertes += /35 %%/.test(alertes()) && lienRev.indexOf("revenus") < 0 ? "1" : "0";
      history.replaceState(null, "", location.pathname + "#complet=1&loyer=900"); depuisHash();
      r.alertes += rev.value === "2000" ? "1" : "0";
      poser(rev, rev0);
    }
    var dpe = document.getElementById("dpe");
    if(dpe){
      dpe.value = "G"; dpe.dispatchEvent(new Event("change", {bubbles:true}));
      r.alertes += /gèle/.test(alertes()) && /2025/.test(alertes()) ? "1" : "0";
      dpe.value = ""; dpe.dispatchEvent(new Event("change", {bubbles:true}));
    }
  }
  // Bien déjà détenu : un autre jeu de champs, un rendement calculé, et le
  // retour à l'achat rend le chiffre de départ.
  var situ = document.getElementById("situation");
  if(situ){
    var triAchat = document.getElementById("heroTri").textContent;
    var visible = function(id){ var e = document.getElementById(id); return !!(e && !e.hidden && e.offsetParent !== null); };
    situ.value = "detenu"; situ.dispatchEvent(new Event("change", {bubbles:true}));
    if(bTout) bTout.click();
    r.detenuChamps = ["fValeur","fPrixAchat","fDepuis","fTravauxPasses","fCrd","fDureeRestante","dVente"].filter(visible).join(",");
    r.detenuMasques = ["fPrix","fNotaire","fApport","fDuree","dFinancement","fMobilier"].filter(visible).join(",");
    r.detenuTri = document.getElementById("heroTri").textContent;
    r.detenuNet = document.getElementById("dvNet").textContent;
    r.detenuLibelle = document.querySelector("#verdict .eyebrow").textContent;
    r.detenuCascade = document.querySelectorAll("#plotCasc svg text.chiffre").length;
    r.detenuNaN = (document.body.innerText.match(/NaN|undefined|Infinity/g)||[]).length;
    situ.value = "achat"; situ.dispatchEvent(new Event("change", {bubbles:true}));
    if(bEss) bEss.click();
    r.detenuRetour = document.getElementById("heroTri").textContent === triAchat
      && /revente à/.test(document.querySelector("#verdict .eyebrow").textContent);
  }
  r.regT = document.querySelectorAll("#plotRegT path[stroke]").length;
  r.regTNote = (document.getElementById("regTNote") || {}).textContent || "";
  // L'assistant de l'accroche : une question a l'ecran, sept questions, puis le
  // recapitulatif. On le parcourt deux fois — en acceptant tout, puis en doublant
  // le prix — et on lit la cible du bouton final sans quitter la page.
  var q = document.getElementById("assistant");
  if(q){
    var pasVus = function(){ return Array.prototype.filter.call(
      q.querySelectorAll(".qstep"), function(e){ return !e.hidden; }); };
    var suivant = document.getElementById("qNext"), n = 0;
    r.qVisibles = pasVus().length;
    while(!suivant.hidden && n < 12){ suivant.click(); n++; }
    r.qEtapes = n;
    r.qFin = pasVus().length === 1 ? pasVus()[0].id : "";
    r.qLienDefaut = document.getElementById("qGo").getAttribute("href");
    // Le recapitulatif est la plus large des etapes : on remesure ici.
    r.qDeborde = largeur < 500
      ? Array.prototype.some.call(q.querySelectorAll("*"), function(e){ var b=e.getBoundingClientRect(); return b.width > 0 && b.right > largeur + 1 && !defile(e) && !cache(e); })
      : false;
    var modifier = q.querySelector('.qmod[data-etape="qEtapeBien"]');
    if(modifier){
      modifier.click();
      var prix = document.getElementById("qPrix");
      prix.value = (parseInt(prix.value.replace(/[^0-9]/g, ""), 10) || 0) * 2;
      prix.dispatchEvent(new Event("input", {bubbles:true}));
      n = 0;
      while(!suivant.hidden && n < 12){ suivant.click(); n++; }
      r.qLienModifie = document.getElementById("qGo").getAttribute("href");
    }
    // Payer comptant : la question de la durée du prêt disparaît, le lien le dit.
    var bAchat = document.getElementById("qSituAchat"), bDetenu = document.getElementById("qSituDetenu");
    if(bAchat && bDetenu){
      bAchat.click();
      var comptant = q.querySelector('input[name="qFinancement"][value="comptant"]');
      if(comptant){ comptant.checked = true; comptant.dispatchEvent(new Event("change", {bubbles:true})); }
      n = 0;
      while(!suivant.hidden && n < 12){ suivant.click(); n++; }
      r.qComptantEtapes = n;
      r.qLienComptant = document.getElementById("qGo").getAttribute("href");
      var credit = q.querySelector('input[name="qFinancement"][value="credit"]');
      if(credit){ credit.checked = true; credit.dispatchEvent(new Event("change", {bubbles:true})); }
      // Bien déjà détenu : sept autres questions, et un lien qui ne fixe que la
      // situation et l'absence de travaux.
      bDetenu.click();
      r.qDetenuVisibles = pasVus().length;
      n = 0;
      while(!suivant.hidden && n < 12){ suivant.click(); n++; }
      r.qDetenuEtapes = n;
      r.qDetenuFin = pasVus().length === 1 ? pasVus()[0].id : "";
      r.qLienDetenu = document.getElementById("qGo").getAttribute("href");
      bAchat.click();
      n = 0;
      while(!suivant.hidden && n < 12){ suivant.click(); n++; }
      r.qLienRetour = document.getElementById("qGo").getAttribute("href");
    }
  }
  r.lignes    = document.querySelectorAll("#tbl tbody tr").length;
  r.questions = document.querySelectorAll(".faqg article").length;
  r.tri       = (document.getElementById("heroTri")||{}).textContent || "";
  r.vitrine   = (document.getElementById("vTri")||{}).textContent || "";
  r.vcourbes  = document.querySelectorAll("#vPlotNet path[stroke]").length;
  r.vsens     = document.querySelectorAll("#vPlotSens svg rect").length;
  r.vregT     = document.querySelectorAll("#vPlotReg path[stroke]").length;
  // Le panneau d'hypotheses : le bouton de la barre des sections le montre et le
  // cache. Ferme a l'ouverture sur petit ecran (le verdict d'abord), ouvert sur
  // grand ecran. Un panneau cache est inerte : le clavier n'y entre plus.
  var bPanneau = document.getElementById("railToggle"), railEl = document.getElementById("rail");
  if(bPanneau && railEl){
    var montre = function(){ return !railEl.inert && bPanneau.getAttribute("aria-expanded") === "true"; };
    var auDepart = montre();
    bPanneau.click();
    var change = montre() !== auDepart;
    bPanneau.click();
    r.panneau = (change ? "1" : "0") + (montre() === auDepart ? "1" : "0")
      + (auDepart === (largeur >= 500) ? "1" : "0");
  }
  // Petit ecran : le menu doit s'ouvrir sur les quatre liens, tous a l'ecran.
  var burger = document.querySelector(".topbar .burger");
  if(burger && largeur < 500){
    burger.click();
    var dansEcran = Array.prototype.filter.call(document.querySelectorAll(".topbar .nav a"), function(a){
      var b = a.getBoundingClientRect(); return b.width > 0 && b.left >= -1 && b.right <= largeur + 1; }).length;
    r.menu = (burger.offsetParent !== null ? "1" : "0") + (dansEcran === 4 ? "1" : "0");
    burger.click();
  }
  // La bande des sections s'arrete avant la bascule Net | Brut : rien ne passe dessous.
  var bande = document.querySelector(".subliens"), bascule = document.querySelector(".subnav .seg.fisc");
  if(bande && bascule) r.subnavLibre = bande.getBoundingClientRect().right <= bascule.getBoundingClientRect().left + 0.5;
  // Brut : le meme projet avant impot. Le rendement change, les colonnes d'impot
  // quittent le tableau, le verdict le dit, et revenir en net rend le chiffre de depart.
  var bBrut = document.getElementById("fiscBrut"), bNet = document.getElementById("fiscNet");
  if(bBrut && bNet){
    var triNet = document.getElementById("heroTri").textContent;
    bBrut.click();
    r.brut = (document.getElementById("heroTri").textContent !== triNet ? "1" : "0")
      + (document.getElementById("tbl").tHead.textContent.indexOf("Imp") < 0 ? "1" : "0")
      + (/avant imp/.test(document.querySelector("#verdict .eyebrow").textContent) ? "1" : "0")
      + (localStorage.getItem("rentaloc.fiscalite") === null ? "1" : "0");
    bNet.click();
    r.brut += document.getElementById("heroTri").textContent === triNet
      && document.getElementById("tbl").tHead.textContent.indexOf("Imp") >= 0 ? "1" : "0";
  }
  // Le lien partage porte tout le scenario : ouvert chez quelqu'un qui a sa propre
  // saisie, il doit rendre exactement le formulaire de l'auteur, travaux compris.
  if(typeof valeursFormulaire === "function" && typeof lienHypotheses === "function"){
    var scenario = JSON.stringify(valeursFormulaire()) + JSON.stringify(items);
    var lienPartage = lienHypotheses(valeursFormulaire(), null, items, true);
    document.getElementById("apport").value = "123456";
    document.getElementById("tmi").value = "45";
    document.getElementById("ira").checked = !document.getElementById("ira").checked;
    items = [];
    history.replaceState(null, "", location.pathname + lienPartage);
    depuisHash();
    r.partage = JSON.stringify(valeursFormulaire()) + JSON.stringify(items) === scenario;
  }
  // Un lien complet efface la saisie d'une visite precedente ; un lien de guide
  // s'y superpose. Mesure en dernier : elle modifie le formulaire.
  var tx = document.getElementById("taux");
  if(typeof depuisHash === "function" && tx){
    var essai = function(fragment){
      tx.value = "9.99";
      history.replaceState(null, "", location.pathname + fragment);
      depuisHash();
      return tx.value;
    };
    r.lienComplet = essai("#complet=1&loyer=1234") === DEFAULTS.taux
                    && document.getElementById("loyer").value === "1234";
    r.lienGuide = essai("#regime=reel-foncier") === "9.99"
                  && document.getElementById("regime").value === "reel-foncier";
    // Un lien copie avant l'apparition d'un champ garde le scenario d'alors : il
    // porte tous les champs d'origine mais pas la comptabilite, qui y vaut 0 €.
    // Un lien de l'assistant, lui, prend la valeur d'ouverture.
    var compta = document.getElementById("compta");
    if(typeof LIEN_ORIGINE !== "undefined" && compta){
      essai("#complet=1&" + LIEN_ORIGINE.map(function(k){ return k + "=" + encodeURIComponent(DEFAULTS[k]); }).join("&"));
      var ancien = compta.value;
      essai("#complet=1");
      r.lienAncien = ancien + "|" + compta.value;
    }
  }
  document.getElementById("sonde").textContent = "SONDE::" + JSON.stringify(r);
}, 1800);
</script>"""


# Les repères de marché arrivent par deux chargements successifs — la liste des
# communes d'une initiale, puis le fichier du département : on tape, on attend,
# on choisit, on attend encore.
SONDE_MARCHE = """
<div id="sonde"></div>
<script>
window.__err=[]; window.addEventListener("error",function(e){window.__err.push(e.message);});
setTimeout(function(){
  var r = {largeur: %d}, c = document.getElementById("commune"), s = document.getElementById("surface");
  var fin = function(){ r.erreurs = window.__err; document.getElementById("sonde").textContent = "SONDE::" + JSON.stringify(r); };
  if(!c || !s){ fin(); return; }
  c.value = "lyon 3"; c.dispatchEvent(new Event("input", {bubbles:true}));
  setTimeout(function(){
    r.options = [].map.call(document.querySelectorAll("#communesListe option"), function(o){ return o.value; });
    c.value = r.options[0] || ""; c.dispatchEvent(new Event("input", {bubbles:true}));
    s.value = "50"; s.dispatchEvent(new Event("change", {bubbles:true}));
    setTimeout(function(){
      var rp = document.getElementById("repPrix"), rl = document.getElementById("repLoyer");
      r.prix = rp.hidden ? "" : rp.textContent;
      r.loyer = rl.hidden ? "" : rl.textContent;
      r.lien = lienHypotheses(valeursFormulaire(), null, items, true).indexOf("commune=69383") >= 0;
      r.resume = document.getElementById("marcheResume").hidden ? 0 : document.querySelectorAll("#marcheTuiles .tile").length;
      r.encadre = /encadrement des loyers/.test(document.getElementById("warnBox").textContent);
      r.equivalent = /annonce équivalente serait/.test(r.loyer);
      // Bien détenu : le marché propose une valeur, reprise d'un clic.
      var sit = document.getElementById("situation");
      sit.value = "detenu"; sit.dispatchEvent(new Event("change", {bubbles:true}));
      var bouton = document.querySelector("#repPrix .reprendre");
      if(bouton){ bouton.click(); r.reprise = document.getElementById("valeur").value; }
      sit.value = "achat"; sit.dispatchEvent(new Event("change", {bubbles:true}));
      // Effacer la commune efface les repères.
      c.value = ""; c.dispatchEvent(new Event("input", {bubbles:true}));
      r.efface = rp.hidden && rl.hidden;
      fin();
    }, 1500);
  }, 1500);
}, 1200);
</script>"""


def initiales_delicates():
    """[nom, initiale selon outils/donnees.py] pour chaque commune dont le nom ne
    commence pas par une lettre sans accent, plus quelques noms à apostrophe et à
    « Saint » : ceux où la page et l'import pourraient ne pas s'entendre."""
    sortie = []
    for f in sorted((RACINE / "donnees" / "communes").glob("*.json")):
        for code, nom, _ in json.loads(f.read_text(encoding="utf-8")):
            if not ("A" <= nom[0] <= "Z") or "'" in nom[:3] or nom.startswith(("Saint", "Sainte")):
                sortie.append([nom, f.stem])
    return sortie


def sonde_navigateur(chrome, base, fichier, largeur, sonde=SONDE):
    """Charge une page dans Chrome et rapatrie un diagnostic depuis le DOM.

    Chrome sans fenêtre refuse moins de 500 px de large : en dessous, on
    contraint la page elle-même, ce qui suffit à révéler un débordement.
    """
    page = fichier.read_text(encoding="utf-8")
    etroit = f"<style>html{{width:{largeur}px;margin:0}}</style>" if largeur < 500 else ""
    temoin = fichier.parent / "__verif.html"
    temoin.write_text(page.replace("</head>", etroit + "</head>")
                      .replace("</body>", sonde % largeur + "</body>"), encoding="utf-8")
    try:
        url = base + "/" + temoin.relative_to(SITE).as_posix()
        dom = subprocess.run(
            [chrome, "--headless=new", *_local.options_chrome(chrome), "--disable-gpu", "--virtual-time-budget=9000",
             f"--window-size={max(500, largeur)},1000", "--dump-dom", url],
            capture_output=True, text=True, timeout=120).stdout
        trouve = re.search(r"SONDE::(\{.*?\})</div>", dom, re.S)
        # --dump-dom sérialise le texte en HTML : un « & » de lien ressort en &amp;.
        return json.loads(html.unescape(trouve.group(1))) if trouve else None
    finally:
        temoin.unlink(missing_ok=True)


def propre(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t).replace("&nbsp;", " ")
                  .replace("&amp;", "&")).strip()


def main():
    print("Construction…")
    erreur = _local.construire()
    if erreur:
        # Sans cela, une source mal formée ressortait en CalledProcessError nue :
        # le message que build.py a pris soin d'écrire restait invisible.
        controle("construction du site", False, erreur.splitlines()[-1][:70])
        print("\n%d contrôle, 1 échec(s)" % 1)
        raise SystemExit(1)

    pages = list(pages_html())
    serveur, base = servir_en_fond()
    try:
        print("\nRESSOURCES")
        for chemin in ("/", "/calculatrice/", "/guides/", "/questions-frequentes/",
                       "/hypotheses-de-calcul/", "/mentions-legales/", "/404.html",
                       "/css/style.css", "/js/app.js", "/js/site.js", "/js/vitrine.js",
                       "/favicon.ico", "/assets/favicon.svg", "/assets/og-image.png",
                       "/assets/apple-touch-icon.png", "/robots.txt", "/sitemap.xml",
                       "/.well-known/security.txt"):
            try:
                with urllib.request.urlopen(base + chemin, timeout=10) as r:
                    controle(chemin, r.status == 200, "%d o" % len(r.read()))
            except urllib.error.HTTPError as e:
                controle(chemin, False, "HTTP %d" % e.code)
        # RFC 9116 : Contact et Expires sont obligatoires, et un fichier expiré
        # vaut absence.
        securite = SITE / ".well-known" / "security.txt"
        securite = securite.read_text(encoding="utf-8") if securite.is_file() else ""
        expire = re.search(r"^Expires: (\d{4}-\d\d-\d\d)T", securite, re.M)
        controle("security.txt : un contact, une échéance à venir",
                 re.search(r"^Contact: https://", securite, re.M) is not None
                 and expire is not None and expire.group(1) > date.today().isoformat(),
                 expire.group(1) if expire else "Expires absent")

        print("\nRÉFÉRENCEMENT")
        sitemap = (SITE / "sitemap.xml").read_text(encoding="utf-8")
        locs = re.findall(r"<loc>(.*?)</loc>", sitemap)
        indexables, problemes_h1 = [], []
        for chemin, fichier in pages:
            html = fichier.read_text(encoding="utf-8")
            defauts = []
            titre = re.search(r"<title>(.*?)</title>", html, re.S)
            desc = re.search(r'name="description" content="(.*?)"', html, re.S)
            if not titre or not (10 <= len(titre.group(1)) <= 60):
                defauts.append("titre %s" % (len(titre.group(1)) if titre else "absent"))
            if not desc or not (50 <= len(desc.group(1)) <= 160):
                defauts.append("description %s" % (len(desc.group(1)) if desc else "absente"))
            if len(re.findall(r"<h1[\s>]", html)) != 1:
                defauts.append("h1 ×%d" % len(re.findall(r"<h1[\s>]", html)))
            if 'lang="fr"' not in html:
                defauts.append("lang")
            canon = re.search(r'rel="canonical" href="(.*?)"', html)
            if not canon or canon.group(1) != DOMAINE + chemin:
                defauts.append("canonical")
            if "og:image" not in html:
                defauts.append("og:image")
            # Le thème choisi doit être posé avant la feuille de style : posé en fin
            # de page, il laissait voir le thème par défaut à chaque changement de page.
            if "rentaloc.theme" not in html.split("</head>")[0].split('rel="stylesheet"')[0]:
                defauts.append("thème posé après la première peinture")
            try:
                ld = json.loads(re.search(r'application/ld\+json">(.*?)</script>', html, re.S).group(1))
            except Exception:
                ld, defauts = None, defauts + ["JSON-LD"]
            if isinstance(ld, list):
                faq = next((o for o in ld if o.get("@type") == "FAQPage"), None)
                if faq:
                    visibles = [propre(v) for v in re.findall(r"<h3>(.*?)</h3>", html, re.S)]
                    if any(q["name"] not in visibles for q in faq["mainEntity"]):
                        defauts.append("FAQ balisée ≠ visible")
            noindex = 'name="robots" content="noindex' in html
            if not noindex:
                indexables.append(chemin)
            controle("page %s" % chemin, not defauts, ", ".join(defauts) or ("noindex" if noindex else ""))

        manquantes = [c for c in indexables if DOMAINE + c not in locs]
        fantomes = [u for u in locs if fichier_pour(u.replace(DOMAINE, "")) is None]
        controle("sitemap : toutes les pages indexables", not manquantes, ", ".join(manquantes))
        controle("sitemap : aucune URL fantôme", not fantomes, ", ".join(fantomes))
        interdites = [u for u in locs if u.replace(DOMAINE, "") not in indexables]
        controle("sitemap : aucune page noindex", not interdites, ", ".join(interdites))

        casses = set()
        for chemin, fichier in pages:
            for href in re.findall(r'href="(/[^"]*)"', fichier.read_text(encoding="utf-8")):
                if href.startswith("//"):
                    continue
                if fichier_pour(href) is None:
                    casses.add(f"{chemin} → {href}")
        controle("liens internes : tous résolus", not casses, "; ".join(sorted(casses))[:80])

        print("\nCHARTE GRAPHIQUE")
        css = (SITE / "css" / "style.css").read_text(encoding="utf-8")
        hors_tokens = re.sub(r":root[^{]*\{[^}]*\}", "", css)
        hex_perdus = sorted(set(re.findall(r"#[0-9a-fA-F]{3,8}\b", hors_tokens)))
        controle("couleurs uniquement dans les tokens", not hex_perdus, ", ".join(hex_perdus)[:60])
        controle("aucune ombre portée", "box-shadow" not in hors_tokens or
                 all("var(--ring)" in l for l in hors_tokens.splitlines() if "box-shadow" in l))
        # Le vert et le rouge de la couche données tombent à 2,9:1 sur fond clair :
        # lisibles en tracé, pas en texte. On vérifie donc chaque paire réellement
        # utilisée, plutôt que de faire confiance à l'œil.
        themes = {"clair": tokens_du_theme(css, ":root"),
                  "sombre": tokens_du_theme(css, ':root[data-theme="dark"]')}
        # Le sombre s'écrit deux fois : choisi sur le site, ou préféré par le
        # navigateur. Deux copies qui divergeraient donneraient deux sombres.
        controle("thème sombre : choix manuel et préférence du navigateur identiques",
                 themes["sombre"] == tokens_du_theme(css, ':root:not([data-theme="light"])'))
        # Le thème sombre n'est qu'une surcharge : ce qu'il ne redéfinit pas vient du clair.
        themes["sombre"] = {**themes["clair"], **themes["sombre"]}
        themes = {nom: resoudre(t) for nom, t in themes.items()}
        # (libellé, sélecteur dont on lit la couleur, fond, fond sous-jacent si translucide)
        composants = [("texte courant", "body", "--bg", None),
                      ("badge gagnant", ".pill.win", "--up-bg", "--surface"),
                      ("badge perdant", ".pill.lose", "--down-bg", "--surface"),
                      ("badge neutre", ".pill.flat", "--surface-2", None),
                      ("rendement héros", ".hero .big", "--surface", None),
                      ("rendement héros négatif", ".hero .big.bad", "--surface", None),
                      ("pouvoir d'achat", ".reel b", "--surface-2", None),
                      ("pouvoir d'achat négatif", ".reel b.bad", "--surface-2", None),
                      ("valeur de tuile en hausse", ".v.pos", "--surface", None),
                      ("valeur de tuile en baisse", ".v.neg", "--surface", None),
                      ("cellule en hausse", "td.pos", "--bg", None),
                      ("cellule en baisse", "td.neg", "--bg", None),
                      ("libellés et axes", ".tile .k", "--surface", None),
                      ("note sous graphique", ".axisnote", "--bg", None)]
        for theme, t in themes.items():
            for nom, selecteur, fond, sur in composants:
                encre = encre_de(css, selecteur)
                if encre is None or encre not in t or fond not in t:
                    controle("contraste %s, %s" % (theme, nom), False,
                             "règle « %s » : couleur %s introuvable" % (selecteur, encre or "—"))
                    continue
                r = contraste(t[encre], t[fond], t[sur] if sur else None)
                controle("contraste %s, %s" % (theme, nom), r >= 4.5,
                         "%s → %.2f:1 (seuil 4.5)" % (encre, r))

        # Une couleur se lit au runtime par son nom : une variable inexistante ne
        # plante pas, elle rend une chaîne vide. C'est ainsi que --ink-3 a survécu.
        app = (SITE / "js" / "app.js").read_text(encoding="utf-8")
        declares = set(re.findall(r"(--[a-z0-9-]+)\s*:", css))
        appeles = set(re.findall(r'css\(\s*"(--[a-z0-9-]+)"', app))
        appeles |= set(re.findall(r'(?:color|textColor)\s*:\s*"(--[a-z0-9-]+)"', app))
        fantomes = sorted(appeles - declares)
        controle("aucun token CSS fantôme appelé par le JS", not fantomes, ", ".join(fantomes))

        polices = list(SITE.rglob("*.woff*"))
        controle("police système, aucune police embarquée",
                 "@font-face" not in css and not polices, "%d fichier(s)" % len(polices))

        print("\nSÉPARATION DES SOURCES")
        moteur_src = sans_commentaires((SRC / "moteur.js").read_text(encoding="utf-8"))
        graph_src = sans_commentaires((SRC / "graphiques.js").read_text(encoding="utf-8"))
        calc_src = (SRC / "calculatrice.js").read_text(encoding="utf-8")
        # Le moteur alimente aussi la page d'accueil : s'il lisait un élément
        # propre à la calculatrice, la vitrine planterait en silence.
        fuites = [m for m in ("document", "getElementById", "getComputedStyle", "window.", "$(")
                  if re.search(r"(?<![\w.])" + re.escape(m), moteur_src)]
        controle("src/moteur.js ne touche jamais au document", not fuites, ", ".join(fuites))
        # Les graphiques ont le droit au document — ils dessinent — mais pas aux
        # champs : ils servent les deux pages.
        champs = json.loads(re.search(r"const FIELDS = (\[.*?\]);", calc_src, re.S)
                            .group(1).replace("\n", " "))
        vus = sorted({c for c in champs if re.search(r'["\']%s["\']' % re.escape(c), graph_src)})
        controle("src/graphiques.js ignore les champs du formulaire", not vus, ", ".join(vus))
        # Personne ne doit remettre du code dans index.html : il ne porte que le
        # balisage, et build.py ne saurait pas quoi en faire.
        balisage = SOURCE.read_text(encoding="utf-8")
        controle("index.html ne porte que le balisage",
                 "<style>" not in balisage and "<script>" not in balisage)
        # L'assistant propose des valeurs sans en connaître aucune : il les tire de
        # DEFAUTS, à proportion du prix. Un chiffre recopié ici cesserait de suivre
        # le formulaire à la première mise à jour du scénario par défaut.
        assistant_src = sans_commentaires((SRC / "assistant.js").read_text(encoding="utf-8"))
        defauts = json.loads(build._defauts(balisage, calc_src))
        recopies = sorted({"%s = %g" % (cle, defauts[cle])
                           for cle in ("prix", "loyer", "apport", "tf", "mobilier", "valeur", "prixAchat", "crd")
                           if re.search(r"(?<![\d.])%g(?![\d.])" % defauts[cle], assistant_src)})
        controle("l'assistant ne recopie aucune valeur par défaut",
                 not recopies, ", ".join(recopies))
        # Le graphique de sensibilité déplace la tranche d'un palier : ses paliers
        # doivent être ceux de la liste du formulaire, pas une copie qui dériverait.
        tranches = json.loads(re.search(r"const TRANCHES = (\[.*?\]);", moteur_src).group(1))
        bloc = re.search(r'<select id="tmi">(.*?)</select>', balisage, re.S).group(1)
        options = [float(v) for v in re.findall(r'<option value="([^"]*)"', bloc)]
        controle("sensibilité : tranches du barème = liste du formulaire",
                 tranches == options, "%s vs %s" % (tranches, options))
        # Le lien d'origine et les champs apparus depuis : tous des champs réels,
        # et aucun dans les deux listes à la fois.
        origine = json.loads(re.search(r"const LIEN_ORIGINE = (\[.*?\]);", calc_src, re.S)
                             .group(1).replace("\n", " "))
        tardifs = re.findall(r"(\w+):", re.search(r"const CHAMPS_TARDIFS = \{(.*?)\};", calc_src).group(1))
        intrus = sorted(set(origine + tardifs) - set(champs)) + sorted(set(origine) & set(tardifs))
        controle("liens anciens : champs d'origine et tardifs connus", not intrus and tardifs,
                 ", ".join(intrus))
        # La page de méthode, elle, affiche des chiffres : chacun de ceux qui
        # viennent du formulaire porte data-defaut et doit en égaler la valeur.
        # Sans quoi la page annoncerait 8 % de frais quand l'outil en retient 7,5.
        methode = (RACINE / "pages" / "hypotheses-de-calcul.html").read_text(encoding="utf-8")
        affiches = re.findall(r'data-defaut="(\w+)"[^>]*>([^<]+)<', methode)
        lu = lambda t: float(re.search(r"-?\d+(?:\.\d+)?",
                                       re.sub(r"\s", "", t).replace("−", "-").replace(",", ".")).group())
        derives = ["%s %s" % (cle, texte.strip()) for cle, texte in affiches
                   if cle not in defauts or abs(lu(texte) - defauts[cle]) > 1e-9]
        controle("hypothèses de calcul : chiffres affichés = valeurs par défaut",
                 bool(affiches) and not derives,
                 ", ".join(derives)[:60] or "%d chiffres vérifiés" % len(affiches))

        print("\nCONFIDENTIALITÉ ET POIDS")
        textes = css + "".join(f.read_text(encoding="utf-8") for _, f in pages)
        textes += (SITE / "js" / "app.js").read_text(encoding="utf-8")
        # Un lien qu'on clique n'est pas un appel : il ne part qu'au geste du
        # visiteur. Ils sont mis de côté, puis réservés aux sources officielles.
        ancre = r'<a\b[^>]*\bhref="https?://([a-z0-9.-]+)[^"]*"'
        liens = set(re.findall(ancre, textes))
        tiers = {d for d in re.findall(r"https?://([a-z0-9.-]+)", re.sub(ancre, "", textes))
                 if not d.endswith(("w3.org", "schema.org", "sitemaps.org", "cloudflare.com"))
                 and "monrendementlocatif" not in d}
        controle("aucun appel vers un domaine tiers", not tiers, ", ".join(tiers))
        # Les sources officielles, et l'hébergeur que les mentions légales nomment.
        sortants = sorted(d for d in liens if not d.endswith((".gouv.fr", "cloudflare.com"))
                          and "monrendementlocatif" not in d)
        controle("liens sortants : sources officielles seulement", not sortants, ", ".join(sortants))
        controle("aucun script de mesure d'audience",
                 not re.search(r"googletagmanager|google-analytics|gtag\(|plausible\.io|matomo|hotjar|clarity\.ms|cloudflareinsights", textes, re.I))
        # Les données de marché ne se chargent qu'à la demande, une initiale et un
        # département à la fois : elles ont leur propre budget, par fichier. Le
        # reste du site passe à 650 Ko le 2026-09-23 (seuils, capacité d'emprunt,
        # repères de marché), dont 18 Ko d'une image de partage rendue sous Linux.
        hors_donnees = [f for f in SITE.rglob("*") if f.is_file() and "donnees" not in f.relative_to(SITE).parts]
        poids = sum(f.stat().st_size for f in hors_donnees)
        controle("poids du site, hors données de marché, sous 650 Ko", poids < 650_000, "%d Ko" % (poids // 1024))

        print("\nDONNÉES DE MARCHÉ")
        dossier = SITE / "donnees"
        lettres = sorted((dossier / "communes").glob("*.json"))
        departements = sorted((dossier / "marche").glob("*.json"))
        lourds = [f.name for f in lettres if f.stat().st_size > 250_000] \
            + [f.name for f in departements if f.stat().st_size > 150_000]
        controle("données : chaque fichier chargé à la demande reste léger", bool(lettres) and not lourds,
                 ", ".join(lourds) or "initiales ≤ 250 Ko, départements ≤ 150 Ko")
        communes = [c for f in lettres for c in json.loads(f.read_text(encoding="utf-8"))]
        fiches = {}
        for f in departements:
            fiches.update(json.loads(f.read_text(encoding="utf-8"))["c"])
        orphelines = [c[0] for c in communes if c[0] not in fiches]
        controle("données : toutes les communes, chacune avec sa fiche",
                 len(communes) > 34000 and len(departements) >= 100 and not orphelines,
                 "%d communes, %d départements%s" % (len(communes), len(departements),
                                                     ", sans fiche : " + orphelines[0] if orphelines else ""))
        # Une commune se range sous l'initiale que la page calculera en la tapant.
        # Des bornes larges mais fermées : un prix à 0 €/m² ou un loyer à 500 €/m²
        # trahit une colonne décalée ou une unité changée à la source.
        aberrants = [c for c, v in fiches.items()
                     if any(k in v and v[k][1] >= 10 and not 100 <= v[k][0] <= 60000 for k in ("pa", "pm"))
                     or any(k in v and not (3 <= v[k][0] <= 60 and v[k][1] <= v[k][0] <= v[k][2])
                            for k in ("la", "l12", "l3", "lm"))]
        controle("données : prix et loyers dans des bornes plausibles", not aberrants,
                 ", ".join(aberrants[:3]) or "prix 100-60 000 €/m², loyers 3-60 €/m²")
        sources = json.loads((dossier / "sources.json").read_text(encoding="utf-8"))
        fin = date.fromisoformat(sources["dvf"]["periode"][1] + "-01")
        age = (date.today() - fin).days // 30
        # L'encadrement des loyers est une expérimentation datée : passé sa fin,
        # la liste relevée à la main doit être revue — prolongée ou retirée.
        enc = sources["encadrement"]
        controle("données : liste d'encadrement revue depuis la fin de l'expérimentation",
                 date.today() <= date.fromisoformat(enc["fin"]) or enc["verifie"] >= enc["fin"],
                 "vérifiée le %s, fin le %s" % (enc["verifie"], enc["fin"]))
        # DVF publie deux fois l'an, avec six mois de retard : au-delà de 18 mois,
        # un millésime a été manqué — relancer outils/donnees.py.
        controle("données : ventes DVF de moins de 18 mois", age <= 18,
                 "jusqu'à %s, il y a %d mois" % (sources["dvf"]["periode"][1], age))

        chrome = premier_existant(CHROME)
        if not chrome:
            print("\nNAVIGATEUR : Chrome introuvable, contrôles ignorés")
        else:
            print("\nNAVIGATEUR")
            vitrine = {}
            for largeur in (1360, 390):
                r = sonde_navigateur(chrome, base, SITE / "index.html", largeur)
                if r is None:
                    controle("accueil %d px chargé" % largeur, False, "aucune réponse de la sonde")
                    continue
                vitrine = r if largeur == 1360 else vitrine
                controle("accueil %d px : aucune erreur JavaScript" % largeur, not r["erreurs"],
                         "; ".join(r["erreurs"])[:60])
                controle("accueil %d px : aucun NaN affiché" % largeur, not r["suspects"],
                         ", ".join(r["suspects"])[:40])
                controle("accueil %d px : aucun débordement" % largeur, not r["deborde"])
                if largeur < 500:
                    # « bouton menu visible », « quatre liens à l'écran une fois ouvert »
                    controle("accueil %d px : le menu montre les quatre liens" % largeur,
                             r.get("menu") == "11", r.get("menu") or "sonde muette")
                if largeur == 1360:
                    controle("accueil : trois graphiques tracés", r["graphes"] == 3, str(r["graphes"]))
                    controle("accueil : quatre placements comparés", r["vcourbes"] == 4, str(r["vcourbes"]))
                    controle("accueil : quatre régimes et la bourse dans le temps",
                             r.get("vregT") == 5, "%s courbes" % r.get("vregT"))
                    controle("accueil : sensibilité tracée", r["vsens"] >= 6, "%d barres" % r["vsens"])
                    controle("accueil : rendement affiché", "%" in r["vitrine"], r["vitrine"])
                    # L'image de partage montre le scénario de l'accueil. Quand ce
                    # chiffre bouge, elle se corrige puis se régénère avec
                    # outils/og_image.py — sinon les réseaux sociaux affichent l'ancien.
                    og = (RACINE / "outils" / "og-image.html").read_text(encoding="utf-8")
                    controle("image de partage : même rendement que l'accueil",
                             bool(r["vitrine"]) and ">%s<" % r["vitrine"] in og, r["vitrine"])
                    controle("accueil : avis éditorial rendu",
                             len(r.get("vAvis") or "") > 20, r.get("vAvis") or "absent")
                    controle("accueil : aucun graphique ne piège le défilement",
                             not r.get("piege"), r.get("piege") or "")
                    controle("accueil : chaque infobulle porte une explication",
                             r.get("bulles", 0) >= 2 and not r.get("bullesVides"),
                             "%s bouton(s), %s sans texte" % (r.get("bulles"), r.get("bullesVides")))
                    controle("assistant : une seule question à l'écran",
                             r.get("qVisibles") == 1, "%s étape(s) visible(s)" % r.get("qVisibles"))
                    controle("assistant : sept questions puis le récapitulatif",
                             r.get("qEtapes") == 7 and r.get("qFin") == "qEtapeRecap",
                             "%s clics → %s" % (r.get("qEtapes"), r.get("qFin") or "—"))
                    # L'assistant ne doit inventer aucune hypothèse : tout accepter
                    # doit rendre le scénario que la vitrine affiche juste au-dessus,
                    # c'est-à-dire un lien qui ne porte que son marqueur « complet ».
                    controle("assistant : les valeurs proposées rejouent le scénario par défaut",
                             r.get("qLienDefaut") == "/calculatrice/#complet=1", r.get("qLienDefaut") or "—")
                    manquants = [c for c in ("prix=", "loyer=", "apport=", "tf=", "copro=", "mobilier=")
                                 if c not in (r.get("qLienModifie") or "")]
                    controle("assistant : le prix entraîne loyer, apport et charges",
                             not manquants, ", ".join(manquants) or (r.get("qLienModifie") or "—")[-58:])
                    lc = r.get("qLienComptant") or ""
                    controle("assistant : payer comptant saute la durée du prêt et voyage dans le lien",
                             r.get("qComptantEtapes") == 6 and "comptant=1" in lc and "duree=" not in lc,
                             "%s clics → %s" % (r.get("qComptantEtapes"), lc[-50:] or "—"))
                    controle("assistant : bien détenu, sept questions puis le récapitulatif",
                             r.get("qDetenuVisibles") == 1 and r.get("qDetenuEtapes") == 7
                             and r.get("qDetenuFin") == "qEtapeRecap",
                             "%s clics → %s" % (r.get("qDetenuEtapes"), r.get("qDetenuFin") or "—"))
                    controle("assistant : bien détenu, les valeurs proposées ne fixent que la situation",
                             r.get("qLienDetenu") == "/calculatrice/#complet=1&situation=detenu&tvx=",
                             r.get("qLienDetenu") or "—")
                    # La saisie faite avant de basculer (le prix doublé) survit au retour.
                    controle("assistant : revenir à l'achat retrouve la saisie du visiteur",
                             bool(r.get("qLienRetour")) and r.get("qLienRetour") == r.get("qLienModifie"),
                             (r.get("qLienRetour") or "—")[-58:])
                if not r.get("qDeborde") is None:
                    controle("assistant %d px : le récapitulatif ne déborde pas" % largeur,
                             not r.get("qDeborde"))

            for largeur in (1360, 390):
                r = sonde_navigateur(chrome, base, SITE / "calculatrice" / "index.html", largeur)
                if r is None:
                    controle("calculatrice %d px chargée" % largeur, False, "aucune réponse de la sonde")
                    continue
                controle("calculatrice %d px : aucune erreur JavaScript" % largeur, not r["erreurs"],
                         "; ".join(r["erreurs"])[:60])
                controle("calculatrice %d px : aucun NaN affiché" % largeur, not r["suspects"],
                         ", ".join(r["suspects"])[:40])
                controle("calculatrice %d px : aucun débordement" % largeur, not r["deborde"])
                controle("calculatrice %d px : aucun débordement, panneau complet" % largeur,
                         not r.get("debordeTout"))
                controle("calculatrice %d px : aucune section sous la bascule Net | Brut" % largeur,
                         r.get("subnavLibre") is True, str(r.get("subnavLibre")))
                # « le bouton bascule », « un second clic rétablit », « fermé sur
                # téléphone, ouvert sur grand écran au départ »
                controle("calculatrice %d px : le bouton Hypothèses montre et cache le panneau" % largeur,
                         r.get("panneau") == "111", r.get("panneau") or "sonde muette")
                if largeur < 500:
                    controle("calculatrice %d px : le menu montre les quatre liens" % largeur,
                             r.get("menu") == "11", r.get("menu") or "sonde muette")
                if largeur == 1360:
                    # La vitrine rejoue le scénario par défaut : le moindre écart
                    # signalerait qu'elle a cessé de suivre le moteur.
                    controle("accueil et calculatrice : même rendement",
                             bool(r["tri"]) and r["tri"] == vitrine.get("vitrine"),
                             "%s vs %s" % (vitrine.get("vitrine", "—"), r["tri"]))
                    controle("six tuiles d'indicateurs", r["tuiles"] == 6, str(r["tuiles"]))
                    controle("huit graphiques tracés", r["graphes"] == 8, str(r["graphes"]))
                    controle("huit équivalents textuels", r.get("equiv") == 8, str(r.get("equiv")))
                    controle("huit graphiques atteignables au clavier",
                             r.get("focalisables") == 8, str(r.get("focalisables")))
                    controle("quatre régimes et la bourse dans le temps",
                             r.get("regT") == 5 and len(r.get("regTNote") or "") > 20,
                             "%s courbes, note : %s" % (r.get("regT"), (r.get("regTNote") or "—")[:40]))
                    # « champs du crédit masqués », « rendement changé », « bulle du
                    # loyer couvert : aucun crédit », « décocher rend le départ »
                    # « seuil LMP signalé », « apport nul : rendement calculé et
                    # expliqué », « comptabilité au seul LMNP réel », « DPE G :
                    # gel et interdiction datée », « endettement au-delà de 35 %,
                    # revenus hors du lien », « revenus gardés à l'ouverture d'un lien »
                    controle("angles morts signalés : LMP, apport nul, comptabilité, endettement, DPE",
                             r.get("alertes") == "111111", r.get("alertes") or "sonde muette")
                    controle("achat comptant : les champs du crédit s'effacent, le rendement suit",
                             r.get("comptant") == "1111", r.get("comptant") or "sonde muette")
                    controle("bien détenu : ses champs, et seulement eux",
                             r.get("detenuChamps") == "fValeur,fPrixAchat,fDepuis,fTravauxPasses,fCrd,fDureeRestante,dVente"
                             and r.get("detenuMasques") == "",
                             "%s ; encore visibles : %s" % (r.get("detenuChamps"), r.get("detenuMasques") or "aucun"))
                    controle("bien détenu : rendement, net d'une vente aujourd'hui, libellés, cascade",
                             "%" in (r.get("detenuTri") or "") and "€" in (r.get("detenuNet") or "")
                             and "revente dans" in (r.get("detenuLibelle") or "")
                             and r.get("detenuCascade") == 9 and r.get("detenuNaN") == 0,
                             "%s, %s, %s marches" % (r.get("detenuTri"), r.get("detenuNet"), r.get("detenuCascade")))
                    controle("bien détenu : revenir à l'achat rend le chiffre de départ",
                             r.get("detenuRetour") is True, str(r.get("detenuRetour")))
                    # « ouvre au focus », « les flèches déplacent », « se ferme au blur »
                    controle("infobulle pilotable au clavier", r.get("clavier") == "111",
                             r.get("clavier") or "sonde muette")
                    # Le lien de l'assistant décrit un projet entier : ce qu'il ne
                    # fixe pas ne doit pas garder la saisie d'une visite précédente.
                    controle("lien complet : repart des valeurs d'ouverture",
                             r.get("lienComplet") is True, str(r.get("lienComplet")))
                    controle("lien de guide : conserve la saisie du visiteur",
                             r.get("lienGuide") is True, str(r.get("lienGuide")))
                    # « lien copié avant la comptabilité | lien de l'assistant »
                    controle("lien copié avant un nouveau champ : scénario d'alors",
                             r.get("lienAncien") == "0|" + str(int(defauts["compta"])),
                             r.get("lienAncien") or "sonde muette")
                    # « rendement change », « colonnes d'impôt retirées »,
                    # « verdict avant impôt », « brut jamais retenu » (la page
                    # s'ouvre toujours en net), « retour net identique »
                    controle("bascule brut/net : rendement, tableau et libellés suivent",
                             r.get("brut") == "11111", r.get("brut") or "sonde muette")
                    # Le lien de « Copier le lien », ouvert par-dessus une autre saisie.
                    controle("lien partagé : rend le scénario exact, même chez qui a sa propre saisie",
                             r.get("partage") is True, str(r.get("partage")))
                    controle("aucun graphique ne piège le défilement",
                             not r.get("piege"), r.get("piege") or "")
                    controle("les graphiques suivent la bascule de thème",
                             (r.get("theme") or "").endswith("|ok"),
                             (r.get("theme") or "sonde muette").replace(" |ok", ""))
                    controle("quatre courbes comparées", r["courbes"] == 4, str(r["courbes"]))
                    controle("quatre régimes comparés", r["regimes"] == 4, str(r["regimes"]))
                    controle("sensibilité calculée", r["sens"] >= 6, "%d barres" % r["sens"])
                    controle("seuils face à la bourse affichés", r.get("seuils") == 5, "%s tuiles" % r.get("seuils"))
                    if largeur == 1360:
                        m = sonde_navigateur(chrome, base, fichier_pour("/calculatrice/"), largeur, SONDE_MARCHE) or {}
                        # « Lyon 3e proposée », « prix au m² situé », « loyer situé »,
                        # « la commune voyage dans le lien », « effacée, plus de repères »
                        etat = "".join("1" if v else "0" for v in (
                            (m.get("options") or [""])[0] == "Lyon 3e Arrondissement (69)",
                            "4 000 €/m²" in (m.get("prix") or "").replace("\u202f", " ").replace("\xa0", " "),
                            "hors charges" in (m.get("loyer") or ""),
                            m.get("lien"), m.get("efface"), m.get("resume") == 4, m.get("encadre"),
                            m.get("equivalent"), m.get("reprise") == "226000"))
                        controle("repères de marché : recherche, prix, loyer, lien, effacement, résumé, "
                                 "encadrement, équivalent charges comprises, valeur reprise",
                                 etat == "111111111" and not m.get("erreurs"),
                                 etat + (" · " + m["erreurs"][0] if m.get("erreurs") else ""))
                    attendu = {
                        "micro-foncier": ("fAbattement", False),
                        "reel-foncier": ("fPlafondDeficit", True),
                        "lmnp-micro": ("fAbattement,fCfe,fMobilier", False),
                        "lmnp-reel": ("fAmortBati,fAmortMob,fAmortTvx,fCfe,fMobilier,fPartBati", False),
                    }
                    vus = r.get("conditionnement") or {}
                    ecarts = [rg for rg, (champs, deduc) in attendu.items()
                              if vus.get(rg, {}).get("champs") != champs
                              or vus.get(rg, {}).get("deduc") != deduc]
                    controle("chaque régime n'expose que ses champs", not ecarts,
                             ", ".join(ecarts) or "4 régimes vérifiés")
                    # Une explication vidée de son texte est pire qu'absente :
                    # le bouton reste, et ne dit plus rien.
                    controle("chaque infobulle porte une explication",
                             r.get("bulles", 0) >= 25 and not r.get("bullesVides"),
                             "%s bouton(s), %s sans texte" % (r.get("bulles"), r.get("bullesVides")))
                    # « s'ouvre au focus », « tient dans l'écran », « Échap referme »
                    controle("infobulle pilotable au clavier et bornée à l'écran",
                             r.get("bulleClavier") == "111",
                             r.get("bulleClavier") or "sonde muette")
                    # Le budget de texte : sans lui, les paragraphes reviendraient
                    # un par un sous chaque graphique.
                    controle("descriptions courtes sous chaque titre",
                             not r.get("tropLong"), (r.get("tropLong") or "")[:60])
                    # Replié ne veut pas dire absent : les huit graphiques sont
                    # tracés, comptés et atteignables, ouverts ou non.
                    controle("analyse et tableau repliés à l'ouverture",
                             r.get("replie") == "analyse,detail", r.get("replie") or "aucun")
                    controle("mode Essentiel : quatorze réglages décisifs",
                             r.get("champsEssentiel") == 14
                             and (r.get("champsTout") or 0) > 20,
                             "%s champs, %s en mode complet"
                             % (r.get("champsEssentiel"), r.get("champsTout")))
                    controle("renvois vers les pages annexes",
                             r["liens"] >= 3, "%d liens" % r["liens"])
                    controle("avis éditorial affiché", bool(r.get("avis")),
                             (r.get("avis") or "absent")[:38])
                    controle("curseur de cascade borné par l'horizon",
                             r.get("cascMax") == "25", "max=%s" % r.get("cascMax"))
                    controle("le curseur ne change que la cascade",
                             bool(r.get("cascAn1")) and r.get("cascAn1") != r.get("cascHorizon")
                             and r.get("triStable"),
                             "%s → %s" % (r.get("cascHorizon"), r.get("cascAn1")))
                    controle("tableau annuel rempli", r["lignes"] >= 10, "%d lignes" % r["lignes"])
                    controle("rendement calculé", "%" in r["tri"], r["tri"])
            # Les six guides, pas un seul : l'erreur de contenu trouvée à l'audit
            # vivait précisément dans celui qui n'était jamais chargé.
            fiches = sorted(f.parent.name for f in (SITE / "guides").glob("*/index.html"))
            for chemin in ["/guides/"] + ["/guides/%s/" % f for f in fiches] + \
                          ["/questions-frequentes/", "/hypotheses-de-calcul/", "/mentions-legales/"]:
                fichier = fichier_pour(chemin)
                for largeur in (1360, 390):
                    r = sonde_navigateur(chrome, base, fichier, largeur) if fichier else None
                    controle("%s %d px : propre" % (chemin, largeur),
                             r is not None and not r["erreurs"] and not r["deborde"],
                             "" if r else "aucune réponse")
    finally:
        serveur.shutdown()

    jsc = premier_existant(JSC)
    if not jsc:
        print("\nMOTEUR FINANCIER : JavaScriptCore introuvable, contrôles ignorés")
    else:
        print("\nMOTEUR FINANCIER")
        # src/moteur.js ne touche pas au document : il s'exécute tel quel, sans
        # découpe ni bouchon. C'est ce qui rend le contrôle « aucun accès au
        # document » ci-dessus vérifiable plutôt que promis en commentaire.
        moteur = (SRC / "moteur.js").read_text(encoding="utf-8")
        essai = RACINE / "outils" / "__moteur.js"
        # jsc expose print() ; node non. Le harnais s'écrit une fois pour les deux.
        # Les chiffres que les pages attribuent au « scénario par défaut » se
        # vérifient sur les vraies valeurs d'ouverture, relues dans index.html ;
        # base() ci-dessous est un scénario de test figé, qui ne les suit pas.
        essai.write_text('if(typeof print==="undefined"){ var print = console.log; }\n' + moteur
                         + "\nvar DEFAUTS_SITE = %s;\n" % json.dumps(defauts)
                         + "var INITIALES = %s;\n" % json.dumps(initiales_delicates()) + """
function base(){ return {prix:200000,notairePct:8,fraisAcq:0,mobilier:8000,apport:35000,
 duree:20,taux:3.4,assur:0.34,fraisDossier:2500,loyer:900,vacance:5,copro:60,tf:1200,pno:180,
 gestion:0,entretien:5,ps:18.6,psPV:17.2,cfe:400,abattement:50,plafondDeficit:10700,partBati:85,
 amortBatiAns:30,amortTvxAns:15,amortMobAns:7,horizon:25,inflation:2,indexPrix:2,indexLoyer:2,
 indexCharges:2,fraisVente:5,bourse:4,fondsEuros:0,livretA:-0.3,fiscBourse:31.4,fiscFonds:30,
 regime:'lmnp-reel',tmi:30,ira:true,items:[{nom:'R',montant:20000,taux:5,duree:20,deduc:100}]}; }
// Le scenario d'ouverture du site, comme la vitrine le rejoue : prix, loyers et
// charges suivent l'inflation tant que la case est cochee.
function site(o){ var p=Object.assign({}, DEFAUTS_SITE, {items:TVX_DEFAUT.map(function(t){ return Object.assign({}, t); })});
 p.indexPrix=p.indexLoyer=p.indexCharges=p.inflation; for(var k in o) p[k]=o[k];
 p.travaux=p.items.reduce(function(s,i){return s+i.montant;},0); return compute(p); }
function run(o){ var p=base(); for(var k in o) p[k]=o[k];
 p.travaux=p.items.reduce(function(s,i){return s+i.montant;},0); return compute(p); }
var lignes=[];
// Le TRI et le graphique de gain doivent dire la meme chose : si le taux boursier
// egale le TRI et qu'aucun impot ne frappe le portefeuille, les deux courbes se
// rejoignent exactement a l'horizon.
['lmnp-reel','reel-foncier','micro-foncier','lmnp-micro'].forEach(function(rg){
  var b=run({regime:rg});
  var reel=((1+b.final.tri)/1.02-1)*100;
  var x=run({regime:rg, bourse:reel, fiscBourse:0});
  lignes.push('coherence TRI/graphique '+rg+'|'+(Math.abs(x.final.gainImmo-x.final.gainBourse)<1?1:0)
    +'|ecart '+(x.final.gainImmo-x.final.gainBourse).toFixed(2)+' EUR');
});
// Sans impot, le TRI du portefeuille boursier est exactement son taux nominal.
var s0=run({fiscBourse:0}), s30=run({fiscBourse:31.4});
lignes.push('TRI bourse sans impot = taux nominal|'+(Math.abs(s0.final.triBourse-0.0608)<1e-4?1:0)+'|'+(s0.final.triBourse*100).toFixed(3)+' %');
lignes.push('impot des placements reduit leur gain|'+(s30.final.gainBourse<s0.final.gainBourse && s30.final.gainFonds<=s0.final.gainFonds?1:0)+'|');
// Les frais d'agence du vendeur minorent le prix de cession.
var f0=run({fraisVente:0}), f5=run({fraisVente:5});
lignes.push('frais de vente reduisent l impot de plus-value|'+(f5.final.impotPV<f0.final.impotPV?1:0)+'|'+f0.final.impotPV.toFixed(0)+' -> '+f5.final.impotPV.toFixed(0));
// Le mobilier n'entre pas dans la plus-value : l'ajouter ne peut pas l'alourdir.
lignes.push('mobilier sans effet aggravant sur la plus-value|'+(run({mobilier:5000}).final.impotPV<=run({mobilier:0}).final.impotPV+0.01?1:0)+'|');
// Deficit BIC reporte : sans amortissement, l'impot de l'an 2 se calcule sur base2 + min(0, base1).
var d=run({partBati:0,amortTvxAns:0,amortMobAns:0,taux:9,loyer:1300,indexLoyer:100});
var r1=d.rows[0], r2=d.rows[1];
var b1=r1.loyers-r1.charges-r1.interets-r1.assurance, b2=r2.loyers-r2.charges-r2.interets-r2.assurance;
var attendu=Math.max(0,b2+Math.min(0,b1))*0.486;
lignes.push('deficit BIC reporte sur l annee suivante|'+(b1<0 && b2>0 && Math.abs(r2.impot-attendu)<1?1:0)+'|'+r2.impot.toFixed(0)+' vs '+attendu.toFixed(0)+' EUR');
// La cascade du gain est une identite comptable exacte.
var c=run({}), f=c.final;
// Neuf marches : frais d'acquisition (sans le mobilier), travaux et mobilier,
// puis revalorisation. Le mobilier a change de colonne, pas de signe.
var fraisAcq=c.notaire+c.p.fraisAcq+c.p.fraisDossier;
var equipement=c.p.travaux+c.mobilier;
var somme=f.cumulLoyers-f.cumulCharges-f.cumulCredit-f.cumulImpot-fraisAcq-equipement
  +(f.valeur-c.p.prix)-(f.fraisVente+f.ira)-(f.impotPV+f.repriseDF);
lignes.push('cascade du gain : somme des marches = gain|'+(Math.abs(somme-f.gain)<1?1:0)+'|ecart '+(somme-f.gain).toFixed(2)+' EUR');
lignes.push('CFE exoneree la premiere annee|'
  +(Math.abs(run({}).rows[0].charges-run({cfe:0}).rows[0].charges)<0.01?1:0)+'|');
lignes.push('CFE neutralisee en location nue|'
  +(Math.abs(run({regime:'reel-foncier',cfe:400}).final.tri-run({regime:'reel-foncier',cfe:0}).final.tri)<1e-9?1:0)+'|');
// Le mobilier est masque en location nue : il ne doit pas gonfler le cout de l'operation.
lignes.push('mobilier neutralise en location nue|'
  +(Math.abs(run({regime:'reel-foncier',mobilier:8000}).final.tri-run({regime:'reel-foncier',mobilier:0}).final.tri)<1e-9?1:0)+'|');
lignes.push('mobilier compte en meuble|'
  +(Math.abs(run({mobilier:8000}).final.tri-run({mobilier:0}).final.tri)>1e-6?1:0)+'|');
// Sans apport, la mise est l'effort d'epargne : le TRI existe, et il prolonge
// continument celui d'un apport minime.
var a0 = run({apport:0}).final.tri, a100 = run({apport:100}).final.tri;
lignes.push('apport nul : TRI sur l effort d epargne|'+(a0!==null && Math.abs(a0-a100)<1e-3?1:0)+'|'
  +(a0===null?'non calculable':(a0*100).toFixed(2)+' %'));
// Si rien ne sort jamais de la poche, il n'y a pas de rendement — ni a
// l'horizon, ni a une annee de revente ou l'argent commencerait par rentrer.
var auto = run({apport:0, loyer:3000});
lignes.push('autofinance sans mise : TRI non calculable, chaque annee|'
  +(auto.rows.every(function(r){ return r.tri===null; }) && auto.best===null?1:0)+'|');
// Comptabilite : une charge du seul LMNP au reel, deductible.
var c0 = run({}), c5 = run({compta:500});
lignes.push('comptabilite comptee au LMNP reel|'
  +(Math.abs(c5.rows[0].charges-c0.rows[0].charges-500)<0.01 && c5.final.tri<c0.final.tri?1:0)
  +'|'+(c0.final.tri*100).toFixed(2)+' -> '+(c5.final.tri*100).toFixed(2)+' %');
lignes.push('comptabilite neutre hors LMNP reel|'
  +(['micro-foncier','reel-foncier','lmnp-micro'].every(function(rg){
     return run({regime:rg, compta:500}).final.tri===run({regime:rg}).final.tri; })?1:0)+'|');
// La tranche entre dans la sensibilite quand elle pese, en sort quand l'impot
// est nul, et ne bouge que d'un cote au bout du bareme.
var mf = {regime:'micro-foncier', ps:17.2, cfe:0, abattement:30};
var tr = function(o){ var R=run(o); return sensibilite(R.p, R.final.tri).filter(function(s){ return s.nom==="Tranche d'imposition"; })[0]; };
var t30 = tr(mf), t45 = tr(Object.assign({}, mf, {tmi:45})), tl = tr({});
lignes.push('sensibilite : tranche d imposition|'
  +(t30 && t30.lo<0 && t30.hi>0 && t45 && Math.min(Math.abs(t45.lo),Math.abs(t45.hi))<1e-12 && !tl?1:0)+'|'
  +(t30?pts(t30.lo)+' / '+pts(t30.hi):'absente'));
// Seuils : a la valeur trouvee, le projet egale la bourse a moins d'un
// centieme de point pres ; et le prix maximal est sous le prix saisi quand la
// bourse est devant. Scenario d'ouverture, bien detenu et achat comptant.
var ecartsSeuils = [];
[{}, {situation:'detenu', valeur:200000, crd:90000, depuis:8, prixAchat:160000, dureeRestante:12, travauxPasses:0}, {comptant:true}]
 .forEach(function(o){
  var ps = site(o).p;
  seuils(ps).forEach(function(sl){
    if(sl.valeur === null) return;
    var q = {}; for(var k in ps) q[k] = ps[k]; q[sl.k] = sl.valeur;
    var fq = compute(q).final;
    if(Math.abs(fq.tri - fq.triBourse) > 1e-4) ecartsSeuils.push(sl.k+' '+((fq.tri-fq.triBourse)*100).toFixed(3)+' pt');
  });
});
var sp = seuils(site({}).p);
lignes.push('seuils : a la valeur trouvee, le projet egale la bourse|'
  +(ecartsSeuils.length===0 && sp.length===5 && sp[0].k==='prix' && (sp[0].valeur < sp[0].actuel) === !sp[0].devant?1:0)
  +'|'+(ecartsSeuils[0] || 'prix max '+Math.round(sp[0].valeur)+' EUR'));
// Un projet qui s'autofinance sans mise n'a pas de TRI : pour la recherche des
// seuils, il est infiniment devant la bourse, pas « non comparable ».
var autoS = site({apport:0, loyer:3000});
lignes.push('seuils : sans mise, le projet compte comme devant la bourse|'
  +(autoS.final.tri===null && ecartBourse(autoS.p)===1?1:0)+'|');
// Initiales : la page range une commune sous la meme lettre que l'import.
var desaccords = INITIALES.filter(function(x){ return initiale(x[0]) !== x[1]; });
lignes.push('donnees : la page et l import rangent chaque commune sous la meme initiale|'
  +(INITIALES.length > 1000 && desaccords.length===0?1:0)+'|'+(desaccords[0] ? desaccords[0].join(' -> ') : INITIALES.length+' noms delicats'));
// Recherche de communes : chaque mot ouvre un mot du nom, le nom qui commence
// par la saisie d'abord, puis la plus active.
var L = [['69383','Lyon 3e Arrondissement',2671],['69387','Lyon 7e Arrondissement',2447],['27377','Lyons-la-Forêt',5],
         ['93066','Saint-Denis',900],['97411','Saint-Denis',1200],['14650','Œuilly',3]];
var r1 = chercherCommunes(L,'lyon 3',8), r2 = chercherCommunes(L,'st denis',8), r3 = chercherCommunes(L,'Lyons',8), r4 = chercherCommunes(L,'oeuil',8);
lignes.push('recherche de communes : mots, saint, ligatures, activite|'
  +(r1.length===1 && r1[0][0]==='69383' && r2.length===2 && r2[0][0]==='97411' && r3.length===1 && r4.length===1
    && chercherCommunes(L,'',8).length===0?1:0)+'|');
// Reperes : la commune, sauf trop peu de ventes (departement) ; le loyer d'annonce
// suit la surface ; les valeurs saisies sont ramenees au m².
var M = {c:{'11111':{n:'Ville',pa:[3000,120],pm:[2500,4],la:[12,9,15,50],l12:[14,11,18,30],l3:[11,8,14,20],lm:[10,7,13,0]}},
         d:{pa:[2800,900],pm:[2200,700]}};
var ra = reperesMarche(M,'11111',{prix:150000,loyer:600,surface:50,typeBien:'appartement'});
var rs = reperesMarche(M,'11111',{prix:100000,loyer:500,surface:30,typeBien:'appartement'});
var rm = reperesMarche(M,'11111',{prix:200000,loyer:900,surface:100,typeBien:'maison'});
var rd = reperesMarche(M,'11111',{situation:'detenu',valeur:120000,prix:1,loyer:500,surface:40,typeBien:'appartement'});
lignes.push('reperes de marche : commune ou departement, loyer selon la surface|'
  +(ra.prix.saisi===3000 && ra.prix.echelle==='commune' && ra.loyer.cle==='la' && ra.loyer.saisi===12
    && rs.loyer.cle==='l12' && rm.prix.echelle==='departement' && rm.prix.marche===2200 && rm.loyer.cle==='lm'
    && rd.prix.saisi===3000 && reperesMarche(M,'22222',{})===null
    && reperesMarche(M,'11111',{prix:1,loyer:1,surface:0}).prix.saisi===null?1:0)+'|');
// Contexte local : zonage, tension, encadrement, et tendance des prix du
// departement en taux annuel compose.
var Mc = {c:{'11111':{n:'Ville', pa:[3000,120], z:'A', t:1, e:2}}, d:{pa:[2800,900], ev:{pa:[2000,1800,2021,2025]}}};
var cx = reperesMarche(Mc,'11111',{prix:1,loyer:1,surface:50}).contexte;
var tauxAttendu = Math.pow(0.9, 1/4) - 1;
lignes.push('reperes de marche : zonage, tension, encadrement, tendance annuelle|'
  +(cx.zone==='A' && cx.tension===1 && cx.encadre===2 && Math.abs(cx.tendance.taux-tauxAttendu)<1e-12
    && reperesMarche({c:{'1':{n:'X'}}, d:{}},'1',{}).contexte.tendance===null?1:0)+'|'+(cx.tendance.taux*100).toFixed(2)+' %/an');
// Frais de dossier au reel : deduits l'annee 1, a emprunt egal (l'apport les
// absorbe), sur un scenario sans amortissement ni travaux ou la base est
// positive. L'impot de l'annee 1 baisse alors exactement de frais x (TMI + PS).
var fdAvec = {partBati:0, mobilier:0, loyer:2000, items:[], fraisDossier:2500, apport:37500};
var fdSans = {partBati:0, mobilier:0, loyer:2000, items:[], fraisDossier:0, apport:35000};
var ecartFd = function(o){ var a=run(Object.assign({}, fdSans, o)), b=run(Object.assign({}, fdAvec, o));
  return a.rows[0].impot - b.rows[0].impot; };
var eLmnp = ecartFd({}), eFoncier = ecartFd({regime:'reel-foncier', ps:17.2, cfe:0}), eMicro = ecartFd({regime:'micro-foncier', ps:17.2, cfe:0, abattement:30});
lignes.push('frais de dossier deduits l annee 1 au reel, pas au micro|'
  +(Math.abs(eLmnp-2500*0.486)<0.01 && Math.abs(eFoncier-2500*0.472)<0.01 && Math.abs(eMicro)<1e-9?1:0)
  +'|'+eLmnp.toFixed(0)+' et '+eFoncier.toFixed(0)+' EUR');
// Capacite d'emprunt : ratio du HCSF, loyer retenu a 70 %. Reponse connue, puis
// l'emprunt maximal doit tomber exactement sur 35 %.
var ce = run({revenus:4000, credits:300}), E1 = endettement(ce.p, ce);
var attenduTaux = (300 + ce.mensualite)/(4000 + 0.7*900);
var pMax = run({revenus:4000, credits:300, apport: ce.besoin - E1.empruntMax}), E2 = endettement(pMax.p, pMax);
lignes.push('capacite d emprunt : ratio HCSF, emprunt maximal a 35 %|'
  +(Math.abs(E1.taux-attenduTaux)<1e-12 && Math.abs(E2.taux-0.35)<1e-9 && endettement(run({}).p, run({}))===null?1:0)
  +'|'+(E1.taux*100).toFixed(1)+' %, max '+E1.empruntMax.toFixed(0)+' EUR');
// DPE F ou G : le loyer ne bouge plus d'une annee a l'autre ; les autres classes
// suivent l'indexation, comme sans DPE renseigne.
var gG = run({dpe:'G'}), gD = run({dpe:'D'}), gN = run({});
lignes.push('DPE F ou G : loyers geles, autres classes indexees|'
  +(gG.rows.every(function(r){ return Math.abs(r.loyers-gG.rows[0].loyers)<1e-6; })
    && run({dpe:'F'}).final.tri===gG.final.tri && gD.final.tri===gN.final.tri && gN.rows[1].loyers>gN.rows[0].loyers?1:0)+'|');
// Les ordres de grandeur que la page d'hypotheses publie dans ses limites.
var ref = site({}).final.tri;
var gel = ref - site({dpe:'G'}).final.tri;
lignes.push('limites : geler les loyers coute pres de deux points|'+(gel>0.015 && gel<0.025?1:0)+'|'+(gel*100).toFixed(2)+' pt');
var tmiEcart = site(Object.assign({}, mf, {tmi:11})).final.tri - site(Object.assign({}, mf, {tmi:41})).final.tri;
lignes.push('limites : tranche 11 -> 41 en micro-foncier, plus d un point et demi|'+(tmiEcart>0.015?1:0)+'|'+(tmiEcart*100).toFixed(2)+' pt');
var rm = site({}), cfm = rm.rows.map(function(r){ return r.cfNet; });
cfm[0] -= rm.p.loyer*6;
var tri6 = irr([-rm.cash0].concat(cfm.slice(0,-1)).concat([cfm[cfm.length-1]+rm.final.netVente]));
lignes.push('limites : six mois sans loyer = deux a trois points de vacance|'
  +(tri6<=site({vacance:rm.p.vacance+2}).final.tri && tri6>=site({vacance:rm.p.vacance+3}).final.tri?1:0)+'|'+(tri6*100).toFixed(2)+' %');
lignes.push('duree amortissement nulle sans plantage|'+(isFinite(run({amortBatiAns:0}).final.tri)?1:0)+'|');
lignes.push('horizon 1 an sans plantage|'+(isFinite(run({horizon:1}).final.tri)?1:0)+'|');
lignes.push('champs fiscaux absents toleres|'+(isFinite(run({fiscBourse:undefined,fiscFonds:undefined}).final.gainBourse)?1:0)+'|');
// Affichage brut : aucun impot nulle part, charges et credit inchanges. L'ecart
// entre les deux affichages doit etre l'impot, et rien d'autre.
['lmnp-reel','reel-foncier','micro-foncier','lmnp-micro'].forEach(function(rg){
  var n=run({regime:rg}), b=run({regime:rg, avantImpot:true});
  var nul=b.rows.every(function(x){ return x.impot===0 && x.impotPV===0 && x.repriseDF===0; });
  var memes=b.rows.every(function(x,i){ return Math.abs(x.charges-n.rows[i].charges)<1e-9
    && Math.abs(x.annuite-n.rows[i].annuite)<1e-9 && Math.abs(x.valeur-n.rows[i].valeur)<1e-9; });
  lignes.push('brut '+rg+' : aucun impot, charges et credit inchanges|'+(nul&&memes?1:0)+'|');
});
var bb=run({avantImpot:true}), b0=run({fiscBourse:0, fiscFonds:0});
lignes.push('brut : placements compares avant impot|'
  +(Math.abs(bb.final.gainBourse-b0.final.gainBourse)<1e-6 && Math.abs(bb.final.gainFonds-b0.final.gainFonds)<1e-6?1:0)+'|');
// La cascade brute n'a plus de marches d'impot : sa somme doit rester le gain.
var fb=bb.final, sommeBrute=fb.cumulLoyers-fb.cumulCharges-fb.cumulCredit
  -(bb.notaire+bb.p.fraisAcq+bb.p.fraisDossier)-(bb.p.travaux+bb.mobilier)
  +(fb.valeur-bb.p.prix)-(fb.fraisVente+fb.ira);
lignes.push('brut : cascade sans marches d impot = gain|'+(Math.abs(sommeBrute-fb.gain)<1?1:0)+'|ecart '+(sommeBrute-fb.gain).toFixed(2)+' EUR');
// Le lien partage porte chaque hypothese, meme egale a sa valeur d'ouverture, et
// ses travaux meme vides : il ne depend plus des valeurs par defaut du site.
var lp = lienHypotheses({prix:'200000', ira:true}, null, [], true);
lignes.push('lien partage : tout voyage, marqueur compris|'+(lp === '#complet=1&prix=200000&ira=1&tvx=' ?1:0)+'|'+lp);
// Surtaxe de plus-value (art. 1609 nonies G) : chaque palier s'ouvre par une
// bande de 10 000 EUR ou une decote lisse la marche. Sans elle, le code
// surestimait de 79 % juste au-dessus de 50 000 EUR.
var attenduSurtaxe = [[50000,0],[51000,570],[60000,1200],[61000,1220],[100000,2000],
  [105000,2650],[110000,3300],[155000,5450],[160000,6400],[205000,9250],[210000,10500],
  [255000,14050],[260000,15600],[300000,18000]];
var ecarts = attenduSurtaxe.filter(function(c){ return Math.abs(surtaxePV(c[0])-c[1])>0.01; });
lignes.push('surtaxe de plus-value : table legale|'+(ecarts.length===0?1:0)+'|'
  + (ecarts.length ? ecarts[0][0]+' EUR -> '+surtaxePV(ecarts[0][0]).toFixed(0)+' au lieu de '+ecarts[0][1] : '14 points verifies'));
// Et elle reste croissante : une decote mal posee creerait une inversion.
var inverse = 0;
for(var b=45000; b<=270000; b+=250) if(surtaxePV(b+250) < surtaxePV(b) - 1e-9) inverse++;
lignes.push('surtaxe de plus-value : croissante|'+(inverse===0?1:0)+'|'+inverse+' inversion(s)');
// Aucun cout d'acquisition : les rentabilites rapportees au cout divisent par zero.
var z = run({prix:0, notairePct:0, fraisAcq:0, fraisDossier:0, mobilier:0, apport:0,
  items:[{nom:'R',montant:0,taux:0,duree:0,deduc:0}]});
var fini = [z.brute,z.bruteCout,z.nette,z.netteNette].every(isFinite);
lignes.push('cout d acquisition nul : aucune division par zero|'+(fini?1:0)+'|'
  +[z.brute,z.bruteCout,z.nette,z.netteNette].join(' '));
// Duree de pret nulle : sans garde, le capital restait du pour toujours, jamais
// amorti ni facture, mais retranche du prix de vente a chaque annee.
var d0 = run({duree:0});
lignes.push('duree de pret nulle : aucune dette fantome|'
  +(d0.rows[d0.rows.length-1].crd < 0.01 && isFinite(d0.final.gain)?1:0)+'|CRD final '
  +d0.rows[d0.rows.length-1].crd.toFixed(0)+' EUR');
// Deficit foncier : la part hors interets s'impute sur le revenu global dans la
// limite du plafond, le reste est reporte. Teste ici sur le regime reel foncier,
// dont la mecanique differe entierement du deficit BIC verifie plus haut.
var df = run({regime:'reel-foncier', ps:17.2, cfe:0, loyer:200, indexLoyer:0,
  items:[{nom:'R',montant:60000,taux:0,duree:30,deduc:100}]});
// 60 000 EUR de travaux face a 2 400 EUR de loyers : le deficit imputable
// depasse largement le plafond, l'economie de l'annee 1 vaut donc exactement
// plafond x TMI, et doubler le plafond doit la doubler.
var e1 = -df.rows[0].impot;
var df2 = run({regime:'reel-foncier', ps:17.2, cfe:0, loyer:200, indexLoyer:0, plafondDeficit:21400,
  items:[{nom:'R',montant:60000,taux:0,duree:30,deduc:100}]});
var e2 = -df2.rows[0].impot;
lignes.push('deficit foncier plafonne a 10 700 EUR|'
  +(Math.abs(e1 - 10700*0.30) < 1 && Math.abs(e2 - 21400*0.30) < 1 ? 1:0)
  +'|economie '+e1.toFixed(0)+' EUR, puis '+e2.toFixed(0)+' EUR a 21 400 EUR de plafond');
// Le surplus non impute doit reapparaitre plus tard, pas disparaitre.
var sansDeficit = run({regime:'reel-foncier', ps:17.2, cfe:0, loyer:200, indexLoyer:0,
  items:[{nom:'R',montant:0,taux:0,duree:30,deduc:100}]});
var cumulAvec = df.rows.reduce(function(s,r){ return s+r.impot; }, 0);
var cumulSans = sansDeficit.rows.reduce(function(s,r){ return s+r.impot; }, 0);
lignes.push('deficit foncier reporte sur les annees suivantes|'+(cumulAvec < cumulSans - 1?1:0)
  +'|impot cumule '+cumulAvec.toFixed(0)+' vs '+cumulSans.toFixed(0)+' EUR');
// Achat comptant : aucun emprunt, la mise est tout le cout, et les frais de
// dossier d'un pret qui n'existe pas ne pesent pas.
var cc = run({comptant:true});
lignes.push('achat comptant : aucun emprunt, mise = cout total|'
  +(cc.emprunt===0 && Math.abs(cc.cash0-cc.besoin)<0.01 && cc.rows.every(function(x){ return x.annuite===0; })?1:0)
  +'|mise '+cc.cash0.toFixed(0)+' EUR');
lignes.push('achat comptant : frais de dossier sans effet|'
  +(Math.abs(run({comptant:true, fraisDossier:99999}).final.tri-cc.final.tri)<1e-12?1:0)+'|');
// Bien detenu : vendre aujourd'hui doit rendre exactement ce que la calculatrice
// d'achat annonce comme net si revente a la meme date — memes frais (7,5 %),
// meme credit, meme duree de detention. Regime micro-foncier : sans
// amortissement, l'invariant est exact.
var nu = {regime:'micro-foncier', ps:17.2, cfe:0, abattement:30, notairePct:7.5, items:[]};
var A = run(nu), ecartsDetenu = [];
[1, 5, 8, 12, 19].forEach(function(k){
  var r = A.rows[k-1];
  var D = run(Object.assign({}, nu, {situation:'detenu', valeur:r.valeur, crd:r.crd, depuis:k,
    prixAchat:200000, dureeRestante:20-k, travauxPasses:0}));
  if(Math.abs(D.net0 - r.netVente) > 1) ecartsDetenu.push(k+' : '+D.net0.toFixed(0)+' vs '+r.netVente.toFixed(0));
});
lignes.push('bien detenu : vendre aujourd hui = net si revente du scenario d achat|'
  +(ecartsDetenu.length===0?1:0)+'|'+(ecartsDetenu[0] || '5 annees verifiees'));
// La cascade d'un bien detenu : sans frais d'acquisition, frais de revente et
// impot de plus-value comptes en plus de ceux d'une vente aujourd'hui.
var Dd = run({situation:'detenu', valeur:200000, crd:90000, depuis:8, prixAchat:160000, dureeRestante:12, travauxPasses:0});
var fd = Dd.final, v0 = Dd.vente0;
var sommeDetenu = fd.cumulLoyers-fd.cumulCharges-fd.cumulCredit-fd.cumulImpot-Dd.p.travaux+fd.revalorisation
  -(fd.fraisVente+fd.ira-v0.fraisVente-v0.ira)-(fd.impotPV+fd.repriseDF-v0.impotPV);
lignes.push('bien detenu : cascade = gain|'+(Math.abs(sommeDetenu-fd.gain)<1?1:0)+'|ecart '+(sommeDetenu-fd.gain).toFixed(2)+' EUR');
lignes.push('bien detenu : mise = net de la vente + travaux|'
  +(Math.abs(Dd.cash0-(Dd.net0+Dd.p.travaux))<0.01 && Dd.net0>0 && isFinite(fd.tri)?1:0)+'|'+Dd.net0.toFixed(0)+' EUR');
lignes.push('bien detenu : 30 ans de detention, plus-value exoneree|'
  +(run({situation:'detenu', valeur:300000, crd:0, depuis:30, prixAchat:100000, dureeRestante:0}).final.impotPV===0?1:0)+'|');
lignes.push('bien detenu : sans credit, ni mensualite ni dette|'
  +(function(){ var z = run({situation:'detenu', valeur:200000, crd:0, depuis:3, prixAchat:180000, dureeRestante:0});
    return isFinite(z.final.tri) && z.rows.every(function(x){ return x.annuite===0 && x.crd===0; }) ? 1 : 0; })()+'|');
lignes.push('bien detenu : comptant l emporte sur le capital restant du|'
  +(run({situation:'detenu', comptant:true, valeur:200000, crd:90000, depuis:3, prixAchat:180000, dureeRestante:10}).emprunt===0?1:0)+'|');
// Bien detenu : des cas dont la reponse est connue d'avance. Sans loyer, sans
// impot, sans frais et sans dette, garder ne rapporte rien ; avec la seule
// revalorisation, le rendement est exactement cette revalorisation ; avec les
// seuls loyers, exactement le loyer rapporte a la valeur.
var rien = {situation:'detenu', regime:'micro-foncier', ps:17.2, cfe:0, abattement:30, valeur:200000,
  prixAchat:160000, depuis:8, travauxPasses:0, loyer:0, copro:0, tf:0, pno:0, entretien:0, vacance:0,
  indexPrix:0, indexLoyer:0, crd:0, dureeRestante:0, avantImpot:true, fraisVente:0, ira:false, items:[]};
var tousA = function(R, cible){ return R.rows.every(function(r){ return r.tri !== null && Math.abs(r.tri - cible) < 1e-9; }); };
lignes.push('bien detenu : rien ne bouge, rendement nul|'+(tousA(run(rien), 0)?1:0)+'|');
lignes.push('bien detenu : seule la revalorisation, rendement = revalorisation|'
  +(tousA(run(Object.assign({}, rien, {indexPrix:2.5})), 0.025)?1:0)+'|');
lignes.push('bien detenu : seuls les loyers, rendement = loyer / valeur|'
  +(tousA(run(Object.assign({}, rien, {loyer:500})), 0.03)?1:0)+'|');
lignes.push('bien detenu : frais de vente deja dans la mise, sans effet sur le rendement|'
  +(tousA(run(Object.assign({}, rien, {indexPrix:2.5, fraisVente:5})), 0.025)?1:0)+'|');
var lev = run(Object.assign({}, rien, {indexPrix:5, crd:100000, dureeRestante:25, assur:0}));
lignes.push('bien detenu : dette a 3,4 % sur un bien a 5 %, levier positif et decroissant|'
  +(lev.rows[0].tri > 0.05 && lev.rows.every(function(r,i){ return i===0 || r.tri <= lev.rows[i-1].tri + 1e-9; })?1:0)
  +'|'+(lev.rows[0].tri*100).toFixed(2)+' % puis '+(lev.final.tri*100).toFixed(2)+' %');
var z0 = run({situation:'detenu', valeur:200000, crd:90000, depuis:8, prixAchat:160000, dureeRestante:0, travauxPasses:0, items:[]});
lignes.push('bien detenu : 0 an restant mais capital du, la dette est remboursee|'
  +(z0.rows[0].annuite > 90000 && z0.rows[0].crd < 0.01?1:0)+'|annuite '+z0.rows[0].annuite.toFixed(0)+' EUR');
// Les quatre regimes se comparent aussi dans le temps : une serie par regime,
// aussi longue que l'horizon, dont le dernier point est le rendement a l'horizon.
var cmp = comparerRegimes(base(), run({}));
lignes.push('comparatif des regimes : une courbe par regime|'
  +(cmp.length===4 && cmp.every(function(c){ return c.tris.length===25 && c.tris[24]===c.tri; })?1:0)+'|');
print(lignes.join('\\n'));
""", encoding="utf-8")
        try:
            sortie = subprocess.run([jsc, str(essai)], capture_output=True,
                                    text=True, timeout=90)
            if sortie.returncode != 0:
                message = (sortie.stderr.strip() or sortie.stdout.strip())
                controle("moteur exécutable", False,
                         message.splitlines()[0][:70] if message else "échec")
            else:
                for ligne in sortie.stdout.strip().splitlines():
                    parts = ligne.split("|")
                    if len(parts) == 3:
                        controle(parts[0], parts[1] == "1", parts[2])
        finally:
            essai.unlink(missing_ok=True)

    rates = resultats.count(False)
    print("\n%d contrôles, %d échec(s)" % (len(resultats), rates))
    return 1 if rates else 0


if __name__ == "__main__":
    sys.exit(main())
