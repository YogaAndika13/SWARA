# Panduan Pemakaian SWARA untuk PML

Panduan ini untuk **Pengawas / Pemeriksa Lapangan (PML)** yang memakai SWARA
sehari-hari. Tidak perlu latar belakang teknis. Untuk pemasangan di komputer baru,
lihat [README.md](README.md).

**SWARA itu apa?** Sistem yang menanyakan langsung kepada responden lewat WhatsApp:
*"Apakah benar petugas kami berkunjung?"* Jawaban responden masuk otomatis ke
dashboard, sehingga kunjungan fiktif ketahuan pada hari yang sama — bukan berbulan
kemudian saat pemeriksaan dokumen.

---

## 1. Masuk ke Sistem

1. Buka alamat SWARA di peramban (Chrome/Edge). **Alamatnya berbeda tergantung
   Anda ada di mana** — tanyakan kepada Admin alamat mana yang berlaku:

   | Anda berada di | Alamat |
   |---|---|
   | Komputer server itu sendiri | `http://localhost:3000` |
   | Jaringan wifi kantor | `http://<IP-komputer-server>:3000`, mis. `http://10.0.0.50:3000` |
   | Di lapangan / paket data HP | `https://swara.<domain-kantor>` (lewat terowongan Cloudflare) |

2. Masukkan email dan password yang diberikan Admin.
3. Bila ini login pertama Anda dengan password bawaan, sistem akan **meminta Anda
   membuat password baru** (minimal 8 karakter) sebelum bisa melanjutkan.

> **Sesi Anda berlaku 8 jam.** Setelah itu Anda diminta login lagi. Itu normal,
> bukan tanda ada kerusakan.

### Lupa password

Sistem ini **tidak mengirim surel**. Prosedurnya:

1. Klik **Lupa password** di halaman login, lalu masukkan email Anda.
2. Halaman menjawab bahwa tautan reset telah dibuat. **Tautan itu tidak dikirim
   ke mana pun** — ia hanya tercatat di komputer server.
3. **Hubungi Admin** (telepon/WA). Admin membuka berkas `data\swara.log` di
   komputer server dan mencari baris terbaru yang berbunyi:

   ```
   [RESET PASSWORD] Link reset untuk nama.anda@bps.go.id (berlaku 1 jam):
   https://swara.<domain-kantor>/reset/<kode-panjang>
   ```

4. Admin menyampaikan tautan itu kepada Anda. Anda membukanya, lalu mengisi
   password baru (minimal 6 karakter).

> Tautan **berlaku 1 jam** dan sekali pakai. Bila kedaluwarsa, ulangi dari
> langkah 1. Jangan meneruskan tautan itu kepada siapa pun — siapa saja yang
> memegangnya dapat mengambil alih akun Anda.

### Pakta Integritas
Setelah masuk, muncul **Pakta Integritas Kerahasiaan Data**. Bacalah, lalu centang
dan setujui. **Data tidak akan tampil sebelum ini disetujui.** Ini bukan formalitas:
persetujuan Anda tercatat, dan seluruh aktivitas Anda terekam dalam jejak audit.

---

## 2. Mengenali Layar Dashboard

| Bagian | Isi |
|---|---|
| **Rail kiri (gelap)** | **Pemilih kegiatan/survei**, lalu perpindahan antar tampilan: Ringkasan, Data Responden, Jalur Hijau, Indikasi Fraud. Di bawahnya ada nama dan peran Anda. |
| **Topbar** | Tombol lipat rail, judul halaman, status gateway WhatsApp, dan menu profil Anda. |
| **Kartu statistik** | Terkirim, Valid, Indikasi Fraud, Response Rate, Belum Dikirim. |
| **Komposisi Respons** | Diagram donat sebaran status seluruh responden. |
| **Data Verifikasi Responden** | Tabel utama tempat Anda bekerja. |

### Status gateway WhatsApp (pojok kanan atas)
| Warna | Arti | Tindakan |
|---|---|---|
| 🟢 Hijau — *WA Gateway Aktif* | Siap mengirim | Lanjut bekerja |
| 🟠 Oranye — *Menunggu Koneksi WA* | Belum tertaut | Klik status itu, lalu pindai QR yang muncul |
| 🔴 Merah — *WA Terputus* | Sesi terputus | Klik status itu, pindai ulang QR |

**Selama status belum hijau, pesan tidak akan terkirim.**

---

## 3. Memilih Kegiatan yang Benar

Sebelum apa pun, pastikan **pemilih kegiatan di rail kiri** menunjuk survei yang
sedang Anda kerjakan. Seluruh angka, tabel, impor, dan ekspor mengikuti kegiatan yang dipilih.

Anda hanya melihat kegiatan tempat Anda didaftarkan. Bila kegiatan yang seharusnya
ada tidak muncul, mintalah Admin mendaftarkan Anda lewat menu **Kelola PML**.

