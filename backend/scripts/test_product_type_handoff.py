"""Exercise the actual Agent reader; statically compare RAG's Literal without installing its runtime."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('actual_worker_products', ROOT / 'worker/products.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
TYPES = {'vacuum', 'washing_machine', 'air_conditioner', 'unknown'}


class ProductTypeHandoffTests(unittest.TestCase):
    def test_actual_agent_reads_requested_and_resumed_commands_for_all_types(self):
        examples = json.loads((ROOT / 'backend/docs/kafka-examples.json').read_text())
        commands = [e for e in examples if e['eventType'] in {'DIAGNOSIS_REQUESTED', 'DIAGNOSIS_RESUMED'}]
        self.assertEqual(len(commands), 2)
        for command in commands:
            for product_type in TYPES:
                item = copy.deepcopy(command)
                item['payload']['repair']['product_type'] = product_type
                item['payload']['repair']['product_snapshot']['product_type'] = product_type
                self.assertEqual(worker.command_product_type(item), product_type)

    def test_actual_agent_treats_legacy_missing_metadata_as_unknown(self):
        self.assertEqual(worker.command_product_type({'payload': {'repair': {}}}), 'unknown')

    def test_rag_literal_swagger_and_shared_kafka_vocabulary_match(self):
        tree = ast.parse((ROOT / 'Rag_mcp/src/repair_mcp/products.py').read_text())
        alias = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'ProductType' for t in n.targets))
        self.assertEqual({v.value for v in alias.value.slice.elts}, TYPES)
        swagger = json.loads((ROOT / 'backend/docs/openapi.json').read_text())
        self.assertEqual(set(swagger['components']['schemas']['ProductType']['enum']), TYPES)
        schema = json.loads((ROOT / 'contract/kafka-event.schema.json').read_text())
        for rule in schema['allOf']:
            if rule['if']['properties']['eventType']['const'] in {'DIAGNOSIS_REQUESTED', 'DIAGNOSIS_RESUMED'}:
                repair = rule['then']['properties']['payload']['properties']['repair']
                self.assertIn('product_type', repair['required'])
                self.assertEqual(set(repair['properties']['product_type']['enum']), TYPES)


if __name__ == '__main__':
    unittest.main()
