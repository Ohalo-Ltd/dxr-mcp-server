# Sample Documents - Test Case Mapping

This directory contains sample files for the DXR MCP Server benchmark framework. Each file is mapped to one or more benchmark test cases.

## Source

Files were copied from: `/Users/kyledupont/Library/CloudStorage/GoogleDrive-kyle@ohalo.co/Shared drives/Product DXR/Demos/`

**Important**: These are copies - original files were NOT moved.

---

## Directory Structure

```
sample-documents/
├── compliance/
│   ├── hipaa/        # HIPAA/PHI test data (compliance-001)
│   ├── gdpr/         # GDPR/PII test data (compliance-002)
│   ├── itar/         # ITAR export control (compliance-003)
│   ├── pci/          # PCI credit card data (compliance-004)
│   └── ccpa/         # Consumer data (NOTE: No CCPA task - missing CA-specific data)
├── search/
│   ├── contracts/    # Contract documents (search-001)
│   ├── invoices/     # Invoice documents (search-002)
│   └── general/      # Mixed documents (search-003 to search-007)
└── governance/       # DLP, classification, ownership (governance-001 to 005)
```

---

## Compliance Tasks

### compliance-001: HIPAA Document Discovery

**Directory**: `compliance/hipaa/`

| File | Source Folder | Contains |
|------|---------------|----------|
| PMR_SmithJ_2023_Final_v3_AB1234_XYZ.txt | Healthcare/Patient Medical Records | Patient names, diagnoses, treatment plans |
| Smith_J_DiabetesMgt_PMR_Final_V3_092023_XYZ123.txt | Healthcare/Patient Medical Records | Diabetes management records, PHI |
| Smith_JD_PatientMedRec_v3.2_FINAL_2023-10-15_AB123_XYZ_DR04.txt | Healthcare/Patient Medical Records | Complete patient medical record |
| RadRpt_Final_JSmith_2023_10_25_V1_ABC123_XYZ.txt | Healthcare/Radiology Reports | X-ray/MRI results with patient info |
| Rpt_2023_FNL_DR_Smith_MRI_Chest_0A1B2C3D.txt | Healthcare/Radiology Reports | MRI chest scan report |
| MAR_Final_JD_Smith_20231015_Rev3_AB1234_XY.txt | Healthcare/MAR | Medication administration with dosages |
| MAR_2023_Fnl_JSmith_AdmRcrds_abc123_XYZ789.txt | Healthcare/MAR | Patient medication history |
| SurgProcNote_Final_v3.2_JDoe_20230815_Op12345_ABCtxt_A1B2C3.txt | Healthcare/Surgical Procedure Notes | Surgical notes with patient details |
| DrSmith_SurgProc_Notes_v3.2_FINAL_2023_07_12_ABD-HR78-XY88.txt | Healthcare/Surgical Procedure Notes | Operative report |
| ClaimForm_Final_AB1234_JDoe_Insurance2023_Q2.txt | Healthcare/Insurance Claim Forms | Insurance claim with health info |
| ClaimForm_Final_DG2023_abc123_XYZ_JohnDoe_InsuranceA11.txt | Healthcare/Insurance Claim Forms | Health insurance claim data |

**Expected DXR Annotations**: PHI, HIPAA, Patient Name, Diagnosis Code, Medical Record Number

---

### compliance-002: GDPR PII Identification

**Directory**: `compliance/gdpr/`

| File | Source Folder | Contains |
|------|---------------|----------|
| EmpPerfRev_Final_JD34_2023_Q3_AE2389_XYZ.txt | HR/Employee Performance Reviews | Employee performance data (EU) |
| EmpPerfRev_JohnDoe_Final_V2_2023_Q3_7634AB.txt | HR/Employee Performance Reviews | Personal employment evaluation |
| Payroll_Sum_2023_final_ABC123_JD_Smith_Q4.txt | HR/Payroll Summaries | Salary, bank details |
| PS_2023_Fnl_Summary_JDoe_84521_XYZ.txt | HR/Payroll Summaries | Employee compensation data |
| WD_Report_FINAL_2023_ABG_JohnD_XYZ_7431_A1B2C3.txt | HR/Workforce Demographics Reports | Demographic data (age, gender, ethnicity) |
| WFDemoRpt_Final_v3.21_JD_Smith_2023_10_07_AB-RT1256.txt | HR/Workforce Demographics Reports | Workforce composition data |
| personal_data.xlsx | demo_files/Data/CSV | Personal identifiers spreadsheet |
| emails.xlsx | demo_files/Data/CSV | Email addresses |
| Employment status.docx | demo_files/Documents | Employment records |

**Expected DXR Annotations**: PII, EU Personal Data, Name, Email, Address, Date of Birth

---

### compliance-003: ITAR Controlled Content

**Directory**: `compliance/itar/`

| File | Source Folder | Contains |
|------|---------------|----------|
| ITAR_Sample_1.pdf | Military/ITAR_Sample_Documents | Export-controlled technical data |
| ITAR_Sample_2.pdf | Military/ITAR_Sample_Documents | Defense article specifications |
| ITAR_Sample_3.pdf | Military/ITAR_Sample_Documents | Military technology documentation |
| ITAR_Lookalike_1.pdf | Military/ITAR_Lookalike_Documents | Non-ITAR similar content (negative test) |
| ITAR_Lookalike_2.pdf | Military/ITAR_Lookalike_Documents | Non-ITAR similar content (negative test) |
| Submarine schematic.docx | demo_files/Confidential Folder | Naval defense specifications |
| Missile launch systems.docx | demo_files/Confidential Folder | Weapons system documentation |
| Schematic Overview - Model AE-2100 Jet Engine.docx | demo_files/Confidential Folder | Aircraft engine technical data |
| Handling hazardous explosives.docx | demo_files/Confidential Folder | Munitions handling procedures |