> Anda juga hanya melihat **data Anda sendiri**. PML lain tidak melihat data Anda,
> dan Anda tidak melihat data mereka.

---

## 4. Memasukkan Data Responden

Tiga cara, pilih yang paling sesuai:

### a. Upload CSV (untuk data banyak)
1. Klik **Template** untuk mengunduh contoh berkas.
2. Isi memakai Excel. Kolom yang **wajib**: `nama_usaha`, `no_hp`, `nama_petugas`.
   Kolom `no_hp_petugas` sangat dianjurkan — tanpa itu, fitur teguran otomatis
   tidak dapat menghubungi petugas.
3. Simpan sebagai **CSV**, lalu klik **Upload CSV** dan pilih berkasnya.
4. Muncul pemberitahuan berapa baris masuk dan berapa dilewati.

### b. Tambah Manual (untuk satu-dua data)
Klik **Tambah Manual**, isi kolomnya, lalu **Simpan**.

### c. Sampel Acak (bila data terlalu banyak untuk diverifikasi semua)
Klik **Sampel Acak**, isi jumlah responden. Sistem memilih secara acak dari data
berstatus *Menunggu* dan langsung mencentangnya.

> **Mengapa sampel acak berguna:** petugas tidak tahu kunjungan mana yang akan
> diverifikasi, sehingga efek jeranya tetap bekerja walau tidak semua diperiksa.
> Untuk pemakaian harian, 10–20% dari kunjungan sudah memadai.

**Format nomor:** boleh `08123456789` maupun `628123456789`. Sistem menormalkannya.

---

## 5. Mengirim Pesan Verifikasi

| Tombol | Kegunaan |
|---|---|
| **Blast Semua** (oranye) | Mengirim ke **semua** responden berstatus *Menunggu*. |
| **Blast Terpilih** (biru) | Mengirim hanya ke baris yang dicentang. |

Isi pesannya sopan dan singkat, meminta responden membalas **1** bila petugas benar
berkunjung, atau **2** bila tidak.

> **Pengiriman sengaja dibuat lambat** — ada jeda 6–15 detik antar pesan supaya nomor
> gateway tidak diblokir WhatsApp. Untuk 50 responden, perkirakan sekitar 10 menit.
> **Biarkan berjalan, jangan menutup aplikasi.** Anda tetap bisa memakai dashboard.

Saran: mulai dari jumlah kecil (10–20 nomor) pada hari pertama.

---

## 6. Membaca Hasil

Dashboard memperbarui dirinya **setiap 5 detik** — tak perlu menyegarkan halaman.
Setiap balasan masuk juga memunculkan notifikasi di pojok kanan atas.

| Status | Arti | Tindakan |
|---|---|---|
| **Menunggu** | Belum dikirimi pesan | Lakukan blast |
| **Terkirim** | Sudah dikirim, belum dibalas | Tunggu |
| **Valid** | Responden membalas `1` — kunjungan benar | Selesai |
| **Valid (Manual)** | Semula fraud, lalu Anda sahkan setelah pengecekan | Selesai |
| **Indikasi Fraud** | Responden membalas `2` — mengaku tidak dikunjungi | **Tindak lanjuti** |
| **Gagal Kirim** | Nomor salah/tidak aktif | Periksa nomornya |

Gunakan tab **Jalur Hijau** dan **Indikasi Fraud** untuk menyaring cepat, atau kolom
pencarian dan penyaring Status/Petugas/Sumber.

---

## 7. Menindaklanjuti Indikasi Fraud

Saat responden membalas `2`, sistem **otomatis** mengirim teguran ke nomor petugas
(bila `no_hp_petugas` terisi), memintanya berkunjung ulang dalam 1×24 jam.

Tugas Anda sesudah itu:

1. **Periksa** — hubungi petugas, atau kunjungi sendiri bila perlu.
2. Bila ternyata kunjungan **memang terjadi** (mis. responden lupa, atau yang
   ditemui anggota keluarga lain), klik **Validasi Manual** pada baris tersebut.
   Statusnya menjadi *Valid (Manual)* dan perubahan itu tercatat di jejak audit.
3. Bila kunjungan **benar-benar tidak terjadi**, klik **Salin** untuk menyalin teks
   penolakan baku, lalu tempelkan ke berkas/laporan pemeriksaan Anda.

> Jangan memakai Validasi Manual untuk merapikan angka. Setiap penggunaannya terekam
> beserta identitas Anda dan dapat diperiksa sewaktu-waktu.

---

## 8. Melihat Nomor Telepon Lengkap

Nomor sengaja ditampilkan tersamar (`0813****794`). Untuk melihat versi lengkapnya,
klik **ikon mata** di sebelah nomor lalu konfirmasi.

> Setiap pembukaan nomor **dicatat dalam jejak audit** beserta nama dan waktu.
> Bukalah hanya bila memang perlu menghubungi responden.

