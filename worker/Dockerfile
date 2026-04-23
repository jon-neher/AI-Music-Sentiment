FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TRANSFORMERS_CACHE=/app/.cache/huggingface \
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

# Pre-download HF models into the image layer so container starts don't
# block ~5-10 minutes on a ~700MB download the first time score_batch is
# called. Must match worker.config.Settings defaults.
RUN python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; \
[(AutoTokenizer.from_pretrained(m), AutoModelForSequenceClassification.from_pretrained(m)) \
 for m in ('cardiffnlp/twitter-roberta-base-sentiment-latest', \
           'j-hartmann/emotion-english-distilroberta-base')]"

COPY . /app/worker

CMD ["python", "-m", "worker.schedule"]
