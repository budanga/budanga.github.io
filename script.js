/**
 * CYBERNETIC KINETIC OS // RUNTIME CONTROLLER
 * Handles i18n Localization, Aperture Navigation, Modal Systems, and Keyboard Commands.
 */

const BASE_LANG = 'es';
const SUPPORTED_LANGS = ['es', 'en'];
const translationsCache = {};

// Helper: Traverse nested JSON keys like "header.role"
function getNestedValue(obj, key) {
    if (!obj || !key) return null;
    return key.split('.').reduce((prev, curr) => (prev ? prev[curr] : null), obj);
}

// Load Translation JSON from i18n/
async function loadTranslations(lang) {
    if (translationsCache[lang]) {
        return translationsCache[lang];
    }
    try {
        const response = await fetch(`i18n/${lang}.json`);
        if (!response.ok) throw new Error(`Failed to load i18n/${lang}.json`);
        const data = await response.json();
        translationsCache[lang] = data;
        return data;
    } catch (error) {
        console.error('Translation loading error:', error);
        return null;
    }
}

// Update DOM elements matching [data-i18n]
async function updateContent(lang) {
    try {
        const baseTranslations = await loadTranslations(BASE_LANG);
        const translations = lang === BASE_LANG ? baseTranslations : await loadTranslations(lang);

        if (!baseTranslations) return;

        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            const value =
                (translations ? getNestedValue(translations, key) : null) ??
                getNestedValue(baseTranslations, key);

            if (value !== null && value !== undefined) {
                element.textContent = value;
            }
        });

        localStorage.setItem('preferredLanguage', lang);
        document.documentElement.lang = lang;
    } catch (error) {
        console.error('Content update error:', error);
    }
}

// Modal Management
function openBioModal() {
    const modal = document.getElementById('provenance-modal');
    if (modal) {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }
}

