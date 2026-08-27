# Mon rendement locatif

Calculateur de rentabilité d'un investissement locatif en France. Il répond à
deux questions que les simulateurs courants laissent de côté :

- **Combien ce projet rapporte-t-il vraiment, chaque année ?** Un TRI calculé sur
  les fonds réellement sortis de votre poche, en euros courants et en pouvoir
  d'achat, pour chaque année de revente possible.
- **Quand faut-il revendre ?** La fiscalité française avance par seuils, et
  l'année optimale n'est presque jamais la dernière.

Le tout comparé, à mise de fonds identique, à un Livret A, un fonds euros et un
placement boursier.

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
composants), plus-value avec abattements pour durée de détention, forfait travaux
de 15 %, surtaxe au-delà de 50 000 €, et la réintégration des amortissements LMNP
introduite par la loi de finances 2025.

**Monnaie** — inflation explicite. Par défaut, prix, loyers et charges la suivent :
le rendement vient alors du levier du crédit et des loyers, pas d'un pari sur les
prix.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | La calculatrice. Un seul fichier, sans dépendance ni build. |
| `build.py` | Produit `site/index.html`, la version déployable. |
| `site/index.html` | Généré. Ajoute l'enveloppe HTML, le viewport et les métadonnées. |

Éditez `index.html`, puis :

```sh
python3 build.py
```

`site/` est le dossier à déployer sur un hébergement statique.

## Limites

Les projections reposent sur vos hypothèses et ne remplacent pas l'avis d'un
conseiller fiscal. Ne sont pas modélisés : IFI, statut LMP, dispositifs Pinel,
Denormandie et Malraux, SCI à l'impôt sur les sociétés, démembrement, et le taux
d'endettement — un projet rentable ici peut être refusé par une banque.

Les hypothèses de calcul détaillées figurent en bas de la page elle-même.
