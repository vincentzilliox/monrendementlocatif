#!/usr/bin/env python3
"""Construit le site déployable à partir de index.html.

index.html est un fichier unique, pratique à éditer et compatible avec
l'hébergement Artifact. Ce script l'éclate en une arborescence classique et
ajoute ce qu'un vrai site exige : enveloppe HTML, viewport, favicon, robots,
sitemap, et les en-têtes Cloudflare Pages.

    python3 build.py        ->  site/
"""

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
DESCRIPTION = (
    "Calculez le rendement annualisé de votre investissement locatif, en euros "
    "courants et en pouvoir d'achat. Point mort, meilleure année de revente, et "
    "comparaison avec le Livret A, un fonds euros et la bourse."
)
ROSE = (0xE1, 0x0F, 0xA6)          # rose peps du logotype

# Géométrie dessinée dans un carré de 32 unités, réutilisée par le SVG et le
# rastériseur.
#
# MAISON est le pentagone *intérieur* : la silhouette visible est ce polygone
# dilaté de RAYON_MAISON, ce qui arrondit tous les angles d'un coup — le faîte
# comme les quatre coins du corps. En SVG c'est un contour de même couleur que
# le remplissage, avec des jonctions rondes ; au rastériseur, une distance au
# contour. Les deux produisent exactement la même forme.
# Maison décalée à gauche et posée bas, pour dégager le ciel où passe la courbe.
MAISON = [(13.8, 12.0), (19.4, 16.6), (19.4, 25.1), (8.2, 25.1), (8.2, 16.6)]
RAYON_MAISON = 2.1

# Quatre ouvertures en carré, séparées par deux unités.
# Coordonnées entières à dessein : le carré de référence fait 32 unités et
# l'ICO 32 pixels, donc une unité vaut un pixel. Des bords entiers tombent pile
# sur la grille de pixels et restent nets ; des bords décimaux se moyennent en
# une bouillie grise à cette taille.
TROUS = [(10.0, 18.0, 13.0, 21.0), (15.0, 18.0, 18.0, 21.0),
         (10.0, 23.0, 13.0, 26.0), (15.0, 23.0, 18.0, 26.0)]
RAYON_TROU = 0.6

# La courbe démarre dans le prolongement exact de la pente du toit — même
# inclinaison, décalée perpendiculairement de RAYON_MAISON plus un intervalle —
# puis dépasse le faîte avant de redescendre un peu et de repartir vers le haut.
# Le premier segment doit franchir l'aplomb du faîte avant que la courbe ne
# fléchisse : sinon le creux vient mordre la pointe du toit.
COURBE = [(4.8, 12.8), (12.4, 6.6), (18.2, 9.0), (27.2, 3.0)]
TRAIT = 2.4
POINT_FINAL = 1.5


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


def _dans_rect_arrondi(x, y, x0, y0, x1, y1, r):
    dx = max(x0 + r - x, 0.0, x - (x1 - r))
    dy = max(y0 + r - y, 0.0, y - (y1 - r))
    return x0 <= x <= x1 and y0 <= y <= y1 and math.hypot(dx, dy) <= r


def dessiner_icone(taille, trous=True):
    """Rendu suréchantillonné puis moyenné : des bords lisses même à 32 px.

    `trous` est désactivé aux très petites tailles, où des ouvertures de moins
    de deux pixels saliraient la maison au lieu de la détailler.
    """
    s = 4 if taille <= 64 else 2
    n = taille * s
    echelle = 32.0 / n

    haute = bytearray(n * n * 4)
    for py in range(n):
        y = (py + 0.5) * echelle
        for px in range(n):
            x = (px + 0.5) * echelle
            i = (py * n + px) * 4
            if _sdf_carre_arrondi(x, y) > 0:
                continue                                   # hors du carré : transparent
            dans_maison = (_dans_polygone(x, y, MAISON)
                           or _distance_polyligne(x, y, MAISON, ferme=True) <= RAYON_MAISON)
            if dans_maison:
                blanc = not (trous and any(
                    _dans_rect_arrondi(x, y, *t, RAYON_TROU) for t in TROUS))
            else:
                fin = COURBE[-1]
                blanc = (_distance_polyligne(x, y, COURBE) <= TRAIT / 2
                         or math.hypot(x - fin[0], y - fin[1]) <= POINT_FINAL)
            haute[i:i + 4] = bytes((255, 255, 255, 255)) if blanc else bytes((*ROSE, 255))

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


def ecrire_png(chemin, taille):
    """PNG RGBA sans compression coûteuse, pour l'icône iOS."""
    rgba = dessiner_icone(taille)
    brut = b"".join(b"\x00" + rgba[y * taille * 4:(y + 1) * taille * 4] for y in range(taille))

    def bloc(nom, data):
        return (struct.pack(">I", len(data)) + nom + data
                + struct.pack(">I", zlib.crc32(nom + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += bloc(b"IHDR", struct.pack(">IIBBBBB", taille, taille, 8, 6, 0, 0, 0))
    png += bloc(b"IDAT", zlib.compress(brut, 9))
    png += bloc(b"IEND", b"")
    chemin.write_bytes(png)


# Le contour de même couleur que le remplissage, avec des jonctions rondes,
# arrondit tous les angles du pentagone : c'est l'équivalent SVG de la dilatation
# faite au rastériseur.
FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#{rose}"/>
  <path d="{courbe}" fill="none" stroke="#fff" stroke-width="{trait}"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="{fx}" cy="{fy}" r="{pt}" fill="#fff"/>
  <path d="{maison}Z" fill="#fff" stroke="#fff" stroke-width="{contour}"
        stroke-linejoin="round"/>
{trous}
</svg>
"""


# ---------------------------------------------------------------- assemblage
def main():
    src = SOURCE.read_text(encoding="utf-8")

    style = re.search(r"<style>(.*?)</style>", src, re.S).group(1).strip()
    script = re.search(r"<script>(.*?)</script>", src, re.S).group(1).strip()
    polices = "\n".join(re.findall(r"^<link [^>]*>$", src, re.M))
    corps = src[src.index('<header class="masthead">'):src.index("<script>")].strip()

    for dossier in ("css", "js", "assets"):
        (SITE / dossier).mkdir(parents=True, exist_ok=True)

    (SITE / "css" / "style.css").write_text(style + "\n", encoding="utf-8")
    (SITE / "js" / "app.js").write_text(script + "\n", encoding="utf-8")
    rose_hex = "%02X%02X%02X" % ROSE
    svg = FAVICON_SVG.format(
        rose=rose_hex,
        maison="M " + " L ".join(f"{x} {y}" for x, y in MAISON) + " ",
        contour=RAYON_MAISON * 2,
        courbe="M " + " L ".join(f"{x} {y}" for x, y in COURBE),
        trait=TRAIT, fx=COURBE[-1][0], fy=COURBE[-1][1], pt=POINT_FINAL,
        trous="\n".join(
            f'  <rect x="{x0}" y="{y0}" width="{round(x1 - x0, 2)}" '
            f'height="{round(y1 - y0, 2)}" rx="{RAYON_TROU}" fill="#{rose_hex}"/>'
            for x0, y0, x1, y1 in TROUS))
    (SITE / "assets" / "favicon.svg").write_text(svg, encoding="utf-8")
    ecrire_ico(SITE / "favicon.ico")
    ecrire_png(SITE / "assets" / "apple-touch-icon.png", 180)

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
<meta name="twitter:card" content="summary">
{polices}
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
