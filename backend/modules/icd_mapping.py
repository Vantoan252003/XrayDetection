# Fallback mapping for TorchXRayVision pathologies to standard ICD-10 codes and groups

ICD10_MAPPING = {
    "Atelectasis": {"code": "J98.11", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Consolidation": {"code": "J18.9", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Infiltration": {"code": "J18.9", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Pneumothorax": {"code": "J93.9", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Edema": {"code": "J81.0", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Emphysema": {"code": "J43.9", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Fibrosis": {"code": "J84.1", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Effusion": {"code": "J90", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Pneumonia": {"code": "J18.9", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Pleural_Thickening": {"code": "J94.8", "group": "Bệnh hệ hô hấp (J00-J99)"},
    "Cardiomegaly": {"code": "I51.7", "group": "Bệnh hệ tuần hoàn (I00-I99)"},
    "Hernia": {"code": "K44.9", "group": "Bệnh hệ tiêu hóa (K00-K93)"},
    "Nodule": {"code": "R91.1", "group": "Triệu chứng và dấu hiệu lâm sàng (R00-R99)"},
    "Mass": {"code": "R91.8", "group": "Triệu chứng và dấu hiệu lâm sàng (R00-R99)"},
    "TB": {"code": "A15.0", "group": "Bệnh nhiễm trùng và ký sinh trùng (A00-B99)"},
    "Normal": {"code": "Z00.0", "group": "Yếu tố ảnh hưởng sức khỏe (Z00-Z99)"}
}

def get_default_icd(pathology: str | None) -> tuple[str | None, str | None]:
    """Get the default ICD-10 code and group for a given pathology."""
    if not pathology or pathology not in ICD10_MAPPING:
        return None, None
    mapped = ICD10_MAPPING[pathology]
    return mapped["code"], mapped["group"]
