export type Profile = 'adult_art' | 'eid' | 'clinical';

export const ADULT_ALIASES: Record<string, string[]> = {
  patient_id: ['Patient ID', 'Unique ID', 'UID', 'Hospital Number', 'Hosp No', 'Hosp Number', 'File Number', 'Folder Number', 'PEPID', 'PEP ID', 'Client ID', 'ART Number', 'Patient Code'],
  sex: ['Sex', 'Gender', 'Client Sex', 'Patient Sex'],
  age: ['Age', 'Current Age', 'Age at Visit', 'Age Years', 'Age (Years)'],
  date_of_birth: ['Date of Birth', 'DOB', 'Birth Date', 'Birthdate', 'Date Of Birth (DOB)'],
  facility: ['Facility', 'Facility Name', 'Health Facility', 'Site', 'Site Name', 'orgunit', 'Org Unit', 'Organisation Unit', 'Health Facility Name'],
  datim_code: ['DATIM Code', 'Datim ID', 'Facility Code', 'orgUnitId', 'Org Unit Id', 'Site Code', 'MFL Code'],
  state: ['State', 'State Name', 'Province'],
  lga: ['LGA', 'Local Government Area', 'LGA Name', 'District'],
  date_confirmed_positive: ['Date Confirmed Positive', 'HIV Confirmation Date', 'Date of HIV Diagnosis', 'Confirmation Date', 'Date Confirmed HIV Positive'],
  art_start_date: ['ART Start Date', 'Date Started ART', 'ART Commencement Date', 'Date of ART Initiation', 'ART Initiation Date', 'Date ART Started'],
  current_regimen: ['Regimen', 'Current ART Regimen', 'ARV Regimen', 'Drug Regimen', 'Current Regimen', 'Regimen Code', 'ART Regimen'],
  regimen_line: ['Regimen Line', 'ART Line', 'Line of Regimen', 'Treatment Line', 'Line'],
  visit_date: ['Visit Date', 'Encounter Date', 'Pickup Date', 'Last Pickup Date', 'Date of Visit', 'Last Visit Date', 'Date of Encounter', 'Last Drug Pickup Date'],
  next_pickup_date: ['Next Pickup Date', 'Next Drug Pickup', 'Date of Next Refill', 'Next Clinic Date', 'Next Appointment', 'Next Appointment Date', 'Next Refill Date', 'Date of Next Appointment'],
  months_dispensed: ['Months of ARV Dispensed', 'MMD', 'Duration of Refill', 'Refill Period', 'Months Dispensed', 'Months of ARV Refill', 'Quantity Months'],
  viral_load_result: ['Viral Load', 'VL Result', 'Current VL', 'VL copies', 'Last VL Result', 'Viral Load Result', 'Current Viral Load', 'VL'],
  viral_load_date: ['VL Date', 'Date of VL Sample', 'Last VL Date', 'Date VL Result', 'Viral Load Date', 'Date of Viral Load', 'Date Sample Collected VL'],
  who_stage: ['WHO Stage', 'WHO Clinical Stage', 'Clinical Stage', 'WHO Staging'],
  baseline_cd4: ['Baseline CD4', 'CD4 Count', 'CD4', 'CD4 at Baseline', 'Baseline CD4 Count'],
  weight: ['Weight', 'Body Weight', 'Weight kg', 'Weight (kg)', 'Current Weight'],
  tb_screen_result: ['TB Screen', 'TB Screening Result', 'TB Status', 'TB Screen Outcome', 'TB Screening', 'TB Screen Result'],
  pregnancy_status: ['Pregnancy Status', 'Pregnant', 'ANC Status', 'Pregnancy', 'Is Pregnant', 'Currently Pregnant'],
  current_status: ['Status', 'Patient Outcome', 'Current Status', 'Treatment Status', 'Outcome', 'ART Status', 'Client Status'],
};

export const EID_ALIASES: Record<string, string[]> = {
  patient_id: ['Patient ID', 'Hospital Number', 'Hosp No', 'Infant ID', 'Baby ID', 'Unique ID', 'Client ID'],
  sex: ['Sex', 'Gender', 'Infant Sex', 'Baby Sex', 'Sex of Infant'],
  infant_dob: ['Date of Birth', 'DOB', 'Infant DOB', 'Baby Date of Birth', 'Birth Date', 'Date of Birth of Infant'],
  age_months: ['Age (Months)', 'Age in Months', 'Infant Age Months', 'Age Months', 'Age at Test (Months)', 'Infant Age'],
  sending_facility: ['Sample sent from', 'Sending Facility', 'Facility', 'Facility Name', 'Referring Facility', 'Site', 'Health Facility'],
  sample_reference_number: ['Sample Reference Number', 'Sample Ref', 'NRL Number', 'Lab Number', 'Sample ID', 'Specimen ID', 'Sample Reference'],
  date_specimen_drawn: ['Date Specimen Drawn', 'Sample Collection Date', 'Date Sample Taken', 'Date of Collection', 'Collection Date', 'Date Sample Collected', 'DBS Collection Date'],
  date_specimen_received_lab: ['Date Specimen Received', 'Date Received by Lab', 'Lab Receipt Date', 'Date Sample Received', 'Date Received at Lab', 'Received Date'],
  date_assay_performed: ['Date Assay Performed', 'Assay Date', 'Date Tested', 'Date of Analysis', 'Testing Date', 'Date of Assay', 'Date Analysed'],
  date_result_sent_back: ['Date Result Sent Back', 'Date Result Dispatched', 'Result Return Date', 'Date Result Released', 'Date Result Returned', 'Date Result Sent'],
  sample_testable: ['Was Sample Testable', 'Testable', 'Sample Valid', 'Sample Testable', 'Is Sample Testable', 'Sample Condition'],
  reason_for_pcr: ['Reason for PCR', 'PCR Reason', 'Test Reason', 'Reason for Test', 'Indication'],
  test_result: ['Test Result', 'PCR Result', 'EID Result', 'DNA PCR Result', 'Result', 'HIV PCR Result', 'Final Result'],
  mother_art_status: ['ART administered to Mother during pregnancy', 'Mother ART Status', 'Maternal ART', 'Mother on ART', 'Maternal ART Status', 'Mothers ART Status'],
  infant_prophylaxis: ['Baby received', 'Infant Prophylaxis', 'ARV Prophylaxis', 'NVP given', 'Baby received ARV Prophylaxis', 'Infant ARV Prophylaxis'],
  ever_breastfed: ['Was baby ever breastfed', 'Ever Breastfed', 'Baby Ever Breastfed', 'Breastfed Ever'],
  currently_breastfeeding: ['Is baby breastfeeding now', 'Currently Breastfeeding', 'Baby Breastfeeding Now', 'Still Breastfeeding'],
  cotrimoxazole_given: ['Cotrimoxazole given to baby', 'CTX', 'Cotrimoxazole', 'Cotrimoxazole Given', 'CTX Given', 'Septrin Given'],
  rapid_test_done: ['Rapid test done', 'Rapid Test', 'Rapid Test Done', 'Antibody Test Done', 'Confirmatory Rapid Test'],
};

