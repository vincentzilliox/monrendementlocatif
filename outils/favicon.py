#!/usr/bin/env python3
"""Le logotype, et les icônes qu'on en tire.

Une géométrie unique — maison, deux barres, une flèche — sert à la fois au SVG
et au rastériseur maison qui produit favicon.ico et l'icône iOS. Rien
d'extérieur n'est nécessaire : le champ de distance signée donne l'anticrénelage,
et les en-têtes ICO et PNG sont écrits octet par octet.

Sorti de build.py, qui assemble des pages HTML et n'avait rien à faire d'un
moteur de rendu d'images.
"""

import math
import struct
import zlib

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


def svg():
    """Le logotype en SVG, assemblé depuis la même géométrie que les bitmaps."""
    contour = "M " + " L ".join(f"{x} {y}" for x, y in MAISON) + " Z"
    for x0, y0, x1, y1 in TROUS:                     # sous-tracés = fenêtres évidées
        contour += f" M {x0} {y0} H {x1} V {y1} H {x0} Z"
    return FAVICON_SVG.format(
        rose="%02X%02X%02X" % ENCRE, sombre=ENCRE_SOMBRE,
        maison=contour,
        barres="\n".join(
            f'  <rect x="{x0}" y="{y0}" width="{round(x1 - x0, 2)}" '
            f'height="{round(y1 - y0, 2)}"/>'
            for x0, y0, x1, y1 in BARRES),
        fleche="M " + " L ".join(f"{x} {y}" for x, y in FLECHE),
        trait=TRAIT,
        pointe="M " + " L ".join(f"{x} {y}" for x, y in POINTE) + " Z")
