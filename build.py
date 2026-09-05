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
import struct
import zlib
from datetime import date, datetime

RACINE = pathlib.Path(__file__).parent
SOURCE = RACINE / "index.html"
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
# L'interface est monochrome : le logotype aussi. Encre sur fond clair ; le SVG
# passe en clair sur fond sombre via une requête média.
ENCRE = (0x11, 0x11, 0x11)
ENCRE_SOMBRE = "EDEDED"

# Géométrie dessinée dans un carré de 32 unités, réutilisée par le SVG et le
# rastériseur : maison à gauche, deux barres montantes, et une flèche qui monte,
# fléchit, puis repart vers le haut. Fond transparent, formes roses.
#
# Toutes les formes reposent sur la même ligne de sol, et les intervalles entre
# elles font 1,2 unité : de quoi rester lisibles sans se souder à petite taille.
SOL = 26.6

MAISON = [(8.6, 13.0), (14.4, 18.8), (13.0, 18.8), (13.0, SOL),
          (4.2, SOL), (4.2, 18.8), (2.8, 18.8)]

# Ouvertures sur coordonnées entières : le carré de référence fait 32 unités et
# l'ICO 32 pixels, donc une unité vaut un pixel. Des bords entiers tombent pile
# sur la grille et restent nets ; des bords décimaux se moyennent en gris.
TROUS = [(6.0, 20.0, 8.0, 22.0), (9.0, 20.0, 11.0, 22.0),
         (6.0, 23.0, 8.0, 25.0), (9.0, 23.0, 11.0, 25.0)]

BARRES = [(15.6, 19.4, 19.0, SOL), (20.2, 13.6, 23.6, SOL)]

# La flèche part au ras du sol à gauche, dépasse l'aplomb du faîte avant de
# fléchir — sinon le creux mordrait la pointe du toit — puis file vers le haut.
FLECHE = [(1.6, 16.4), (8.6, 9.2), (15.0, 15.8), (23.6, 6.4)]
TRAIT = 2.4
POINTE = [(27.11, 2.56), (26.04, 8.63), (21.16, 4.17)]


def _sdf_carre_arrondi(x, y, cote=32.0, r=7.0):
    qx = abs(x - cote / 2) - (cote / 2 - r)
    qy = abs(y - cote / 2) - (cote / 2 - r)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def _dans_polygone(x, y, sommets):
    dedans = False
    j = len(sommets) - 1
    for i, (xi, yi) in enumerate(sommets):
        xj, yj = sommets[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dedans = not dedans
        j = i
    return dedans


def _distance_polyligne(x, y, sommets, ferme=False):
    segments = list(zip(sommets, sommets[1:]))
    if ferme:
        segments.append((sommets[-1], sommets[0]))
    best = 1e9
    for (x1, y1), (x2, y2) in segments:
        dx, dy = x2 - x1, y2 - y1
        long2 = dx * dx + dy * dy
        t = 0.0 if long2 == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / long2))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def _dans_rect(x, y, x0, y0, x1, y1):
    return x0 <= x <= x1 and y0 <= y <= y1


