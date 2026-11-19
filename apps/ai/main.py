"""BMUETTE AI service: turns text and images into 512-number "embeddings" so the API can find
similar things (visual search, "more like this", search by meaning).

Contract used by the API (apps/api/src/search/embedding.service.ts):
  POST /embed/text   {"text": "white sneakers"}          -> {"embedding": [512 numbers]}
  POST /embed/image  {"url": "https://.../photo.jpg"}    -> {"embedding": [512 numbers]}
  GET  /health
Model: OpenCLIP ViT-B-32 (512 dimensions, matches the database column vector(512)).
"""
import io
import ipaddress
import os
import socket
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

BACKEND = os.getenv("EMBED_BACKEND", "clip")  # "clip" for real use. "dummy" is for tests only.
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(15 * 1024 * 1024)))
# Hosts we may download images from (comma separated), e.g. "cdn.bmuette.com,minio". Empty = any public host.
ALLOWED_HOSTS = {h.strip().lower() for h in os.getenv("AI_ALLOWED_HOSTS", "").split(",") if h.strip()}
# Development only: allow private addresses such as localhost and docker service names.
ALLOW_PRIVATE = os.getenv("AI_ALLOW_PRIVATE_URLS", "false").lower() == "true"

app = FastAPI(title="BMUETTE AI", docs_url=None, redoc_url=None)
_model = None


def _load():
    global _model
    if _model is not None:
        return _model
    if BACKEND == "dummy":
        _model = ("dummy", None, None, None)
        return _model
    import open_clip
    import torch

    name = os.getenv("CLIP_MODEL", "ViT-B-32")
    pretrained = os.getenv("CLIP_PRETRAINED", "laion2b_s34b_b79k")
    model, _, preprocess = open_clip.create_model_and_transforms(name, pretrained=pretrained)
    model.eval()
    tokenizer = open_clip.get_tokenizer(name)
    torch.set_num_threads(int(os.getenv("TORCH_THREADS", "2")))
    _model = ("clip", model, preprocess, tokenizer)
    return _model


def _normalise(v):
    n = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / n for x in v]


def _dummy_vector(seed: str):
    import hashlib

    out = []
    h = hashlib.sha256(seed.encode()).digest()
    while len(out) < 512:
        h = hashlib.sha256(h).digest()
        out.extend((b - 127.5) / 127.5 for b in h)
    return _normalise(out[:512])


def _check_url(url: str) -> None:
    """Stops the service being used to fetch internal addresses (SSRF)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise HTTPException(400, "url must be http or https")
    host = u.hostname.lower()
    if ALLOWED_HOSTS and host not in ALLOWED_HOSTS:
        raise HTTPException(400, "host is not allowed")
    if ALLOW_PRIVATE:
        return
    try:
        infos = socket.getaddrinfo(host, u.port or (443 if u.scheme == "https" else 80))
    except socket.gaierror:
        raise HTTPException(400, "cannot resolve host")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(400, "private addresses are not allowed")


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ImageIn(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


@app.get("/health")
def health():
    return {"ok": True, "backend": BACKEND}


@app.post("/embed/text")
def embed_text(body: TextIn):
    kind, model, _, tokenizer = _load()
    if kind == "dummy":
        return {"embedding": _dummy_vector(body.text.lower())}
    import torch

    with torch.no_grad():
        feats = model.encode_text(tokenizer([body.text]))
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return {"embedding": feats[0].tolist()}


@app.post("/embed/image")
def embed_image(body: ImageIn):
    _check_url(body.url)
    try:
        with httpx.Client(timeout=15, follow_redirects=False) as c:
            with c.stream("GET", body.url) as r:
                if r.status_code != 200:
                    raise HTTPException(502, f"image download failed ({r.status_code})")
                data = bytearray()
                for chunk in r.iter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_IMAGE_BYTES:
                        raise HTTPException(413, "image too large")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"image download failed: {e}")
    kind, model, preprocess, _ = _load()
    if kind == "dummy":
        return {"embedding": _dummy_vector(bytes(data[:2000]).decode("latin-1"))}
    try:
        img = Image.open(io.BytesIO(bytes(data))).convert("RGB")
    except Exception:
        raise HTTPException(400, "not a readable image")
    import torch

    with torch.no_grad():
        feats = model.encode_image(preprocess(img).unsqueeze(0))
        feats = feats / feats.norm(dim=-1, keepdim=True)
    return {"embedding": feats[0].tolist()}
