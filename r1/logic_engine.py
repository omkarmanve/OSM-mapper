"""
Excel row ko XML ke employee / dependent se strict match karna.

Yahan koi business logic hard-coded nahi hai: expected values sirf mapping ke
logic text se aati hain (r1/logic_dsl.py).
"""

import re

from r1.xml_parser import norm_id

SSN_CELL = re.compile(r"^[\d-]{5,}$")


def _clean(value):
    return str(value or "").strip()


def _name(value):
    return re.sub(r"\s+", " ", _clean(value)).upper()


def _digits(value):
    return re.sub(r"\D", "", str(value or ""))


# ---------------------------------------------------------------
# Employee row
# ---------------------------------------------------------------
def extract_row_info(cells):
    info = {
        "record_type": _clean(cells[0]) if cells else "",
        "last": "",
        "first": "",
        "ssn": [],
        "dob": "",
        "nm1_idx": None,
    }

    for index, raw in enumerate(cells):
        if index == 0:
            continue

        cell = _clean(raw)
        if not cell:
            continue

        upper = cell.upper()

        if upper.startswith("NM1*") and info["nm1_idx"] is None:
            parts = cell.split("*")
            info["nm1_idx"] = index
            info["last"] = _clean(parts[3]) if len(parts) > 3 else ""
            info["first"] = _clean(parts[4]) if len(parts) > 4 else ""
            if len(parts) > 9 and _clean(parts[9]):
                info["ssn"].append(_clean(parts[9]))

        elif upper.startswith("DMG*") and not info["dob"]:
            parts = cell.split("*")
            info["dob"] = _clean(parts[2]) if len(parts) > 2 else ""

        elif "*" not in cell and SSN_CELL.match(cell):
            info["ssn"].append(cell)

    return info


def match_user(info, users):
    """Employee row -> XML employee. Returns (user, [error messages])."""
    ssn_keys = [norm_id(s) for s in info["ssn"] if len(norm_id(s)) >= 5]

    if not ssn_keys:
        return None, ["SSN not found in the Excel row."]

    if not (info["last"] and info["first"]):
        return None, ["Name not found in the Excel row (NM1 segment)."]

    excel_ssn = info["ssn"][0]
    excel_name = f"{info['last']} {info['first']}"

    full, ssn_only, name_only = [], [], []

    for user in users:
        ssn_ok = any(key in user["id_values"] for key in ssn_keys)
        name_ok = (
            _name(user["last"]) == _name(info["last"])
            and _name(user["first"]) == _name(info["first"])
        )

        if ssn_ok and name_ok:
            full.append(user)
        elif ssn_ok:
            ssn_only.append(user)
        elif name_ok:
            name_only.append(user)

    if len(full) > 1:
        labels = ", ".join(u["label"] for u in full)
        return None, [f"Duplicate user in XML ({labels})."]

    if len(full) == 1:
        user = full[0]

        excel_dob, xml_dob = _digits(info["dob"]), _digits(user["dob"])
        if excel_dob and xml_dob and excel_dob != xml_dob:
            return None, [
                f"DOB does not match (Excel: {info['dob']}, "
                f"XML: {user['dob']})."
            ]

        return user, []

    if ssn_only:
        user = ssn_only[0]
        return None, [
            f"Name does not match (Excel: {excel_name}, "
            f"XML: {user['last']} {user['first']})."
        ]

    if name_only:
        user = name_only[0]
        return None, [
            f"SSN does not match (Excel: {excel_ssn}, "
            f"XML user: {user['label']})."
        ]

    return None, [
        f"SSN and Name both do not match "
        f"(Excel SSN: {excel_ssn}, Name: {excel_name})."
    ]


