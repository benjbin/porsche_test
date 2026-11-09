# Atelier 911 — Paint to Sample

Showroom des 152 teintes Paint to Sample de la 911, redessiné de zéro.

## Lancer

```bash
python3 -m http.server 8850 --directory atelier
```

Puis http://localhost:8850 (un lien direct vers une teinte : `#5ZA`).

## Netteté

- Rendus WebP 1200 / 2000 / 3500 px générés à partir d'une seule photo studio : agrandie ×4 par super-résolution (Real-ESRGAN x4plus), carrosserie isolée puis repeinte dans chacune des 152 teintes (ombres et reflets conservés), tramage anti-bandes, voiture posée au même endroit sur une toile 3500 × 5000. Choisis pour avoir au moins 1 pixel d'image par pixel d'écran (Retina compris).
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

**Clavier** : `←` `→` teinte voisine, `↑` `↓` famille précédente / suivante, `Début` / `Fin` première / dernière teinte, `F` favori, `C` face à face (puis `1` `2` `3` modes, `S` décor, `L` loupe), `G` nuancier, `/` recherche, `Échap` fermer (ou annuler une rotation en cours).

**L'étiquette** (en bas à gauche, dans le cadre d'épreuve) : Nº et code (toucher le code pour le copier), nom en Poppins avec la finition en italique, perle de laque (survol : teinte écran approximative), famille et finition. À chaque changement, le compteur roule, le nom se révèle mot à mot et un éclat de laque balaie la carrosserie ; sur ordinateur, une lumière de studio suit la souris. Tout est coupé si « réduire les animations » est actif. En bas à droite : « Favori », « Comparer », « Exporter » (Story / carré / paysage en pleine résolution, ou partage du lien).

**Face à face** (outil de décision, `C` ou « Comparer ») : 2 à 4 finalistes. Depuis l'étiquette : la teinte affichée + vos favoris (sinon la teinte suivante de l'éventail) ; depuis le Nuancier en mode Favoris : « Comparer » (4 premiers favoris) ; appui long sur une lame : cette teinte face à la teinte affichée.

- Bande des finalistes (en bas) : ✕ pour retirer (2 minimum), « + Ajouter » ouvre un sélecteur (recherche, vos favoris en tête, familles ; `↑` `↓` `Entrée`, `Échap`). Glisser une carte pour la déplacer (au doigt : appui puis glisser), ou `Alt` + `←` `→`.
- Modes (`1` `2` `3`) : **Rideau** (deux teintes, rideau à glisser, toucher pour le poser, `←` `→` ; avec 3–4 finalistes, des pastilles choisissent la paire ; téléphone portrait : rideau horizontal), **Côte à côte** (même échelle, même cadrage « voiture seule » ; 2 → 2 colonnes, 3 → 3, 4 → 2 × 2 ou une rangée de 4 si la hauteur manque ; téléphone : rangées empilées), **Duel** (« Choisissez, on élimine » : cliquer / toucher, `←` `→`, ou balayer une teinte pour l'écarter ; la gagnante reste, la suivante entre ; verdict : « L'afficher dans le showroom » (ferme, affiche la teinte et l'ajoute aux favoris), « Recommencer le duel », « Partager » (copie le lien)).
- Décors (`S`) : Studio (rendu d'origine), Gris neutre, Plein jour, Nuit. Hors Studio, la voiture est découpée par `_car.webp` et posée sur un fond neutre : seul le décor change, la laque reste celle du rendu.
- Loupe (`L`, `Maj` maintenue, ou appui long au doigt ; Côte à côte et Duel) : le même point agrandi sur toutes les finalistes, depuis les rendus 3500 (chargés au premier usage, filet de progression), jamais au-delà de la résolution native.
- Repères sous chaque teinte : famille · finition, clarté (L* CIE) et saturation (chroma) sur 100 (▲ = la plus élevée), « au quotidien » (indicatif).
- `Échap` ferme d'abord le sélecteur, puis le face à face (le focus revient au bouton d'origine).

Liens directs : `#5ZA` (teinte), `#cmp=5ZA,M4T[,3RR,GB0]&m=duel|rideau|cote&s=gris|jour|nuit|studio` (face à face, options facultatives et lues avec indulgence ; `#cmp=5ZA,M4T` reste valable), `#sel=5ZA.M4T` (proposer une sélection à ajouter aux favoris).

## Fichiers

- `index.html`, `styles.css`, `app.js` — aucune dépendance
- `colors.json` — 152 teintes : code, nom, hex, famille
- `img/thumb/CODE.webp` — vignettes 640×256 (nuancier et carte d'aperçu)
- `img/1200`, `img/2000`, `img/3500` — rendus + `_mask.webp` (silhouette pour faire passer le nom derrière la voiture) + `_car.webp` (voiture seule : carrosserie, roues, ombre de contact — décors du face à face)

Les noms et codes de teintes viennent du programme Paint to Sample de Porsche : prototype d'étude.

## Logo

- `logo/atelier911-logo-clair.svg` / `-sombre.svg` — la ligne de toit de la 911 (relevée sur la silhouette du rendu) tracée comme un coup de pinceau, au-dessus du logotype « ATELIER 911 » en Poppins (Medium / Light), vectorisé : s'affiche partout sans la police.
- `logo/atelier911-symbole.svg` — pastille de laque avec la ligne en réserve ; `favicon.svg` en est la version épaissie pour les petites tailles.
