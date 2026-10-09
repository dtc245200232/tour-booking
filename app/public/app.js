document.addEventListener('DOMContentLoaded', () => {
    // Tìm kiếm + lọc điểm đến trong bảng tour
    const s = document.getElementById('search');
    const d = document.getElementById('dest');
    const rows = document.querySelectorAll('tr.row');
    const filter = () => {
        const k = s ? s.value.toLowerCase() : '';
        const dest = d ? d.value : '';
        rows.forEach((r) => {
            const okName = r.dataset.name.includes(k);
            const okDest = !dest || r.dataset.dest === dest;
            r.style.display = okName && okDest ? '' : 'none';
        });
    };
    if (s) s.addEventListener('input', filter);
    if (d) d.addEventListener('change', filter);

    // Hộp xác nhận cho nút Xóa/Hủy
    document.querySelectorAll('form[data-confirm]').forEach((f) => {
        f.addEventListener('submit', (e) => {
            if (!confirm(f.dataset.confirm)) e.preventDefault();
        });
    });

    // Tính tổng tiền khi đặt tour
    const p = document.getElementById('people');
    const t = document.getElementById('total');
    if (p && t) {
        const update = () => {
            const sum = Number(t.dataset.price) * (Number(p.value) || 1);
            t.textContent = sum.toLocaleString('vi-VN') + ' ₫';
        };
        p.addEventListener('input', update);
        update();
    }

    // Lọc tour đã đặt: tất cả / sắp tới / đã qua
    const fb = document.querySelectorAll('[data-filter]');
    fb.forEach((b) =>
        b.addEventListener('click', () => {
            fb.forEach((x) => x.classList.remove('on'));
            b.classList.add('on');
            const f = b.dataset.filter;
            document.querySelectorAll('tr[data-phase]').forEach((r) => {
                const ph = r.dataset.phase;
                const show =
                    f === 'all' ||
                    (f === 'upcoming' && (ph === 'upcoming' || ph === 'ongoing')) ||
                    ph === f;
                r.style.display = show ? '' : 'none';
            });
        })
    );
});