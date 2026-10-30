# Rencana Teknis — Talent Pool & Recruitment (Phase 1)

Status: **Disetujui 2026-10-30 — pengerjaan tahap 1 dimulai.**
Acuan: [talentpool.md](../talentpool.md) (PRD + Decision Log, semua keputusan 0–7 sudah disepakati per 2026-10-30).

---

## 1. Prinsip desain

1. **Tidak membuat ulang modul rekrutmen.** Model `Candidate` yang ada (`apps/recruitment`) sudah berperan sebagai *lamaran* (punya job, CV, status, riwayat status, catatan, dan dipakai oleh Onboarding). Model ini **dipertahankan sebagai Application Record**.
2. **Tambah satu model baru: `CandidateProfile`** = orangnya (satu orang = satu profil). Setiap `Candidate` (lamaran) menunjuk ke satu profil.
3. Tabel database tetap bernama `Candidate` supaya FK di Onboarding, file CV di storage, dan riwayat status tidak perlu dipindah. Di UI, `Candidate` ditampilkan sebagai **"Lamaran"**, dan `CandidateProfile` ditampilkan sebagai **"Kandidat"**.
4. Semua perubahan bersifat **additive + data migration**. Tidak ada data lama yang dihapus.

```
CandidateProfile (orang)          1 ──< N   Candidate (lamaran / application record)
  ├─ data diri, preferensi, CV terbaru,          ├─ job (nullable = Open Application)
  │  portfolio, kompensasi, consent              ├─ track: INHOUSE / FREELANCE / UNDECIDED
  ├─ link → personnel.Freelancer (opsional)      ├─ status (PRD) + inactive_reason
  └─ link → personnel.Employee  (opsional)       ├─ screening result + notes
                                                 ├─ Interview (1 ──< N)
                                                 ├─ CandidateStatusHistory (sudah ada)
                                                 └─ Onboarding (sudah ada, OneToOne)
```

---

## 2. Perubahan backend (`apps/recruitment`)

### 2.1 Model baru `CandidateProfile`

