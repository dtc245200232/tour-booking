const express = require('express');
const morgan = require('morgan');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.set('view engine', 'ejs');
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/public'));
app.use(morgan('combined')); // log ra stdout -> Promtail -> Loki

// ---- Phiên đăng nhập (cookie đã ký) ----
app.use(
  cookieSession({
    name: 'sid',
    keys: [process.env.SESSION_SECRET],
    maxAge: 8 * 60 * 60 * 1000, // 8 giờ
    httpOnly: true,
    secure: true, // chỉ gửi qua HTTPS (Nginx)
    sameSite: 'lax',
  })
);
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// ---- Middleware phân quyền ----
const requireLogin = (req, res, next) =>
  req.session.user ? next() : res.redirect('/login');

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== role) {
    console.warn(`FORBIDDEN user=${req.session.user.email} path=${req.path}`);
    return res.status(403).render('403');
  }
  next();
};
const admin = requireRole('admin');
const customer = requireRole('customer');

// ---- Hàm dùng chung trong view ----
app.locals.code = (id) => 'TOUR-' + String(id).padStart(3, '0');
app.locals.dur = (d) => `${d} ngày ${Math.max(d - 1, 0)} đêm`;
app.locals.money = (n) => Number(n).toLocaleString('vi-VN') + ' ₫';
app.locals.bstatus = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  cancelled: 'Đã hủy',
};
app.locals.phaseLabel = {
  past: 'Đã qua',
  ongoing: 'Đang diễn ra',
  upcoming: 'Sắp khởi hành',
  unknown: '—',
};

// ---- Prometheus metrics ----
client.collectDefaultMetrics();
const httpCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Tong so request',
  labelNames: ['method', 'route', 'status'],
});
app.use((req, res, next) => {
  res.on('finish', () =>
    httpCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : 'other',
      status: res.statusCode,
    })
  );
  next();
});

// ---- Database ----
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
const q = (sql, params) => pool.query(sql, params);

const TOUR_SQL = `
  SELECT t.*, t.seats - COALESCE((
    SELECT SUM(b.people) FROM bookings b
    WHERE b.tour_id = t.id AND b.status <> 'cancelled'), 0) AS seats_left
  FROM tours t`;

const setSession = (req, u) => {
  req.session.user = {
    id: u.id,
    name: u.full_name,
    email: u.email,
    phone: u.phone || '',
    role: u.role,
  };
};

// ===================== ĐĂNG NHẬP / ĐĂNG KÝ =====================
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, email: '' });
});

app.post('/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const { rows } = await q('SELECT * FROM users WHERE email=$1', [email]);
  const u = rows[0];
  const ok = u && (await bcrypt.compare(String(req.body.password || ''), u.password_hash));
  if (!ok) {
    console.warn(`LOGIN_FAILED email=${JSON.stringify(email)}`);
    return res.status(401).render('login', { error: 'Sai email hoặc mật khẩu', email });
  }
  setSession(req, u);
  console.log(`LOGIN_OK user=${u.email} role=${u.role}`);
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { error: null, form: {} });
});

