"""Local BGE-M3 HTTP sidecar for Claude Context.

The module keeps FastAPI, torch, and FlagEmbedding imports lazy so the response
normalization tests can run in a plain Python environment.
"""

import argparse
import os
from dataclasses import dataclass
from typing import Any, Literal


BgeM3Mode = Literal["full", "dense"]


def _as_python(value: Any) -> Any:
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_number_list(value: Any) -> bool:
    return isinstance(value, list) and all(_is_number(item) for item in value)


def _pick_item(value: Any, index: int, *, batched: bool) -> Any:
    value = _as_python(value)
    if not batched:
        return value
    if isinstance(value, list):
        return value[index]
    return value


def _normalize_dense(value: Any, index: int, *, batched: bool) -> list[float]:
    dense = _pick_item(value, index, batched=batched)
    dense = _as_python(dense)
    if not _is_number_list(dense):
        raise ValueError("BGE-M3 model response is missing dense vector data")
    return [float(item) for item in dense]


def _normalize_sparse(value: Any, index: int, *, batched: bool) -> dict[str, list[int] | list[float]]:
    sparse = _pick_item(value, index, batched=batched)
    sparse = _as_python(sparse)

    if isinstance(sparse, dict) and "indices" in sparse and "values" in sparse:
        indices = _as_python(sparse["indices"])
        values = _as_python(sparse["values"])
        if not isinstance(indices, list) or not isinstance(values, list):
            raise ValueError("BGE-M3 sparse vector must contain indices and values")
        if len(indices) != len(values):
            raise ValueError("BGE-M3 sparse vector indices and values length mismatch")
        pairs = [(int(idx), float(weight)) for idx, weight in zip(indices, values)]
    elif isinstance(sparse, dict):
        pairs = [(int(token_id), float(weight)) for token_id, weight in sparse.items()]
    else:
        raise ValueError("BGE-M3 full mode requires sparse lexical weights")

    pairs = sorted((idx, weight) for idx, weight in pairs if weight != 0.0)
    return {
        "indices": [idx for idx, _ in pairs],
        "values": [weight for _, weight in pairs],
    }


def _normalize_colbert(value: Any, index: int, *, batched: bool) -> list[list[float]]:
    colbert = _pick_item(value, index, batched=batched)
    colbert = _as_python(colbert)
    if not isinstance(colbert, list):
        raise ValueError("BGE-M3 full mode requires ColBERT token vectors")

    vectors: list[list[float]] = []
    for vector in colbert:
        vector = _as_python(vector)
        if not _is_number_list(vector):
            raise ValueError("BGE-M3 ColBERT vectors must be a numeric matrix")
        vectors.append([float(item) for item in vector])
    return vectors


def normalize_embedding(
    encoded: dict[str, Any],
    *,
    mode: BgeM3Mode,
    index: int = 0,
    batched: bool = False,
) -> dict[str, Any]:
    """Convert FlagEmbedding output to the TypeScript BgeM3Embedding contract."""

    dense_source = encoded.get("dense_vecs", encoded.get("dense", encoded.get("embedding")))
    result: dict[str, Any] = {
        "dense": _normalize_dense(dense_source, index, batched=batched),
    }

    if mode == "full":
        sparse_source = encoded.get("lexical_weights", encoded.get("sparse"))
        colbert_source = encoded.get("colbert_vecs", encoded.get("colbert"))
        result["sparse"] = _normalize_sparse(sparse_source, index, batched=batched)
        result["colbert"] = _normalize_colbert(colbert_source, index, batched=batched)

    return result


@dataclass
class BgeM3Service:
    model: Any
    model_name: str
    default_mode: BgeM3Mode = "full"

    def embed(self, text: str, *, mode: BgeM3Mode | None = None) -> dict[str, Any]:
        return self.embed_batch([text], mode=mode)[0]

    def embed_batch(self, texts: list[str], *, mode: BgeM3Mode | None = None) -> list[dict[str, Any]]:
        selected_mode = mode or self.default_mode
        if selected_mode not in ("full", "dense"):
            raise ValueError(f"Unsupported BGE-M3 mode: {selected_mode}")

        encoded = self.model.encode(
            texts,
            return_dense=True,
            return_sparse=selected_mode == "full",
            return_colbert_vecs=selected_mode == "full",
        )

        return [
            normalize_embedding(encoded, mode=selected_mode, index=index, batched=True)
            for index in range(len(texts))
        ]

    def metadata(self) -> dict[str, Any]:
        return {
            "model": self.model_name,
            "default_mode": self.default_mode,
            "supported_modes": ["full", "dense"],
            "outputs": ["dense", "sparse", "colbert"],
        }


def _default_device() -> str:
    requested = os.environ.get("BGE_M3_DEVICE")
    if requested:
        return requested

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def load_service(
    *,
    model_name: str,
    mode: BgeM3Mode,
    device: str | None = None,
    use_fp16: bool = True,
) -> BgeM3Service:
    from FlagEmbedding import BGEM3FlagModel

    selected_device = device or _default_device()
    model = BGEM3FlagModel(model_name, use_fp16=use_fp16, devices=selected_device)
    return BgeM3Service(model=model, model_name=model_name, default_mode=mode)


def create_app(service: BgeM3Service | None = None):
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel, Field

    app = FastAPI(title="Claude Context BGE-M3 sidecar")
    loaded_service = service

    class EmbedRequest(BaseModel):
        input: str
        model: str | None = None
        mode: BgeM3Mode | None = None

    class EmbedBatchRequest(BaseModel):
        inputs: list[str] = Field(min_length=1)
        model: str | None = None
        mode: BgeM3Mode | None = None

    def get_service() -> BgeM3Service:
        nonlocal loaded_service
        if loaded_service is None:
            loaded_service = load_service(
                model_name=os.environ.get("BGE_M3_MODEL", "BAAI/bge-m3"),
                mode=os.environ.get("BGE_M3_MODE", "full"),  # type: ignore[arg-type]
                device=os.environ.get("BGE_M3_DEVICE"),
                use_fp16=os.environ.get("BGE_M3_USE_FP16", "true").lower() != "false",
            )
        return loaded_service

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/metadata")
    def metadata() -> dict[str, Any]:
        return get_service().metadata()

    @app.post("/embed")
    def embed(request: EmbedRequest) -> dict[str, Any]:
        try:
            return get_service().embed(request.input, mode=request.mode)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/embed_batch")
    def embed_batch(request: EmbedBatchRequest) -> list[dict[str, Any]]:
        try:
            return get_service().embed_batch(request.inputs, mode=request.mode)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return app


try:
    app = create_app()
except ModuleNotFoundError:
    app = None


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Claude Context BGE-M3 sidecar")
    parser.add_argument("--host", default=os.environ.get("BGE_M3_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("BGE_M3_PORT", "8000")))
    parser.add_argument("--model", default=os.environ.get("BGE_M3_MODEL", "BAAI/bge-m3"))
    parser.add_argument("--mode", choices=["full", "dense"], default=os.environ.get("BGE_M3_MODE", "full"))
    parser.add_argument("--device", default=os.environ.get("BGE_M3_DEVICE"))
    parser.add_argument("--no-fp16", action="store_true")
    args = parser.parse_args()

    global app
    app = create_app(load_service(
        model_name=args.model,
        mode=args.mode,
        device=args.device,
        use_fp16=not args.no_fp16,
    ))

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
