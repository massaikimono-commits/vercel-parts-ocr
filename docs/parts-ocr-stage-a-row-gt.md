# Parts OCR Stage A row-geometry annotation

目的: 黄色正式12枚について、人間が実写真を見て明細行の縦方向row-band Ground Truthを作成する。

## 重要ルール

- OCR出力、fixed candidate、dynamic candidateを見ながらGTを作らない。
- GTをcandidate生成・停止条件・閾値調整・候補選択へ利用しない。
- GTは全candidate生成後のscoring-onlyで使用する。
- 実写真やPIIをGitHubへcommitしない。
- annotation JSONには画像そのものやOCR文字列を含めない。
- row-bandは各実明細行を縦方向に覆う範囲だけを手動指定する。
- x座標はStage Aのcoverage採点には使わない。

## 使用方法

1. `scripts/parts-ocr-row-gt-annotator.html` をローカルブラウザで開く。
2. 黄色正式12枚をファイル選択する。
3. 実写真を目視し、各明細行の上端から下端まで縦方向にドラッグする。
4. 全12枚が終わったらJSONを書き出す。
5. JSONはprivate runtimeだけでStage A scoringへ投入する。
6. annotation完了前はfixed/dynamic coverage比較を実施しない。

## JSON

```json
{
  "version": 1,
  "kind": "parts-ocr-stage-a-row-geometry-gt",
  "source": "manual-photo-annotation",
  "images": {
    "IMG_0675(1).jpeg": {
      "filename": "IMG_0675(1).jpeg",
      "width": 0,
      "height": 0,
      "bands": [
        {
          "y1Px": 0,
          "y2Px": 0,
          "y1Norm": 0,
          "y2Norm": 0
        }
      ]
    }
  }
}
```

Stage A scoringではnormalized y-bandを使い、画像の保存名suffixが変わっていても正式識別名へマッピングして使用する。
