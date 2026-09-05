#!/usr/bin/env python3
"""Construit le site déployable à partir de index.html.

index.html est un fichier unique, pratique à éditer et compatible avec
l'hébergement Artifact. Ce script l'éclate en une arborescence classique et
ajoute ce qu'un vrai site exige : enveloppe HTML, viewport, favicon, robots,
sitemap, et les en-têtes Cloudflare Pages.

    python3 build.py        ->  site/
"""

import json
import math
import pathlib
import re
import sys
from datetime import date, datetime

sys.path.insert(0, str(pathlib.Path(__file__).parent / "outils"))
import favicon

RACINE = pathlib.Path(__file__).parent
SOURCE = RACINE / "index.html"
SRC = RACINE / "src"
GUIDES = RACINE / "guides"
PAGES = RACINE / "pages"
SITE = RACINE / "site"

DOMAINE = "https://monrendementlocatif.fr"
NOM = "Mon rendement locatif"
CALCULATRICE = "/calculatrice/"
# Titre sous 60 caractères, description sous 160 : au-delà, Google tronque.
TITRE = "Rendement locatif : votre TRI net d'impôt, année par année"
DESCRIPTION = (
    "Calculez le vrai rendement de votre investissement locatif : TRI net "
    "d'impôt et d'inflation, meilleur moment pour revendre, comparaison bourse "
    "à mise égale."
)
def _faq_depuis_le_html(corps):
    """Extrait les questions-réponses de la section FAQ visible.

    Google exige que le balisage corresponde mot pour mot à ce que voit le
    visiteur. En le dérivant du HTML plutôt qu'en le recopiant à la main, les
    deux ne peuvent pas diverger quand le texte évolue.
    """
    def nettoyer(html):
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html)
                      .replace("&nbsp;", "\u00a0").replace("&amp;", "&")).strip()

    entrees = []
    for bloc in re.findall(r"<article>(.*?)</article>", corps, re.S):
        question = re.search(r"<h3>(.*?)</h3>", bloc, re.S)
        reponses = re.findall(r"<p>(.*?)</p>", bloc, re.S)
        if not question or not reponses:
            continue
        entrees.append({
            "@type": "Question",
            "name": nettoyer(question.group(1)),
            "acceptedAnswer": {"@type": "Answer",
                               "text": " ".join(nettoyer(p) for p in reponses)},
        })
    return entrees


def _jsonld(corps):
    outil = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": NOM,
    "url": DOMAINE + CALCULATRICE,
    "description": DESCRIPTION,
    "applicationCategory": "FinanceApplication",
    "operatingSystem": "Tout navigateur web",
    "inLanguage": "fr-FR",
    "isAccessibleForFree": True,
    "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"},
    "featureList": [
        "Taux de rendement interne année par année",
        "Rendement réel net d'inflation",
        "Point mort et meilleure année de revente",
        "Quatre régimes fiscaux : micro-foncier, réel, micro-BIC, LMNP au réel",
        "Comparaison avec le Livret A, un fonds euros et la bourse",
    ],
    }
    faq = _faq_depuis_le_html(corps)
    graphe = [outil]
    if faq:
        graphe.append({"@context": "https://schema.org", "@type": "FAQPage",
                       "mainEntity": faq})
    return json.dumps(graphe if len(graphe) > 1 else outil,
                      ensure_ascii=False, separators=(",", ":"))


def _entre(texte, nom, chemin="index.html"):
    """Le contenu entre `<!-- nom:début -->` et `<!-- nom:fin -->`.

    Le repérage par `.index()` seul trouvait toujours *une* position, même si
    les sections avaient été réordonnées : l'en-tête aurait alors avalé le pied
    de page, et cet en-tête corrompu se serait retrouvé sur toutes les pages
    du site, sans la moindre erreur de construction. On exige donc les deux
    marqueurs, une seule fois chacun, et dans l'ordre.
    """
    ouvre, ferme = f"<!-- {nom}:début -->", f"<!-- {nom}:fin -->"
    for m in (ouvre, ferme):
        n = texte.count(m)
        if n != 1:
            raise SystemExit(f"{chemin} : marqueur {m} présent {n} fois, attendu une seule")
    a, b = texte.index(ouvre) + len(ouvre), texte.index(ferme)
    if b < a:
        raise SystemExit(f"{chemin} : {ferme} précède {ouvre}")
    return texte[a:b].strip()


def _sans_marqueurs(texte):
    """Le balisage débarrassé des marqueurs de découpe, qui n'ont rien à faire
    dans la page servie."""
    return re.sub(r"[ \t]*<!-- \w+:(?:début|fin) -->\n?", "", texte)


