"""Sentiment + emotion scoring. Lazy-loads HF models; falls back to a tiny lexicon scorer if unavailable."""
from __future__ import annotations

from typing import Dict, List
import logging
import math

log = logging.getLogger(__name__)

_SENT_PIPE = None
_EMO_PIPE = None
_TRANSFORMERS_OK = True

_EMOTION_LABELS = ["joy", "anger", "fear", "sadness", "surprise", "disgust", "neutral"]

# Tiny lexicon fallback
_POS = {"great", "amazing", "love", "breakthrough", "excited", "promising", "incredible", "hope", "progress", "helpful"}
_NEG = {"terrible", "hate", "fear", "dangerous", "scary", "doom", "threat", "layoffs", "risk", "bias", "harm"}


def _init_pipelines(sentiment_model: str, emotion_model: str) -> None:
    global _SENT_PIPE, _EMO_PIPE, _TRANSFORMERS_OK
    if _SENT_PIPE is not None or not _TRANSFORMERS_OK:
        return
    try:
        from transformers import pipeline
        _SENT_PIPE = pipeline("sentiment-analysis", model=sentiment_model, truncation=True)
        _EMO_PIPE = pipeline("text-classification", model=emotion_model, top_k=None, truncation=True)
    except Exception as e:
        log.warning("Transformers unavailable (%s); using lexicon fallback", e)
        _TRANSFORMERS_OK = False


def _lexicon_score(text: str) -> tuple[float, Dict[str, float]]:
    t = (text or "").lower()
    toks = set(t.split())
    pos = len(toks & _POS)
    neg = len(toks & _NEG)
    if pos == 0 and neg == 0:
        s = 0.0
    else:
        s = (pos - neg) / max(1, pos + neg)
    emotions = {lbl: 0.0 for lbl in _EMOTION_LABELS}
    emotions["neutral"] = 1.0 if s == 0.0 else 0.3
    emotions["joy"] = max(0.0, s)
    emotions["anger"] = max(0.0, -s) * 0.5
    emotions["fear"] = max(0.0, -s) * 0.5
    return s, emotions


def score_batch(texts: List[str], sentiment_model: str, emotion_model: str) -> List[tuple[float, Dict[str, float]]]:
    _init_pipelines(sentiment_model, emotion_model)
    if not _TRANSFORMERS_OK:
        return [_lexicon_score(t) for t in texts]

    results: List[tuple[float, Dict[str, float]]] = []
    try:
        sent_out = _SENT_PIPE(texts, batch_size=16)
        emo_out = _EMO_PIPE(texts, batch_size=16)
    except Exception as e:
        log.warning("Model inference failed (%s); fallback", e)
        return [_lexicon_score(t) for t in texts]

    for s, e in zip(sent_out, emo_out):
        label = s["label"].lower()
        score = float(s["score"])
        if "pos" in label:
            polarity = score
        elif "neg" in label:
            polarity = -score
        else:
            polarity = 0.0
        emo_vec = {lbl: 0.0 for lbl in _EMOTION_LABELS}
        items = e if isinstance(e, list) else [e]
        for item in items:
            lbl = item["label"].lower()
            if lbl in emo_vec:
                emo_vec[lbl] = float(item["score"])
        results.append((polarity, emo_vec))
    return results
