import unittest

from bge_m3_sidecar import BgeM3Service, create_app, normalize_embedding


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


if __name__ == "__main__":
    unittest.main()
