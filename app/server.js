const express = require('express');
const morgan = require('morgan');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.set('view engine', 'ejs');
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(morgan('combined')); // log ra stdout -> Promtail -> Loki

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

// ---- Tours ----
app.get('/', async (req, res) => {
  const { rows } = await q('SELECT * FROM tours ORDER BY id DESC');
  res.render('index', { tours: rows });
});

app.get('/tours/new', (req, res) =>
  res.render('form', { tour: {}, action: '/tours', title: 'Thêm tour' })
);

app.post('/tours', async (req, res) => {
  const { name, destination, price, days, seats, itinerary } = req.body;
  await q(
    'INSERT INTO tours (name,destination,price,days,seats,itinerary) VALUES ($1,$2,$3,$4,$5,$6)',
    [name, destination, price, days, seats, itinerary]
  );
  res.redirect('/');
});

app.get('/tours/:id', async (req, res) => {
  const { rows } = await q('SELECT * FROM tours WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy tour');
  res.render('tour', { tour: rows[0] });
});

app.get('/tours/:id/edit', async (req, res) => {
  const { rows } = await q('SELECT * FROM tours WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).send('Không tìm thấy tour');
  res.render('form', {
    tour: rows[0],
    action: `/tours/${req.params.id}/edit`,
    title: 'Sửa tour',
  });
});

app.post('/tours/:id/edit', async (req, res) => {
  const { name, destination, price, days, seats, itinerary } = req.body;
  await q(
    'UPDATE tours SET name=$1,destination=$2,price=$3,days=$4,seats=$5,itinerary=$6 WHERE id=$7',
    [name, destination, price, days, seats, itinerary, req.params.id]
  );
  res.redirect(`/tours/${req.params.id}`);
});

app.post('/tours/:id/delete', async (req, res) => {
  await q('DELETE FROM tours WHERE id=$1', [req.params.id]);
  res.redirect('/');
});

// ---- Booking ----
app.post('/tours/:id/book', async (req, res) => {
  const { full_name, email, phone, people } = req.body;
  const c = await q(
    'INSERT INTO customers (full_name,email,phone) VALUES ($1,$2,$3) RETURNING id',
    [full_name, email, phone]
  );
  await q('INSERT INTO bookings (tour_id,customer_id,people) VALUES ($1,$2,$3)', [
    req.params.id,
    c.rows[0].id,
    people,
  ]);
  res.redirect('/bookings');
});

app.get('/bookings', async (req, res) => {
  const { rows } = await q(`
    SELECT b.id, b.people, b.status, b.created_at,
           t.name AS tour_name, c.full_name, c.email, c.phone
    FROM bookings b
    JOIN tours t ON t.id=b.tour_id
    JOIN customers c ON c.id=b.customer_id
    ORDER BY b.id DESC`);
  res.render('bookings', { bookings: rows });
});

app.post('/bookings/:id/delete', async (req, res) => {
  await q('DELETE FROM bookings WHERE id=$1', [req.params.id]);
  res.redirect('/bookings');
});

// ---- System ----
app.get('/health', (req, res) => res.send('OK'));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Lỗi server');
});

app.listen(3000, () => console.log('Tour app listening on 3000'));