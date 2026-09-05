# Audit — Mon rendement locatif (monrendementlocatif.fr)

Document produit le 2026-09-05, à partir de l'état du dépôt au commit `30bd897`
(`main`, en avance de 2 sur `origin/main` — rien n'a encore été poussé).

**Destiné à un autre agent IA** qui reprendra ce projet pour corriger les bugs
et refactorer le site. Cinq volets, menés par des agents d'exploration
distincts puis, pour les points les plus importants, **revérifiés
personnellement en exécutant le vrai moteur** (JavaScriptCore) plutôt qu'en
faisant confiance aveuglément aux rapports d'agents — deux fausses pistes ont
ainsi été écartées (voir C.4 et C.6), ce qui a évité de faire perdre du temps
au prochain agent à les poursuivre.

**Étiquettes** :
- ✅ **CORRIGÉ** — traité depuis, avec le contrôle qui empêche la rechute.
- 🔴 **BUG CONFIRMÉ** — vérifié en relisant/exécutant le code moi-même.
- 🟠 **À VÉRIFIER** — trouvaille d'agent plausible mais pas revérifiée à 100 %,
  ou question qui dépend d'une source externe (droit fiscal, rendu navigateur
  réel).
- 🟡 **LIMITATION / AMÉLIORATION** — comportement correct mais perfectible, ou
  chantier de refactor identifié.
- 🟢 **OK** — contrôlé, rien à signaler (ou fausse alerte écartée après
  vérification).

---

## Où en est le chantier (mis à jour le 2026-09-05)

**Phase 1 — corrections : faite.** Tout ce qui est marqué ✅ ci-dessous est
corrigé dans la structure existante, chaque correction accompagnée du contrôle
qui l'aurait attrapée. `outils/verifier.py` passe de **97 à 146 contrôles**.

Deux principes ont guidé cette passe, et méritent d'être conservés :

1. **Ne pas croire l'audit sur parole.** Chaque affirmation chiffrée a été
   rejouée sur le vrai moteur avant correction. C'est ainsi que C.1, présenté
   ici comme un bug confirmé, s'est révélé être un **faux positif** — et que le
   vrai défaut, situé juste à côté, a été trouvé.
2. **Un contrôle qui ne peut pas échouer ne vaut rien.** Les nouveaux contrôles
   ont été validés par **mutation** : chaque bug a été réintroduit un par un
   dans `index.html` et l'échec attendu vérifié. Le premier jet du contrôle de
   contraste a d'ailleurs échoué à cette épreuve — il lisait les tokens, pas
   les règles qui les utilisent, si bien qu'un composant pouvait repasser à une
   couleur illisible sans qu'il bronche. Il a été réécrit pour lire la couleur
   dans la règle du composant.

**Phase 2 — refactor : faite.** `index.html` ne porte plus que du balisage
(391 lignes au lieu de 2 271) ; le style et le script vivent dans `src/`, que
`build.py` **concatène** au lieu de découper :

```
src/moteur.js + src/graphiques.js + src/calculatrice.js  ->  site/js/app.js
src/moteur.js + src/graphiques.js + src/vitrine.js       ->  site/js/vitrine.js
```

Critère d'acceptation tenu : **toutes les pages HTML et le CSS produits sont
identiques au bit près** avant et après le refactor, et le moteur rend les
mêmes chiffres. Seuls les deux fichiers JS diffèrent — réordonnancement de la
concaténation, et les configurations de graphiques désormais partagées.

Ce qui était une convention est devenu un contrôle : `src/moteur.js` ne peut
plus toucher au document, `src/graphiques.js` ne peut plus connaître un champ,
`index.html` ne peut plus reprendre de code, et les marqueurs de découpe ne
peuvent plus manquer, se dupliquer ou se croiser sans arrêter la construction.
Quatre mutations l'ont vérifié.

---

## Résumé exécutif — par priorité

### Bugs confirmés (tous corrigés)

