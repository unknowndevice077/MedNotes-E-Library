// Subjects for labelling files and filtering the library. Grouped for the picker; the admin can
// still type any other label.
export const CATEGORY_GROUPS: { group: string; items: string[] }[] = [
  { group: 'Basic sciences', items: ['Anatomy', 'Neuroanatomy', 'Histology', 'Embryology', 'Physiology', 'Biochemistry', 'Genetics', 'Molecular Biology', 'Pharmacology', 'Pathology', 'Microbiology', 'Parasitology', 'Immunology', 'Toxicology', 'Medical Terminology'] },
  { group: 'Internal medicine', items: ['Internal Medicine', 'Cardiology', 'Pulmonology', 'Gastroenterology', 'Hepatology', 'Nephrology', 'Endocrinology', 'Hematology', 'Oncology', 'Rheumatology', 'Infectious Diseases', 'Allergy & Immunology', 'Geriatrics', 'Sleep Medicine'] },
  { group: 'Surgery', items: ['General Surgery', 'Surgery', 'Orthopedics', 'Neurosurgery', 'Cardiothoracic Surgery', 'Vascular Surgery', 'Plastic Surgery', 'Pediatric Surgery', 'Urology', 'Trauma Surgery', 'Surgical Instruments'] },
  { group: 'Specialties', items: ['Pediatrics', 'Neonatology', 'Obstetrics', 'Gynecology', 'OB-GYN', 'Neurology', 'Psychiatry', 'Dermatology', 'Ophthalmology', 'ENT (Otolaryngology)', 'Anesthesiology', 'Emergency Medicine', 'Critical Care', 'Radiology', 'Nuclear Medicine', 'Rehabilitation Medicine', 'Sports Medicine', 'Pain Medicine', 'Palliative Care', 'Family Medicine'] },
  { group: 'Public health', items: ['Community Health', 'Public Health', 'Epidemiology', 'Biostatistics', 'Preventive Medicine', 'Occupational Health', 'Health Policy', 'Global Health', 'Nutrition & Dietetics'] },
  { group: 'Clinical skills & exams', items: ['Clinical', 'Clinical Skills', 'Physical Examination', 'ECG', 'Lab Values', 'Medical Ethics', 'Legal & Forensic Medicine', 'Research Methods', 'Board Review', 'NLE (Nurse Licensure Exam)', 'PLE (Physician Licensure Exam)', 'USMLE', 'NCLEX'] },
  { group: 'Nursing', items: ['Nursing', 'Fundamentals of Nursing', 'Medical-Surgical Nursing', 'Maternal & Child Nursing', 'Pediatric Nursing', 'Psychiatric Nursing', 'Community Health Nursing', 'Nursing Pharmacology', 'Nursing Leadership & Management', 'Midwifery'] },
  { group: 'Allied health', items: ['Pharmacy', 'Clinical Pharmacy', 'Medical Technology', 'Clinical Chemistry', 'Clinical Microscopy', 'Blood Banking', 'Physical Therapy', 'Occupational Therapy', 'Radiologic Technology', 'Respiratory Therapy', 'Dentistry', 'Optometry', 'Speech Pathology', 'Health Informatics'] },
];

export const CATEGORIES = [...new Set(CATEGORY_GROUPS.flatMap((g) => g.items))];

/** Loose match: every typed word appears somewhere in the name ("card surg" finds "Cardiothoracic Surgery"). */
export function matches(name: string, q: string) {
  const n = name.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => n.includes(w));
}