export const CLINICAL_ALIASES: Record<string, string[]> = {
  chief_complaint: ['Chief Complaint', 'Presenting Complaint', 'CC', 'Reason for Visit', 'Complaint'],
  hpi: ['HPI', 'History of Presenting Illness', 'History of Present Illness', 'Presenting History'],
  pmh: ['PMH', 'Past Medical History', 'Medical History', 'Past History'],
  exam: ['Examination', 'Physical Examination', 'Exam', 'Clinical Findings', 'Examination Findings'],
  differential: ['Differential Diagnosis', 'Differentials', 'DDx', 'Working Diagnosis'],
  final_diagnosis: ['Final Diagnosis', 'Diagnosis', 'Primary Diagnosis', 'Confirmed Diagnosis'],
  icd10: ['ICD-10 Code', 'ICD10', 'ICD 10', 'ICD Code', 'Diagnosis Code'],
  investigations: ['Investigations', 'Tests Ordered', 'Laboratory Investigations', 'Workup'],
  medications: ['Medications', 'Drugs Prescribed', 'Prescription', 'Treatment Given'],
  treatment_plan: ['Treatment Plan', 'Management Plan', 'Plan', 'Management'],
  soap_note: ['SOAP Note', 'SOAP', 'Structured Note'],
};

export const ALIASES: Record<string, string[]> = (() => {
  const merged: Record<string, string[]> = {};
  for (const [field, list] of Object.entries(ADULT_ALIASES)) merged[field] = [...list];
  for (const [field, list] of Object.entries(EID_ALIASES)) {
    merged[field] = merged[field] ? Array.from(new Set([...merged[field], ...list])) : [...list];
  }
  return merged;
})();

export const PROFILE_ALIASES: Record<Profile, Record<string, string[]>> = {
  adult_art: ADULT_ALIASES,
  eid: EID_ALIASES,
  clinical: CLINICAL_ALIASES,
};

export const EID_SIGNAL_FIELDS = ['date_specimen_drawn', 'test_result', 'age_months'];

export const FIELD_LABELS: Record<string, string> = {
  patient_id: 'Patient ID',
  sex: 'Sex',
  age: 'Age (years)',
  date_of_birth: 'Date of birth',
  facility: 'Facility',
  datim_code: 'DATIM code',
  state: 'State',
  lga: 'LGA',
  date_confirmed_positive: 'Date confirmed positive',
  art_start_date: 'ART start date',
  current_regimen: 'Current regimen',
  regimen_line: 'Regimen line',
  visit_date: 'Visit date',
  next_pickup_date: 'Next pickup date',
  months_dispensed: 'Months dispensed',
  viral_load_result: 'Viral load result',
  viral_load_date: 'Viral load date',
  who_stage: 'WHO stage',
  baseline_cd4: 'Baseline CD4',
  weight: 'Weight',
  tb_screen_result: 'TB screen result',
  pregnancy_status: 'Pregnancy status',
  current_status: 'Current status',
  infant_dob: 'Infant date of birth',
  age_months: 'Age (months)',
  sending_facility: 'Sending facility',
  sample_reference_number: 'Sample reference number',
  date_specimen_drawn: 'Date specimen drawn',
  date_specimen_received_lab: 'Date received at lab',
  date_assay_performed: 'Date assay performed',
  date_result_sent_back: 'Date result sent back',
  sample_testable: 'Sample testable',
  reason_for_pcr: 'Reason for PCR',
  test_result: 'Test result',
  mother_art_status: 'Mother ART status',
  infant_prophylaxis: 'Infant prophylaxis',
  ever_breastfed: 'Ever breastfed',
  currently_breastfeeding: 'Currently breastfeeding',
  cotrimoxazole_given: 'Cotrimoxazole given',
  rapid_test_done: 'Rapid test done',
  chief_complaint: 'Chief complaint',
  hpi: 'History of presenting illness',
  pmh: 'Past medical history',
  exam: 'Examination',
  differential: 'Differential diagnosis',
  final_diagnosis: 'Final diagnosis',
  icd10: 'ICD-10 code',
  investigations: 'Investigations',
  medications: 'Medications',
  treatment_plan: 'Treatment plan',
  soap_note: 'SOAP note',
};

export function normaliseHeader(h: string): string {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function headerTokens(h: string): string[] {
  return String(h)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
