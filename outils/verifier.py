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

import http.server
import json
import pathlib
import re
import socket
import socketserver
import subprocess
import sys
import threading
import urllib.error
import urllib.request

RACINE = pathlib.Path(__file__).parent.parent
SITE = RACINE / "site"
CHROME = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/usr/bin/google-chrome", "/usr/bin/chromium")
JSC = ("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc",)
DOMAINE = "https://monrendementlocatif.fr"

resultats = []


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


def premier_existant(chemins):
    return next((c for c in chemins if pathlib.Path(c).exists()), None)


def servir():
    """Sert site/ sur un port libre, dans un thread de fond."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    classe = type("Handler", (http.server.SimpleHTTPRequestHandler,),
                  {"__init__": lambda self, *a, **k:
                   http.server.SimpleHTTPRequestHandler.__init__(
                       self, *a, directory=str(SITE), **k),
                   "log_message": lambda *a: None})
    serveur = socketserver.ThreadingTCPServer(("127.0.0.1", port), classe)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    return serveur, "http://127.0.0.1:%d" % port


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
  r.tuiles    = document.querySelectorAll(".tile").length;
  // Un SVG n'annonce que son titre : chaque graphique doit doubler ses valeurs
  // d'un tableau hors ecran, et rester atteignable au clavier.
  r.equiv     = document.querySelectorAll(".plot table.visually-hidden").length;
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
  var av = document.getElementById("vAvisBox");
  r.vAvis = av && !av.hidden ? (document.getElementById("vAvis").textContent || "").slice(0, 40) : "";
  r.graphes   = document.querySelectorAll(".plot svg").length;
  r.courbes   = document.querySelectorAll("#plotNet path[stroke]").length;
  r.regimes   = document.querySelectorAll("#plotReg svg path").length;
  r.sens      = document.querySelectorAll("#plotSens svg rect").length;
  r.liens     = document.querySelectorAll("#suite a").length;
  var boite = document.getElementById("avisBox");
  r.avis = boite && !boite.hidden ? (document.getElementById("avisText").textContent || "").slice(0, 40) : "";
  // Le curseur de la cascade ne doit redessiner que sa section : on note le total
  // a l'horizon, puis a la premiere annee, et on verifie que le verdict ne bouge pas.
  var curseur = document.getElementById("cascAnnee");
  var totalCascade = function(){
    var t = document.querySelectorAll("#plotCasc svg text.valeur");
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
  r.lignes    = document.querySelectorAll("#tbl tbody tr").length;
  r.questions = document.querySelectorAll(".faqg article").length;
  r.tri       = (document.getElementById("heroTri")||{}).textContent || "";
  r.vitrine   = (document.getElementById("vTri")||{}).textContent || "";
  r.vcourbes  = document.querySelectorAll("#vPlotNet path[stroke]").length;
  r.vsens     = document.querySelectorAll("#vPlotSens svg rect").length;
  document.getElementById("sonde").textContent = "SONDE::" + JSON.stringify(r);
}, 1800);
</script>"""


def sonde_navigateur(chrome, base, fichier, largeur):
    """Charge une page dans Chrome et rapatrie un diagnostic depuis le DOM.

    Chrome sans fenêtre refuse moins de 500 px de large : en dessous, on
    contraint la page elle-même, ce qui suffit à révéler un débordement.
    """
    page = fichier.read_text(encoding="utf-8")
    etroit = f"<style>html{{width:{largeur}px;margin:0}}</style>" if largeur < 500 else ""
    temoin = fichier.parent / "__verif.html"
    temoin.write_text(page.replace("</head>", etroit + "</head>")
                      .replace("</body>", SONDE % largeur + "</body>"), encoding="utf-8")
    try:
        url = base + "/" + temoin.relative_to(SITE).as_posix()
        dom = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=9000",
             f"--window-size={max(500, largeur)},1000", "--dump-dom", url],
            capture_output=True, text=True, timeout=120).stdout
        trouve = re.search(r"SONDE::(\{.*?\})</div>", dom, re.S)
        return json.loads(trouve.group(1)) if trouve else None
    finally:
        temoin.unlink(missing_ok=True)


def propre(t):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t).replace("&nbsp;", " ")
                  .replace("&amp;", "&")).strip()