| Field | Tipe | Catatan |
| :-- | :-- | :-- |
| `code` | Char, unique | `TP-000123`, dibuat otomatis (Candidate ID di PRD §5.2) |
| `full_name`, `email`, `phone` | Char / Email | email & phone di-index untuk deteksi duplikat |
| `city` | Char | Current City of Residence |
| `linkedin_url`, `portfolio_url` | URL, opsional | |
| `employment_types` | JSON list | multi: FULL_TIME / CONTRACT / FREELANCE / INTERNSHIP / OPEN |
| `preferred_location` + `preferred_location_other` | Choice + Char | Yogyakarta / Jakarta / Other / Flexible |
| `employment_status` + `employment_status_other` | Choice + Char | Employed / Freelance / Open to Work / Student / Fresh Graduate / Other |
| `availability` | Choice | 5 pilihan sesuai Decision #3 |
| `expected_monthly_salary`, `expected_project_fee` | Decimal, nullable | **opsional** (Decision #2); disembunyikan dari role non-HR |
| `cv_name`, `cv_path`, `cv_content_type` | Char | CV terbaru; lamaran tetap menyimpan CV versinya sendiri |
| `source_reported` + `source_other` | Choice + Char | jawaban kandidat (LinkedIn, JobStreet, Threads, …) |
| `consent_at`, `consent_version`, `consent_withdrawn_at` | DateTime / Char | PRD §5.1F, §5.13 |
| `possible_duplicate_of` | FK self, nullable | diisi saat kecocokan hanya lewat nomor telepon |
| `freelancer` | FK `personnel.Freelancer`, nullable | diisi saat diterima sebagai freelance |
| `employee` | FK `personnel.Employee`, nullable | diisi saat onboarding selesai |
| `created_at`, `updated_at` | | Registration date / Last updated |

### 2.2 Perubahan model `Candidate` (lamaran)

| Perubahan | Alasan |
| :-- | :-- |
| `profile` FK → `CandidateProfile` | inti relasi 1 orang : N lamaran |
| `job` menjadi **nullable** (`SET_NULL`) | Open Application / Talent Pool tidak terikat lowongan |
| `track`: INHOUSE / FREELANCE / UNDECIDED | HR menentukan arah (Decision #0); default diambil dari `job.recruitment_type`, Open Application = UNDECIDED |
| `employment_type` | jenis pekerjaan untuk lamaran ini |
| `STATUS_CHOICES` diganti ke status PRD | NEW, SCREENED, CONTACTED, HR_INTERVIEW, USER_INTERVIEW, HIRED, INACTIVE |
| `inactive_reason` + `inactive_note` | Not Qualified / Candidate Withdrew / Unresponsive / No Longer Available / Position Closed / Other |
| `screening_result` (QUALIFIED / NOT_QUALIFIED) + `screening_notes` | notes **wajib** saat result diisi |
| `source` diperluas | sumber internal dari tautan per channel (`?ref=linkedin`) — terpisah dari `source_reported` |

**Aturan transisi (menggantikan `TRANSITIONS` lama):** status boleh maju ke tahap mana pun setelahnya (tahap boleh dilewati, PRD §6.2). `INACTIVE` bisa dipilih dari status mana pun asalkan ada alasan. HR bisa mengaktifkan kembali lamaran yang `INACTIVE` ke status sebelumnya. Setiap perubahan tetap dicatat di `CandidateStatusHistory`.

### 2.3 Model baru `Interview`

`application` (FK Candidate), `stage` (HR / USER / SKILL_TEST), `scheduled_at`, `interviewer` (FK User, nullable) + `interviewer_name` (teks bebas untuk user eksternal), `result` (PENDING / PASSED / NOT_PASSED), `notes`, `created_by`, timestamps.
Skill Test (PRD §5.4) dicatat sebagai Interview dengan `stage=SKILL_TEST`, **bukan** status tersendiri, supaya daftar status tetap sesuai PRD §5.5.

### 2.4 Endpoint API

| Endpoint | Akses | Fungsi |
| :-- | :-- | :-- |
| `GET /api/recruitment/public/apply-options/` | publik | dropdown posisi: lowongan OPEN + "Open Application / Talent Pool", plus skill untuk lowongan freelance |
| `POST /api/recruitment/public/apply/` | publik | **satu form** untuk in-house & freelance; validasi CV (PDF/DOC/DOCX, ≤ 5 MB), consent wajib, rate-limit & anti-duplikat 24 jam (dipakai ulang dari `antispam.py`) |
| `GET/PATCH /api/recruitment/talent-pool/` (+ `/{id}/`) | HR | daftar & detail profil, search/filter PRD §5.7, termasuk daftar lamaran |
| `POST /talent-pool/{id}/merge/` | HR | gabungkan profil duplikat (lamaran dipindah ke profil tujuan) |
| `POST /talent-pool/{id}/applications/` | HR | buat lamaran baru untuk profil yang sudah ada (mempertimbangkan kandidat ke posisi lain) |
| `POST /talent-pool/{id}/anonymize/` | HR Lead / Admin | penarikan consent / permintaan hapus: hapus PII + CV, lamaran tetap tersimpan untuk statistik |
| `/api/recruitment/candidates/…` (sudah ada) | HR | tetap ada sebagai endpoint lamaran; `transition` memakai status baru; tambah `screening` dan `interviews` |
| `GET /api/recruitment/dashboard/talent-pool/` | HR | PRD §5.8; hitungan **profil unik** dipisah dari **jumlah lamaran** |
| `GET /api/recruitment/dashboard/pipeline/` | HR | PRD §5.9 |

Endpoint publik lama (`POST /candidates/` dari `/jobs/[slug]`) dialihkan ke logika yang sama agar link lowongan yang sudah tersebar tetap berfungsi.

### 2.5 Deteksi duplikat (PRD §5.2)

* **Email sama (case-insensitive)** → lamaran baru otomatis ditempel ke profil yang ada. Data preferensi profil diperbarui dengan isian terbaru, dan CV terbaru menggantikan CV di profil.
* **Hanya nomor telepon yang sama** → profil baru dibuat dengan tanda `possible_duplicate_of`. HR memutuskan *merge* atau *bukan duplikat*.
* Nomor telepon dinormalisasi (`08…` / `+628…` / `628…` → `628…`) sebelum dibandingkan.

### 2.6 Integrasi yang sudah ada

* **Onboarding**: syarat `status == 'OFFER_ACCEPTED'` diganti menjadi `status == 'HIRED' and track == 'INHOUSE'`. Setelah Employee dibuat, `profile.employee` diisi.
* **Freelancer** (`talent_pool.accept_candidate_to_talent_pool`): logika dedup dan pemetaan skill tetap dipakai. Status menjadi `HIRED`, `track` menjadi FREELANCE, dan `profile.freelancer` diisi. Fungsi ini diganti nama menjadi `accept_candidate_as_freelancer`.
* **Project Assignment** (PRD §5.11) masuk Phase 2. `freelance.EventAssignment` yang ada nantinya diperluas dengan start/end date + status Active/Inactive; Phase 1 tidak menyentuhnya.

### 2.7 Akses data (PRD §4, §5.13)

* Phase 1: hanya role HR (`IsRecruitmentAdmin`: ADMIN / HR_STAFF / HR_LEAD) yang membuka Talent Pool.
* Kompensasi, screening notes, dan interview notes **tidak dikirim** di serializer untuk role lain. Ini disiapkan untuk saat akses Hiring Manager dibuka.
* Anonymize hanya untuk HR_LEAD / ADMIN dan tercatat di audit log (`log_event`).

---

## 3. Migrasi data (Decision #7)

Urutan migration di `apps/recruitment/migrations`:

1. **Schema**: tambah `CandidateProfile`, `Interview`, dan field baru di `Candidate` (`profile` masih nullable, `job` nullable).
2. **Data**:
   * kelompokkan `Candidate` lama per email (lower-case) → satu `CandidateProfile` per email (fallback ke telepon bila email kosong);
   * salin nama/telepon/CV terbaru ke profil; `consent_at` = kosong dengan `consent_version='legacy'` (consent lama tidak terekam);
   * (tahap 2) petakan status sesuai tabel Decision #7 (Rejected → INACTIVE/Not Qualified, Withdrawn → INACTIVE/Candidate Withdrew, dst.);
   * `track` diambil dari `job.recruitment_type`;
   * hubungkan `profile.freelancer` lewat pencocokan email/telepon yang sama dengan `talent_pool._find_existing_freelancer`, dan `profile.employee` lewat Onboarding yang sudah selesai.
   * `CandidateStatusHistory` **tidak diubah**. UI menampilkan label lama (mis. "Interview GM") apa adanya agar riwayat tetap jujur.
3. **Schema**: `profile` menjadi wajib (non-null).

Migration data bisa di-*reverse*: profil dibuat dari data lamaran (tidak ada data lama yang diubah di tahap 1), dan pada tahap 2 status lama disimpan di kolom `legacy_status` sebelum dipetakan.

---

## 4. Perubahan frontend

| Area | Perubahan |
| :-- | :-- |
| **Nav** (`config/nav-config.ts`) | "Freelance / Talent Pool" → **"Freelancer"** (Decision #6); menu baru **"Talent Pool"** di grup Recruitment |
| **Form publik** | satu form 5 section sesuai contoh form di `talentpool.md`: `/apply` (Open Application) dan `/jobs/[slug]` (posisi sudah terisi). Field kompensasi muncul sesuai Employment Type yang dipilih. Form freelance berbasis skill yang lama dipensiunkan. |
| **Talent Pool – daftar** | tabel profil + filter PRD §5.7, badge "Kemungkinan duplikat" |
| **Talent Pool – detail** | tab Profil · Lamaran · Riwayat; aksi Merge, Buat lamaran baru, Anonymize |
| **Lamaran (candidates)** | halaman yang ada dipakai ulang: status baru, form screening (notes wajib), daftar & form interview, pilihan alasan Inactive, tombol "Terima sebagai Freelancer" / "Buat Onboarding" sesuai `track` |
| **Dashboard** | dua kartu/halaman: Talent Pool (§5.8) dan Pipeline (§5.9) di halaman Recruitment |
| `candidate-pipeline.ts`, `onboarding-page.tsx` | label & warna status baru + label status lama untuk riwayat |

---

## 5. Urutan pengerjaan (Phase 1)

Setiap langkah bisa di-deploy sendiri, dengan test + `manage.py check` + `tsc` + `next build`.

1. **Model + migrasi data + test migrasi** (backend saja): `CandidateProfile`, `Interview`, field baru di `Candidate`, pengelompokan lamaran lama menjadi profil. Status lama **belum diubah**, sehingga UI dan Onboarding yang ada tetap berjalan.
2. **Status & transisi baru (+ pemetaan status lama), screening, interview, alasan Inactive** + penyesuaian Onboarding dan accept-freelancer + update UI lamaran.
3. **Form publik terpadu** (`/apply`, `/jobs/[slug]`) + deteksi duplikat + consent.
4. **Halaman Talent Pool** (daftar, detail, merge, anonymize) + rename menu.
5. **Dashboard Talent Pool & Pipeline.**

Phase 2 (Project Assignment, start/end/status assignment, sinkronisasi Employee penuh) dibahas terpisah setelah Phase 1 berjalan.

---

## 6. Keputusan tambahan (2026-10-30)

1. **Akses Phase 1 hanya HR** (ADMIN / HR_STAFF / HR_LEAD). Hiring Manager / Project Manager belum diberi akses; GM tetap read-only untuk menu Freelancer seperti sekarang.
2. **Email sama → otomatis digabung** ke profil yang ada. Kecocokan yang hanya lewat nomor telepon ditandai `possible_duplicate_of` untuk dicek HR.
3. **Retensi**: profil tanpa aktivitas **24 bulan** muncul di daftar "Perlu ditinjau". Tidak ada penghapusan otomatis.
4. **Teks consent**: draf disiapkan developer berdasarkan PRD §5.1F, lalu ditinjau HR/legal sebelum form publik dirilis.
