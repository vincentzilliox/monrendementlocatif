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
from datetime import date

RACINE = pathlib.Path(__file__).parent
SOURCE = RACINE / "index.html"
SITE = RACINE / "site"

DOMAINE = "https://monrendementlocatif.fr"
TITRE = "Rentabilité locative : votre rendement réel, année par année"
# Sous 160 caracteres : au-dela, Google tronque l'extrait dans ses resultats.
DESCRIPTION = (
    "Calculez le rendement réel de votre investissement locatif année par "
    "année : point mort, meilleur moment pour revendre, comparaison bourse."
)
ROSE = (0xE1, 0x0F, 0xA6)          # rose peps du logotype

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
            rose = False
            if _dans_polygone(x, y, MAISON):
                rose = not (trous and any(_dans_rect(x, y, *t) for t in TROUS))
            elif any(_dans_rect(x, y, *b) for b in BARRES):
                rose = True
            elif (_distance_polyligne(x, y, FLECHE) <= TRAIT / 2
                  or _dans_polygone(x, y, POINTE)):
                rose = True
            if rose:
                haute[(py * n + px) * 4:(py * n + px) * 4 + 4] = bytes((*ROSE, 255))

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
FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path fill="#{rose}" fill-rule="evenodd" d="{maison}"/>
{barres}
  <path d="{fleche}" fill="none" stroke="#{rose}" stroke-width="{trait}"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path fill="#{rose}" d="{pointe}"/>
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
    "name": "Mon rendement locatif",
    "url": DOMAINE + "/",
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


# ---------------------------------------------------------------- assemblage
def main():
    src = SOURCE.read_text(encoding="utf-8")

    style = re.search(r"<style>(.*?)</style>", src, re.S).group(1).strip()
    script = re.search(r"<script>(.*?)</script>", src, re.S).group(1).strip()
    corps = src[src.index('<header class="masthead">'):src.index("<script>")].strip()

    for dossier in ("css", "js", "assets"):
        (SITE / dossier).mkdir(parents=True, exist_ok=True)

    # Les @font-face en tête de feuille, et les fichiers copiés : plus aucune
    # requête vers un domaine tiers.
    police_css = (RACINE / "polices" / "polices.css").read_text(encoding="utf-8")
    (SITE / "assets" / "fonts").mkdir(parents=True, exist_ok=True)
    for woff in sorted((RACINE / "polices").glob("*.woff2")):
        (SITE / "assets" / "fonts" / woff.name).write_bytes(woff.read_bytes())
    (SITE / "css" / "style.css").write_text(police_css + style + "\n", encoding="utf-8")
    (SITE / "js" / "app.js").write_text(script + "\n", encoding="utf-8")
    rose_hex = "%02X%02X%02X" % ROSE
    contour = "M " + " L ".join(f"{x} {y}" for x, y in MAISON) + " Z"
    for x0, y0, x1, y1 in TROUS:                     # sous-tracés = fenêtres évidées
        contour += f" M {x0} {y0} H {x1} V {y1} H {x0} Z"
    svg = FAVICON_SVG.format(
        rose=rose_hex,
        maison=contour,
        barres="\n".join(
            f'  <rect x="{x0}" y="{y0}" width="{round(x1 - x0, 2)}" '
            f'height="{round(y1 - y0, 2)}" fill="#{rose_hex}"/>'
            for x0, y0, x1, y1 in BARRES),
        fleche="M " + " L ".join(f"{x} {y}" for x, y in FLECHE),
        trait=TRAIT,
        pointe="M " + " L ".join(f"{x} {y}" for x, y in POINTE) + " Z")
    (SITE / "assets" / "favicon.svg").write_text(svg, encoding="utf-8")
    # Image de partage : produite une fois par outils/og.sh, versionnée à la
    # racine puis recopiée. Sans cette copie, un `rm -rf site` la perdrait.
    (SITE / "assets" / "og-image.png").write_bytes((RACINE / "og-image.png").read_bytes())
    ecrire_ico(SITE / "favicon.ico")
    ecrire_png(SITE / "assets" / "apple-touch-icon.png", 180)

    jsonld = _jsonld(corps)
    (SITE / "index.html").write_text(f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TITRE}</title>
<meta name="description" content="{DESCRIPTION}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F8F7FB" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15111E" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="{DOMAINE}/">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:url" content="{DOMAINE}/">
<meta property="og:title" content="{TITRE}">
<meta property="og:description" content="{DESCRIPTION}">
<meta property="og:locale" content="fr_FR">
<meta property="og:image" content="{DOMAINE}/assets/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Mon rendement locatif">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{jsonld}</script>
<link rel="preload" href="/assets/fonts/public-sans-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
{corps}
<script src="/js/app.js"></script>
</body>
</html>
""", encoding="utf-8")

    (SITE / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {DOMAINE}/sitemap.xml\n", encoding="utf-8")

    (SITE / "sitemap.xml").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{DOMAINE}/</loc>
    <lastmod>{date.today().isoformat()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
""", encoding="utf-8")

    # Cloudflare Pages lit ce fichier au déploiement.
    (SITE / "_headers").write_text("""/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), camera=(), microphone=()

/index.html
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
