# Atelier 911 — Paint to Sample

Showroom des 152 teintes Paint to Sample de la 911, redessiné de zéro.

## Lancer

```bash
python3 -m http.server 8850 --directory atelier
```

Puis http://localhost:8850 (un lien direct vers une teinte : `#5ZA`).

## Netteté

- Rendus WebP 1200 / 2000 / 3500 px, choisis pour avoir au moins 1 pixel d'image par pixel d'écran (Retina compris).
- Le zoom de la voiture vient de la taille de la scène, pas d'un `transform: scale` : ni l'image ni le titre ne sont rééchantillonnés.
- Titre, parallaxe, étiquettes de l'arc, carte d'aperçu, cadre et filets positionnés au pixel entier, jamais tournés. Aucun `backdrop-filter`, aucun flou.

## Utilisation

**L'éventail** (bas de l'écran) : 152 lames laquées, rangées par famille, qui tournent autour d'un pivot caché sous le bord, sous un seul reflet commun. La lame sortie sous l'index (en haut, au centre) est la teinte de la voiture. À l'arrivée, les lames se déplient depuis la teinte affichée (pas d'animation si « réduire les animations » est actif).

- Faire tourner : glisser l'éventail (doigt ou souris, avec élan), molette ou pavé tactile. Pendant la rotation, une carte d'aperçu (vignette du rendu, nom, code) suit la lame sous l'index et la fiche la reprend ; au repos, la voiture change. Au doigt, un léger cran vibre à chaque lame (si l'appareil le permet).
- Toucher / cliquer une lame : elle vient sous l'index et la voiture change aussitôt. Toucher le nom d'une famille sur l'arc : première teinte de la famille.
- Survol (souris) : la lame sort légèrement et sa carte d'aperçu apparaît au-dessus de la pointe.
- Appui long sur une lame (tactile) : favori, comparer, copier le code.
- Glisser la voiture : teinte voisine (l'éventail suit).

**Le Nuancier** (plein écran) : toutes les teintes par famille, en vignettes du vrai rendu, la recherche et les favoris réunis. `G` ou « Nuancier » pour l'ouvrir, `/` ou « Rechercher » pour chercher (nom, code ou famille, en français ou en anglais), ♥ en haut pour l'ouvrir sur les favoris. Flèches pour se déplacer dans la grille, `Entrée` pour choisir (le nuancier se ferme, l'éventail tourne jusqu'à la teinte), `Échap` pour fermer. En mode Favoris : « Partager la sélection » (lien `#sel=`).

**Clavier** : `←` `→` teinte voisine, `↑` `↓` famille précédente / suivante, `Début` / `Fin` première / dernière teinte, `F` favori, `C` face à face, `G` nuancier, `/` recherche, `Échap` fermer (ou annuler une rotation en cours).

**L'étiquette** (en bas à gauche, dans le cadre d'épreuve) : Nº et code (toucher le code pour le copier), nom en Bodoni avec la finition en italique, perle de laque (survol : teinte écran approximative), famille et finition. À chaque changement, le compteur roule, le nom se révèle mot à mot et un éclat de laque balaie la carrosserie ; sur ordinateur, une lumière de studio suit la souris. Tout est coupé si « réduire les animations » est actif. En bas à droite : « Favori », « Comparer », « Exporter » (Story / carré / paysage en pleine résolution, ou partage du lien).

Liens directs : `#5ZA` (teinte), `#cmp=5ZA,M4T` (face à face), `#sel=5ZA.M4T` (proposer une sélection à ajouter aux favoris).

## Fichiers

- `index.html`, `styles.css`, `app.js` — aucune dépendance
- `colors.json` — 152 teintes : code, nom, hex, famille
- `img/thumb/CODE.webp` — vignettes 640×256 (nuancier et carte d'aperçu)
- `img/1200`, `img/2000`, `img/3500` — rendus + `_mask.webp` (silhouette pour faire passer le nom derrière la voiture)

Les rendus et noms de teintes appartiennent à Porsche : prototype d'étude, à garder en local.

## Logo

- `logo/atelier911-logo-clair.svg` / `-sombre.svg` — la ligne de toit de la 911 (relevée sur la silhouette du rendu) tracée comme un coup de pinceau, au-dessus du logotype « ATELIER 911 » en Poppins (Medium / Light), vectorisé : s'affiche partout sans la police.
- `logo/atelier911-symbole.svg` — pastille de laque avec la ligne en réserve ; `favicon.svg` en est la version épaissie pour les petites tailles.
