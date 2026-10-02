CREATE TABLE tours (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  destination VARCHAR(100) NOT NULL,
  price NUMERIC(12,0) NOT NULL,
  days INT NOT NULL,
  seats INT NOT NULL DEFAULT 20,
  itinerary TEXT
);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  phone VARCHAR(20)
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  tour_id INT REFERENCES tours(id) ON DELETE CASCADE,
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  people INT NOT NULL DEFAULT 1,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO tours (name, destination, price, days, seats, itinerary) VALUES
('Hạ Long 3N2Đ', 'Quảng Ninh', 3500000, 3, 20, 'Ngày 1: Hà Nội - Hạ Long, lên du thuyền. Ngày 2: Tham quan hang Sửng Sốt, chèo kayak. Ngày 3: Trả phòng, về Hà Nội.'),
('Đà Nẵng - Hội An 4N3Đ', 'Đà Nẵng', 5200000, 4, 15, 'Ngày 1: Bay đến Đà Nẵng. Ngày 2: Bà Nà Hills. Ngày 3: Phố cổ Hội An. Ngày 4: Biển Mỹ Khê, bay về.'),
('Phú Quốc 3N2Đ', 'Kiên Giang', 4800000, 3, 25, 'Ngày 1: Đến Phú Quốc, nghỉ resort. Ngày 2: Lặn ngắm san hô, Grand World. Ngày 3: Chợ đêm, bay về.');