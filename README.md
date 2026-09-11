# Mon rendement locatif

Calculateur de rentabilité d'un investissement locatif en France, et six guides
qui expliquent ce qu'il mesure.

> **Pour voir le site :** `python3 outils/servir.py`.
> Ouvrir `index.html` en double-clic ne marche pas — c'est un fichier source,
> pas une page : les chemins sont absolus et les guides n'existent que dans
> `site/`, produit par `build.py`.

Il répond à deux questions que les simulateurs courants laissent de côté :

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

**Monnaie** — inflation explicite, fixée par défaut au taux directeur de la BCE
(facilité de dépôt). Prix, loyers et charges la suivent :
le rendement vient alors du levier du crédit et des loyers, pas d'un pari sur les
prix.

**Graphiques** — rendement annualisé par année de revente, comparatif des quatre
régimes, gain net face aux trois placements, cascade du gain, trésorerie
annuelle, patrimoine net et dette, sensibilité du TRI aux six paramètres clés.

**Brut ou net** — une bascule de la barre de navigation passe toute la
calculatrice avant impôt : verdict, graphiques, tableau et export CSV. Seule la
fiscalité disparaît (impôt sur les loyers, plus-value, reprise de déficit,
impôt des placements comparés) ; charges, crédit, taxe foncière et CFE restent
dus. L'écart entre les deux affichages est donc ce que coûte l'impôt. La
calculatrice s'ouvre toujours en net : le mode brut n'est jamais retenu.

## Deux règles d'interface

**Une explication ne s'écrit pas à l'écran.** Elle attend dans un
`<span class="ibody" hidden>` posé à côté de son bouton `i`, et une bulle unique,
bornée au viewport, l'affiche à la demande. Le texte reste donc dans le balisage —
lisible par un robot et par un lecteur d'écran — sans occuper la page. Deux
contrôles le tiennent : aucun bouton sans texte, et le clavier doit pouvoir ouvrir
la bulle puis la refermer. Un troisième plafonne à 120 caractères ce qui reste
visible sous un titre de graphique.

**Le panneau a deux niveaux.** Il s'ouvre sur les onze réglages marqués `key` dans
`index.html` — ceux auxquels le rendement est le plus sensible, plus ceux sans
lesquels il n'y a pas de projet. « Tous les réglages » découvre les vingt-cinq
autres, qui n'ont jamais cessé d'entrer dans le calcul. De même côté résultats :
le verdict, les indicateurs et les trois graphiques qui décident restent à
l'écran ; trésorerie, cascade, patrimoine, sensibilité et tableau annuel attendent
d'être dépliés — tracés quand même, et redessinés à l'ouverture.

## Charte graphique

L'interface est monochrome (noir, blanc, gris) ; la couleur est réservée à la
donnée : `--up` et `--down` pour gain et perte, `--d1` à `--d4` pour les séries.
Police système, aucune ombre, rayons de 6 et 8 px. Les tokens sont déclarés en
tête du `<style>` de `index.html` ; rien n'est codé en dur ailleurs, et
`outils/verifier.py` le contrôle.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Le balisage de la calculatrice, et la seule source de l'en-tête et du pied de page de tout le site. |
| `src/style.css` | La feuille de style, unique pour tout le site. |
| `src/moteur.js` | Le calcul. Aucun accès au document : `outils/verifier.py` le contrôle, et le harnais de test l'exécute tel quel. |
| `src/graphiques.js` | Le dessin SVG, les infobulles des graphiques et celles de l'interface, plus les configurations partagées par les deux pages. |
| `src/calculatrice.js` | L'interface : lecture du formulaire, rendu, persistance. Seul fichier à connaître les identifiants des champs. |
| `src/vitrine.js` | Le pilote de la page d'accueil. |
| `src/assistant.js` | Les sept questions de l'accroche, et le lien préréglé qu'elles construisent. |
| `pages/accueil.html` | La page d'accueil, servie sur `/`. |
| `pages/*.html` | Questions fréquentes, hypothèses de calcul, mentions légales, 404. |
| `guides/*.html` | Les six guides : un bloc `meta` JSON puis un `<article class="prose">`. |
| `build.py` | Produit `site/` : concatène les sources, habille les autres pages avec l'en-tête et le pied de la calculatrice, génère JSON-LD, sitemap, robots, `security.txt`, en-têtes Cloudflare. |
| `outils/favicon.py` | Le logotype et les icônes qu'on en tire, rastérisées sans dépendance. |
| `outils/_local.py` | Le serveur local et la détection de Chrome, partagés par les trois outils. |
| `outils/hooks/pre-commit` | Refuse un commit dont `site/` n'a pas été régénéré. |
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

