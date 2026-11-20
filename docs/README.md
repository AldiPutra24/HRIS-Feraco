# Dokumentasi HRIS FERACO

Dokumen dikelompokkan per modul. File bertanda *(lokal)* masuk `.gitignore`: hanya ada di laptop pengembang, tidak ikut ke repository.

## Deploy

| File | Isi |
| :-- | :-- |
| [deploy/production.md](deploy/production.md) *(lokal)* | Docker Compose, environment produksi, backup dan restore database |
| [deploy/vps.md](deploy/vps.md) *(lokal)* | Spesifikasi dan setup VPS |

## Requirement

| File | Isi |
| :-- | :-- |
| [requirements/Requirement_Release_HRIS_Feraco.pdf](requirements/Requirement_Release_HRIS_Feraco.pdf) *(lokal)* | Requirement rilis HRIS |

## Payroll

| File | Isi |
| :-- | :-- |
| [payroll/PRD_Modul_Payroll_Karyawan_Inhouse.md](payroll/PRD_Modul_Payroll_Karyawan_Inhouse.md) | PRD modul payroll karyawan inhouse |
| [payroll/payroll.md](payroll/payroll.md) | Dokumentasi teknis modul payroll (komponen, struktur gaji, TER PPh 21, true-up) |
| [payroll/payroll-import-technical-plan.md](payroll/payroll-import-technical-plan.md) | Rencana teknis impor payroll dari Excel |
| [payroll/payroll-flowchart.md](payroll/payroll-flowchart.md) *(lokal)* | Flowchart proses payroll |

## Reimbursement

| File | Isi |
| :-- | :-- |
| [reimbursement/flowchart-reimbursement-end-to-end.png](reimbursement/flowchart-reimbursement-end-to-end.png) | Flowchart reimbursement dari pengajuan sampai rekap Finance |
| [reimbursement/flowchart-reimbursement-finance.png](reimbursement/flowchart-reimbursement-finance.png) | Flowchart ringkas rekap Finance |
| [reimbursement/reimbursement-finance-recap-plan.md](reimbursement/reimbursement-finance-recap-plan.md) | Keputusan dan implementasi rekap reimbursement oleh Finance |

## Recruitment

| File | Isi |
| :-- | :-- |
| [recruitment/talent-pool-technical-plan.md](recruitment/talent-pool-technical-plan.md) | Rencana teknis talent pool |
| [recruitment/talent-pool-flowchart.md](recruitment/talent-pool-flowchart.md) *(lokal)* | Flowchart talent pool (beserta `.png` dan `.svg`) |

## Personnel

| File | Isi |
| :-- | :-- |
| [personnel/perubahan-data-karyawan.png](personnel/perubahan-data-karyawan.png) | Alur perubahan data karyawan |

## Notifikasi

| File | Isi |
| :-- | :-- |
| [notifications/Notification.md](notifications/Notification.md) | Sistem notifikasi in-app dan email: event, penerima, template, cron |

## API

[API/README.md](API/README.md) *(lokal)*: referensi endpoint per modul, dengan indeks lengkap di [API/endpoint-index.md](API/endpoint-index.md).