def _defauts(src, script):
    """Les valeurs par défaut du formulaire, relues dans le HTML.

    La vitrine doit afficher exactement ce que la calculatrice affiche à
    l'ouverture : on récupère donc les mêmes valeurs à la source plutôt que de
    les recopier dans un second fichier, où elles dériveraient.
    """
    champs = json.loads(re.search(r"const FIELDS = (\[.*?\]);", script, re.S)
                        .group(1).replace("\n", " "))
    selects = json.loads(re.search(r"const SELECTS = (\[.*?\]);", script, re.S).group(1))
    valeurs = {}
    for cle in champs:
        balise = re.search(r'<input id="%s"[^>]*>' % cle, src)
        if not balise:
            raise SystemExit("index.html : champ « %s » introuvable" % cle)
        valeurs[cle] = float(re.search(r'value="([^"]*)"', balise.group(0)).group(1))
    for cle in selects:
        bloc = re.search(r'<select id="%s">(.*?)</select>' % cle, src, re.S).group(1)
        choisi = re.search(r'<option value="([^"]*)"[^>]*selected', bloc).group(1)
        valeurs[cle] = float(choisi) if cle == "tmi" else choisi
    valeurs["ira"] = 'id="ira" type="checkbox" checked' in src
    return json.dumps(valeurs, ensure_ascii=False, indent=2)


# Pilote de la page d'accueil : un seul scénario, celui que la calculatrice
# propose à l'ouverture, rendu avec les fonctions du bloc partagé.
# ---------------------------------------------------------------- pages
def _tete(titre, description, chemin, jsonld, noindex=False, type_og="website"):
    """Le <head> commun : métadonnées, partage, icônes, feuille de style."""
    url = DOMAINE + chemin
    robots = '<meta name="robots" content="noindex, follow">\n' if noindex else ""
    return f"""<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titre}</title>
<meta name="description" content="{description}">
{robots}<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="{url}">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="{type_og}">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{titre}">
<meta property="og:description" content="{description}">
<meta property="og:locale" content="fr_FR">
<meta property="og:image" content="{DOMAINE}/assets/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{NOM} — calculateur de rendement locatif">
<meta property="og:site_name" content="{NOM}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{titre}">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="{DOMAINE}/assets/og-image.png">
<script type="application/ld+json">{jsonld}</script>
<link rel="stylesheet" href="/css/style.css">"""


def _page(tete, corps, scripts):
    """`scripts` : un chemin, ou plusieurs, chargés dans l'ordre donné."""
    if isinstance(scripts, str):
        scripts = [scripts]
    balises = "\n".join(f'<script src="{s}"></script>' for s in scripts)
    return f"""<!doctype html>
<html lang="fr">
<head>
{tete}
</head>
<body>
{corps}
{balises}
</body>
</html>
"""


# Script des pages sans calculateur : l'interrupteur de thème et l'adresse de
# contact assemblée côté client, rien d'autre.
SITE_JS = """"use strict";
(function(){
  const b = document.getElementById("theme");
  // Sombre par défaut : seule une préférence système explicitement claire,
  // ou un choix manuel, fait basculer en clair.
  const estSombre = () => {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
  };
  const sync = () => {
    if(!b) return;
    const nuit = estSombre();
    b.setAttribute("aria-checked", nuit ? "true" : "false");
    b.setAttribute("aria-label", nuit ? "Mode nuit activé" : "Mode jour activé");
  };
  try{ const t = localStorage.getItem("rentaloc.theme"); if(t) document.documentElement.setAttribute("data-theme", t); }catch(e){}
  if(b) b.addEventListener("click", () => {
    const suivant = estSombre() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", suivant);
    try{ localStorage.setItem("rentaloc.theme", suivant); }catch(e){}
    sync();
    document.dispatchEvent(new Event("theme"));
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", sync);
  sync();
  document.querySelectorAll("a.mail").forEach(a => { a.href = "mailto:" + a.dataset.u + "@" + a.dataset.d; });
})();
"""


def _meta(fragment, chemin):
    m = re.search(r'<script type="application/json" id="meta">(.*?)</script>', fragment, re.S)
    if not m:
        raise SystemExit(f"{chemin} : bloc <script id=\"meta\"> manquant")
    meta = json.loads(m.group(1))
    corps = fragment[m.end():].strip()
    for cle in ("titre", "description"):
        if cle not in meta:
            raise SystemExit(f"{chemin} : clé « {cle} » manquante dans le bloc meta")
    return meta, corps


