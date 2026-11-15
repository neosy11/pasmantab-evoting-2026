# PASMANTAB e-VOTING 2026

Sistem Pemungutan Suara Elektronik Resmi **Paskibra MAN 4 Banjar (PASMANTAB)** untuk pemilihan Ketua Paskibra yang menjunjung tinggi prinsip:
**ONE MEMBER. ONE VOTE. ONE RESPONSIBILITY.**

---

## Fitur Utama & Arsitektur Keamanan

1. **Verifikasi 3 Faktor Pemilih:**
   - Kombinasi **Nama Lengkap**, **Kelas**, dan **Token Bersama (atau QR Code TPS)**.
   - Normalisasi spasi dan huruf besar/kecil otomatis sehingga pemilih tidak terkendala salah kapitalisasi.
2. **Anonimitas Surat Suara Penuh (*Ballot Secrecy*):**
   - Pemisahan ketat antara identitas anggota (`voters`) dan kotak suara (`ballots`).
   - Tabel `ballots` hanya merekam `id`, `candidate_id`, `position`, dan `cast_bucket` (pembulatan interval 5 menit) tanpa menyimpan nama, kelas, token, maupun alamat IP.
3. **Transaksi Atomik & Anti *Race-Condition*:**
   - Menggunakan fungsi PostgreSQL `cast_ballot_atomic` dengan *advisory lock* per anggota sehingga 1 anggota hanya bisa mengirimkan tepat 1 suara meskipun menekan tombol berkali-kali atau dari dua perangkat bersamaan.
4. **Kotak Suara Permanen (*Immutable*):**
   - Dilindungi *database trigger* (`prevent_ballot_tampering` dan `prevent_audit_tampering`) sehingga suara maupun catatan audit tidak dapat diubah atau dihapus oleh siapa pun.
5. **Portal Panitia 10 Menu:**
   - Overview partisipasi, manajemen calon Ketua + upload foto, manajemen DPT + impor CSV, generator Token + QR Code siap cetak, kontrol jadwal & tahapan pemilihan, rekapitulasi suara, ekspor CSV & Berita Acara PDF, audit logs, dan pengaturan organisasi.

---

## Panduan Instalasi Dari Awal

1. **Siapkan Proyek Supabase:**
   - Buat proyek baru di [Supabase](https://supabase.com).
   - Buka **SQL Editor** dan jalankan seluruh skrip di folder `supabase/migrations/` secara berurutan dari `0001` hingga `0006`.
   - Buat *Storage Bucket* publik bernama `candidate-photos`.
2. **Daftarkan Akun Panitia Pertama:**
   - Buat user di **Authentication $\rightarrow$ Users** (centang *Auto Confirm User*).
   - Salin `User UID` ke tabel `public.admin_users` dengan role `SUPER_ADMIN` dan `is_active = true`.
3. **Hubungkan Frontend:**
   - Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` pada file `js/config.js`.
4. **Dokumentasi Lengkap:**
   - Panduan Deploy ke GitHub & Vercel: `docs/DEPLOYMENT_GUIDE.md`
   - Buku Panduan Panitia Hari-H: `docs/ADMIN_HANDBOOK.md`
   - Prosedur Pemulihan Insiden: `docs/INCIDENT_RECOVERY.md`
   - Checklist Pengujian Mutu: `docs/QA_CHECKLIST.md`