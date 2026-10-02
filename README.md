# Hệ thống Booking Tour - <Mã SV> - <Họ tên>

## Stack
Node.js/Express, PostgreSQL, pgAdmin, Nginx, Prometheus, Grafana, Loki, Promtail

## Chạy hệ thống
1. `cp .env.example .env` rồi đổi mật khẩu
2. Sinh cert: lệnh openssl trong mục "HTTPS"
3. `docker compose up -d --build`

## Địa chỉ
| Dịch vụ | URL |
|---|---|
| Website | https://localhost |
| pgAdmin | http://localhost:5050 |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |

## Dừng
`docker compose down` (thêm `-v` để xóa dữ liệu)