L'accroche de `/` ne renvoie pas vers un formulaire vide : elle pose sept
questions — prix, loyer, nu ou meublé, travaux, apport, durée du prêt, tranche
d'imposition — chacune préremplie, chacune dotée d'un « je ne sais pas encore »
quand elle s'y prête. Le régime fiscal, lui, n'est pas demandé : le moteur
départage les régimes de la famille choisie et retient le plus favorable. Les
réponses partent dans le fragment de `/calculatrice/`, où tout reste modifiable.

### Comment les sources s'assemblent

```
src/moteur.js + src/graphiques.js + src/calculatrice.js                     ->  site/js/app.js
src/moteur.js + src/graphiques.js + src/vitrine.js + src/assistant.js       ->  site/js/vitrine.js
```

Un seul moteur, un seul jeu de graphiques, deux pilotes : la page d'accueil
rejoue le scénario par défaut avec le code exact de la calculatrice, sans
capture d'écran et sans possibilité de dérive. Les valeurs par défaut sont
relues dans le balisage de `index.html`, jamais recopiées — de même que les
listes de choix, que `build.py` injecte dans `OPTIONS`.

Trois règles, et ce sont des contrôles, pas des conventions :

- `src/moteur.js` ne touche jamais au document — il sert aussi la vitrine, et
  le harnais de test l'exécute hors navigateur.
- `src/graphiques.js` a le droit au document, jamais aux identifiants des
  champs.
- `src/assistant.js` ne connaît aucun chiffre : il propose des valeurs déduites
  de `DEFAUTS` à proportion du prix saisi. Accepter toutes ses propositions doit
  donc rendre un lien qui ne fixe aucune hypothèse, `/calculatrice/#complet=1`,
  c'est-à-dire le scénario même de la vitrine — et c'est un contrôle. Le
  marqueur `complet` fait repartir la calculatrice des valeurs d'ouverture,
  quoi qu'une visite précédente ait laissé dans le navigateur ; un lien de
  guide, lui, se pose sur la saisie du visiteur. « Copier le lien » va plus
  loin : il inscrit chaque hypothèse, pour qu'un scénario partagé rende la même
  chose chez n'importe qui, et ne change pas quand les valeurs par défaut du site
  évoluent — c'est aussi un contrôle.
- `index.html` ne porte que du balisage, délimité par des marqueurs appariés
  `<!-- entete:début -->` / `<!-- entete:fin -->` : `build.py` refuse de
  construire s'ils manquent, sont dupliqués ou se croisent.

Éditez une source, un guide ou une page, puis :

```sh
python3 outils/servir.py     # construit, sert et ouvre le navigateur
python3 build.py             # construit seulement
python3 outils/verifier.py   # 150 contrôles avant publication
```

### Installer le garde-fou

`site/` est versionné mais généré. Un hook empêche de committer une version
périmée — sans quoi on déploie un site qui ne correspond plus aux sources :

```sh
ln -sf ../../outils/hooks/pre-commit .git/hooks/pre-commit
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

Plus de cent cinquante contrôles : ressources servies, métadonnées de chaque
page, sitemap complet et sans fantôme, liens internes, charte respectée, absence
d'appel vers un domaine tiers et de mesure d'audience, erreurs JavaScript et
débordement à 1360 et 390 px sur cinq pages — panneau replié puis déployé —,
graphiques présents, infobulles pourvues d'un texte et pilotables au clavier,
budget de texte sous chaque titre, égalité du
rendement affiché par l'accueil et par la calculatrice, parcours complet de
l'assistant, et cohérence du moteur financier (invariant TRI/graphique, frais de
vente, impôt des placements, déficit BIC, identité de la cascade). Code de sortie non nul si l'un échoue.

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
