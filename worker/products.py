"""Read product metadata supplied by Spring; never infer it from symptom text."""
PRODUCT_NAMES = {"vacuum": "청소기", "washing_machine": "세탁기",
                 "air_conditioner": "에어컨", "unknown": "제품 종류 미확인"}


def normalize_product_type(value):
    if value is None or value == "":
        return "unknown"
    if not isinstance(value, str) or value.strip().lower() not in PRODUCT_NAMES:
        raise ValueError("Unsupported product_type")
    return value.strip().lower()


def command_product_type(command):
    payload = command.get("payload", {})
    repair = payload.get("repair", {})
    snapshot = repair.get("product_snapshot") or {}
    # Canonical position: payload.repair.product_type. Accept Spring camelCase
    # and product snapshots while the intake contract is being rolled out.
    values = {normalize_product_type(obj[key]) for obj in (repair, snapshot, payload)
              for key in ("product_type", "productType") if key in obj}
    known = values - {"unknown"}
    if len(known) > 1:
        raise ValueError("Conflicting product_type metadata")
    return next(iter(known), "unknown")
