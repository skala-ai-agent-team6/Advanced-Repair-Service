"""Product codes shared by intake, MCP tools, reports and retrieval."""
from typing import Literal
from pydantic import TypeAdapter

ProductType = Literal["vacuum", "washing_machine", "air_conditioner", "unknown"]
PRODUCT_NAMES = {"vacuum": "청소기", "washing_machine": "세탁기",
                 "air_conditioner": "에어컨", "unknown": "제품 종류 미확인"}


def validate_product_type(value: str) -> ProductType:
    return TypeAdapter(ProductType).validate_python(value)
