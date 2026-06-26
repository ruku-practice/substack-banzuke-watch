# 番付ハイランカー 日次更新ジョブ（Cloud Run Job）
# 起動時にリポジトリを clone → スクレイプ→集計→OGP生成 → データをmainへpush・site/をgh-pagesへ公開。
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates tzdata fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# スクリプトが使う追加ライブラリは Pillow のみ（他は標準ライブラリ）
RUN pip install --no-cache-dir Pillow

ENV TZ=Asia/Tokyo \
    PYTHONUNBUFFERED=1

COPY run.sh /run.sh
RUN chmod +x /run.sh

ENTRYPOINT ["/run.sh"]
