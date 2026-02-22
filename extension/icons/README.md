# アイコンについて

`icon.svg` を元に以下のPNGファイルを生成してください:

- `icon16.png`  — 16×16px
- `icon48.png`  — 48×48px
- `icon128.png` — 128×128px

## 生成方法（例: Inkscapeを使う場合）

```bash
inkscape icon.svg --export-png=icon16.png  --export-width=16
inkscape icon.svg --export-png=icon48.png  --export-width=48
inkscape icon.svg --export-png=icon128.png --export-width=128
```

## 生成方法（例: ImageMagick + rsvg-convert を使う場合）

```bash
rsvg-convert -w 16  -h 16  icon.svg -o icon16.png
rsvg-convert -w 48  -h 48  icon.svg -o icon48.png
rsvg-convert -w 128 -h 128 icon.svg -o icon128.png
```

## 暫定対応

開発中はダミーのPNGファイルを置くか、manifest.jsonの `icons` と `action.default_icon` を一時的に削除してください（Chrome は省略可）。
