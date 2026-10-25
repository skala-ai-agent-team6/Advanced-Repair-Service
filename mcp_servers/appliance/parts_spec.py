"""가전 부품 점검 항목과 상태 클래스. 상태 → 심각도는 고정 대응표 (모델이 상태를 내면 심각도가 정해진다)."""

ITEMS = {
    "ac_filter": {"product": "air_conditioner", "part": "air conditioner / HVAC air filter",
                  "classes": {"clean": "filter looks clean or new",
                              "mildly_dirty": "some dust or discoloration",
                              "heavily_dirty": "thick dust, dark grime or clogged"}},
    "ac_drain_hose": {"product": "air_conditioner", "part": "air conditioner condensate drain hose or pipe",
                      "classes": {"ok": "hose or pipe looks intact and unobstructed",
                                  "kinked_or_blocked": "kinked, crushed, dirty buildup or visibly clogged"}},
    "rv_motor": {"product": "robot_vacuum", "part": "small electric motor (armature, winding, housing)",
                 "classes": {"normal": "no burn marks",
                             "burn_marks": "scorch marks, blackened or melted winding/insulation"}},
    "rv_wheel": {"product": "robot_vacuum", "part": "small rubber/plastic wheel or tire",
                 "classes": {"ok": "wheel intact, tread visible",
                             "worn": "tread worn smooth, cracked rubber",
                             "broken": "wheel broken, cracked through or missing pieces"}},
    "wm_inlet_hose": {"product": "washing_machine", "part": "flexible water hose (washing machine inlet or similar)",
                      "classes": {"ok": "hose intact",
                                  "damaged": "cracked, bulging, burst, leaking or corroded fitting"}},
    "wm_drain_filter": {"product": "washing_machine", "part": "washing machine drain pump filter or lint filter",
                        "classes": {"clean": "filter clean",
                                    "clogged": "lint, hair, debris or sludge clogging it"}},
    "wm_door_gasket": {"product": "washing_machine", "part": "front-loader washing machine door rubber seal/gasket",
                       "classes": {"ok": "seal clean and intact",
                                   "mold_or_torn": "black mold, slime or torn rubber"}},
}

# 상태 → 심각도 (none / minor / moderate / severe). 고장이 아닌 상태는 none
SEVERITY = {"clean": "none", "ok": "none", "normal": "none",
            "mildly_dirty": "minor", "worn": "moderate", "kinked_or_blocked": "moderate",
            "clogged": "moderate", "mold_or_torn": "moderate",
            "heavily_dirty": "severe", "burn_marks": "severe", "broken": "severe", "damaged": "severe"}

PRODUCTS = sorted({v["product"] for v in ITEMS.values()})


def items_for(product_type: str) -> list[str]:
    return [k for k, v in ITEMS.items() if v["product"] == product_type]
