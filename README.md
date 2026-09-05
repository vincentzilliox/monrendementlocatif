# Mon rendement locatif

Calculateur de rentabilité d'un investissement locatif en France, et six guides
qui expliquent ce qu'il mesure.

> **Pour voir le site :** `python3 outils/servir.py`.
> Ouvrir `index.html` en double-clic ne marche pas — c'est un fichier source,
> pas une page : les chemins sont absolus et les guides n'existent que dans
> `site/`, produit par `build.py`. Il répond à deux questions que les simulateurs
courants laissent de côté :

- **Combien ce projet rapporte-t-il vraiment, chaque année ?** Un TRI calculé sur
  les fonds réellement sortis de votre poche, en euros courants et en pouvoir
  d'achat, pour chaque année de revente possible.
- **Quand faut-il revendre ?** La fiscalité française avance par seuils, et
  l'année optimale n'est presque jamais la dernière.

Le tout comparé, à mise de fonds identique et net d'impôt des deux côtés, à un
Livret A, un fonds euros et un placement boursier.

## Ce qui est modélisé

**Acquisition** — prix, frais de notaire, frais d'agence, mobilier, et des postes
de travaux à durée de vie propre : chacun ajoute sa valeur au bien puis la perd
au rythme indiqué, parce qu'une cuisine de vingt ans ne vaut plus rien.

**Financement** — amortissement mensuel réel, assurance emprunteur, frais de
dossier, pénalités de remboursement anticipé.

**Exploitation** — loyers indexés, vacance locative, charges de copropriété,
taxe foncière, PNO, gestion, provision d'entretien, CFE.

**Fiscalité** — quatre régimes (micro-foncier, réel foncier avec déficit
imputable et reportable dix ans, micro-BIC, LMNP au réel avec amortissement par
composants et déficit BIC reportable), plus-value sur le prix de cession net de
frais avec abattements pour durée de détention, forfait travaux de 15 %, surtaxe
au-delà de 50 000 €, et la réintégration des amortissements LMNP (bâti et
travaux) introduite par la loi de finances 2025.

**Placements comparés** — mêmes versements aux mêmes dates ; gains boursiers et
du fonds euros imposés à la sortie au taux choisi, Livret A exonéré ; le
rendement annualisé du portefeuille boursier net d'impôt sert de référence.

**Monnaie** — inflation explicite. Par défaut, prix, loyers et charges la suivent :
le rendement vient alors du levier du crédit et des loyers, pas d'un pari sur les
prix.

**Graphiques** — rendement annualisé par année de revente, comparatif des quatre
régimes, gain net face aux trois placements, cascade du gain, trésorerie
annuelle, patrimoine net et dette, sensibilité du TRI aux six paramètres clés.

## Charte graphique

L'interface est monochrome (noir, blanc, gris) ; la couleur est réservée à la
donnée : `--up` et `--down` pour gain et perte, `--d1` à `--d4` pour les séries.
Police système, aucune ombre, rayons de 6 et 8 px. Les tokens sont déclarés en
tête du `<style>` de `index.html` ; rien n'est codé en dur ailleurs, et
`outils/verifier.py` le contrôle.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | La calculatrice : un seul fichier (style, corps, script), source de vérité. Sa feuille de style sert à tout le site. |
| `pages/accueil.html` | La page d'accueil, servie sur `/`. |
| `pages/*.html` | Questions fréquentes, hypothèses de calcul, mentions légales, 404. |
| `guides/*.html` | Les six guides : un bloc `meta` JSON puis un `<article class="prose">`. |
| `build.py` | Produit `site/` : éclate `index.html`, habille les autres pages avec l'en-tête et le pied de la calculatrice, génère `vitrine.js`, favicons, JSON-LD, sitemap, robots, en-têtes Cloudflare. |
| `outils/servir.py` | Construit, sert et ouvre le site en local. |
| `outils/verifier.py` | Contrôles avant publication. |
| `outils/captures.py` | Captures d'écran clair/sombre, grand et petit écran. |
| `outils/og_image.py` | Régénère `og-image.png` à partir de `outils/og-image.html`. |
| `wrangler.jsonc` | Déploiement Cloudflare Pages ; les URL inconnues renvoient `404.html`. |
| `site/` | Généré. À déployer tel quel, à ne pas éditer à la main. |

### Les pages

`/` présente l'outil, `/calculatrice/` est l'outil, `/guides/` explique, et deux
pages annexes détaillent la méthode : `/questions-frequentes/` et
`/hypotheses-de-calcul/`.

Le script de `index.html` est coupé en deux par des marqueurs. Le **bloc
partagé** ne contient que ce qui calcule ou dessine — il devient aussi
`site/js/vitrine.js`, de sorte que la page d'accueil rejoue le scénario par
défaut avec le moteur de la calculatrice, sans capture d'écran et sans risque de
dérive (`outils/verifier.py` compare les deux rendements). L'**interface**, en
dessous, est la seule à toucher au formulaire.

Éditez `index.html`, un guide ou une page, puis :

```sh
python3 outils/servir.py     # construit, sert et ouvre le navigateur
python3 build.py             # construit seulement
```

### Écrire un guide

Un fichier `guides/mon-sujet.html` devient `/guides/mon-sujet/`. Il commence par :

```html
<script type="application/json" id="meta">
{"titre": "≤ 60 caractères", "description": "≤ 160 caractères", "h1": "…",
 "court": "libellé du fil d'Ariane", "date": "2026-09-04", "lecture": "8 min", "ordre": 1}
</script>
<article class="prose"> … <!--META--> … </article>
```

`<!--META-->` reçoit la date et le temps de lecture. Les `<article>` d'une
section `.faqg` deviennent du balisage FAQPage ; une section `.lire` accueille
les liens croisés ; un `.cta` renvoie à la calculatrice, éventuellement
pré-réglée (`/calculatrice/#regime=reel-foncier` — l'URL porte toutes les
hypothèses).

Une page de `pages/` accepte en plus, dans son bloc `meta` : `racine` (servie
sur `/`), `noindex` (hors index et hors sitemap), `faq` (ajoute le balisage
FAQPage), `script` et `priorite`.

## Vérifier avant de publier

```sh
python3 outils/verifier.py
```

Plus de quatre-vingt-dix contrôles : ressources servies, métadonnées de chaque
page, sitemap complet et sans fantôme, liens internes, charte respectée, absence
d'appel vers un domaine tiers et de mesure d'audience, erreurs JavaScript et
débordement à 1360 et 390 px sur cinq pages, graphiques présents, égalité du
rendement affiché par l'accueil et par la calculatrice, et cohérence du moteur
financier (invariant TRI/graphique, frais de vente, impôt des placements,
déficit BIC, identité de la cascade). Code de sortie non nul si l'un échoue.

Et pour photographier le résultat (clair/sombre, 1360 et 390 px) :

```sh
python3 outils/captures.py captures/ / /calculatrice/ /guides/
```

## Limites

Les projections reposent sur vos hypothèses et ne remplacent pas l'avis d'un
conseiller fiscal. Ne sont pas modélisés : IFI, statut LMP, dispositifs Pinel,
Denormandie et Malraux, SCI à l'impôt sur les sociétés, démembrement, et le taux
d'endettement — un projet rentable ici peut être refusé par une banque. Les
plafonds du micro-foncier et du micro-BIC sont signalés, pas imposés.

Les hypothèses de calcul détaillées figurent en bas du calculateur.
