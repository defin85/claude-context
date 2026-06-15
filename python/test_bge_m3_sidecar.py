import json
import unittest

from bge_m3_sidecar import BgeM3Service, create_app, normalize_embedding
import bge_m3_sidecar


class FakeArray:
    def __init__(self, value):
        self.value = value

    def tolist(self):
        return self.value


class FakeModel:
    def __init__(self):
        self.calls = []

    def encode(self, inputs, **kwargs):
        self.calls.append((inputs, kwargs))
        return {
            "dense_vecs": [[0.1, 0.2], [0.3, 0.4]],
            "lexical_weights": [{"10": 0.7}, {"20": 0.8}],
            "colbert_vecs": [
                [[0.01, 0.02], [0.03, 0.04]],
                [[0.05, 0.06]],
            ],
        }


class FailingModel:
    def encode(self, inputs, **kwargs):
        raise RuntimeError("model overload without payload text")


class PayloadLeakingFailingModel:
    def encode(self, inputs, **kwargs):
        raise RuntimeError(f"model failed while processing {inputs[0]}")


class BgeM3SidecarTest(unittest.TestCase):
    def test_normalizes_flag_embedding_full_response(self):
        result = normalize_embedding(
            {
                "dense_vecs": FakeArray([0.1, 0.2]),
                "lexical_weights": {"42": 0.9, 7: 0.4},
                "colbert_vecs": FakeArray([[0.01, 0.02], [0.03, 0.04]]),
            },
            mode="full",
        )

        self.assertEqual(
            result,
            {
                "dense": [0.1, 0.2],
                "sparse": {
                    "indices": [7, 42],
                    "values": [0.4, 0.9],
                },
                "colbert": [[0.01, 0.02], [0.03, 0.04]],
            },
        )

    def test_service_requests_full_vectors_in_full_mode(self):
        model = FakeModel()
        service = BgeM3Service(model=model, model_name="BAAI/bge-m3", default_mode="full")

        results = service.embed_batch(["one", "two"], mode="full")

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["sparse"], {"indices": [10], "values": [0.7]})
        self.assertEqual(results[1]["colbert"], [[0.05, 0.06]])
        self.assertEqual(
            model.calls[0][1],
            {
                "return_dense": True,
                "return_sparse": True,
                "return_colbert_vecs": True,
            },
        )

    def test_service_requests_dense_only_vectors_in_dense_mode(self):
        model = FakeModel()
        service = BgeM3Service(model=model, model_name="BAAI/bge-m3", default_mode="dense")

        result = service.embed("one", mode="dense")

        self.assertEqual(result, {"dense": [0.1, 0.2]})
        self.assertEqual(
            model.calls[0][1],
            {
                "return_dense": True,
                "return_sparse": False,
                "return_colbert_vecs": False,
            },
        )

    def test_fastapi_endpoints_use_sidecar_contract(self):
        try:
            from fastapi.testclient import TestClient
        except ModuleNotFoundError:
            self.skipTest("fastapi is not installed")

        model = FakeModel()
        service = BgeM3Service(model=model, model_name="BAAI/bge-m3", default_mode="full")
        client = TestClient(create_app(service))

        self.assertEqual(client.get("/health").json(), {"status": "ok"})
        self.assertEqual(client.get("/metadata").json()["supported_modes"], ["full", "dense"])

        response = client.post("/embed_batch", json={"inputs": ["one", "two"], "mode": "full"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["dense"], [0.1, 0.2])
        self.assertEqual(response.json()[1]["sparse"], {"indices": [20], "values": [0.8]})

    def test_fastapi_batch_diagnostics_are_structured_and_sanitized(self):
        try:
            from fastapi.testclient import TestClient
        except ModuleNotFoundError:
            self.skipTest("fastapi is not installed")

        raw_text = "secret payload text"
        model = FakeModel()
        service = BgeM3Service(model=model, model_name="BAAI/bge-m3", default_mode="full")
        client = TestClient(create_app(service))

        with self.assertLogs("claude_context.bge_m3_sidecar", level="INFO") as logs:
            response = client.post(
                "/embed_batch",
                json={"inputs": [raw_text, "two"], "mode": "full"},
                headers={"x-claude-context-request-id": "request-123"},
            )

        self.assertEqual(response.status_code, 200)
        joined_logs = "\n".join(logs.output)
        self.assertNotIn(raw_text, joined_logs)
        self.assertNotIn("0.1", joined_logs)
        payload = json.loads(logs.output[0].split("INFO:claude_context.bge_m3_sidecar:", 1)[1])
        self.assertEqual(payload["request_id"], "request-123")
        self.assertEqual(payload["endpoint"], "/embed_batch")
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["shape"]["chunk_count"], 2)
        self.assertEqual(payload["shape"]["content_char_count"], len(raw_text) + 3)

    def test_diagnostic_logger_omits_payload_text_without_fastapi(self):
        raw_text = "secret payload text"
        shape = bge_m3_sidecar._text_shape([raw_text, "two"], mode="full")

        with self.assertLogs("claude_context.bge_m3_sidecar", level="INFO") as logs:
            bge_m3_sidecar._log_request_outcome(
                request_id="request-direct",
                endpoint="/embed_batch",
                status="success",
                shape=shape,
                started_at=0,
            )

        joined_logs = "\n".join(logs.output)
        self.assertNotIn(raw_text, joined_logs)
        payload = json.loads(logs.output[0].split("INFO:claude_context.bge_m3_sidecar:", 1)[1])
        self.assertEqual(payload["request_id"], "request-direct")
        self.assertEqual(payload["shape"]["chunk_count"], 2)
        self.assertEqual(payload["shape"]["content_char_count"], len(raw_text) + 3)

    def test_diagnostic_logger_redacts_exception_messages_without_fastapi(self):
        raw_text = "secret failing payload"
        shape = bge_m3_sidecar._text_shape([raw_text], mode="full")

        with self.assertLogs("claude_context.bge_m3_sidecar", level="INFO") as logs:
            bge_m3_sidecar._log_request_outcome(
                request_id="request-direct-failure",
                endpoint="/embed_batch",
                status="failure",
                shape=shape,
                started_at=0,
                phase="embed_batch",
                exc=RuntimeError(f"model failed while processing {raw_text}"),
            )

        joined_logs = "\n".join(logs.output)
        self.assertNotIn(raw_text, joined_logs)
        payload = json.loads(logs.output[0].split("INFO:claude_context.bge_m3_sidecar:", 1)[1])
        self.assertEqual(payload["exception_class"], "RuntimeError")
        self.assertEqual(payload["exception_message"], "[redacted]")

    def test_fastapi_batch_failure_diagnostics_omit_payload_text_and_vectors(self):
        try:
            from fastapi.testclient import TestClient
        except ModuleNotFoundError:
            self.skipTest("fastapi is not installed")

        raw_text = "secret failing payload"
        service = BgeM3Service(model=PayloadLeakingFailingModel(), model_name="BAAI/bge-m3", default_mode="full")
        client = TestClient(create_app(service))

        with self.assertLogs("claude_context.bge_m3_sidecar", level="INFO") as logs:
            response = client.post(
                "/embed_batch",
                json={"inputs": [raw_text], "mode": "full"},
                headers={"x-claude-context-request-id": "request-failed"},
            )

        self.assertEqual(response.status_code, 500)
        joined_logs = "\n".join(logs.output)
        self.assertNotIn(raw_text, joined_logs)
        payload = json.loads(logs.output[0].split("INFO:claude_context.bge_m3_sidecar:", 1)[1])
        self.assertEqual(payload["request_id"], "request-failed")
        self.assertEqual(payload["status"], "failure")
        self.assertEqual(payload["phase"], "embed_batch")
        self.assertEqual(payload["exception_class"], "RuntimeError")
        self.assertEqual(payload["exception_message"], "[redacted]")
        self.assertEqual(payload["shape"]["chunk_count"], 1)


if __name__ == "__main__":
    unittest.main()
