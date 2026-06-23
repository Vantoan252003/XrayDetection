export const diseaseTranslation: Record<string, string> = {
  "Atelectasis": "Xẹp phổi",
  "Cardiomegaly": "Tim phì đại",
  "Consolidation": "Đông đặc phổi",
  "Edema": "Phù phổi",
  "Effusion": "Tràn dịch màng phổi",
  "Emphysema": "Khí phế thũng",
  "Fibrosis": "Xơ hóa phổi",
  "Hernia": "Thoát vị hoành",
  "Infiltration": "Thâm nhiễm phổi",
  "Mass": "Khối u phổi",
  "Nodule": "Nốt phổi",
  "Pleural_Thickening": "Dày màng phổi",
  "Pneumonia": "Viêm phổi",
  "Pneumothorax": "Tràn khí màng phổi",
  "Normal": "Bình thường",
  "Lung Lesion": "Tổn thương phổi",
  "Fracture": "Gãy xương sườn",
  "Lung Opacity": "Mờ phổi",
  "Enlarged Cardiomediastinum": "Rộng trung thất",
};

export const translateDisease = (disease: string | null | undefined): string => {
  if (!disease) return "Bình thường";
  return diseaseTranslation[disease] || disease;
};
