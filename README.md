# SC 410 — Nuancier

Showroom des teintes PANTONE (unies `PANTONE xxxx C`, métallisées `PANTONE 10xxx C` / `8xxx C`) sur la voiture. Le nombre de teintes, les familles affichées et leurs effectifs viennent tous de `colors.json`.

## Lancer

```bash
python3 -m http.server 8850 --directory atelier
```

Puis http://localhost:8850 (un lien direct vers une teinte : `#7401`).

## Netteté

- Rendus WebP 1200 / 2000 / 3500 px générés à partir d'une seule photo studio, carrosserie repeinte dans chaque teinte (ombres et reflets conservés), voiture posée au même endroit sur une toile 3500 × 5000. Choisis pour avoir au moins 1 pixel d'image par pixel d'écran (Retina compris).
- Le zoom de la voiture vient de la taille de la scène, pas d'un `transform: scale` : ni l'image ni le titre ne sont rééchantillonnés.
- Titre, parallaxe, étiquettes de l'arc, carte d'aperçu, cadre et filets positionnés au pixel entier, jamais tournés. Aucun `backdrop-filter`, aucun flou.

## Utilisation

**L'éventail** (bas de l'écran) : une lame laquée par teinte, rangées par famille, qui tournent autour d'un pivot caché sous le bord, sous un seul reflet commun. La lame sortie sous l'index (en haut, au centre) est la teinte de la voiture. À l'arrivée, les lames se déplient depuis la teinte affichée (pas d'animation si « réduire les animations » est actif).

- Faire tourner : glisser l'éventail (doigt ou souris, avec élan), molette ou pavé tactile. Pendant la rotation, une carte d'aperçu (vignette du rendu, référence) suit la lame sous l'index et la fiche la reprend ; au repos, la voiture change. Au doigt, un léger cran vibre à chaque lame (si l'appareil le permet).
- Toucher / cliquer une lame : elle vient sous l'index et la voiture change aussitôt. Toucher le nom d'une famille sur l'arc : première teinte de la famille.
- Survol (souris) : la lame sort légèrement et sa carte d'aperçu apparaît au-dessus de la pointe.
- Appui long sur une lame (tactile) : favori, copier la référence.
- Glisser la voiture : teinte voisine (l'éventail suit).

**Le Nuancier** (plein écran) : toutes les teintes par famille, en vignettes du vrai rendu, la recherche et les favoris réunis. `G` ou « Nuancier » pour l'ouvrir, `/` ou « Rechercher » pour chercher (référence « 7401 », « 7401 C » ou « pantone 7401 », nom, famille en français ou en anglais, « métallisé » / « uni »), ♥ en haut pour l'ouvrir sur les favoris. Flèches pour se déplacer dans la grille, `Entrée` pour choisir (le nuancier se ferme, l'éventail tourne jusqu'à la teinte), `Échap` pour fermer. En mode Favoris : « Partager la sélection » (lien `#sel=`).

**Clavier** : `←` `→` teinte voisine, `↑` `↓` famille précédente / suivante, `Début` / `Fin` première / dernière teinte, `F` favori, `G` nuancier, `/` recherche, `Échap` fermer (ou annuler une rotation en cours).

**L'étiquette** (en bas à gauche, dans le cadre d'épreuve) : Nº et mention « PANTONE » (la toucher copie la référence complète, p. ex. « PANTONE 7401 C »), numéro en Archivo Expanded (« 7401 C », la lettre de support en maigre), perle de laque (survol : teinte écran approximative), famille et finition. À chaque changement, le compteur roule, le nom se révèle mot à mot et un éclat de laque balaie la carrosserie ; sur ordinateur, une lumière de studio suit la souris. Tout est coupé si « réduire les animations » est actif. En bas à droite : « Favori », « Exporter » (Story / carré / paysage en pleine résolution, ou partage du lien).

Liens directs : `#7401` (teinte, insensible à la casse ; un code inconnu ouvre la première teinte du nuancier), `#sel=7401.10102` (proposer une sélection à ajouter aux favoris). Les anciens liens `#cmp=…` ouvrent simplement la première teinte de la liste (le face à face est retiré de l'interface ; son code reste dans `app.js`, désactivé par `COMPARE = false`).

## Fichiers

- `index.html`, `styles.css`, `app.js` — aucune dépendance
- `colors.json` — liste de teintes : `{"code":"7401","name":"PANTONE 7401 C","hex":"#f5e1a4","family":"jaune","metal":0}`
  - `code` : identifiant (nom des rendus, liens) ; `7401`, `Yellow`, `10442-G`… Les espaces deviennent des tirets dans les liens.
  - `name` : `PANTONE …` → le numéro (« 7401 C ») est affiché en grand, la mention PANTONE en petit ; le code n'est répété que s'il diffère du numéro (`10442-G`).
  - `family` : `blanc`, `gris`, `noir`, `beige`, `brun`, `rouge`, `rose`, `orange`, `jaune`, `vert`, `bleu`, `violet` (une autre clé est acceptée et ajoutée en fin d'éventail) ; seules les familles présentes sont affichées.
  - `metal` : 1 = métallisé, 0 = uni (à défaut : « Metallic » dans le nom).
- `img/thumb/CODE.webp` — vignettes 640×256 (nuancier et carte d'aperçu)
- `img/1200`, `img/2000`, `img/3500` — rendus + `_mask.webp` (silhouette pour faire passer le nom derrière la voiture) + `_car.webp` (voiture seule)
- Après régénération des rendus : changer `IV` en tête de `app.js` (cache navigateur), et `?v=` de `styles.css` / `app.js` dans `index.html` après toute modification.

PANTONE® est une marque de Pantone LLC ; les valeurs hexadécimales sont des approximations écran.

## Logo

- Logotype texte « SC 410 » (Archivo Expanded : SC en 600, 410 en 300 ; caractères auto-hébergés dans fonts/, SIL OFL), dans l'en-tête et sur les images exportées.

## Déploiement Coolify

Le dépôt contient un `Dockerfile` (Nginx alpine) et un `nginx.conf`.
Dans Coolify : *New Resource → Public/Private Repository* → ce dépôt, branche `main`,
**Build Pack : Dockerfile**, **Port exposé : 80**, puis renseigner le domaine.
Healthcheck : `GET /healthz`. Aucune variable d'environnement requise.