**Expected DXR Annotations**: ITAR, Export Controlled, Defense Article, USML Category

**Note**: ITAR_Lookalike files are intentionally similar but should NOT be classified as ITAR-controlled. This tests precision.

---

### compliance-004: PCI Credit Card Files

**Directory**: `compliance/pci/`

| File | Source Folder | Contains |
|------|---------------|----------|
| credit-card-numbers_extradata.csv | demo_files/Data | Credit card numbers with metadata |
| CardBase.csv | demo_files | Payment card database |
| credit card screenshot.png | demo_files | Image of credit card (OCR test) |

**Expected DXR Annotations**: PCI-DSS, Credit Card Number, PAN, CVV

---

### ~~compliance-005: CCPA Consumer Data~~ (REMOVED)

**Status**: Task removed - no California-specific data available

**Directory**: `compliance/ccpa/` (files retained for potential future use)

| File | Source Folder | Contains |
|------|---------------|----------|
| SSN-test-data.xlsx | demo_files/Confidential Folder | Social Security Numbers |
| Texas-Driver-License-front.png | demo_files/Documents/IDs | Texas driver's license (NOT California) |
| iceland_passport.jpg | demo_files | Foreign passport image |
| Taiwan passport.jpg | demo_files | Foreign passport image |
| Bank-Statement.jpg | demo_files/Confidential Folder | Bank account information |
| pay stub.jpg | demo_files/Confidential Folder | Payroll information image |

**Note**: CCPA task requires California-specific consumer data (CA driver licenses, CA resident records).
Current files lack California-specific identifiers. To re-enable this task:
- Add California driver license sample
- Add documents with California resident data

---

## Search Tasks

### search-001: Find Contracts by Date

**Directory**: `search/contracts/`

| File | Source Folder | Use Case |
|------|---------------|----------|
| Sample evaluation agreement.docx | demo_files/Documents/Contract | Contract with execution date |
| Loan_Agreement_1.docx | demo_files | Loan contract with dates |
| loan.pdf | custom_demo_docs | Loan documentation |
| interest-free-loan-agreement.pdf | custom_demo_docs | Specific contract type |

---

### search-002: Invoice Discovery

**Directory**: `search/invoices/`

| File | Source Folder | Use Case |
|------|---------------|----------|
| Invoice_1.pdf through Invoice_4.pdf | demo_files/Documents/Invoices | Standard invoices |
| CD-invoice-1.pdf | demo_files/Documents/Invoices | CD/product invoice |
| james-gibb-sample-invoice.pdf | demo_files/Documents/Invoices | Named invoice |
| wordpress-pdf-invoice-plugin-sample.pdf | demo_files/Documents/Invoices | Plugin-generated invoice |

---

### search-003 to search-007: General Search Tasks

**Directory**: `search/general/`

| File | Use For |
|------|---------|
| defining-issues-18-2-sec-cybersecurity.pdf | Large PDF search (search-003) |
| CR_Assess_Final_2023_JD83_DB_v5.2_AZXY.txt | Author search, recent files |
| DS_Final_JDoe_2023v3_ABC123_Rpt.txt | Cross-folder search |
| CBA_Final_Analysis_v3.2_2023_JSmith_4790_ABC123.txt | Specific author (JSmith) |
| detailed_sales_note_*.txt | File type distribution |
| Amortization-Schedule-Template.xlsx | File type distribution (xlsx) |
| Data Dictionary of Contoso BI demo dataset for Retail Industry.xlsx | File type distribution |

---

## Governance Tasks

**Directory**: `governance/`

| File | Use For |
|------|---------|
| 2011_audited_financial_statement_msword.doc.docx | DLP label compliance (governance-002) |
| CAHRC_HR_Manual.docx | Classification coverage (governance-003) |
| Academic CV template.pdf | Ownership verification (governance-004) |
| Targeted CV template.docx | Ownership verification |
| College CV template.docx | Ownership verification |
| MLA style report.docx | External sharing check (governance-005) |
| sample_redaction_text.txt | Access control audit (governance-001) |

---

## Live Mode Setup Checklist

Before running benchmarks in live mode:

- [ ] Upload sample documents to Google Drive
- [ ] Index the Google Drive folder in DXR
- [ ] Apply DXR classifications to documents
- [ ] Verify annotators are detecting sensitive data
- [ ] Update task YAML files with actual file IDs from DXR
- [ ] Test access controls are properly configured

---

## File Count Summary

| Category | Count | Active Task |
|----------|-------|-------------|
| HIPAA | 11 | compliance-001 |
| GDPR | 9 | compliance-002 |
| ITAR | 9 | compliance-003 |
| PCI | 3 | compliance-004 |
| CCPA | 6 | ~~compliance-005~~ (removed) |
| Contracts | 4 | search-001, search-004 |
| Invoices | 7 | search-002 |
| General | 8 | search-003 to search-007 |
| Governance | 7 | governance-001 to governance-005 |
| **Total** | **64** | **16 tasks** |

**Note**: 4 compliance tasks active (CCPA task removed due to missing CA-specific data)