app.post('/register', async (req, res) => {
  const form = {
    full_name: String(req.body.full_name || '').trim(),
    email: String(req.body.email || '').toLowerCase().trim(),
    phone: String(req.body.phone || '').trim(),
  };
  const password = String(req.body.password || '');
  const fail = (error) => res.status(400).render('register', { error, form });

  if (!form.full_name) return fail('Vui lòng nhập họ tên');
  if (!/^\S+@\S+\.\S+$/.test(form.email)) return fail('Email không hợp lệ');
  if (password.length < 8) return fail('Mật khẩu phải có ít nhất 8 ký tự');

  try {
    const hash = await bcrypt.hash(password, 10);
    // Luôn tạo tài khoản khách hàng, không bao giờ nhận role từ form
    const { rows } = await q(
      `INSERT INTO users (full_name,email,phone,password_hash,role)
       VALUES ($1,$2,$3,$4,'customer') RETURNING *`,
      [form.full_name, form.email, form.phone, hash]
    );
    setSession(req, rows[0]);
    console.log(`REGISTER user=${form.email}`);
    res.redirect('/');
  } catch (e) {
    if (e.code === '23505') return fail('Email này đã được đăng ký');
    throw e;
  }
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// ===================== DASHBOARD (cả 2 vai trò) =====================
app.get('/', requireLogin, async (req, res) => {
  const tours = (await q(TOUR_SQL + " WHERE t.status = 'active' ORDER BY t.id")).rows;
  let stats;
  if (req.session.user.role === 'admin') {
    stats = (await q(`
      SELECT
        (SELECT COUNT(*) FROM tours) AS tours,
        (SELECT COUNT(*) FROM tours WHERE status='active') AS active_tours,
        (SELECT COUNT(*) FROM users WHERE role='customer') AS customers,
        (SELECT COUNT(*) FROM bookings) AS bookings,
        (SELECT COUNT(*) FROM bookings WHERE status='pending') AS pending,
        (SELECT COALESCE(SUM(b.people * t.price), 0)
           FROM bookings b JOIN tours t ON t.id = b.tour_id
           WHERE b.status = 'confirmed') AS revenue`)).rows[0];
  } else {
    stats = (await q(
      `SELECT
         COUNT(*) AS my_total,
         COUNT(*) FILTER (WHERE b.status <> 'cancelled'
           AND b.travel_date + (t.days - 1) >= CURRENT_DATE) AS my_upcoming,
         COUNT(*) FILTER (WHERE b.status <> 'cancelled'
           AND b.travel_date + (t.days - 1) < CURRENT_DATE) AS my_done
       FROM bookings b JOIN tours t ON t.id = b.tour_id
       WHERE b.user_id = $1`,
      [req.session.user.id]
    )).rows[0];
  }
  res.render('dashboard', { stats, tours });
});

// ===================== TOUR =====================
// Chỉ quản trị viên
app.get('/tours', admin, async (req, res) => {
  const { rows } = await q(TOUR_SQL + ' ORDER BY t.id');
  res.render('tours', { tours: rows });
});

app.get('/tours/new', admin, (req, res) =>
  res.render('form', { tour: {}, action: '/tours', title: 'Thêm tour mới' })
);

app.post('/tours', admin, async (req, res) => {
  const { name, destination, price, days, seats, itinerary, status } = req.body;
  await q(
    'INSERT INTO tours (name,destination,price,days,seats,itinerary,status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [name, destination, price, days, seats, itinerary, status || 'active']
  );
  res.redirect('/tours');
});

// Chi tiết tour: cả 2 vai trò xem được
app.get('/tours/:id', requireLogin, async (req, res) => {
  const { rows } = await q(TOUR_SQL + ' WHERE t.id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy tour');
  res.render('tour', { tour: rows[0], today: new Date().toISOString().slice(0, 10) });
});

app.get('/tours/:id/edit', admin, async (req, res) => {
  const { rows } = await q('SELECT * FROM tours WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy tour');
  res.render('form', {
    tour: rows[0],
    action: `/tours/${req.params.id}/edit`,
    title: 'Sửa tour',
  });
});

app.post('/tours/:id/edit', admin, async (req, res) => {
  const { name, destination, price, days, seats, itinerary, status } = req.body;
  await q(
    'UPDATE tours SET name=$1,destination=$2,price=$3,days=$4,seats=$5,itinerary=$6,status=$7 WHERE id=$8',
    [name, destination, price, days, seats, itinerary, status || 'active', req.params.id]
  );
  res.redirect('/tours');
});

app.post('/tours/:id/duplicate', admin, async (req, res) => {
  await q(
    `INSERT INTO tours (name,destination,price,days,seats,itinerary,status)
     SELECT name || ' (bản sao)', destination, price, days, seats, itinerary, 'inactive'
     FROM tours WHERE id=$1`,
    [req.params.id]
  );
  res.redirect('/tours');
});

app.post('/tours/:id/delete', admin, async (req, res) => {
  await q('DELETE FROM tours WHERE id=$1', [req.params.id]);
  res.redirect('/tours');
});

// ===================== ĐẶT TOUR (chỉ khách hàng) =====================
app.post('/tours/:id/book', customer, async (req, res) => {
  const { full_name, email, phone, travel_date } = req.body;
  const people = parseInt(req.body.people, 10);

  const tour = (await q(TOUR_SQL + " WHERE t.id=$1 AND t.status='active'", [req.params.id])).rows[0];
  if (!tour) return res.status(404).send('Tour không tồn tại hoặc đã ngừng mở bán');
  if (!(people >= 1) || people > tour.seats_left)
    return res.status(400).send('Số người không hợp lệ hoặc không đủ chỗ');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travel_date || ''))
    return res.status(400).send('Ngày khởi hành không hợp lệ');
  const chk = await q('SELECT $1::date >= CURRENT_DATE AS ok', [travel_date]);
  if (!chk.rows[0].ok) return res.status(400).send('Ngày khởi hành phải từ hôm nay trở đi');

  const c = await q(
    'INSERT INTO customers (full_name,email,phone) VALUES ($1,$2,$3) RETURNING id',
    [full_name, email, phone]
  );
  await q(
    'INSERT INTO bookings (tour_id,customer_id,user_id,travel_date,people) VALUES ($1,$2,$3,$4,$5)',
    [tour.id, c.rows[0].id, req.session.user.id, travel_date, people]
  );
  console.log(`BOOKING user=${req.session.user.email} tour=${tour.id} people=${people}`);
  res.redirect('/my-bookings');
});

// Tour đã đặt của chính khách hàng (gồm cả tour đã qua)
app.get('/my-bookings', customer, async (req, res) => {
  const { rows } = await q(
    `SELECT b.id, b.people, b.status, to_char(b.travel_date,'DD/MM/YYYY') AS travel_fmt,
            t.id AS tour_id, t.name AS tour_name, t.destination, t.days, t.price,
            CASE
              WHEN b.travel_date IS NULL THEN 'unknown'
              WHEN b.travel_date + (t.days - 1) < CURRENT_DATE THEN 'past'
              WHEN b.travel_date <= CURRENT_DATE THEN 'ongoing'
              ELSE 'upcoming'
            END AS phase
     FROM bookings b JOIN tours t ON t.id = b.tour_id
     WHERE b.user_id = $1
     ORDER BY b.travel_date DESC NULLS LAST, b.id DESC`,
    [req.session.user.id]
  );
  res.render('my-bookings', { bookings: rows });
});

