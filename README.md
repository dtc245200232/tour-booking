# Hệ thống Booking Tour - <DTC245200232> - <Thèn Thành Đạt>

## Stack
Node.js/Express, PostgreSQL, pgAdmin, Nginx, Prometheus, Grafana, Loki, Promtail

## Chạy hệ thống
0. Phải ở thư mục tour-booking `cd tour-booking`
1. `cp .env.example .env` rồi đổi mật khẩu
2. Sinh cert: lệnh openssl trong mục "HTTPS"
3. `docker compose up -d --build`

## Địa chỉ
| Dịch vụ | URL |
|---|---|
| Website | https://localhost:8443 |
| pgAdmin | http://localhost:5050 |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |

## Tài khoản
1. Admin
Email: admin@tour.com
Password: change_me
2. Khách hàng
Email: khachhang@gmail.com
Password: 12345678

## Dừng
`docker compose down` (thêm `-v` để xóa dữ liệu)

## Một số lỗi thường gặp
- Tài khoản không đăng nhập được dùng `docker compose restart app` để khởi động lại server nạp lại tài khoản vào Database