def _date_fr(iso):
    mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
            "août", "septembre", "octobre", "novembre", "décembre"]
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d.day}{'er' if d.day == 1 else ''} {mois[d.month - 1]} {d.year}"


def _entete_pour(entete, courant):
    """Le lien de la page en cours porte aria-current ; les autres non."""
    e = entete.replace(' aria-current="page"', "")
    return e.replace(f'<a href="{courant}">', f'<a href="{courant}" aria-current="page">', 1)


def _fil(elements):
    """Fil d'Ariane visible + son balisage BreadcrumbList."""
    html = " › ".join(f'<a href="{u}">{t}</a>' if u else t for t, u in elements)
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [
              {"@type": "ListItem", "position": i + 1, "name": t,
               **({"item": DOMAINE + u} if u else {})}
              for i, (t, u) in enumerate(elements)]}
    return f'<p class="crumbs">{html}</p>', ld


def construire_guides(entete, pied):
    """guides/<slug>.html -> site/guides/<slug>/index.html, plus l'index."""
    fiches = []
    for src in sorted(GUIDES.glob("*.html")):
        slug = src.stem
        meta, corps = _meta(src.read_text(encoding="utf-8"), src)
        chemin = f"/guides/{slug}/"
        maj = meta.get("maj") or meta.get("date") or date.fromtimestamp(src.stat().st_mtime).isoformat()
        publie = meta.get("date") or maj
        corps = corps.replace("<!--META-->",
                              f'<p class="meta">Publié le {_date_fr(publie)}'
                              + (f" · mis à jour le {_date_fr(maj)}" if maj != publie else "")
                              + (f" · {meta['lecture']} de lecture" if meta.get("lecture") else "") + "</p>")
        fil_html, fil_ld = _fil([("Accueil", "/"), ("Guides", "/guides/"), (meta.get("court", meta["titre"]), None)])
        article = {
            "@context": "https://schema.org", "@type": "Article",
            "headline": meta.get("h1") or meta["titre"], "description": meta["description"],
            "datePublished": publie, "dateModified": maj, "inLanguage": "fr-FR",
            "mainEntityOfPage": DOMAINE + chemin,
            "author": {"@type": "Organization", "name": NOM, "url": DOMAINE + "/"},
            "publisher": {"@type": "Organization", "name": NOM, "url": DOMAINE + "/",
                          "logo": {"@type": "ImageObject", "url": DOMAINE + "/assets/apple-touch-icon.png"}},
            "image": DOMAINE + "/assets/og-image.png",
        }
        graphe = [article, fil_ld]
        faq = _faq_depuis_le_html(corps)
        if faq:
            graphe.append({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": faq})
        jsonld = json.dumps(graphe, ensure_ascii=False, separators=(",", ":"))
        page = _page(_tete(meta["titre"], meta["description"], chemin, jsonld, type_og="article"),
                     _entete_pour(entete, "/guides/") + f'\n<div class="page">\n{fil_html}\n{corps}\n</div>\n' + pied,
                     "/js/site.js")
        dossier = SITE / "guides" / slug
        dossier.mkdir(parents=True, exist_ok=True)
        (dossier / "index.html").write_text(page, encoding="utf-8")
        fiches.append({"chemin": chemin, "maj": maj, "meta": meta, "ordre": meta.get("ordre", 99)})

    fiches.sort(key=lambda f: (f["ordre"], f["chemin"]))
    cartes = "\n".join(
        f'<a class="gcard" href="{f["chemin"]}"><b>{f["meta"].get("court", f["meta"]["titre"])}</b>'
        f'<p>{f["meta"]["description"]}</p>'
        f'<small>{f["meta"].get("lecture", "")}{" de lecture" if f["meta"].get("lecture") else ""}</small></a>'
        for f in fiches)
    fil_html, fil_ld = _fil([("Accueil", "/"), ("Guides", None)])
    titre = "Guides : rendement locatif, fiscalité, revente"
    description = ("Des guides courts et chiffrés pour comprendre le rendement locatif : TRI, "
                   "régimes fiscaux, plus-value, moment de la revente, immobilier ou bourse.")
    liste = {"@context": "https://schema.org", "@type": "CollectionPage", "name": titre,
             "description": description, "url": DOMAINE + "/guides/", "inLanguage": "fr-FR",
             "hasPart": [{"@type": "Article", "headline": f["meta"].get("h1") or f["meta"]["titre"],
                          "url": DOMAINE + f["chemin"]} for f in fiches]}
    corps = f"""<div class="page">
{fil_html}
<div class="prose">
<h1>Guides</h1>
<p class="chapo">Ce que le calculateur mesure, expliqué avec des chiffres : comment lire un rendement, quel régime fiscal choisir, quand revendre, et comment comparer honnêtement la pierre à la bourse.</p>
</div>
<div class="cards">
{cartes}
</div>
</div>"""
    page = _page(_tete(titre, description, "/guides/", json.dumps([liste, fil_ld], ensure_ascii=False, separators=(",", ":"))),
                 _entete_pour(entete, "/guides/") + "\n" + corps + "\n" + pied, "/js/site.js")
    (SITE / "guides").mkdir(parents=True, exist_ok=True)
    (SITE / "guides" / "index.html").write_text(page, encoding="utf-8")
    return fiches


def construire_pages(entete, pied):
    """pages/<nom>.html : accueil, questions fréquentes, hypothèses, mentions, 404.

    Le bloc meta de chaque fragment décide du reste : `racine` la sert sur /,
    `noindex` la retire de l'index et du sitemap, `faq` ajoute le balisage
    FAQPage, `script` choisit le script embarqué.
    """
    entrees = []
    for src in sorted(PAGES.glob("*.html")):
        meta, corps = _meta(src.read_text(encoding="utf-8"), src)
        racine = meta.get("racine", False)
        if src.stem == "404":
            chemin, cible = "/404.html", SITE / "404.html"
        elif racine:
            chemin, cible = "/", SITE / "index.html"
        else:
            chemin, cible = f"/{src.stem}/", SITE / src.stem / "index.html"

        graphe = []
        fil_html = ""
        if racine:
            graphe.append({"@context": "https://schema.org", "@type": "WebSite",
                           "name": NOM, "url": DOMAINE + "/", "inLanguage": "fr-FR",
                           "description": meta["description"]})
        else:
            fil_html, fil_ld = _fil([("Accueil", "/"), (meta.get("court", meta["titre"]), None)])
            graphe.append(fil_ld)
        if meta.get("faq"):
            questions = _faq_depuis_le_html(corps)
            if questions:
                graphe.append({"@context": "https://schema.org", "@type": "FAQPage",
                               "mainEntity": questions})
        jsonld = json.dumps(graphe if len(graphe) > 1 else graphe[0],
                            ensure_ascii=False, separators=(",", ":"))

        corps_page = corps if racine else f'<div class="page">\n{fil_html}\n{corps}\n</div>'
        page = _page(_tete(meta["titre"], meta["description"], chemin, jsonld,
                           noindex=meta.get("noindex", False)),
                     _entete_pour(entete, "" if racine else chemin) + "\n" + corps_page + "\n" + pied,
                     ["/js/site.js"] + ([meta["script"]] if meta.get("script") else []))
        cible.parent.mkdir(parents=True, exist_ok=True)
        cible.write_text(page, encoding="utf-8")
        if not meta.get("noindex", False):
            # La date vient du bloc meta, comme pour les guides. L'horodatage du
            # fichier ne survit pas à un clone : le sitemap annonçait alors que
            # toutes les pages dataient du jour du clone.
            maj = meta.get("maj") or meta.get("date")
            if not maj:
                raise SystemExit(f"{src.name} : clé « maj » manquante dans le bloc meta")
            entrees.append((chemin, maj, meta.get("priorite", "0.6")))
    return entrees


# ---------------------------------------------------------------- assemblage
def main():
    src = SOURCE.read_text(encoding="utf-8")
    style = (SRC / "style.css").read_text(encoding="utf-8").strip()
    lire = lambda nom: (SRC / nom).read_text(encoding="utf-8").strip()
    moteur, graphiques = lire("moteur.js"), lire("graphiques.js")
    calculatrice, vitrine = lire("calculatrice.js"), lire("vitrine.js")

    # L'en-tête et le pied du calculateur servent à toutes les pages : une seule
    # source pour la navigation, aucun risque de dérive entre les pages. On les
    # extrait avant tout le reste, pour que le message d'erreur soit celui des
    # marqueurs et pas un ValueError sans contexte.
    entete = _entre(src, "entete")
    pied = _entre(src, "pied")
    if src.index("<!-- entete:début -->") > src.index("<!-- pied:début -->"):
        raise SystemExit("index.html : le pied de page précède l'en-tête")
    corps = _sans_marqueurs(src[src.index("<!-- entete:début -->"):]).strip()

    for dossier in ("css", "js", "assets"):
        (SITE / dossier).mkdir(parents=True, exist_ok=True)
    # Ce qui ne se régénère pas ne doit pas traîner : pages supprimées, anciens
    # fichiers. La liste se déduit de pages/, pour qu'ajouter ou retirer une page
    # n'oblige pas à penser au nettoyage.
    anciens = ["guides", "calculatrice"] + [f.stem for f in PAGES.glob("*.html")]
    for ancien in anciens:
        chemin = SITE / ancien
        if chemin.exists():
            for f in sorted(chemin.rglob("*"), reverse=True):
                f.unlink() if f.is_file() else f.rmdir()
            chemin.rmdir()

    (SITE / "css" / "style.css").write_text(style + "\n", encoding="utf-8")
    (SITE / "js" / "site.js").write_text(SITE_JS, encoding="utf-8")
    # Un seul moteur, un seul jeu de graphiques, deux pilotes. La calculatrice et
    # la vitrine ne peuvent donc pas afficher deux chiffres différents des mêmes
    # hypothèses — et la vitrine reçoit les valeurs par défaut relues dans le
    # balisage, jamais recopiées.
    prelude = '"use strict";\n'
    (SITE / "js" / "app.js").write_text(
        prelude + "\n".join((moteur, graphiques, calculatrice)) + "\n", encoding="utf-8")
    marqueur = "const DEFAUTS = {/* build.py : valeurs par défaut */};"
    if marqueur not in vitrine:
        raise SystemExit("src/vitrine.js : ligne DEFAUTS introuvable")
    vitrine = vitrine.replace(marqueur, "const DEFAUTS = %s;" % _defauts(src, calculatrice))
    (SITE / "js" / "vitrine.js").write_text(
        prelude + "\n".join((moteur, graphiques, vitrine)) + "\n", encoding="utf-8")
    (SITE / "assets" / "favicon.svg").write_text(favicon.svg(), encoding="utf-8")
    # Image de partage : produite par outils/og_image.py, versionnée à la racine
    # puis recopiée. Sans cette copie, un `rm -rf site` la perdrait.
    (SITE / "assets" / "og-image.png").write_bytes((RACINE / "og-image.png").read_bytes())
    favicon.ecrire_ico(SITE / "favicon.ico")
    favicon.ecrire_png(SITE / "assets" / "apple-touch-icon.png", 180)

    fil_calc, fil_calc_ld = _fil([("Accueil", "/"), ("Calculatrice", None)])
    jsonld_calc = json.dumps([json.loads(_jsonld(corps)), fil_calc_ld],
                             ensure_ascii=False, separators=(",", ":"))
    (SITE / "calculatrice").mkdir(parents=True, exist_ok=True)
    (SITE / "calculatrice" / "index.html").write_text(
        _page(_tete(TITRE, DESCRIPTION, CALCULATRICE, jsonld_calc), corps, "/js/app.js"),
        encoding="utf-8")

    fiches = construire_guides(entete, pied)
    pages = construire_pages(entete, pied)

    (SITE / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {DOMAINE}/sitemap.xml\n", encoding="utf-8")

    aujourdhui = date.today().isoformat()
    urls = [(CALCULATRICE, aujourdhui, "weekly", "0.9"),
            ("/guides/", aujourdhui, "monthly", "0.7")]
    urls += [(f["chemin"], f["maj"], "monthly", "0.8") for f in fiches]
    urls += [(c, m, "monthly", pr) for c, m, pr in pages]
    urls.sort(key=lambda u: (u[0] != "/", u[0]))
    entrees = "\n".join(f"""  <url>
    <loc>{DOMAINE}{u}</loc>
    <lastmod>{m}</lastmod>
    <changefreq>{c}</changefreq>
    <priority>{p}</priority>
  </url>""" for u, m, c, p in urls)
    (SITE / "sitemap.xml").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{entrees}
</urlset>
""", encoding="utf-8")

    # Cloudflare Pages lit ce fichier au déploiement.
    (SITE / "_headers").write_text("""/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), camera=(), microphone=()
  Cache-Control: public, max-age=0, must-revalidate

/css/*
  Cache-Control: public, max-age=3600

/js/*
  Cache-Control: public, max-age=3600

/assets/*
  Cache-Control: public, max-age=604800
""", encoding="utf-8")

    for chemin in sorted(SITE.rglob("*")):
        if chemin.is_file():
            print(f"  {chemin.relative_to(SITE)}  ({chemin.stat().st_size:,} o)".replace(",", " "))


if __name__ == "__main__":
    main()
