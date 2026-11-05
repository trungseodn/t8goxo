# BẢN QUY TẮC BẢO TOÀN DỮ LIỆU & QUY TRÌNH TRIỂN KHAI HỆ THỐNG VPS
**Dự án**: T8 Goxo Reels & Image Automation (`t8.goxo.us`)  
**Ngày thiết lập**: 05/11/2026  
**Trạng thái**: Có hiệu lực bắt buộc cho toàn bộ chu trình phát triển & bảo trì  

---

## 1. TÔN CHỈ BẤT BIẾN (CORE SAFETY PRINCIPLES)

1. **BẢO TOÀN DỮ LIỆU VÀ CÁC DỰ ÁN KHÁC TRÊN VPS (ZERO INTERFERENCE & DATA LOSS)**:
   * VPS `169.58.190.115` đang chạy đồng thời nhiều dự án: `linh.goxo.us` (`/root/ztreel-app`), `t4.goxo.us` (`/root/ztreel-t4`), và `t7.goxo.us` (`/root/ztreel-t7`).
   * **Nghiêm cấm tuyệt đối đụng chạm, sửa đổi, dừng (stop), xóa, hoặc ghi đè bất kỳ file/container/database/port nào của các dự án khác.**
   * Toàn bộ mã nguồn, container, docker volume, network và cấu hình của `t8` phải được cô lập hoàn toàn (prefix `ztreel8_`, thư mục riêng `/root/ztreel-t8`).

2. **QUẢN LÝ MÃ NGUỒN PHÂN TÁCH HOÀN TOÀN**:
   * **Upstream (Template gốc)**: `https://github.com/trungseodn/t4goxo` $\rightarrow$ **CHỈ ĐỌC (READ-ONLY)**.
   * **Origin (Phát triển chính)**: `https://github.com/trungseodn/t8goxo` $\rightarrow$ Toàn bộ code phát triển, tính năng mới và deploy đều đi qua repo này.

3. **CƠ CHẾ PHÊ DUYỆT (EXPLICIT APPROVAL)**:
   * Mọi can thiệp vào VPS (pull code mới, chạy migration, rebuild container, sửa cấu hình Nginx) đều phải được trình bày trước rõ ràng và CHỈ thực hiện sau khi người dùng gửi yêu cầu hoặc đồng ý.

---

## 2. HƯỚNG DẪN ĐĂNG NHẬP & KẾT NỐI VPS (SSH ACCESS DETAILS)

* **IP Server**: `169.58.190.115` (Port: `22`)
* **Domain trỏ về**: `t8.goxo.us`
* **User**: `root`
* **Đường dẫn thư mục dự án trên VPS**: `/root/ztreel-t8`
* **File Docker Compose**: `docker-compose.t8.yml`

### Các câu lệnh SSH chuẩn:

1. **Mở phiên SSH tương tác (Interactive Shell)**:
   ```powershell
   ssh -o StrictHostKeyChecking=no root@169.58.190.115
   ```

2. **Chạy lệnh đơn từ PowerShell (One-shot command)**:
   ```powershell
   ssh -o BatchMode=yes -o StrictHostKeyChecking=no root@169.58.190.115 '<câu_lệnh_bash>'
   ```

3. **Xem trạng thái các container của T8**:
   ```powershell
   ssh -o BatchMode=yes -o StrictHostKeyChecking=no root@169.58.190.115 'docker ps --filter "name=ztreel8"'
   ```

4. **Xem log realtime của API T8**:
   ```powershell
   ssh -o StrictHostKeyChecking=no root@169.58.190.115 'docker logs -f ztreel8_api_prod --tail 100'
   ```

---

## 3. THIẾT KẾ CÔ LẬP HỆ THỐNG T8 TRÊN VPS

* **Thư mục dự án**: `/root/ztreel-t8`
* **Docker Compose file**: `docker-compose.t8.yml`
* **Containers của T8**:
  * `ztreel8_api_prod` (API NestJS - Port host `3008` -> container `3000`)
  * `ztreel8_web_prod` (Frontend React - Port host `8088` -> container `80`)
  * `ztreel8_postgres_prod` (PostgreSQL 15 - Port host `5438` -> container `5432`)
  * `ztreel8_redis_prod` (Redis 7 - Port host `6388` -> container `6379`)
* **Docker Volumes cô lập**:
  * `ztreel8_postgres_data`
  * `ztreel8_redis_data`
  * `ztreel8_storage`
  * `ztreel8_uploads`
* **Docker Network riêng**: `ztreel8_net`

---

## 4. CÁC ĐIỀU CẤM TUYỆT ĐỐI (STRICT PROHIBITIONS)

❌ **NGHIÊM CẤM** đụng đến thư mục `/root/ztreel-app`, `/root/ztreel-t4`, `/root/ztreel-t7` hoặc bất kỳ container/volume/process nào không thuộc `ztreel8`.  
❌ **NGHIÊM CẤM** dùng lệnh `docker compose down -v` hoặc `docker-compose down -v` (Cờ `-v` sẽ xóa sạch các Docker Volume dữ liệu!).  
❌ **NGHIÊM CẤM** dùng lệnh `npx prisma db push --force-reset` hoặc `npx prisma migrate reset`.  
❌ **NGHIÊM CẤM** tự ý xóa file `.env` hoặc `apps/api/.env` trên VPS.  
❌ **NGHIÊM CẤM** chỉnh sửa trực tiếp mã nguồn trên VPS bằng tay. Mọi thay đổi phải đi từ Local $\rightarrow$ Commit Git $\rightarrow$ Pull về VPS.  
❌ **NGHIÊM CẤM** push code lên repo `trungseodn/t4goxo` (chỉ push lên `trungseodn/t8goxo`).  