# ---------------------------------------------------------------
# Dependent row
# ---------------------------------------------------------------
def extract_dependent_info(cells):
    info = {
        "record_type": _clean(cells[0]) if cells else "",
        "last": "",
        "first": "",
        "dob": "",
        "dep_ssn": "",
        "parent_ssns": [],     # employee (subscriber) SSN: alag SSN cell / REF value
        "nm1_idx": None,
    }

    for index, raw in enumerate(cells):
        if index == 0:
            continue

        cell = _clean(raw)
        if not cell:
            continue

        upper = cell.upper()
        parts = cell.split("*")

        if upper.startswith("NM1*") and info["nm1_idx"] is None:
            info["nm1_idx"] = index
            info["last"] = _clean(parts[3]) if len(parts) > 3 else ""
            info["first"] = _clean(parts[4]) if len(parts) > 4 else ""
            info["dep_ssn"] = _clean(parts[9]) if len(parts) > 9 else ""

        elif upper.startswith("DMG*") and not info["dob"]:
            info["dob"] = _clean(parts[2]) if len(parts) > 2 else ""

        elif upper.startswith("REF*"):
            value = _clean(parts[2]) if len(parts) > 2 else ""
            if value and SSN_CELL.match(value):
                info["parent_ssns"].append(value)

        elif "*" not in cell and SSN_CELL.match(cell):
            info["parent_ssns"].append(cell)

    return info


def match_dependent(info, users):
    """Dependent row -> XML dependent. Returns (user, dependent, [errors])."""

    if not (info["last"] and info["first"]):
        return None, None, ["Dependent name not found in the Excel row (NM1 segment)."]

    excel_name = f"{info['last']} {info['first']}"
    parent_keys = [norm_id(s) for s in info["parent_ssns"] if len(norm_id(s)) >= 5]

    candidates, name_hits = [], []

    for user in users:
        parent_ok = (not parent_keys) or any(
            key in user["id_values"] for key in parent_keys
        )

        for dependent in user["dependents"]:
            if (
                _name(dependent["last"]) == _name(info["last"])
                and _name(dependent["first"]) == _name(info["first"])
            ):
                name_hits.append((user, dependent))
                if parent_ok:
                    candidates.append((user, dependent))

    excel_dob = _digits(info["dob"])

    if len(candidates) > 1 and excel_dob:
        narrowed = [c for c in candidates if _digits(c[1]["dob"]) == excel_dob]
        if narrowed:
            candidates = narrowed

    if len(candidates) > 1:
        labels = ", ".join(f"{u['label']}/{d['label']}" for u, d in candidates)
        return None, None, [f"Duplicate dependent in XML ({labels})."]

    if len(candidates) == 1:
        user, dependent = candidates[0]
        errors = []

        xml_dob = _digits(dependent["dob"])
        if excel_dob and xml_dob and excel_dob != xml_dob:
            errors.append(
                f"Dependent DOB does not match (Excel: {info['dob']}, "
                f"XML: {dependent['dob']})."
            )

        excel_ssn, xml_ssn = norm_id(info["dep_ssn"]), norm_id(dependent["ssn"])
        if len(excel_ssn) >= 5 and len(xml_ssn) >= 5 and excel_ssn != xml_ssn:
            errors.append(
                f"Dependent SSN does not match (Excel: {info['dep_ssn']}, "
                f"XML: {dependent['ssn']})."
            )

        return (None, None, errors) if errors else (user, dependent, [])

    if name_hits:
        user = name_hits[0][0]
        return None, None, [
            f"Dependent {excel_name} is in the XML under a different employee "
            f"({user['label']}), not the employee SSN in the Excel row "
            f"({info['parent_ssns'][0] if info['parent_ssns'] else '-'})."
        ]

    parents = [
        u for u in users
        if parent_keys and any(key in u["id_values"] for key in parent_keys)
    ]

    if parents:
        names = ", ".join(
            f"{d['last']} {d['first']}".strip() for d in parents[0]["dependents"]
        ) or "no dependents"
        return None, None, [
            f"Dependent name does not match (Excel: {excel_name}; "
            f"XML dependents of employee {parents[0]['label']}: {names})."
        ]

    return None, None, [
        f"Dependent not found in the XML (Excel: {excel_name})."
    ]
