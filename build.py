#!/usr/bin/env python3
"""Construit le site déployable à partir de index.html.

index.html est un fichier unique, pratique à éditer et compatible avec
l'hébergement Artifact. Ce script l'éclate en une arborescence classique et
ajoute ce qu'un vrai site exige : enveloppe HTML, viewport, favicon, robots,
sitemap, et les en-têtes Cloudflare Pages.

    python3 build.py        ->  site/
"""

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
VIOLET = (0x70, 0x40, 0xD8)


# ---------------------------------------------------------------- favicon
def dessiner_icone(taille):
    """Carré violet arrondi, avec une courbe ascendante blanche. Renvoie du RGBA."""
    r = taille * 7 // 32                      # rayon des coins
    trait = max(2, taille // 11)
    pts = [(0.22, 0.70), (0.43, 0.47), (0.60, 0.60), (0.80, 0.30)]
    sommets = [(x * taille, y * taille) for x, y in pts]

    def dans_le_carre(x, y):
        for cx, cy in ((r, r), (taille - r, r), (r, taille - r), (taille - r, taille - r)):
            if (x < r or x > taille - r) and (y < r or y > taille - r):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    return True
                continue
        return not (x < r or x > taille - r) or not (y < r or y > taille - r)

    def distance_au_trace(px, py):
        best = 1e9
        for (x1, y1), (x2, y2) in zip(sommets, sommets[1:]):
            dx, dy = x2 - x1, y2 - y1
            longueur = dx * dx + dy * dy
            t = 0 if longueur == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / longueur))
            best = min(best, math_hypot(px - (x1 + t * dx), py - (y1 + t * dy)))
        return best

    pixels = bytearray()
    for y in range(taille):
        for x in range(taille):
            cx, cy = x + 0.5, y + 0.5
            if not dans_le_carre(cx, cy):
                pixels += bytes((0, 0, 0, 0))
            elif distance_au_trace(cx, cy) <= trait / 2:
                pixels += bytes((255, 255, 255, 255))
            else:
                pixels += bytes((*VIOLET, 255))
    return bytes(pixels)


def math_hypot(a, b):
    return (a * a + b * b) ** 0.5


def ecrire_ico(chemin, taille=32):
    """ICO minimal : une image 32 bits, données BGRA de bas en haut, masque AND vide."""
    rgba = dessiner_icone(taille)
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
    image = entete + xor + and_mask
    ico = struct.pack("<HHH", 0, 1, 1)
    ico += struct.pack("<BBBBHHII", taille % 256, taille % 256, 0, 0, 1, 32, len(image), 22)
    chemin.write_bytes(ico + image)


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


FAVICON_SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#{VIOLET[0]:02X}{VIOLET[1]:02X}{VIOLET[2]:02X}"/>
  <path d="M7 22.4 L13.8 15 L19.2 19.2 L25.6 9.6" fill="none" stroke="#fff"
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
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
    (SITE / "assets" / "favicon.svg").write_text(FAVICON_SVG, encoding="utf-8")
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