1. ✅ **`surtaxePV()` surestimait l'impôt de plus-value** juste au-dessus de
   50k/100k/150k/200k/250k € (jusqu'à ~79 % de trop, décote manquante).
   **Corrigé le 2026-09-05** : les dix branches de l'art. 1609 nonies G sont
   écrites, quatorze points de la table légale sont vérifiés à chaque
   exécution, plus la monotonie sur 45 000–270 000 €. Aucun chiffre publié ne
   bouge : les bases du scénario de référence tombent hors des bandes de
   lissage. → A.1
2. 🔴 ~~`guides/immobilier-ou-bourse.html` cite des montants de gain immobilier
   faux~~ — **FAUX POSITIF, invalidé le 2026-09-05** : le tableau est exact. Il
   cite `gainImmo` (trésorerie replacée), `quand-revendre.html` cite `gain`
   (trésorerie additionnée telle quelle) : deux grandeurs différentes, toutes
   deux justes, qui ne coïncident que tant que la trésorerie est négative. Le
   vrai défaut était **la phrase** qui suit le tableau : l'écart *se resserre*
   (33 500 € → 31 900 € → 18 000 €) et non « se creuse ». → C.1
3. ✅ **Texte vert et rouge illisible en mode clair** — le problème débordait
   largement du badge signalé : `--up` ne donnait que 2,93:1 sur `--surface`,
   donc le TRI héros, les tuiles, le tableau annuel et les chiffres tracés
   dans trois graphiques échouaient aussi. **Corrigé** par deux tokens
   `--up-ink`/`--down-ink` réservés au texte, et 18 rapports WCAG désormais
   calculés à chaque exécution. → E.3
4. ✅ **Infobulles inaccessibles au clavier et au tactile**, et **5 des 7
   graphiques sans aucune donnée hors du SVG**. **Corrigé** : `pointer*` à la
   place de `mouse*` (souris, tactile et stylet), chaque SVG est un arrêt de
   tabulation unique piloté aux flèches / Début / Fin / Échap, et les sept
   graphiques produisent un tableau `visually-hidden` de toutes leurs valeurs.
   → E.1, E.2
5. ✅ **Trois divisions non protégées** (`bruteCout`, `nette`, `netteNette`).
   **Corrigé**, même patron que `brute`, avec un contrôle sur un scénario à
   coût d'acquisition entièrement nul. → A.3

En prime, deux défauts non listés initialement, traités dans la même passe :
`duree = 0` laissait une **dette fantôme** jamais amortie ni facturée mais
retranchée du prix de vente (A.4), et le token `--ink-3` **n'existait pas**
(B.6) — un contrôle croise désormais tous les `css("--…")` du JS avec les
variables réellement déclarées.

### À vérifier avant de faire confiance aveuglément

6. 🟠 Le taux différencié de 18,6 %/17,2 % de prélèvements sociaux (meublé/nu,
   `PS_LOYERS`) a été vérifié par recherche web (sources citées en A.2) mais
   pas sur une source primaire (BOFiP) — règle récente et inhabituelle.
7. ✅ Contraste de `--text-muted` en clair : 4,54:1, moins de 1 % de marge.
   **Corrigé** en `#6b6b6b` (5,11:1), vérifié automatiquement.

### Chantiers de refactor (tous traités)

8. ✅ **`VITRINE_JS` avait divergé de `render()`** : la page d'accueil perdait
   les repères de seuils fiscaux. `VITRINE_JS` n'existe plus ; les deux
   graphiques communs sont écrits une seule fois. → D.2
9. ✅ Le découpage par marqueurs ne protégeait que leur *présence*, pas leur
   *position* : un réordonnancement des sections HTML aurait produit un
   en-tête corrompu sur tout le site sans la moindre erreur de build. Les
   sources sont désormais des fichiers séparés, et les trois règles de
   séparation sont des contrôles. → D.1
10. ✅ `site/` versionné sans garde-fou : hook `pre-commit` ajouté. → B.2
11. ✅ Pas de *debounce* sur les champs numériques. → E.6
12. ✅ CSS mort et variable CSS fantôme. `.visually-hidden` est conservée :
    elle porte les équivalents textuels des graphiques. → B.6
13. 🟢 Positif à préserver : sur mobile, le verdict (TRI + indicateurs)
    s'affiche **avant** le formulaire de 40+ champs grâce à un réordonnancement
    CSS (`order`) — bon choix UX déjà en place, à ne pas perdre dans une
    refonte.

**Ce qui reste ouvert**, et c'est peu : le taux de prélèvements sociaux meublé
à revérifier sur source primaire (A.2), la reste de duplication SVG entre les
trois fonctions de dessin (D.3), les classes CSS mortes toujours non détectées
automatiquement (B.6), la taille de la poignée du curseur non testée sur un
appareil réel (E.8), et la pastille de légende à 2,93:1 assumée (E.3).

### Fausses pistes écartées après vérification

- Le calcul « net-net » du guide `calcul-rendement-locatif.html` (1,8 % en
  micro-foncier) est **correct** — un agent l'avait jugé faux en supposant à
  tort un coût total identique entre meublé et nu, alors que le mobilier (8
  000 €) ne s'applique qu'au meublé. Voir C.4.
- Le TRI identique à 2,5 % entre micro-BIC et micro-foncier n'est **pas** un
  copier-coller : le moteur donne 2,46 % et 2,55 %, qui arrondissent tous les
  deux à 2,5 %. Coïncidence réelle, vérifiée par exécution. Voir C.6.
- « Meilleure année de revente : Année 25 » dans `outils/og-image.html` est
  **correct** pour l'horizon par défaut (25 ans) — ce n'est pas en
  contradiction avec le guide qui montre un pic à 30 ans sous un *autre*
  réglage d'horizon. Voir C.3 pour la nuance à documenter malgré tout.

---

## A. Moteur financier (`index.html`, fonction `compute()` et voisines)

Tout le moteur vit dans le `<script>` de `index.html`, entre les marqueurs
`/* ═════════ modèle et dessin ... */` et `/* ═════════ fin du bloc
partagé ... */`. C'est aussi ce bloc que `build.py` extrait tel quel pour
produire `site/js/vitrine.js` (page d'accueil) — toute correction faite ici
doit rester à l'intérieur de ces marqueurs pour profiter aux deux pages.

### A.1 ✅ Surtaxe sur la plus-value immobilière — décote manquante (CORRIGÉ)

```js
// index.html, fonction surtaxePV
function surtaxePV(base){
  if(base<=50000) return 0;
  const t = base<=100000?0.02 : base<=150000?0.03 : base<=200000?0.04 : base<=250000?0.05 : 0.06;
  return base*t;
}
```

La loi (art. 1609 nonies G du CGI) applique bien ces taux par tranche, mais
avec un **mécanisme de lissage dans une bande étroite juste au-dessus de
chaque seuil**, pour éviter un effet de seuil brutal. La formule réelle :

| Base imposable | Taxe due |
|---|---|
| ≤ 50 000 € | 0 |
| 50 001 – 60 000 € | `2 %×PV − (60 000−PV)×1/20` |
| 60 001 – 100 000 € | `2 %×PV` |
| 100 001 – 110 000 € | `3 %×PV − (110 000−PV)×1/10` |
| 110 001 – 150 000 € | `3 %×PV` |
| 150 001 – 160 000 € | `4 %×PV − (160 000−PV)×15/100` |
| 160 001 – 200 000 € | `4 %×PV` |
| 200 001 – 210 000 € | `5 %×PV − (210 000−PV)×20/100` |
| 210 001 – 250 000 € | `5 %×PV` |
| 250 001 – 260 000 € | `6 %×PV − (260 000−PV)×25/100` |
| > 260 000 € | `6 %×PV` |

Le code actuel omet les six bandes de lissage. **Vérifié en exécutant la
fonction** : `surtaxePV(51000)` retourne `1020`, alors que la vraie formule
donne `0.02×51000 − (60000−51000)/20 = 1020 − 450 = 570` — **le code
surestime de 79 %** juste au-dessus du seuil. Vérifié aussi que l'écart
disparaît bien à 60 000 € (`surtaxePV(60000)=1200`, continu avec la formule
réelle) et reste à peu près constant juste après (`surtaxePV(61000)=1220`) —
signature exacte d'un lissage de seuil manquant, pas d'une erreur aléatoire.

**Corrigé le 2026-09-05** : `surtaxePV` parcourt une table `SURTAXE_PV` de
neuf paliers `[plafond, taux, décote]`, `impotPV` est inchangé. Deux contrôles
gardent la correction : quatorze points de la table légale (dont 51 000 → 570 €
et 155 000 → 5 450 €) et l'absence d'inversion sur 45 000–270 000 €. Le saut
résiduel de 500 € à 50 001 € n'est pas un bug : la loi elle-même le conserve,
la décote le divise par deux sans l'effacer.

**Impact sur les chiffres publiés : aucun.** Vérifié en rejouant les quatre
régimes avec l'ancienne et la nouvelle fonction — les bases de plus-value du
scénario de référence tombent hors des bandes de lissage, tous les guides
restent exacts.

### A.2 🟠 Taux de prélèvements sociaux différencié meublé/nu (18,6 % vs 17,2 %)

```js
const PS_LOYERS = {"micro-foncier":"17.2", "reel-foncier":"17.2", "lmnp-micro":"18.6", "lmnp-reel":"18.6"};
```

Un agent d'audit (limité à ses connaissances générales, sans accès web) n'a
pas pu corroborer qu'un taux de CSG différencié (10,6 % en meublé contre
9,2 % en nu) existe pour de simples revenus patrimoniaux d'un particulier.
**Cette règle a cependant été vérifiée par recherche web dans une session
antérieure de ce projet**, avec plusieurs sources concordantes :

- [Prélèvements sociaux LMNP : le taux passe à 18,6 % en 2026 — CPIM](https://www.cpim.fr/prelevements-sociaux-immobilier-2026/)
- [Hausse de la CSG en 2026 — Banque Transatlantique](https://www.banquetransatlantique.com/fr/actualites/loi-de-financement-de-la-securite-sociale-pour-2026-hausse-de-la-CSG.html)
- [Hausse de la CSG en 2026, impact LMNP — Journal de l'Agence](https://www.journaldelagence.com/1409327-hausse-de-la-csg-en-2026-quel-impact-pour-les-revenus-immobiliers-et-les-lmnp)

Sources secondaires (conseil patrimonial), pas le texte de loi. Recommandation
: revérifier sur bofip.impots.gouv.fr avant la campagne déclarative de
printemps — règle récente (LFSS 2026) et inhabituelle (traiter différemment
deux catégories de revenus patrimoniaux n'est pas la norme).

**Le 2026-09-05**, la réserve a été portée dans
`pages/hypotheses-de-calcul.html` pour que le lecteur la voie : le taux reste
modifiable et la page dit qu'il est prudent de le reconfirmer. Le taux lui-même
n'a pas été changé, faute de source primaire dans un sens ou dans l'autre.

### A.3 ✅ Divisions non protégées si `besoin = 0` (CORRIGÉ)

```js
brute: p.prix > 0 ? loyerBrutAn/p.prix : 0,     // gardée
bruteCout: loyerBrutAn/besoin,                  // PAS gardée
nette: (r1.loyers - r1.charges)/besoin,         // PAS gardée
netteNette: (r1.loyers - r1.charges - r1.impot)/besoin, // PAS gardée
```

Si `prix=0` et tous les frais d'acquisition sont nuls, `besoin = 0` et ces
trois lignes produisent `Infinity` ou `NaN` (0/0). `brute` juste au-dessus
montre que le garde-fou était connu mais n'a pas été répliqué.

**Corrigé le 2026-09-05** : même patron que `brute` sur les trois lignes.
Contrôle « coût d'acquisition nul : aucune division par zéro » sur un scénario
où prix, frais, mobilier et travaux valent tous zéro.

### A.4 ✅ `duree = 0` produit une dette fantôme (CORRIGÉ)

Dans `schedule()`, si `duree` (ans) vaut 0, `n = Math.round(dureeAns*12) = 0`.
La boucle mensuelle ne s'exécute jamais (`idx >= n` vrai dès `idx=0`), donc :
`ass` (assurance cumulée) reste à 0 pour toujours, mais `sch.mensualite`
inclut quand même l'assurance mensuelle — **affichée sans jamais être
prélevée**. `crd` ne diminue jamais et n'est jamais facturé d'intérêts : une
dette permanente, gratuite et jamais remboursée, soustraite de `netVente` à
toutes les années futures. Le champ `duree` n'a pas d'attribut `min` HTML, et
`read()` ne clampe pas la valeur : un champ vidé donne silencieusement
`duree=0`.

**Corrigé le 2026-09-05**, aux trois niveaux : `min="1" max="40"` sur le
champ, clampage dans `read()` (le champ vidé ne peut plus valoir 0), et garde
`if(n<=0) capital = 0` dans `schedule()` — un prêt de durée nulle est un achat
comptant, pas une dette éternelle. Le moteur reste donc correct même appelé
hors du formulaire. Contrôle : le capital restant dû final est nul.

### A.5 🟡 Assurance emprunteur sur capital initial, pas sur capital restant dû

```js
const assurM = capital>0 ? capital*(assurPct/100)/12 : 0;   // calculé une fois
// ... puis ajouté tel quel chaque mois : ass += assurM;
```

Modélise l'assurance groupe bancaire classique (prime fixe sur capital
initial), pas l'assurance déléguée à prime dégressive (de plus en plus
fréquente, souvent moins chère sur la durée). Choix raisonnable.

**Documenté le 2026-09-05** dans `pages/hypotheses-de-calcul.html` : le
comportement est désormais énoncé, avec la mention explicite que le calcul
surestime une assurance déléguée sur la seconde moitié du crédit. Le modèle
lui-même n'a pas changé.

### A.6 🟢 Points vérifiés et corrects (pas d'action requise)

- **Amortissement du prêt** (`schedule`) : formule d'annuité standard
  correcte, gère `taux=0`.
- **Solveur de TRI** (`irr`, bissection) : garde bien le cas où le NPV ne
  change jamais de signe (retourne `null`), 200 itérations largement
  suffisantes. Limitation théorique non bloquante : suppose un flux à un seul
  changement de signe (presque toujours vrai ici, jamais démenti en
  pratique).
- **Déficit foncier** (réel foncier) : séparation intérêts/hors-intérêts,
  plafond 10 700 €, report FIFO sur 10 ans, reprise à 3 ans — tracé
  algébriquement, aucun double comptage trouvé.
- **LMNP réel** : séparation déficit BIC (report 10 ans, avant amortissement)
  et stock d'amortissement (report illimité, jamais créateur de déficit) —
  correcte. Réintégration à la plus-value : seuls bâti+travaux sont
  réintégrés, le mobilier en est exclu — conforme LF 2025/2026.
- **CFE** : exonération 1ʳᵉ année et sous 5 000 € de recettes — correct.
  Restriction aux régimes meublés — correcte. Note faible confiance, non
  vérifiée : base peut-être réduite de moitié en 2ᵉ année (art. 1478 II), non
  modélisée.
- **Comparaison aux placements** (`portefeuille`, `netDe`, conversion
  nominal/réel) : l'assiette taxée est toujours strictement le gain, jamais
  le capital. Pas de double imposition trouvée. Conversion réel→nominal
  appliquée uniformément.
- **Neutralisation du mobilier en location nue** : tracée jusqu'à tous les
  points d'usage — aucune fuite trouvée.
- **Cas limites** : `apport=0` → `tri=null` (vérifié) ; `horizon=1` → borné
  `[1,40]`, aucun plantage ; poste de travaux `taux=0`/`duree=0` → cohérent.
- **Identité comptable de la cascade** : vérifiée algébriquement, la somme des
  marches égale exactement `gain`.

---

## B. Pipeline de build et structure du site

### B.1 🟢 build.py ↔ wrangler.jsonc

Cohérents : `assets.directory: "./site/"` correspond à `SITE = RACINE /
"site"` ; `not_found_handling: "404-page"` correspond à l'écriture de
`site/404.html` à la racine.

### B.2 ✅ Aucun garde-fou n'empêchait un `site/` désynchronisé (CORRIGÉ)

`site/` est **versionné dans git** alors que le README le décrit comme
« généré, à ne pas éditer à la main ». Rien n'oblige à relancer `python3
build.py` avant un commit touchant `index.html`/`pages/`/`guides/`. Pas de
`.github/workflows`, pas de hook git actif. Le risque : déployer une version
périmée, Cloudflare Pages servant `site/` tel quel.

**Corrigé le 2026-09-05** : `outils/hooks/pre-commit` lance `build.py` et
refuse le commit si `site/` bouge après coup, en affichant ce qui a changé. Il
vit dans le dépôt et s'installe d'une ligne, documentée dans le README :

```sh
ln -sf ../../outils/hooks/pre-commit .git/hooks/pre-commit
```

### B.3 ✅ Liste de nettoyage des dossiers codée en dur (CORRIGÉ)

```python
for ancien in ("guides", "calculatrice", "questions-frequentes",
               "hypotheses-de-calcul", "mentions-legales", "assets/fonts"):
```

Correspond à l'état actuel de `pages/`, mais si une page est ajoutée puis
retirée plus tard, son dossier de sortie ne sera jamais nettoyé
automatiquement (contrairement à `guides/`, entièrement rasé et reconstruit).
`"assets/fonts"` ne correspond plus à rien (nettoyage mort mais inoffensif).

**Corrigé le 2026-09-05** : la liste se déduit du contenu de `pages/`, et
`"assets/fonts"` a disparu.

### B.4 ✅ Trous de couverture dans `outils/verifier.py` (COMBLÉS)

- La sonde de l'accueil (`/`) ne vérifie jamais `vAvisBox`/`vAvis` (l'avis
  éditorial), alors que `avisBox` l'est bien sur la calculatrice.
- Un seul guide sur six (`/guides/tri-immobilier/`) est sondé au navigateur
  pour erreurs JS/débordement — **et c'est précisément le guide qui ne
  contenait pas l'erreur trouvée en C.1**, dans `immobilier-ou-bourse.html`,
  jamais sondé.
- Le test « déficit reporté » ne couvre que le déficit BIC (`lmnp-reel`).
  Aucun test équivalent pour le déficit **foncier** (`reel-foncier`, plafond
  10 700 €, report 10 ans) — mécanique différente, jamais vérifiée par le
  harnais JavaScriptCore.

**Comblés le 2026-09-05.** Les six guides sont désormais chargés en Chrome
(la liste est dérivée de `site/guides/`, elle suivra donc tout guide ajouté),
`vAvisBox`/`vAvis` sont sondés sur l'accueil, et deux contrôles couvrent le
déficit foncier : l'économie de l'année 1 vaut exactement plafond × TMI (et
double quand on double le plafond), et l'impôt cumulé sur l'horizon est bien
inférieur au même scénario sans travaux — donc le surplus non imputé
réapparaît au lieu de disparaître.

S'y ajoutent, dans la même passe, quatre contrôles d'accessibilité (sept
équivalents textuels, sept graphiques focalisables, infobulle pilotable au
clavier, avis éditorial rendu sur l'accueil), dix-huit rapports de contraste
calculés, et le croisement des tokens CSS appelés par le JS avec ceux
réellement déclarés. **Le fichier passe de 97 à 136 contrôles.**

Chacun de ces contrôles a été validé par mutation : le bug qu'il vise a été
réintroduit un par un dans `index.html`, et l'échec attendu vérifié.

### B.5 🟢 Bloc partagé (vitrine) ↔ `pages/accueil.html`

Vérifié un par un : tous les `id="v..."` de `pages/accueil.html` sont bien
renseignés par `VITRINE_JS`. Aucun champ orphelin. Toutes les fonctions
utilisées sont bien à l'intérieur des marqueurs partagés.

**Mais** (nuance ajoutée après le second audit, voir D.2) — le fait que
`VITRINE_JS` fonctionne aujourd'hui ne veut pas dire qu'il reste synchronisé :
c'est une copie Python de configuration JS entretenue à la main, qui a déjà
divergé sur un point concret (les `milestones` du graphique placements,
présents côté calculatrice, absents côté accueil).

### B.6 🟡 CSS mort

- `.faq article`, `.faq h3`, etc. (section « questions, notes, alertes ») :
  plus aucun élément ne porte la classe `faq` — seule `.faqg` est utilisée
  depuis l'extraction de la FAQ vers `pages/questions-frequentes.html`.
- `.visually-hidden` : définie, jamais référencée nulle part (HTML ni JS).
- `.notes` (avec sa règle responsive `.canvas>.notes{margin-bottom:48px}`) :
  entièrement définie mais non utilisée — la section « Pour aller plus loin »
  utilise `<ul class="liens">` à la place. Reliquat d'une section renommée
  dont le CSS n'a jamais été supprimé.
- **Variable CSS fantôme** *(corrigée)* : `css("--ink-3")` (une ligne, dans le
  tracé de la ligne de séparation d'un graphique) référençait un token qui
  n'existait **nulle part** dans la feuille de style (les tokens réels s'appellent
  `--text-muted`, `--border`, etc.). Comme les couleurs sont lues par nom de
  chaîne au runtime (`getComputedStyle(...).getPropertyValue(n)`), une faute
  de frappe/un renommage oublié comme celui-ci **ne plante rien** — retourne
  juste une chaîne vide silencieusement. `outils/verifier.py` ne détecte que
  les couleurs hex codées en dur, pas les références à un token inexistant.

**Traité le 2026-09-05** : `--ink-3` devient `--text-muted` ; `.faq …` et
`.notes` (y compris sa règle responsive) sont supprimées ; `.visually-hidden`
est **conservée** — elle porte désormais les équivalents textuels des
graphiques (voir E.2) et n'est donc plus morte.

Le trou d'outillage qui avait laissé passer `--ink-3` est refermé : un contrôle
croise tous les `css("--…")` et les `color:`/`textColor:` du JS construit avec
les variables déclarées dans le CSS construit. Les classes CSS mortes, elles,
ne sont toujours pas détectées automatiquement — chantier ouvert.

### B.7 🟢 Sitemap, robots.txt, _headers, favicons

Tous cohérents : sitemap complet, sans URL fantôme, priorités défendables ;
`robots.txt` pointe vers le bon sitemap ; règles de cache non contradictoires ;
favicon/apple-touch-icon/SVG dessinés à partir des mêmes constantes
géométriques.

### B.8 ✅ Asymétrie de fraîcheur du sitemap (`lastmod`) (CORRIGÉ)

Pour les guides, `<lastmod>` vient d'une métadonnée JSON explicite. Pour les
pages, `<lastmod>` venait de l'horodatage du fichier sur disque, que git ne
préserve pas après un clone frais : le sitemap annonçait alors que toutes les
pages dataient du jour du clone.

**Corrigé le 2026-09-05** : les pages prennent leur date de leur bloc `meta`,
comme les guides, et `build.py` refuse de construire une page indexable qui
n'en aurait pas.

### B.9 ✅ README — petit défaut de formatage Markdown (CORRIGÉ)

Une phrase d'introduction au projet était piégée à l'intérieur d'un blockquote
par une ligne de continuation sans le préfixe `>` (lazy continuation
CommonMark). **Corrigé le 2026-09-05** : la phrase est sortie du blockquote.

---

## C. Cohérence du contenu (guides, pages, valeurs par défaut)

**Méthode** : cross-référencement textuel systématique des six guides et
quatre pages annexes contre les valeurs par défaut actuelles d'`index.html`,
puis **vérification par exécution du vrai moteur** (JavaScriptCore) pour
chaque désaccord suspecté, plutôt que de trancher à l'œil. Deux fausses
alertes ont ainsi été écartées (C.4, C.6) et un vrai bug confirmé (C.1).

### État de référence actuel

```
prix=200000  notairePct=8  fraisAcq=0  mobilier=8000  apport=35000
duree=20  taux=3.4  assur=0.34  fraisDossier=2500
loyer=900  vacance=5  tf=1200  copro=60  pno=180  gestion=0  entretien=5
horizon=25  inflation=2  fraisVente=5
livretA=-0.3  fondsEuros=0  bourse=4  fiscBourse=31.4  fiscFonds=30
regime=lmnp-reel (LMNP au réel)  tmi=30
```

Résultats moteur confirmés par exécution directe :

| Horizon | TRI | Gain (année) | Meilleure année (best.y) |
|---|---|---|---|
| 25 ans (défaut) | +4,34 % | 187 855 € (an 25) | 25 (best.tri = 4,34 %) |
| 30 ans | +4,79 % | 297 388 € (an 30) | 30 (best.tri = 4,79 %) |

`gainBourse` an 25 = 224 607 € ; an 30 = 340 493 €.

### C.1 🟢 `immobilier-ou-bourse.html` — faux positif, et le vrai défaut à côté

**Ce que cet audit affirmait d'abord** (à tort) : le tableau du guide cite
192 700 €/322 500 € à 25/30 ans là où le moteur donne 187 855 €/297 388 €,
donc la ligne « Immobilier » serait périmée.

**Ce qui est vrai** : les deux jeux de chiffres sortent du moteur, mais de
**deux propriétés différentes** de la même ligne de résultat :

| Grandeur | Définition | 15 ans | 25 ans | 30 ans |
|---|---|---|---|---|
| `gain` | `cumulCF + netVente − cash0` — la trésorerie est additionnée telle quelle | 43 400 € | 187 900 € | 297 400 € |
| `gainImmo` | `netVente + potImmoNet − miseTotale` — la trésorerie excédentaire est replacée au taux de la bourse, à mise de fonds identique | 43 400 € | 192 700 € | 322 500 € |

`quand-revendre.html` cite la première (c'est le « gain net » affiché par la
calculatrice), `immobilier-ou-bourse.html` la seconde (la seule comparable aux
colonnes bourse / Livret A / fonds euros du même tableau, qui reposent toutes
sur la méthode à mise de fonds identique). Les deux guides sont exacts. Les
deux valeurs **coïncident jusqu'à la fin du crédit** (43 400 € à quinze ans),
parce que tant que la trésorerie est négative il n'y a rien à replacer ; elles
divergent ensuite. L'erreur de cet audit a été de supposer qu'un seul chiffre
pouvait mériter le nom de « gain net ».

**Le vrai défaut, lui, était juste en dessous du tableau** : *« la bourse
l'emporte […] et l'écart se creuse »*. L'écart réel, calculé sur les bonnes
grandeurs, vaut 33 500 € à quinze ans, 31 900 € à vingt-cinq et 18 000 € à
trente : il **se resserre**. La phrase disait exactement l'inverse de ses
propres chiffres.

**Corrigé le 2026-09-05** : la phrase est réécrite avec les trois écarts et
leur explication (les abattements de durée de détention effacent l'impôt de
plus-value à 22 et 30 ans, quand le portefeuille reste taxé à 31,4 %), l'en-tête
de colonne devient « Gain net, trésorerie replacée », et la note de méthode dit
explicitement pourquoi ce chiffre diffère du « gain net » de la calculatrice
au-delà de la vingtième année. Le tableau lui-même n'a pas été touché.

**Leçon pour la suite** : deux grandeurs voisines portant le même nom dans deux
pages est un piège réel — il a trompé un agent d'audit, puis la vérification qui
devait le contredire. Avant de déclarer un chiffre faux, vérifier *quelle*
propriété du moteur il cite.

### C.2 🟢 Fichiers propres (aucune incohérence trouvée)

- `pages/accueil.html` — tous les chiffres du scénario sont rendus
  dynamiquement (`<span id="v...">`), aucun nombre codé en dur périmé.
- `pages/mentions-legales.html`, `pages/404.html` — propres.
- `pages/hypotheses-de-calcul.html` — PFU 31,4 %, PS meublé/nu 18,6/17,2 %,
  notaire 8 %, distinction LF 2025 (introduction)/2026 (confirmation) —
  tout cohérent avec le reste du site.
- `guides/tri-immobilier.html` — son tableau (point mort année 9, TRI 15
  ans +2,9 %, 25 ans +4,3 %, 30 ans +4,8 %) correspond exactement aux
  valeurs moteur confirmées ci-dessus, et concorde chiffre pour chiffre avec
  `guides/quand-revendre.html`.
- **Aide contextuelle d'`index.html`** — les 15 `<span class="hint">`
  vérifiées contre leur `value=` voisine correspondent toutes (mobilier
  « environ 4 % du prix » = 8000/200000 ; notaire, PS, fiscBourse/fiscFonds —
  tout concorde).
- **Liens croisés entre guides** — chaque lien `/guides/...` trouvé dans les
  pages et les six guides pointe vers un fichier qui existe réellement, et
  le texte du lien correspond au sujet réel de la cible. Aucun lien cassé.
- Nom du site cohérent partout (« Mon rendement locatif »), sauf la nuance de
  casse notée en C.5.

### C.3 🟢 « Meilleure année de revente : Année 25 » (og-image.html) — pas une contradiction

Vérifié par exécution : avec l'horizon par défaut de 25 ans, la vraie
meilleure année **est** 25 (`best.y=25`, `best.tri=4,34 %`) — le moteur ne
peut évidemment pas trouver un optimum au-delà de l'horizon simulé. Le fait
que `guides/quand-revendre.html` montre un pic à l'année 30 concerne un
**réglage d'horizon différent** (30 ans, scénario distinct utilisé à des fins
pédagogiques dans ce guide) — les deux affirmations sont vraies chacune dans
leur contexte, ce n'est pas une incohérence.

**Nuance documentée le 2026-09-05** : le libellé de la carte devient
« Meilleur moment pour revendre, dans les N ans simulés », N suivant l'horizon
réglé ; l'image de partage dit « Meilleure année sur 25 ans ». Dans la même
passe, la tuile « Rentabilité nette-nette » devient « Rentabilité nette-nette
(année 1) » — trois notions de rendement voisines cohabitaient sur le même
écran sans que l'année de mesure apparaisse dans le libellé (E.9).

### C.4 🟢 Fausse alerte écartée : le calcul « net-net » de `calcul-rendement-locatif.html`

Un agent avait signalé : *« impôt de 10 260 × 70 % × 47,2 % = 3 390 €,
net-net de 1,8 % »* comme faux, en recalculant `(10260-2613-3390)/246500 =
1,73 %` (≈1,7 %, pas 1,8 %).

**Erreur de l'agent** : 246 500 € est le coût total du scénario **meublé**
(LMNP réel, mobilier compris). Mais l'exemple cité est en **micro-foncier**,
un régime de location **nue**, où le mobilier ne s'applique pas — le bon
coût total est donc 238 500 € (sans les 8 000 € de mobilier). Recalcul avec
le bon dénominateur : `(10260-2613-3390)/238500 = 1,785 %`, qui arrondit
bien à **1,8 %**. Le guide est correct ; c'est l'hypothèse implicite de
l'agent (dénominateur unique pour les deux régimes) qui était fausse.
**Vérifié par exécution du moteur** avec `regime=micro-foncier` (donc
`mobilier` neutralisé) : `besoin=238500`, confirmant ce raisonnement.

### C.5 ✅ Casse incohérente du nom du site dans l'avis éditorial (CORRIGÉ)

`pages/accueil.html` et `index.html` affichent *« L'avis de Mon Rendement
Locatif »* (casse de titre) dans l'encart de verdict, alors que toutes les
autres occurrences du nom du site utilisent la casse phrase, *« Mon
rendement locatif »* (titre de page, lien de marque, pied de page). Les deux
occurrences de l'encart sont cohérentes entre elles (pas de contradiction
entre fichiers), juste une variante de casse à harmoniser lors d'une passe de
style. **Corrigé le 2026-09-05** dans les deux fichiers.

### C.6 🟢 Fausse alerte écartée : TRI identique 2,5 % entre micro-BIC et micro-foncier

Un agent avait flaggé comme suspect que `guides/lmnp-reel-ou-micro-bic.html`
(« Le rendement annualisé passe de 2,5 % à 4,3 % ») et
`guides/micro-foncier-ou-reel.html` (micro-foncier « 2,5 % ») utilisent
exactement la même valeur arrondie pour deux régimes différents (meublé vs
nu), y voyant un possible copier-coller sans recalcul.

**Vérifié par exécution du moteur** sur les deux régimes séparément :
`micro-foncier` → TRI 25 ans = **2,46 %** ; `lmnp-micro` (micro-BIC) → TRI 25
ans = **2,55 %**. Les deux valeurs, réellement différentes au dixième de
point près, arrondissent toutes les deux à « 2,5 % » à une décimale — pure
coïncidence numérique, pas une erreur de copier-coller. Aucune correction
nécessaire.

---

## D. Architecture et refactorabilité

*(Ce volet répond spécifiquement au besoin d'un « refactor complet » : il
n'évalue pas la correction du code mais sa maintenabilité et les obstacles
structurels à un remaniement.)*

### D.1 ✅ Le découpage par marqueurs ne protégeait que la présence, pas la position (CORRIGÉ)

`build.py` isole le « bloc partagé » (calcul + dessin, réutilisé pour
`site/js/vitrine.js`) via deux marqueurs commentaires et `str.index()` :

```python
DEBUT_PARTAGE = "/* ═════════ modèle et dessin"
FIN_PARTAGE = "/* ═════════ fin du bloc partagé"
def _bloc_partage(script):
    return script[script.index(DEBUT_PARTAGE):script.index(FIN_PARTAGE)].rstrip()
```

Si un marqueur disparaît, `build.py` plante bruyamment (`ValueError`) — sans
danger. **Le vrai risque** : rien ne vérifie que le code *à l'intérieur* de
la zone reste réellement indépendant du DOM du formulaire. Si quelqu'un
ajoute, à l'intérieur de cette zone, une fonction qui lit `$("regime")` ou
tout autre élément propre à la calculatrice, `build.py` réussira sans erreur
et produira un `site/js/vitrine.js` qui plante silencieusement sur la page
d'accueil (élément introuvable). Seul un commentaire prose (« Ne rien ajouter
ici qui lise le DOM de la calculatrice ») fait respecter cette règle — aucune
vérification automatique.

**Filet de sécurité partiel, non systématique** : `outils/verifier.py`
charge bien l'accueil en Chrome headless et vérifie l'absence d'erreurs JS,
et compare même le TRI affiché sur l'accueil à celui de la calculatrice
(contrôle « accueil et calculatrice : même rendement ») — précisément le
contrôle qui détecterait ce genre d'erreur. Mais rien n'oblige à lancer ce
script avant de committer (voir B.2) : la protection existe mais dépend
entièrement de la discipline humaine.

Même fragilité côté `build.py` pour l'extraction de l'en-tête/pied de page
partagés par toutes les pages :

```python
corps = src[src.index('<header class="topbar">'):src.index("<script>")].strip()
entete = corps[:corps.index('<div class="pagehead">')].strip()
pied = corps[corps.index('<footer class="footer">'):corps.index("</footer>") + len("</footer>")]
```

Sur 4 appels `.index()` de ce type dans `main()`, **aucun n'est accompagné
d'une assertion défensive** (contre 3 `raise SystemExit` bien présents
ailleurs, pour la validation des métadonnées JSON des guides/pages — donc le
réflexe de garde-fou existe dans le projet, juste pas appliqué ici). Un
simple **réordonnancement** des sections HTML (footer déplacé avant
pagehead, par exemple) ne ferait lever aucune exception — chaque `.index()`
trouverait toujours *une* position, mais `entete` engloberait alors
silencieusement le footer, et cet en-tête corrompu serait réutilisé sur
**toutes** les pages générées (guides, FAQ, mentions légales, 404). C'est le
scénario « page cassée sur tout le site sans erreur de build » le plus
concret trouvé dans cet audit.

**Corrigé le 2026-09-05**, sans modules ES — la contrainte « aucun bundler,
un seul fichier servi » a été conservée, et le résultat est aussi vérifiable :

- Le bloc partagé n'est plus une zone dans un fichier mais **deux fichiers**,
  `src/moteur.js` et `src/graphiques.js`, que `build.py` concatène. Il n'y a
  donc plus de marqueur à respecter dans le script, ni de `_bloc_partage()`.
- La règle « ne rien mettre ici qui lise le formulaire » est devenue un
  contrôle : `src/moteur.js` ne doit contenir ni `document`, ni
  `getElementById`, ni `getComputedStyle`, ni `window.`, ni `$(` ;
  `src/graphiques.js` ne doit contenir aucun identifiant déclaré dans `FIELDS`.
  Le harnais JavaScriptCore exécute désormais `src/moteur.js` **tel quel, sans
  bouchon DOM** — ce qui est la preuve d'exécution de la même règle.
- Les quatre `.index()` sur des repères HTML sont remplacés par `_entre()`, qui
  exige des marqueurs `<!-- entete:début -->` / `<!-- entete:fin -->` présents
  une seule fois chacun et dans l'ordre, et refuse de construire sinon. Le
  scénario « en-tête corrompu sur tout le site sans erreur de build » ne peut
  plus se produire.
- `outils/verifier.py` remonte désormais le message d'erreur de `build.py` au
  lieu de le noyer dans un `CalledProcessError`.

### D.2 ✅ `VITRINE_JS` était une copie manuelle qui avait déjà divergé (CORRIGÉ)

`VITRINE_JS` est une chaîne JS écrite à la main dans `build.py` qui
réimplémente une partie de `render()`/`renderComplements()` plutôt que de
partager le code :

- Les deux calculent indépendamment le point mort avec la même ligne
  dupliquée (`rows.findIndex(r => r.gainImmo >= 0)`), une fois dans
  `index.html`, une fois recopiée dans `build.py`.
- Les deux construisent un appel `drawChart(...)` pour le graphique « gagné/
  perdu » — **et ont déjà divergé** : la version calculatrice passe des
  `milestones` (repères des seuils fiscaux : 5 ans, exonération IR, exonération
  PS, fin de reprise du déficit) que la version accueil, dans `VITRINE_JS`,
  **omet entièrement**. L'accueil affiche donc un graphique moins informatif
  que la calculatrice sans que personne ne l'ait décidé — un oubli de
  synchronisation pure.

**Corrigé le 2026-09-05** : `VITRINE_JS` n'existe plus. La vitrine est
`src/vitrine.js`, un vrai fichier JavaScript, et les deux graphiques qu'elle
partageait avec la calculatrice sont écrits **une seule fois**, dans
`cfgGainNet()` et `cfgSensibilite()` (`src/graphiques.js`), la vitrine ne
passant qu'une hauteur différente.

La page d'accueil y gagne au passage tout ce que la divergence lui avait coûté :
les repères de seuils fiscaux, le nom des quatre séries dans son équivalent
textuel, les valeurs exactes plutôt qu'arrondies au millier, et l'infobulle
complète (avance ou retard sur le meilleur placement, net de la revente).

Les valeurs par défaut restent relues dans le balisage par `_defauts()` — un
`src/vitrine.js` qui les recopierait ferait échouer la construction, ce qu'une
mutation a vérifié.

### D.3 🟡 Duplication de code SVG entre les trois fonctions de dessin

`drawChart`, `drawColumns`, `drawTornado` répètent, quasiment identiques :
nettoyage du SVG existant, construction du `<svg>` racine, boucle de
graduation/grille, et surtout **la formule de positionnement de l'infobulle**,
copiée-collée trois fois avec de simples variations cosmétiques.

**Partiellement fait le 2026-09-05** : le placement de l'infobulle est
maintenant `placerInfobulle(tip, host, cx, top)`, et la navigation clavier
`auClavier(ev, n, courant, montrer, cacher)` — les trois fonctions étaient de
toute façon réécrites pour l'accessibilité (E.1), les factoriser au passage
coûtait moins que de le faire deux fois.

**Reste à faire** : le nettoyage du SVG, la construction de la racine et la
boucle de graduation/grille sont toujours triplés (~30-40 lignes). À traiter
dans la phase 2, quand `graphiques.js` deviendra un fichier à part.

### D.4 ✅ `build.py` mélangeait deux responsabilités sans rapport (CORRIGÉ)

Environ 140 lignes (~19 % du fichier) forment un moteur de rasterisation
d'icônes autonome écrit à la main (champ de distance signée, encodeurs
ICO/PNG binaires, écriture de chunks PNG avec CRC) — entièrement indépendant
du reste (extraction/assemblage HTML).

**Corrigé le 2026-09-05** : `outils/favicon.py` (206 lignes) porte la géométrie,
le rastériseur et l'assemblage du SVG ; `build.py` l'appelle en trois lignes et
passe de 738 à 487 lignes.

### D.5 ✅ Trois scripts `outils/*.py` dupliquaient le même code serveur local (CORRIGÉ)

`outils/verifier.py`, `outils/captures.py` et `outils/servir.py` redéfinissent
chacun, quasiment à l'identique, l'idiome `type("Handler",
(http.server.SimpleHTTPRequestHandler,), {...})` pour servir `site/` en
local, et chacun sa propre copie du tuple `CHROME = (...)` de chemins
candidats pour trouver Chrome.

**Corrigé le 2026-09-05** : `outils/_local.py` porte le serveur, la recherche
d'un port libre, la détection de Chrome et de JavaScriptCore, et l'appel à
`build.py`. `captures.py` passe de 85 à 65 lignes, `servir.py` de 79 à 61.

### D.6 🟢 Ce qui fonctionne bien et ne doit pas être « corrigé » par un refactor générique

- **Discipline des tokens CSS activement contrôlée par l'outillage**, pas
  seulement par convention : `outils/verifier.py` grep le CSS *construit*
  hors du bloc `:root{...}` pour toute couleur hexadécimale codée en dur, et
  échoue le contrôle si elle en trouve — à préserver telle quelle, ne pas la
  remplacer par un système qui perdrait ce contrôle automatique.
- **La convention de nommage français (domaine métier) / anglais (mécanique
  générique)** (`besoin`, `mobilier`, `travaux` à côté de `render`, `compute`,
  `schedule`) est cohérente et intentionnelle, pas de la dérive — à
  documenter et préserver, pas à « normaliser » vers une seule langue.
- **Aucune dépendance tierce, aucun bundler, site 100 % statique** : contrainte
  explicite et assumée (README, `wrangler.jsonc`) — rien trouvé dans cet audit
  ne justifie d'introduire npm, un framework ou une librairie JS externe pour
  corriger quoi que ce soit.
- Piège de nommage à connaître (pas un bug) : `schedule()` (tableau
  d'amortissement du prêt) et `planifier()` (anti-rebond, littéralement « to
  schedule » en français) désignent deux choses différentes avec le même mot
  anglais dans deux langues — à garder en tête pendant un renommage global
  pour ne pas fusionner les deux par erreur.

---

## E. Accessibilité, UX mobile, performance

### E.1 ✅ Infobulles inaccessibles au clavier et au tactile (CORRIGÉ)

Les sept graphiques SVG n'attachent que `mousemove`/`mouseleave` (et `click`
seulement pour le comparatif des régimes) :

```js
svg.addEventListener("mousemove", move);
svg.addEventListener("mouseleave", () => { ... });
```

Vérifié sur tout le dépôt : aucun `focus`, `keydown`, `keyup`,
`touchstart`/`touchmove`, ni aucun `tabindex` sur les zones de survol. Un
utilisateur au clavier ne peut jamais faire apparaître une infobulle — ces
zones sont hors du parcours `Tab`. Sur tactile, seul le comparatif des
régimes répond ; les six autres graphiques ne réagissent à aucun événement
tactile natif. Vrai défaut WCAG 2.1.1 (Clavier), pas une nuance cosmétique.

**Corrigé le 2026-09-05.** Trois changements dans les trois fonctions de dessin :

- `mousemove`/`mouseleave` → `pointermove`/`pointerleave` : souris, tactile et
  stylet passent par le même chemin, sans code supplémentaire.
- Chaque `<svg>` porte `tabindex="0"` et **un seul** arrêt de tabulation : les
  flèches parcourent les points ou les colonnes, `Début`/`Fin` vont aux
  extrémités, `Échap` referme. Dix colonnes de cascade ne font donc pas dix
  arrêts de plus dans le parcours `Tab`. La navigation clavier est factorisée
  dans `auClavier()`, partagée par les trois graphiques.
- Sur le comparatif des régimes, `Entrée`/`Espace` adopte le régime de la
  colonne courante, comme le clic le faisait déjà.

Un contour `:focus-visible` matérialise le graphique focalisé, et le placement
de l'infobulle — copié-collé trois fois, voir D.3 — est désormais une seule
fonction `placerInfobulle()`.

Contrôles : « sept graphiques atteignables au clavier » et « infobulle
pilotable au clavier » (ouverture au focus, déplacement à la flèche, fermeture
à la perte de focus), vérifiés par mutation.

### E.2 ✅ 5 des 7 graphiques sans donnée hors du SVG (CORRIGÉ)

Chaque SVG a bien `role="img"` + `aria-label` descriptif — annonce un titre,
pas des valeurs. Le graphique « Rendement annualisé » est doublé par le
tableau `#tbl` (bon, un lecteur d'écran s'en sort). Mais **la cascade, la
trésorerie, le patrimoine et la sensibilité n'ont aucune donnée chiffrée
exposée hors du SVG** : un utilisateur non-voyant entend le titre du
graphique et rien d'autre. C'est le point le plus concret à corriger dans une
refonte — a minima un résumé texte ou un tableau cachés à côté de chaque
`.plot` (la classe `.visually-hidden`, déjà définie mais orpheline — voir
B.6 — serait immédiatement réutilisable ici).

**Corrigé le 2026-09-05** : un helper `resumeTexte(host, titre, entêtes,
lignes)` pose dans chaque `.plot` un `<table class="visually-hidden">` avec
`<caption>`, en-têtes de colonnes et de lignes. Les sept graphiques en ont un
— pas seulement les cinq manquants — et il est reconstruit à chaque rendu.

Les séries portent désormais un `nom` (« Immobilier », « Bourse », « Fonds
euros », « Livret A »…) et, quand le format d'axe est trop grossier pour un
équivalent textuel (« 188 k€ »), un `fmtVal` donne la valeur exacte. La
cascade et la tornade réutilisent le texte qu'elles affichent déjà.

Effet de bord traité : la sonde de débordement de `outils/verifier.py`
comptait ces tableaux hors écran comme un dépassement horizontal. Elle ignore
maintenant explicitement ce qui est sous un `.visually-hidden` — une précision
de la sonde, pas un contournement.

Contrôle : « sept équivalents textuels », vérifié par mutation.

**Régression introduite puis corrigée le 2026-09-05** : posé nu, le `<table>`
mesurait 423 px et non 1 px — `height` n'est qu'un *minimum* sur un élément de
type table, qui se dimensionne toujours à son contenu. La cascade étant le seul
graphique logé dans un `.plotwrap` (dont l'`overflow-x:auto` fait calculer
`overflow-y:auto`), elle a gagné un ascenseur vertical invisible : la molette y
restait piégée au lieu de faire descendre la page. Le tableau est désormais
enveloppé dans un `<div class="visually-hidden">`, et un contrôle vérifie
qu'aucun `.plot` ni `.plotwrap` n'a de débordement vertical défilant.

### E.3 🔴 Texte vert et rouge illisible en mode clair — bien plus large que le seul badge

Le constat initial visait `.pill.win`/`.pill.lose` : texte `--up`/`--down` sur
fond teinté à 14 %, **2,52:1 recalculé** en mode clair, très sous le seuil AA de
4,5:1 (le texte à 12px gras ne qualifie pas pour le seuil « grand texte » de
3:1, qui exige 18,66px en gras).

**Le problème était plus général** : `--up` (#00a878) ne donne que **2,93:1**
sur `--surface`, donc *tout* texte vert échouait, pas seulement le badge —
le TRI héros (`.hero .big`), le rendement réel (`.reel b`), les valeurs des
tuiles (`.v.pos`), les colonnes du tableau annuel (`td.pos`), et les chiffres
tracés dans les SVG de la cascade, du comparatif des régimes et de la tornade.
Le rouge s'en tirait un peu mieux (4,27:1) mais échouait aussi sous 18,66px.

**Corrigé le 2026-09-05** : deux tokens `--up-ink`/`--down-ink` — les mêmes
teintes assombries jusqu'au seuil AA — portent désormais tout ce qui est
**texte** ; `--up`/`--down` restent sur les **tracés** (courbes, barres,
pastilles de légende), où le seuil applicable est celui des éléments non
textuels. En thème sombre les encres aliasent les couleurs de données
inchangées (`var(--up)`), déjà à 9:1.

| Token | Clair | Pire ratio mesuré | Sombre |
|---|---|---|---|
| `--up-ink` | `#007352` | 4,85:1 (sur fond teinté) | `var(--up)` — 9,02:1 |
| `--down-ink` | `#be173b` | 4,83:1 (sur fond teinté) | `var(--down)` — 4,94:1 |

`outils/verifier.py` calcule maintenant les 18 rapports WCAG concernés à chaque
exécution (fonction `contraste()`, thèmes lus dans le CSS construit) : la valeur
hexadécimale ne peut plus dériver sans échec de contrôle.

**Reste connu et assumé** : la pastille de légende `.swatch.sq` (10×10 px)
garde `--up` à 2,93:1, sous le seuil de 3:1 des éléments non textuels. Elle est
systématiquement doublée du libellé écrit juste à côté, et la charte impose que
la couleur d'une série corresponde à son tracé — la changer casserait
l'appariement légende/graphique.

### E.4 🟠 Contraste de `--text-muted` en clair, à la limite

`#737373` sur `#fafafa` (mode clair) → **≈ 4,54:1**. Passe le seuil AA texte
normal (4,5:1) mais avec moins de 1 % de marge, sur du texte à 11-13px (aides
de champ, `.eyebrow`, `.axisnote`). En sombre, `#8a8a8a` sur `#0a0a0a` → ≈
5,74:1, confortable.

**Corrigé le 2026-09-05** : `#6b6b6b`, soit 5,11:1 sur `--surface` et 5,33:1
sur `--bg`, sans changement perceptible de la charte. Vérifié à chaque
exécution par le contrôle de contraste ajouté en E.3.

### E.5 🟢 Points positifs confirmés (à préserver)

- **Labels de formulaire** : tous les champs ont un `<label for>` apparié —
  rien à corriger.
- **`<details>/<summary>` natifs** pour tous les groupes repliables — bon par
  défaut pour clavier et lecteurs d'écran.
- **Interrupteur de thème** : `aria-checked` et `aria-label` correctement
  mis à jour à chaque bascule.
- **Focus visible** : `:focus-visible` défini globalement.
- **Verdict avant formulaire sur mobile** : sous 1040px, un réordonnancement
  CSS (`order`) place le verdict et les indicateurs **avant** le panneau de
  saisie replié — bon choix UX déjà en place, à ne pas perdre dans une
  refonte.
- **Tableaux et cascade en défilement horizontal** sur petit écran, pas de
  troncature.
- **Poids de page raisonnable** : CSS ~28 Ko, JS calculatrice ~73 Ko,
  mutualisés et mis en cache entre toutes les pages du site. Rien
  d'anormalement gonflé.

### E.6 ✅ Pas de debounce sur les champs numériques (CORRIGÉ)

```js
FIELDS.concat(SELECTS).forEach(k => {
  if(k === "regime") return;
  $(k).addEventListener("input", render);
  $(k).addEventListener("change", render);
});
```

Seul le `resize` de fenêtre est debouncé. Chaque frappe dans un champ
numérique redessine intégralement les 7 graphiques (suppression + recréation
de tous les nœuds SVG). Probablement sous les 16 ms sur un poste récent, mais
candidat plausible au jank sur mobile d'entrée de gamme en frappe rapide.
**Corrigé le 2026-09-05** : la frappe est laissée retomber 60 ms ; les listes
et les cases gardent un rendu immédiat, le geste y étant unique.

### E.7 ✅ `getComputedStyle` appelé de façon redondante (CORRIGÉ)

Le helper `css()` est rappelé plusieurs fois par graphique pour des valeurs
constantes sur tout un cycle de rendu (`--border`, `--text-muted`, `--up`,
`--down`, etc.) — de l'ordre de 40-60 appels au total pour les 7 graphiques,
mais **pas** en boucle sur les points de données (pas de scaling avec le
nombre d'années).

**Corrigé le 2026-09-05**, sans changer une seule signature de fonction : `css()`
retient ses réponses le temps d'un rendu, et `oublierTheme()` vide le cache en
tête de `render()` et de `vitrine()`. Une sonde bascule le thème et vérifie que
la couleur des tracés change bien puis revient — sans elle, un cache non vidé
aurait laissé les graphiques peints comme avant.

### E.8 🟡 Curseur `#cascAnnee` — taille tactile non garantie explicitement

Aucun style personnalisé de poignée (`::-webkit-slider-thumb` etc.), aucune
zone de contact agrandie. Retombe sur le rendu natif du navigateur — risque
modéré et non tranché sans test sur device réel.

### E.9 ✅ Trois notions de rendement voisines sur le même écran (TRAITÉ)

« Rentabilité brute », « Rentabilité nette-nette » (tuiles indicateurs) et le
TRI héros du verdict juste au-dessus cohabitent avec des noms proches. Chaque
tuile a un texte d'aide qui clarifie au survol/lecture, donc pas trompeur une
fois lu — mais risque de confusion au premier coup d'œil.

**Traité le 2026-09-05** : la tuile s'intitule « Rentabilité nette-nette
(année 1) ». Voir aussi C.3 pour la carte de revente, qui dit maintenant dans
quel horizon son optimum est cherché.

---

## Annexe — comment vérifier ce document

```sh
cd "/Users/vincent/Documents/Calculatrice Immobilier"
python3 build.py && python3 outils/verifier.py   # 150 contrôles au vert après la phase 2
python3 outils/servir.py                         # ouvre le site en local
git log --oneline -5                             # commit de référence : 30bd897
```

Pour rejouer le moteur isolément (utile pour vérifier tout point de la
section A ou C, ou tout futur changement de chiffre publié) :

```sh
python3 - <<'PY'
import re, pathlib
js = re.search(r"<script>\n(.*?)</script>", pathlib.Path("index.html").read_text(), re.S).group(1)
moteur = js[js.index("/* ---------- postes de travaux ---------- */"):js.index("/* ---------- charts ---------- */")]
pathlib.Path("/tmp/moteur.js").write_text(moteur + """
var $ = function(){ return {innerHTML:'', value:'', textContent:''}; };
function base(o){ var p = {prix:200000,notairePct:8,fraisAcq:0,mobilier:8000,apport:35000,
 duree:20,taux:3.4,assur:0.34,fraisDossier:2500,loyer:900,vacance:5,copro:60,tf:1200,pno:180,
 gestion:0,entretien:5,ps:18.6,psPV:17.2,cfe:400,abattement:50,plafondDeficit:10700,partBati:85,
 amortBatiAns:30,amortTvxAns:15,amortMobAns:7,horizon:25,inflation:2,indexPrix:2,indexLoyer:2,
 indexCharges:2,fraisVente:5,bourse:4,fondsEuros:0,livretA:-0.3,fiscBourse:31.4,fiscFonds:30,
 regime:'lmnp-reel',tmi:30,ira:true,items:[{nom:'R',montant:20000,taux:5,duree:20,deduc:100}]};
 for(var k in o) p[k]=o[k]; p.travaux=p.items.reduce(function(s,i){return s+i.montant;},0); return p; }
var r = compute(base({}));
print('TRI ' + (r.final.tri*100).toFixed(2) + ' %  gain ' + Math.round(r.final.gain));
""")
PY
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc /tmp/moteur.js
```

Pour éprouver le filet lui-même — un contrôle qui ne peut pas échouer ne
protège rien —, réintroduire un bug puis vérifier que `verifier.py` le voit :

```sh
# exemple : remettre la surtaxe sans sa décote
python3 - <<'EOF'
import pathlib
f = pathlib.Path("index.html"); s = f.read_text()
f.write_text(s.replace("return base*taux - (plafond-base)*decote;", "return base*taux;"))
EOF
python3 outils/verifier.py | grep ECHEC   # doit signaler « surtaxe de plus-value : table legale »
git checkout index.html && python3 build.py
```

Ce fichier n'est **pas committé automatiquement** — il vit à la racine du
dépôt (`AUDIT.md`), à ajouter ou non selon ce que Vincent en décide.