def dessiner_icone(taille, trous=True):
    """Rendu suréchantillonné puis moyenné : des bords lisses même à 32 px.

    `trous` est désactivé aux très petites tailles, où des ouvertures de deux
    pixels saliraient la maison au lieu de la détailler.
    """
    s = 4 if taille <= 64 else 2
    n = taille * s
    echelle = 32.0 / n

    haute = bytearray(n * n * 4)
    for py in range(n):
        y = (py + 0.5) * echelle
        for px in range(n):
            x = (px + 0.5) * echelle
            encre = False
            if _dans_polygone(x, y, MAISON):
                encre = not (trous and any(_dans_rect(x, y, *t) for t in TROUS))
            elif any(_dans_rect(x, y, *b) for b in BARRES):
                encre = True
            elif (_distance_polyligne(x, y, FLECHE) <= TRAIT / 2
                  or _dans_polygone(x, y, POINTE)):
                encre = True
            if encre:
                haute[(py * n + px) * 4:(py * n + px) * 4 + 4] = bytes((*ENCRE, 255))

    # moyenne de chaque bloc s×s
    sortie = bytearray()
    aire = s * s
    for y in range(taille):
        for x in range(taille):
            r = v = b = a = 0
            for dy in range(s):
                for dx in range(s):
                    i = ((y * s + dy) * n + (x * s + dx)) * 4
                    r += haute[i]; v += haute[i + 1]; b += haute[i + 2]; a += haute[i + 3]
            sortie += bytes((r // aire, v // aire, b // aire, a // aire))
    return bytes(sortie)


def _image_ico(taille):
    """Un DIB 32 bits : en-tête, pixels BGRA de bas en haut, masque AND vide."""
    rgba = dessiner_icone(taille, trous=taille >= 32)
    lignes = []
    for y in range(taille - 1, -1, -1):            # le BMP se lit du bas vers le haut
        ligne = bytearray()
        for x in range(taille):
            i = (y * taille + x) * 4
            r, g, b, a = rgba[i:i + 4]
            ligne += bytes((b, g, r, a))
        lignes.append(bytes(ligne))
    xor = b"".join(lignes)
    octets_masque = ((taille + 31) // 32) * 4      # lignes alignées sur 4 octets
    and_mask = b"\x00" * (octets_masque * taille)
    entete = struct.pack("<IiiHHIIiiII", 40, taille, taille * 2, 1, 32, 0,
                         len(xor) + len(and_mask), 0, 0, 0, 0)
    return entete + xor + and_mask


def ecrire_ico(chemin, tailles=(16, 32)):
    """ICO multi-tailles : les onglets non-retina piochent le 16, les autres le 32."""
    images = [_image_ico(t) for t in tailles]
    offset = 6 + 16 * len(images)                  # ICONDIR + une entrée par image
    entrees = b""
    for taille, image in zip(tailles, images):
        entrees += struct.pack("<BBBBHHII", taille % 256, taille % 256, 0, 0,
                               1, 32, len(image), offset)
        offset += len(image)
    chemin.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + entrees + b"".join(images))


def ecrire_png(chemin, taille, fond=(255, 255, 255)):
    """PNG pour l'icône iOS, aplati sur un fond opaque.

    L'écran d'accueil d'iOS ne gère pas la transparence : une icône ajourée y
    apparaît sur du noir. On compose donc les formes sur un fond plein.
    """
    rgba = bytearray(dessiner_icone(taille))
    for i in range(0, len(rgba), 4):
        a = rgba[i + 3] / 255
        for c in range(3):
            rgba[i + c] = round(rgba[i + c] * a + fond[c] * (1 - a))
        rgba[i + 3] = 255
    rgba = bytes(rgba)
    brut = b"".join(b"\x00" + rgba[y * taille * 4:(y + 1) * taille * 4] for y in range(taille))

    def bloc(nom, data):
        return (struct.pack(">I", len(data)) + nom + data
                + struct.pack(">I", zlib.crc32(nom + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += bloc(b"IHDR", struct.pack(">IIBBBBB", taille, taille, 8, 6, 0, 0, 0))
    png += bloc(b"IDAT", zlib.compress(brut, 9))
    png += bloc(b"IEND", b"")
    chemin.write_bytes(png)


# La maison et ses ouvertures forment un seul tracé : la règle de remplissage
# « evenodd » creuse les fenêtres, sans masque ni superposition de couleur.
# Le SVG suit le thème du navigateur : encre sur clair, clair sur sombre.
FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>path,rect{{fill:#{rose}}}.t{{fill:none;stroke:#{rose}}}@media (prefers-color-scheme:dark){{path,rect{{fill:#{sombre}}}.t{{stroke:#{sombre}}}}}</style>
  <path fill-rule="evenodd" d="{maison}"/>
{barres}
  <path class="t" d="{fleche}" fill="none" stroke-width="{trait}"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="{pointe}"/>
</svg>
"""


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


# Marqueurs posés dans index.html : tout ce qui précède calcule ou dessine sans
# toucher au formulaire, et sert donc aussi à la page d'accueil.
DEBUT_PARTAGE = "/* ═════════ modèle et dessin"
FIN_PARTAGE = "/* ═════════ fin du bloc partagé"


def _bloc_partage(script):
    return script[script.index(DEBUT_PARTAGE):script.index(FIN_PARTAGE)].rstrip()


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
VITRINE_JS = """
/* ---------- page d'accueil ---------- */
const DEFAUTS = %s;

function scenario(){
  const p = Object.assign({}, DEFAUTS);
  p.items = TVX_DEFAUT.map(o => ({...o}));
  p.travaux = p.items.reduce((s, it) => s + it.montant, 0);
  // La case « prix, loyers et charges suivent l'inflation » est cochée par défaut.
  p.indexPrix = p.indexLoyer = p.indexCharges = p.inflation;
  return p;
}

function vitrine(){
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

  const xs = R.rows.map(r => String(r.y));
  drawChart(g("vPlotNet"), g("vTipNet"), {
    x: xs, height: 280, padLeft: 78, zero: true,
    label: "Gain net de l'immobilier comparé à trois placements",
    fmtAxis: kEur,
    mark: mort > 0 ? {i: mort, text: "point mort · année " + R.rows[mort].y} : null,
    series: [
      {color: "--d1", values: R.rows.map(r => r.gainImmo), width: 2.4},
      {color: "--d2", values: R.rows.map(r => r.gainBourse)},
      {color: "--d3", values: R.rows.map(r => r.gainFonds), dash: "7 4"},
      {color: "--d4", values: R.rows.map(r => r.gainLivret), dash: "2 3"}
    ],
    tip: i => {
      const r = R.rows[i];
      return `<div class="th">Revente fin d'année ${r.y}</div>` +
        tipRow(css("--d1"), "Immobilier", sEur(r.gainImmo)) +
        tipRow(css("--d2"), "Bourse", sEur(r.gainBourse)) +
        tipRow(css("--d3"), "Fonds euros", sEur(r.gainFonds)) +
        tipRow(css("--d4"), "Livret A", sEur(r.gainLivret)) +
        tipRow("transparent", "sorti de votre poche", eur.format(r.mise));
    }
  });

  const sens = sensibilite(p, f.tri);
  drawTornado(g("vPlotSens"), g("vTipSens"), {
    label: "Sensibilité du rendement annualisé",
    fmtAxis: v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v*100).toFixed(1).replace(".", ",") + " pt",
    rows: sens.map(s => ({label: s.nom, lo: s.lo, hi: s.hi, loText: pts(s.lo), hiText: pts(s.hi)})),
    tip: i => {
      const s = sens[i];
      return `<div class="th">${s.nom} · ±${s.txt}</div>` +
        tipRow(css("--up"), "Scénario favorable", sPct(s.fav.tri)) +
        tipRow(css("--down"), "Scénario défavorable", sPct(s.def.tri)) +
        tipRow("transparent", "Hypothèse retenue", sPct(f.tri));
    }
  });
  if(sens.length) ecrire("vSens", sens[0].nom.toLowerCase());
}

let vid;
addEventListener("resize", () => { clearTimeout(vid); vid = setTimeout(vitrine, 140); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => setTimeout(vitrine, 30));
document.addEventListener("theme", vitrine);
vitrine();
"""


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
            entrees.append((chemin, date.fromtimestamp(src.stat().st_mtime).isoformat(),
                            meta.get("priorite", "0.6")))
    return entrees


# ---------------------------------------------------------------- assemblage
def main():
    src = SOURCE.read_text(encoding="utf-8")

    style = re.search(r"<style>(.*?)</style>", src, re.S).group(1).strip()
    script = re.search(r"<script>(.*?)</script>", src, re.S).group(1).strip()
    corps = src[src.index('<header class="topbar">'):src.index("<script>")].strip()
    # L'en-tête et le pied du calculateur servent à toutes les pages : une seule
    # source pour la navigation, aucun risque de dérive entre les pages.
    entete = corps[:corps.index('<div class="pagehead">')].strip()
    pied = corps[corps.index('<footer class="footer">'):corps.index("</footer>") + len("</footer>")]

    for dossier in ("css", "js", "assets"):
        (SITE / dossier).mkdir(parents=True, exist_ok=True)
    # Ce qui ne se régénère pas ne doit pas traîner : pages supprimées, anciens fichiers.
    for ancien in ("guides", "calculatrice", "questions-frequentes",
                   "hypotheses-de-calcul", "mentions-legales", "assets/fonts"):
        chemin = SITE / ancien
        if chemin.exists():
            for f in sorted(chemin.rglob("*"), reverse=True):
                f.unlink() if f.is_file() else f.rmdir()
            chemin.rmdir()

    (SITE / "css" / "style.css").write_text(style + "\n", encoding="utf-8")
    (SITE / "js" / "app.js").write_text(script + "\n", encoding="utf-8")
    (SITE / "js" / "site.js").write_text(SITE_JS, encoding="utf-8")
    # La vitrine rejoue le scénario par défaut avec le moteur de la calculatrice :
    # elle ne peut donc pas afficher autre chose que ce que l'outil calculerait.
    (SITE / "js" / "vitrine.js").write_text(
        '"use strict";\n' + _bloc_partage(script) + "\n"
        + VITRINE_JS % _defauts(src, script), encoding="utf-8")
    rose_hex = "%02X%02X%02X" % ENCRE
    contour = "M " + " L ".join(f"{x} {y}" for x, y in MAISON) + " Z"
    for x0, y0, x1, y1 in TROUS:                     # sous-tracés = fenêtres évidées
        contour += f" M {x0} {y0} H {x1} V {y1} H {x0} Z"
    svg = FAVICON_SVG.format(
        rose=rose_hex, sombre=ENCRE_SOMBRE,
        maison=contour,
        barres="\n".join(
            f'  <rect x="{x0}" y="{y0}" width="{round(x1 - x0, 2)}" '
            f'height="{round(y1 - y0, 2)}"/>'
            for x0, y0, x1, y1 in BARRES),
        fleche="M " + " L ".join(f"{x} {y}" for x, y in FLECHE),
        trait=TRAIT,
        pointe="M " + " L ".join(f"{x} {y}" for x, y in POINTE) + " Z")
    (SITE / "assets" / "favicon.svg").write_text(svg, encoding="utf-8")
    # Image de partage : produite par outils/og_image.py, versionnée à la racine
    # puis recopiée. Sans cette copie, un `rm -rf site` la perdrait.
    (SITE / "assets" / "og-image.png").write_bytes((RACINE / "og-image.png").read_bytes())
    ecrire_ico(SITE / "favicon.ico")
    ecrire_png(SITE / "assets" / "apple-touch-icon.png", 180)

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