function closeBioModal() {
    const modal = document.getElementById('provenance-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
}

/**
 * ASCII glow panels. Each project panel has a <canvas class="glow-canvas"> behind its
 * SVG schematic. An intensity field (0..1) is evaluated per character cell in the SVG's
 * own viewBox coordinates (400 x 320), so the glow lines up with the drawing, then
 * rendered as a soft colour wash plus one glyph per cell.
 */
function initGlow() {
    const RAMP = ' .;-+xX#';
    const CELL_W = 8, CELL_H = 12;
    const VIEW_W = 400, VIEW_H = 320;
    const STATIC_T = 2; // frame shown when the user prefers reduced motion
    // intensity -> colour: obsidian, ultramarine, magenta, solar, yellow, white
    const STOPS = [
        [0.00, 10, 11, 14], [0.30, 0, 40, 200], [0.55, 170, 20, 150],
        [0.75, 255, 62, 0], [0.92, 255, 200, 60], [1.00, 255, 245, 200]
    ];

    function color(i) {
        for (let k = 1; k < STOPS.length; k++) {
            if (i <= STOPS[k][0]) {
                const a = STOPS[k - 1], b = STOPS[k], f = (i - a[0]) / (b[0] - a[0]);
                return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
            }
        }
        return STOPS[STOPS.length - 1].slice(1);
    }
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const gauss = (d, w) => Math.exp(-((d / w) ** 2));
    const boxDist = (x, y, x0, y0, w, h) =>
        Math.hypot(Math.max(x0 - x, 0, x - x0 - w), Math.max(y0 - y, 0, y - y0 - h));

    // Galaxy: a clump orbits each of the schematic's two tilted ellipses, plus the core.
    const rot = deg => [Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180)];
    const ELLIPSE_A = rot(-25), ELLIPSE_B = rot(35);
    function orbit(dx, dy, [c, s], angle) {
        const xr = (dx * c + dy * s) / 180, yr = (-dx * s + dy * c) / 65;
        const band = gauss(Math.hypot(xr, yr) - 1, 0.2);
        const clump = Math.exp(-(Math.sin((Math.atan2(yr, xr) - angle) / 2) ** 2) / 0.08);
        return band * (0.3 + 0.7 * clump);
    }
    function galaxy(x, y, t) {
        const dx = x - 200, dy = y - 160, r = Math.hypot(dx, dy);
        return gauss(r, 26) + 0.22 * gauss(r, 75)
            + 0.8 * orbit(dx, dy, ELLIPSE_A, t * 0.5)
            + 0.42 * orbit(dx, dy, ELLIPSE_B, 2 - t * 0.35);
    }

    // Vault: light stays inside the safe body; a highlight sweeps round the dial ring.
    function vault(x, y, t) {
        const dx = x - 200, dy = y - 165, r = Math.hypot(dx, dy);
        const body = gauss(boxDist(x, y, 110, 90, 180, 150), 14);
        const dial = gauss(r - 45, 8) * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(Math.atan2(dy, dx) - t * 0.8)));
        const ripples = 0.3 * Math.exp(-r / 80) * (0.5 + 0.5 * Math.cos(r * 0.2 - t * 1.4)) ** 2;
        return body * (0.1 + 0.45 * dial + 0.45 * gauss(r, 20) + ripples);
    }

    // Ledger: every 5s a pulse leaves block A, runs along the dashed wire, lights the
    // QR node as it passes and flashes block B on arrival.
    const WIRE = [[140, 110], [200, 110], [200, 210], [260, 210]];
    function wireDist(x, y) {
        let best = Infinity, bestS = 0, acc = 0;
        for (let k = 0; k < WIRE.length - 1; k++) {
            const [ax, ay] = WIRE[k], [bx, by] = WIRE[k + 1], len = Math.hypot(bx - ax, by - ay);
            const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)));
            const d = Math.hypot(x - ax - u * (bx - ax), y - ay - u * (by - ay));
            if (d < best) { best = d; bestS = acc + u * len; }
            acc += len;
        }
        return [best, bestS];
    }
    function ledger(x, y, t) {
        const ph = (t % 5) / 5, s0 = ph * 310 - 40; // pulse reaches block B at ph ~ 0.84
        const [d, s] = wireDist(x, y);
        const a = gauss(boxDist(x, y, 80, 90, 40, 40), 24) * (0.3 + 0.45 * gauss(Math.min(ph, 1 - ph), 0.14));
        const b = gauss(boxDist(x, y, 280, 190, 40, 40), 24) * (0.25 + 0.6 * gauss(ph - 0.84, 0.1));
        const qr = 0.5 * gauss(Math.hypot(x - 200, y - 160), 24) * gauss(s0 - 110, 40);
        return gauss(d, 13) * (0.22 + 0.75 * gauss(s - s0, 32)) + a + b + qr;
    }
    const FIELDS = { galaxy, vault, ledger };

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const panels = [...document.querySelectorAll('.glow-canvas')].map(cv => ({
        cv, ctx: cv.getContext('2d'), field: FIELDS[cv.dataset.glow],
        off: document.createElement('canvas'), // one pixel per cell, upscaled for the wash
        lx: 200, ly: 160, tx: 200, ty: 160,    // cursor light: current and target position
        heat: 0, over: false, visible: true
    }));
    if (!panels.length) return;
    const byCanvas = new Map(panels.map(p => [p.cv, p]));

    function draw(p, t) {
        const { ctx, cols, rows, img, vals } = p, data = img.data;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const x = ((c + 0.5) * CELL_W - p.ox) / p.scale, y = ((r + 0.5) * CELL_H - p.oy) / p.scale;
            const light = p.heat * gauss(Math.hypot(x - p.lx, y - p.ly), 75);
            const ambient = 0.06 + 0.03 * Math.sin(x * 0.03 + t * 0.4) * Math.sin(y * 0.04 - t * 0.3);
            const i = Math.min(1, ambient + p.field(x, y, t) * (1 + 1.1 * light) + 0.3 * light);
            const k = r * cols + c, [R, G, B] = color(i);
            vals[k] = i; data[k * 4] = R; data[k * 4 + 1] = G; data[k * 4 + 2] = B; data[k * 4 + 3] = 255;
        }
        p.off.getContext('2d').putImageData(img, 0, 0);

        ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
        ctx.clearRect(0, 0, p.w, p.h);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(p.off, 0, 0, p.w, p.h);
        ctx.globalAlpha = 1;
        ctx.font = '11px "Space Mono", monospace';
        ctx.textBaseline = 'top';
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const i = vals[r * cols + c];
            // per-cell jitter mixes neighbouring glyphs at band edges (the dithered look)
            const idx = Math.min(RAMP.length - 1, Math.floor((i + (hash(c, r) - 0.5) * 0.09) * RAMP.length * 1.08));
            if (idx <= 0) continue;
            const [R, G, B] = color(Math.min(1, i * 1.12 + 0.06));
            ctx.fillStyle = `rgb(${Math.min(255, R * 1.25 + 18) | 0},${Math.min(255, G * 1.25 + 18) | 0},${Math.min(255, B * 1.25 + 18) | 0})`;
            ctx.fillText(RAMP[idx], c * CELL_W + 0.5, r * CELL_H);
        }
    }

    function resize(p) {
        p.w = p.cv.clientWidth; p.h = p.cv.clientHeight;
        p.dpr = Math.min(2, window.devicePixelRatio || 1);
        // same fit as the SVG's default preserveAspectRatio (xMidYMid meet)
        p.scale = Math.min(p.w / VIEW_W, p.h / VIEW_H) || 1;
        p.ox = (p.w - VIEW_W * p.scale) / 2; p.oy = (p.h - VIEW_H * p.scale) / 2;
        p.cv.width = Math.round(p.w * p.dpr); p.cv.height = Math.round(p.h * p.dpr);
        p.cols = Math.max(1, Math.ceil(p.w / CELL_W)); p.rows = Math.max(1, Math.ceil(p.h / CELL_H));
        p.off.width = p.cols; p.off.height = p.rows;
        p.img = new ImageData(p.cols, p.rows);
        p.vals = new Float32Array(p.cols * p.rows);
        if (reducedMotion) draw(p, STATIC_T);
    }
    panels.forEach(resize);
    const resizeObserver = new ResizeObserver(() => panels.forEach(resize));
    panels.forEach(p => resizeObserver.observe(p.cv));

    if (reducedMotion) {
        document.fonts.ready.then(() => panels.forEach(p => draw(p, STATIC_T)));
        return;
    }

    for (const p of panels) {
        const area = p.cv.closest('.aperture-visual');
        const track = e => {
            const r = p.cv.getBoundingClientRect(); // includes the hover zoom
            p.tx = ((e.clientX - r.left) * p.w / r.width - p.ox) / p.scale;
            p.ty = ((e.clientY - r.top) * p.h / r.height - p.oy) / p.scale;
            if (!p.over) { p.lx = p.tx; p.ly = p.ty; }
            p.over = true;
        };
        const release = () => { p.over = false; };
        area.addEventListener('pointerdown', track);
        area.addEventListener('pointermove', track);
        area.addEventListener('pointerleave', release);
        area.addEventListener('pointercancel', release);
    }

    const visibility = new IntersectionObserver(entries => {
        entries.forEach(e => { byCanvas.get(e.target).visible = e.isIntersecting; });
    });
    panels.forEach(p => visibility.observe(p.cv));

    let last = 0;
    function frame(ms) {
        requestAnimationFrame(frame);
        if (ms - last < 33) return; // ~30 fps
        last = ms;
        for (const p of panels) {
            if (!p.visible) continue;
            p.lx += (p.tx - p.lx) * 0.1; p.ly += (p.ty - p.ly) * 0.1;
            p.heat += ((p.over ? 1 : 0) - p.heat) * 0.07;
            draw(p, ms / 1000);
        }
    }
    requestAnimationFrame(frame);
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    // 1. Language Initialization
    const savedLang = localStorage.getItem('preferredLanguage');
    const browserLang = navigator.language ? navigator.language.split('-')[0] : 'es';
    let currentLang = savedLang && SUPPORTED_LANGS.includes(savedLang)
        ? savedLang
        : SUPPORTED_LANGS.includes(browserLang) ? browserLang : 'es';

    updateContent(currentLang);

    // Language Toggle Button
    const langBtn = document.getElementById('lang-toggle-btn');
    if (langBtn) {
        langBtn.addEventListener('click', () => {
            currentLang = currentLang === 'es' ? 'en' : 'es';
            updateContent(currentLang);
        });
    }

    // 2. Modal Triggers
    const aboutBtn = document.getElementById('about-trigger-btn');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalBackdrop = document.getElementById('modal-backdrop');

    if (aboutBtn) aboutBtn.addEventListener('click', openBioModal);
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeBioModal);
    if (modalBackdrop) modalBackdrop.addEventListener('click', closeBioModal);

    // 3. Keyboard Commands
    document.addEventListener('keydown', (e) => {
        // ESC -> Close Modal
        if (e.key === 'Escape') {
            closeBioModal();
        }

        // Ignore hotkeys when typing in inputs/textareas
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        // Key 'A' -> Toggle About Modal
        if (e.key === 'a' || e.key === 'A') {
            const modal = document.getElementById('provenance-modal');
            if (modal && modal.classList.contains('active')) {
                closeBioModal();
            } else {
                openBioModal();
            }
        }

        // Key 'L' -> Toggle Language
        if (e.key === 'l' || e.key === 'L') {
            currentLang = currentLang === 'es' ? 'en' : 'es';
            updateContent(currentLang);
        }

        // Numbers 1, 2, 3 -> Focus Apertures
        if (['1', '2', '3'].includes(e.key)) {
            const target = document.getElementById(`aperture-0${e.key}`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                target.style.outline = '1px solid #0038FF';
                setTimeout(() => { target.style.outline = 'none'; }, 800);
            }
        }
    });

    // 4. ASCII Glow Panels
    initGlow();
});