def main():
    print("Construction…")
    subprocess.run([sys.executable, "build.py"], cwd=RACINE,
                   capture_output=True, check=True)

    pages = list(pages_html())
    serveur, base = servir()
    try:
        print("\nRESSOURCES")
        for chemin in ("/", "/calculatrice/", "/guides/", "/questions-frequentes/",
                       "/hypotheses-de-calcul/", "/mentions-legales/", "/404.html",
                       "/css/style.css", "/js/app.js", "/js/site.js", "/js/vitrine.js",
                       "/favicon.ico", "/assets/favicon.svg", "/assets/og-image.png",
                       "/assets/apple-touch-icon.png", "/robots.txt", "/sitemap.xml"):
            try:
                with urllib.request.urlopen(base + chemin, timeout=10) as r:
                    controle(chemin, r.status == 200, "%d o" % len(r.read()))
            except urllib.error.HTTPError as e:
                controle(chemin, False, "HTTP %d" % e.code)

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
        themes = {"sombre": tokens_du_theme(css, ":root"),
                  "clair": tokens_du_theme(css, ':root[data-theme="light"]')}
        # Le thème clair n'est qu'une surcharge : ce qu'il ne redéfinit pas vient du sombre.
        themes["clair"] = {**themes["sombre"], **themes["clair"]}
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

        print("\nCONFIDENTIALITÉ ET POIDS")
        textes = css + "".join(f.read_text(encoding="utf-8") for _, f in pages)
        textes += (SITE / "js" / "app.js").read_text(encoding="utf-8")
        tiers = {d for d in re.findall(r"https?://([a-z0-9.-]+)", textes)
                 if not d.endswith(("w3.org", "schema.org", "sitemaps.org", "cloudflare.com"))
                 and "monrendementlocatif" not in d}
        controle("aucun appel vers un domaine tiers", not tiers, ", ".join(tiers))
        controle("aucun script de mesure d'audience",
                 not re.search(r"googletagmanager|google-analytics|gtag\(|plausible\.io|matomo|hotjar|clarity\.ms|cloudflareinsights", textes, re.I))
        poids = sum(f.stat().st_size for f in SITE.rglob("*") if f.is_file())
        controle("poids total sous 600 Ko", poids < 600_000, "%d Ko" % (poids // 1024))

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
                if largeur == 1360:
                    controle("accueil : deux graphiques tracés", r["graphes"] == 2, str(r["graphes"]))
                    controle("accueil : quatre placements comparés", r["vcourbes"] == 4, str(r["vcourbes"]))
                    controle("accueil : sensibilité tracée", r["vsens"] >= 6, "%d barres" % r["vsens"])
                    controle("accueil : rendement affiché", "%" in r["vitrine"], r["vitrine"])
                    controle("accueil : avis éditorial rendu",
                             len(r.get("vAvis") or "") > 20, r.get("vAvis") or "absent")

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
                if largeur == 1360:
                    # La vitrine rejoue le scénario par défaut : le moindre écart
                    # signalerait qu'elle a cessé de suivre le moteur.
                    controle("accueil et calculatrice : même rendement",
                             bool(r["tri"]) and r["tri"] == vitrine.get("vitrine"),
                             "%s vs %s" % (vitrine.get("vitrine", "—"), r["tri"]))
                    controle("six tuiles d'indicateurs", r["tuiles"] == 6, str(r["tuiles"]))
                    controle("sept graphiques tracés", r["graphes"] == 7, str(r["graphes"]))
                    controle("sept équivalents textuels", r.get("equiv") == 7, str(r.get("equiv")))
                    controle("sept graphiques atteignables au clavier",
                             r.get("focalisables") == 7, str(r.get("focalisables")))
                    # « ouvre au focus », « les flèches déplacent », « se ferme au blur »
                    controle("infobulle pilotable au clavier", r.get("clavier") == "111",
                             r.get("clavier") or "sonde muette")
                    controle("quatre courbes comparées", r["courbes"] == 4, str(r["courbes"]))
                    controle("quatre régimes comparés", r["regimes"] == 4, str(r["regimes"]))
                    controle("sensibilité calculée", r["sens"] >= 6, "%d barres" % r["sens"])
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
        js = (SITE / "js" / "app.js").read_text(encoding="utf-8")
        moteur = js[js.index("/* ---------- postes de travaux ---------- */"):
                    js.index("/* ---------- charts ---------- */")]
        essai = RACINE / "outils" / "__moteur.js"
        essai.write_text(moteur + """
var $ = function(){ return {innerHTML:'', value:'', textContent:''}; };
function base(){ return {prix:200000,notairePct:8,fraisAcq:0,mobilier:8000,apport:35000,
 duree:20,taux:3.4,assur:0.34,fraisDossier:2500,loyer:900,vacance:5,copro:60,tf:1200,pno:180,
 gestion:0,entretien:5,ps:18.6,psPV:17.2,cfe:400,abattement:50,plafondDeficit:10700,partBati:85,
 amortBatiAns:30,amortTvxAns:15,amortMobAns:7,horizon:25,inflation:2,indexPrix:2,indexLoyer:2,
 indexCharges:2,fraisVente:5,bourse:4,fondsEuros:0,livretA:-0.3,fiscBourse:31.4,fiscFonds:30,
 regime:'lmnp-reel',tmi:30,ira:true,items:[{nom:'R',montant:20000,taux:5,duree:20,deduc:100}]}; }
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
lignes.push('apport nul : TRI non calculable|'+(run({apport:0}).final.tri===null?1:0)+'|');
lignes.push('duree amortissement nulle sans plantage|'+(isFinite(run({amortBatiAns:0}).final.tri)?1:0)+'|');
lignes.push('horizon 1 an sans plantage|'+(isFinite(run({horizon:1}).final.tri)?1:0)+'|');
lignes.push('champs fiscaux absents toleres|'+(isFinite(run({fiscBourse:undefined,fiscFonds:undefined}).final.gainBourse)?1:0)+'|');
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
