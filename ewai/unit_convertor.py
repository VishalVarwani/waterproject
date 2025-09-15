# unit_converter.py
"""
Lightweight unit conversion helpers for the water-domain harmonizer.

Design:
- STANDARD_UNITS: canonical unit per parameter (what we want to show in the
  harmonized output).
- CONVERTERS: per (parameter, from_unit) -> function(pd.Series)->pd.Series.
- convert_series(param, from_unit, series) returns:
    converted_series, unit_to, did_convert (bool)

Notes:
- We only implement unambiguous, common conversions. If a conversion needs
  temperature/salinity/pressure context (e.g., DO %sat→mg/L) we leave it
  unconverted.
- For DO ppm→mg/L we treat as 1:1 in freshwater (density ≈ 1 g/mL). If you
  want stricter handling, remove that mapping.
"""

from __future__ import annotations
from typing import Tuple, Callable, Dict
import pandas as pd

# -------- Canonical unit per parameter --------
STANDARD_UNITS: Dict[str, str] = {
    "temperature": "C",
    "ph": "unitless",
    "dissolved_oxygen": "mg/L",
    "turbidity": "NTU",
    "conductivity": "µS/cm",
    "chlorophyll": "µg/L",
    "chlorophyll_a": "µg/L",
    "salinity": "PSU",
    "secchi_depth": "m",
    "redox": "mV",
    "total_phosphorus": "mg/L",
    "total_nitrogen": "mg/L",
    "organic_nitrogen": "mg/L",
    "nitrate": "mg/L",
    "nitrite": "mg/L",
    "ammonium": "mg/L",
    "phosphate": "mg/L",
    "sulfate": "mg/L",
    "chloride": "mg/L",
    "fluoride": "mg/L",
    "potassium": "mg/L",
    "carbon_dioxide": "mg/L",
    "uv_absorbance": "absorbance",
    "suva": "L/mg·m",
    "toc": "mg/L",
    "color_real": "PtCo",
    "reservoir_level": "m",
    "photic_zone_depth": "m",
    "pheopigments": "µg/L",
    "total_eukaryotic_algae": "cells/mL",
    "total_cyanobacteria": "cells/mL",
    "diatoms": "cells/mL",
    "ceratium": "cells/mL",
    "peridinium": "cells/mL",
    "dynobryon": "cells/mL",
    "cryptomonas": "cells/mL",
    "eudorina_pandorina": "cells/mL",
    "staurastrum": "cells/mL",
    "woronochinia": "cells/mL",
    "dolichospermum": "cells/mL",
    "aphanizomenon": "cells/mL",
    "e_coli": "CFU/100mL",
    "microcystins": "µg/L",
    "saxitoxina": "µg/L",
}

# -------- Converter registry --------
def _id(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")

def _f_to_c(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    return (s - 32.0) * (5.0/9.0)

def _k_to_c(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    return s - 273.15

def _mscm_to_uscm(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    return s * 1000.0

def _ugl_to_mgl(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    return s / 1000.0

def _ppm_to_mgl(s: pd.Series) -> pd.Series:
    # Approximate freshwater assumption (density ~1). If you dislike this,
    # remove mapping and we will not convert ppm.
    s = pd.to_numeric(s, errors="coerce")
    return s

# Parameter-specific converters keyed by (param, from_unit)
CONVERTERS: Dict[tuple, Callable[[pd.Series], pd.Series]] = {
    # temperature
    ("temperature", "F"): _f_to_c,
    ("temperature", "K"): _k_to_c,
    ("temperature", "C"): _id,

    # conductivity
    ("conductivity", "mS/cm"): _mscm_to_uscm,
    ("conductivity", "µS/cm"): _id,

    # dissolved oxygen
    ("dissolved_oxygen", "mg/L"): _id,
    ("dissolved_oxygen", "ppm"): _ppm_to_mgl,
    # percent_sat needs context → no converter here

    # nutrients/metals/etc mg/L ↔ µg/L
    ("total_phosphorus", "µg/L"): _ugl_to_mgl,
    ("nitrate", "µg/L"): _ugl_to_mgl,
    ("nitrite", "µg/L"): _ugl_to_mgl,
    ("ammonium", "µg/L"): _ugl_to_mgl,
    ("phosphate", "µg/L"): _ugl_to_mgl,

    # already canonical
    ("total_phosphorus", "mg/L"): _id,
    ("total_nitrogen", "mg/L"): _id,
    ("organic_nitrogen", "mg/L"): _id,
    ("sulfate", "mg/L"): _id,
    ("chloride", "mg/L"): _id,
    ("fluoride", "mg/L"): _id,
    ("potassium", "mg/L"): _id,
    ("toc", "mg/L"): _id,

    # pigments/toxins
    ("chlorophyll", "µg/L"): _id,
    ("chlorophyll_a", "µg/L"): _id,
    ("pheopigments", "µg/L"): _id,
    ("microcystins", "µg/L"): _id,
    ("saxitoxina", "µg/L"): _id,

    # optics / depth / redox
    ("secchi_depth", "m"): _id,
    ("photic_zone_depth", "m"): _id,
    ("redox", "mV"): _id,
    ("uv_absorbance", "absorbance"): _id,
    ("suva", "L/mg·m"): _id,
    ("color_real", "PtCo"): _id,

    # counts
    ("total_eukaryotic_algae", "cells/mL"): _id,
    ("total_cyanobacteria", "cells/mL"): _id,
    ("diatoms", "cells/mL"): _id,
    ("ceratium", "cells/mL"): _id,
    ("peridinium", "cells/mL"): _id,
    ("dynobryon", "cells/mL"): _id,
    ("cryptomonas", "cells/mL"): _id,
    ("eudorina_pandorina", "cells/mL"): _id,
    ("staurastrum", "cells/mL"): _id,
    ("woronochinia", "cells/mL"): _id,
    ("dolichospermum", "cells/mL"): _id,
    ("aphanizomenon", "cells/mL"): _id,

    ("e_coli", "CFU/100mL"): _id,

    # etc. add as needed
}

def convert_series(param: str, from_unit: str, series: pd.Series) -> Tuple[pd.Series, str, bool]:
    """
    Convert `series` of values for `param` from `from_unit` to the STANDARD_UNITS[param],
    when supported.

    Returns: (converted_series, unit_to, did_convert)
    """
    unit_to = STANDARD_UNITS.get(param)
    if unit_to is None:
        return series, from_unit, False  # unknown param

    # already standard
    if from_unit == unit_to:
        return pd.to_numeric(series, errors="coerce"), unit_to, False

    fn = CONVERTERS.get((param, from_unit))
    if fn is None:
        # unsupported conversion, leave as-is
        return series, from_unit, False

    try:
        conv = fn(series)
        return conv, unit_to, True
    except Exception:
        # fail-safe: do not break pipeline
        return series, from_unit, False