---

## 9. Mengunduh Laporan

Klik **Ekspor** untuk mengunduh CSV. Beberapa hal yang perlu Anda ketahui:

- Isinya hanya data pada **kegiatan yang sedang dipilih**, dan hanya data Anda.
- Nomor telepon **tersamar** secara baku.
- Baris pertama berkas memuat **nama Anda, waktu unduh, dan peringatan hukum**.
  Berkas ini rahasia dan menjadi tanggung jawab Anda.

---

## 10. Kebiasaan Harian yang Disarankan

| Waktu | Kegiatan |
|---|---|
| Pagi | Pastikan status WA hijau. Impor kunjungan kemarin. |
| Siang | Ambil sampel acak, lakukan blast. |
| Sore | Periksa tab **Indikasi Fraud**, tindak lanjuti. |
| 17.00 | Ringkasan harian otomatis terkirim ke pengawas. |

---

## 11. Memakai SWARA dari HP di Lapangan

Bila Admin sudah menyalakan alamat publik (terowongan Cloudflare), SWARA dapat
dibuka dari HP mana pun dengan paket data — tidak perlu berada di kantor.

**Yang perlu diketahui:**

- Bukalah lewat **Chrome/Safari biasa**, bukan aplikasi khusus. Tidak ada aplikasi
  yang perlu dipasang.
- Di layar HP, **rail kiri disembunyikan**. Ketuk **ikon tiga garis** di pojok kiri
  topbar untuk memunculkannya (termasuk pemilih kegiatan); tutup lagi dengan ikon
  ✕ di dalamnya, dengan mengetuk area gelap di sebelahnya, atau tombol Esc.
- Tabel bergeser ke samping — geser dengan jari untuk melihat kolom yang
  tersembunyi.
- Simpan alamatnya sebagai **pintasan di layar utama HP** agar tidak perlu
  mengetik ulang.

**Yang sebaiknya tetap dikerjakan dari komputer:**

| Kegiatan | Alasan |
|---|---|
| Upload CSV | Memilih berkas dan menyiapkannya di Excel jauh lebih mudah di komputer. |
| Blast dalam jumlah besar | Prosesnya lama (jeda 6–15 detik per pesan). Jalankan dari komputer, pantau hasilnya dari HP. |
| Ekspor laporan | Berkas CSV rahasia — lebih aman diunduh ke komputer kantor daripada ke HP pribadi. |

**Yang paling berguna dikerjakan dari HP:** memantau tab **Indikasi Fraud**,
menindaklanjuti temuan saat masih di lapangan, dan menambah responden satu-dua
lewat **Tambah Manual**.

> ### Keamanan saat memakai HP
>
> - **Jangan** menyimpan password SWARA di HP yang dipakai bersama orang lain.
> - Selesai bekerja, tekan **Keluar** dari menu profil. Jangan hanya menutup tab —
>   sesi Anda masih hidup sampai 8 jam.
> - Membuka nomor telepon lengkap (ikon mata) **tetap tercatat di jejak audit**,
>   sama seperti dari komputer. Jangan membukanya sambil ditonton orang lain.
> - Jangan memotret layar berisi nomor responden lalu mengirimnya lewat grup WA.
>   Data ini dilindungi UU 16/1997 dan UU 27/2022.

> **Alamatnya berubah-ubah?** Bila Admin memakai terowongan sementara
> (`*.trycloudflare.com`), alamatnya memang berganti setiap kali server dinyalakan
> ulang. Mintalah alamat terbaru kepada Admin, atau mintalah Admin memakai nama
> domain tetap agar alamatnya tidak berubah lagi.

---

## Pertanyaan yang Sering Muncul

**Responden membalas selain 1 atau 2 — bagaimana?**
Balasan itu tidak mengubah status. Hubungi responden secara manual bila perlu.

**Bolehkah blast dijalankan dua kali ke orang yang sama?**
Blast hanya menyasar status *Menunggu*, jadi tidak ada pengiriman ganda. Bila memang
perlu mengirim ulang, gunakan **Reset** — tetapi ingat, Reset menghapus hasil
balasan Valid/Fraud yang sudah masuk pada kegiatan tersebut.

**Data saya tidak muncul.**
Periksa pemilih kegiatan di rail kiri. Bila masih kosong, mintalah Admin memastikan
Anda terdaftar pada kegiatan itu.

**Apakah komputer harus menyala terus?**
Ya, selama Anda menunggu balasan responden. Balasan yang masuk saat aplikasi mati
tidak akan tercatat.

**HP yang dipakai untuk memindai QR harus selalu aktif?**
Ya. WhatsApp Web bekerja sebagai perangkat tertaut, jadi HP gateway sebaiknya tetap
menyala dan terhubung internet.

---

*SWARA · BPS Kabupaten Karangasem · Bila menemui kendala teknis, hubungi Admin sistem.*
