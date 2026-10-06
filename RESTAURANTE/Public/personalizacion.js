(() => {
    'use strict';

    const STORAGE_KEY = 'fogonclick.personalizacion.preferencias.v1';
    const DEFAULTS = { theme: 'predeterminado', palette: 'predeterminada', iconStyle: 'predeterminado', pageStyle: 'predeterminado' };
    const allowed = {
        theme: ['predeterminado', 'dispositivo', 'claro', 'oscuro'],
        palette: ['predeterminada', 'fogon', 'cacao', 'huerta', 'oliva', 'mediterraneo', 'marino', 'berenjena', 'vino', 'mango', 'jade'],
        iconStyle: ['predeterminado', 'clasico', 'lineal', 'minimalista', 'circular', 'cuadrado', 'suave', 'divertido', 'elegante', 'calido', 'monocromatico'],
        pageStyle: ['predeterminado', 'transparente', 'solido', 'sombreado', 'esquinas', 'delineado', 'elevado', 'compacto', 'aireado', 'minimalista', 'separadores']
    };
    const palettes = {
        predeterminada: {
            original: { background: '#1a1a2e', middle: '#16213e', deep: '#0f3460', surface: '#1a1a2e', text: '#ffffff', muted: '#888888', accent: '#e94560', border: 'rgba(255,255,255,.08)', sidebar: 'rgba(0,0,0,.25)' },
            light: { background: '#f5f3f6', surface: '#ffffff', text: '#20232d', muted: '#5f6675', accent: '#cf3653', border: '#d7d9e0', sidebar: '#ececf1' },
            dark: { background: '#111318', middle: '#191d26', deep: '#222834', surface: '#242936', text: '#f5f6f8', muted: '#b9bec7', accent: '#e94560', border: 'rgba(255,255,255,.14)', sidebar: '#191d26' }
        },
        fogon: { light: ['#F7F1E8','#FFFDF8','#35251F','#A7472D'], dark: ['#211B19','#302522','#F5EBDD','#E27B50'] },
        cacao: { light: ['#F5EFE6','#FFFCF7','#3D2D25','#8A5B43'], dark: ['#211C19','#332923','#F3EBDD','#C28A65'] },
        huerta: { light: ['#F1F4EC','#FCFDF9','#26372E','#56765A'], dark: ['#1B221E','#29352D','#E7EFE5','#91AD83'] },
        oliva: { light: ['#F4F2E8','#FFFDF5','#34372A','#777A43'], dark: ['#202118','#303126','#F0EFDE','#C2BE73'] },
        mediterraneo: { light: ['#EFF4F3','#FBFDFC','#253A3C','#B95F4C'], dark: ['#192326','#273336','#E7F1EF','#E28B72'] },
        marino: { light: ['#F0F3F6','#FCFDFE','#263547','#A9783F'], dark: ['#1A2029','#282F3A','#EAF0F5','#D1A46A'] },
        berenjena: { light: ['#F5F0F2','#FFFCFD','#3B2A35','#A76055'], dark: ['#241D23','#352931','#F5EAF0','#D58C7D'] },
        vino: { light: ['#F5F0EC','#FFFCF8','#3D292B','#8D4C4D'], dark: ['#241D20','#35292B','#F3E9E2','#C77A72'] },
        mango: { light: ['#F5F2EB','#FFFDFA','#34312B','#B87925'], dark: ['#22201C','#33302A','#F1EDE4','#D99A3D'] },
        jade: { light: ['#EFF4F1','#FCFDFC','#253A35','#A56745'], dark: ['#19221F','#28332F','#E8F0EB','#D18B62'] }
    };
    const outlineIcons = {
        'bi-bar-chart-line-fill':'bi-bar-chart-line', 'bi-cart-fill':'bi-cart', 'bi-star-fill':'bi-star',
        'bi-exclamation-triangle-fill':'bi-exclamation-triangle', 'bi-bag-check-fill':'bi-bag-check',
        'bi-cup-hot-fill':'bi-cup-hot', 'bi-cash-coin':'bi-cash', 'bi-box-seam':'bi-box',
        'bi-receipt':'bi-receipt', 'bi-bell-fill':'bi-bell'
    };
    const fieldMap = { tema: 'theme', 'paleta-color': 'palette', 'estilo-iconos': 'iconStyle', 'estilo-pagina': 'pageStyle' };
    const systemTheme = window.matchMedia('(prefers-color-scheme: light)');

    function readPreferences() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, allowed[key].includes(saved[key]) ? saved[key] : fallback]));
        } catch (_) { return { ...DEFAULTS }; }
    }

    let preferences = readPreferences();
    let draft = { ...preferences };

    function effectiveMode() {
        if (draft.theme === 'claro') return 'light';
        if (draft.theme === 'oscuro') return 'dark';
        if (draft.theme === 'dispositivo') return systemTheme.matches ? 'light' : 'dark';
        return 'original';
    }

    function getPalette(mode) {
        const selected = palettes[draft.palette] || palettes.predeterminada;
        if (draft.palette === 'predeterminada') {
            if (mode === 'original') return selected.original;
            return selected[mode];
        }
        const activeMode = mode === 'original' ? 'dark' : mode;
        const values = selected[activeMode === 'light' ? 'light' : 'dark'];
        return {
            background: values[0], middle: values[1], deep: values[0], surface: values[1], text: values[2], accent: values[3],
            muted: activeMode === 'light' ? '#62666d' : '#b9bec7',
            border: activeMode === 'light' ? 'rgba(40,35,30,.16)' : 'rgba(255,255,255,.16)',
            sidebar: activeMode === 'light' ? values[1] : values[0]
        };
    }

    function restoreIconGlyphs() {
        document.querySelectorAll('i.bi').forEach((icon) => {
            if (icon.closest('.personalizacion-opciones')) return;
            const base = icon.dataset.fcBaseGlyph;
            if (!base) return;
            Array.from(icon.classList).filter(name => name.startsWith('bi-')).forEach(name => icon.classList.remove(name));
            icon.classList.add(base);
        });
    }

    function applyIconGlyphs(style) {
        restoreIconGlyphs();
        if (style !== 'lineal') return;
        document.querySelectorAll('i.bi').forEach((icon) => {
            if (icon.closest('.personalizacion-opciones')) return;
            const glyph = icon.dataset.fcBaseGlyph || Array.from(icon.classList).find(name => name.startsWith('bi-'));
            if (!glyph) return;
            icon.dataset.fcBaseGlyph = glyph;
            if (outlineIcons[glyph]) {
                icon.classList.remove(glyph);
                icon.classList.add(outlineIcons[glyph]);
            }
        });
    }

    function applyPreferences() {
        const mode = effectiveMode();
        const colors = getPalette(mode);
        const root = document.documentElement;
        const dataMode = mode === 'original' ? 'dark' : mode;
        const background = mode === 'original' && draft.palette === 'predeterminada'
            ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
            : `linear-gradient(135deg, ${colors.background} 0%, ${colors.middle || colors.surface} 52%, ${colors.deep || colors.background} 100%)`;
        root.dataset.fcMode = dataMode;
        root.dataset.fcTheme = draft.theme;
        root.dataset.fcPalette = draft.palette;
        root.dataset.fcIconStyle = draft.iconStyle;
        root.dataset.fcPageStyle = draft.pageStyle;
        root.style.setProperty('--fc-background', background);
        root.style.setProperty('--fc-surface', colors.surface);
        root.style.setProperty('--fc-surface-hover', dataMode === 'light' ? 'rgba(32,35,45,.08)' : 'rgba(255,255,255,.09)');
        root.style.setProperty('--fc-text', colors.text);
        root.style.setProperty('--fc-muted', colors.muted);
        root.style.setProperty('--fc-accent', colors.accent);
        root.style.setProperty('--fc-border', colors.border);
        root.style.setProperty('--fc-sidebar', colors.sidebar || colors.surface);
        root.style.setProperty('--fc-shadow-color', dataMode === 'light' ? 'rgba(20,25,35,.28)' : 'rgba(0,0,0,.55)');
        root.style.setProperty('--fc-shadow', dataMode === 'light' ? '0 12px 28px rgba(20,25,35,.22)' : '0 12px 28px rgba(0,0,0,.55)');
        applyIconGlyphs(draft.iconStyle);
    }

    function reflectControls(values) {
        Object.entries({ tema: values.theme, 'paleta-color': values.palette, 'estilo-iconos': values.iconStyle, 'estilo-pagina': values.pageStyle }).forEach(([name, value]) => {
            const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
            if (input) input.checked = true;
        });
    }

    function updateStatus(message, hasPendingChanges) {
        const status = document.getElementById('estado-personalizacion');
        const button = document.getElementById('btn-confirmar-personalizacion');
        if (status) status.textContent = message;
        if (button) button.disabled = !hasPendingChanges;
    }

    function bindControls() {
        document.querySelectorAll('input[type="radio"]').forEach((input) => {
            const key = fieldMap[input.name];
            if (!key) return;
            input.addEventListener('change', () => {
                if (!input.checked || !allowed[key].includes(input.value)) return;
                draft[key] = input.value;
                updateStatus('Hay cambios pendientes. Confírmalos para aplicarlos y guardarlos.', true);
                const current = input.closest('.personalizacion-combo');
                if (current) current.open = false;
            });
        });

        const combos = Array.from(document.querySelectorAll('details.personalizacion-combo'));
        combos.forEach((combo) => combo.addEventListener('toggle', () => {
            if (!combo.open) return;
            combos.forEach(other => { if (other !== combo) other.open = false; });
        }));

        const confirm = document.getElementById('btn-confirmar-personalizacion');
        if (confirm) confirm.addEventListener('click', () => {
            preferences = { ...draft };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
                applyPreferences();
                combos.forEach(combo => { combo.open = false; });
                updateStatus('Cambios confirmados y guardados. Se conservarán al cambiar de página.', false);
            } catch (error) {
                updateStatus('No se pudieron guardar los cambios en este navegador.', true);
                console.error('No se pudieron guardar las preferencias.', error);
            }
        });
    }

    function start() {
        reflectControls(preferences);
        applyPreferences();
        bindControls();
        systemTheme.addEventListener?.('change', () => {
            if (preferences.theme === 'dispositivo' && !document.getElementById('btn-confirmar-personalizacion')) applyPreferences();
        });
        window.addEventListener('storage', (event) => {
            if (event.key !== STORAGE_KEY) return;
            preferences = readPreferences();
            draft = { ...preferences };
            reflectControls(preferences);
            applyPreferences();
            updateStatus('Se cargaron las preferencias guardadas en otra página.', false);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();