// Khách chỉ hủy được đơn của mình, còn chờ xác nhận và chưa khởi hành
app.post('/my-bookings/:id/cancel', customer, async (req, res) => {
  await q(
    `UPDATE bookings SET status='cancelled'
     WHERE id=$1 AND user_id=$2 AND status='pending' AND travel_date > CURRENT_DATE`,
    [req.params.id, req.session.user.id]
  );
  res.redirect('/my-bookings');
});

// ===================== QUẢN LÝ ĐƠN (chỉ quản trị viên) =====================
app.get('/bookings', admin, async (req, res) => {
  const { rows } = await q(`
    SELECT b.id, b.people, b.status, b.created_at, t.id AS tour_id,
           to_char(b.travel_date,'DD/MM/YYYY') AS travel_fmt,
           t.name AS tour_name, t.price, c.full_name, c.email, c.phone
    FROM bookings b
    JOIN tours t ON t.id = b.tour_id
    JOIN customers c ON c.id = b.customer_id
    ORDER BY b.id DESC`);
  res.render('bookings', { bookings: rows });
});

app.post('/bookings/:id/status', admin, async (req, res) => {
  const ok = ['pending', 'confirmed', 'cancelled'];
  if (ok.includes(req.body.status)) {
    await q('UPDATE bookings SET status=$1 WHERE id=$2', [req.body.status, req.params.id]);
  }
  res.redirect('/bookings');
});

app.post('/bookings/:id/delete', admin, async (req, res) => {
  await q('DELETE FROM bookings WHERE id=$1', [req.params.id]);
  res.redirect('/bookings');
});

// ===================== KHÁCH HÀNG (chỉ quản trị viên) =====================
app.get('/customers', admin, async (req, res) => {
  const { rows } = await q(`
    SELECT u.id, u.full_name, u.email, u.phone,
           to_char(u.created_at,'DD/MM/YYYY') AS joined, COUNT(b.id) AS total
    FROM users u LEFT JOIN bookings b ON b.user_id = u.id
    WHERE u.role = 'customer'
    GROUP BY u.id ORDER BY u.id DESC`);
  res.render('customers', { customers: rows });
});

// ===================== CÀI ĐẶT (cả 2 vai trò) =====================
async function renderSettings(req, res, extra = {}) {
  const { rows } = await q('SELECT full_name,email,phone,role FROM users WHERE id=$1', [
    req.session.user.id,
  ]);
  res.render('settings', { me: rows[0], msg: null, err: null, ...extra });
}

app.get('/settings', requireLogin, (req, res) => renderSettings(req, res));

app.post('/settings/profile', requireLogin, async (req, res) => {
  const name = String(req.body.full_name || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!name) return renderSettings(req, res, { err: 'Họ tên không được để trống' });
  await q('UPDATE users SET full_name=$1, phone=$2 WHERE id=$3', [name, phone, req.session.user.id]);
  req.session.user = { ...req.session.user, name, phone };
  res.locals.user = req.session.user;
  renderSettings(req, res, { msg: 'Đã cập nhật thông tin' });
});

app.post('/settings/password', requireLogin, async (req, res) => {
  const uid = req.session.user.id;
  const { rows } = await q('SELECT password_hash FROM users WHERE id=$1', [uid]);
  const oldOk = await bcrypt.compare(String(req.body.old_password || ''), rows[0].password_hash);
  if (!oldOk) return renderSettings(req, res, { err: 'Mật khẩu hiện tại không đúng' });
  const np = String(req.body.new_password || '');
  if (np.length < 8) return renderSettings(req, res, { err: 'Mật khẩu mới phải có ít nhất 8 ký tự' });
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(np, 10), uid]);
  console.log(`PASSWORD_CHANGED user=${req.session.user.email}`);
  renderSettings(req, res, { msg: 'Đã đổi mật khẩu' });
});

// ===================== HỆ THỐNG =====================
app.get('/health', (req, res) => res.send('OK'));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Lỗi server');
});

// Tạo tài khoản admin lần đầu từ biến môi trường
async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return console.warn('Chưa cấu hình ADMIN_EMAIL / ADMIN_PASSWORD');
  const { rows } = await q('SELECT id FROM users WHERE email=$1', [email]);
  if (rows.length) return;
  await q(
    `INSERT INTO users (full_name,email,password_hash,role) VALUES ('Quản trị viên',$1,$2,'admin')`,
    [email, await bcrypt.hash(pw, 10)]
  );
  console.log(`Đã tạo tài khoản admin: ${email}`);
}

seedAdmin().catch((e) => console.error('seedAdmin lỗi:', e.message));
app.listen(3000, () => console.log('Tour app listening on 3000'));