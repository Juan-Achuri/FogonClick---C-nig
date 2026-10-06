// Mantiene cada panel en su sesión y adjunta el token a las rutas privadas.
(() => {
    const fetchOriginal = window.fetch.bind(window);
    const paginaPorRol = {
        admin: 'Administrador.html',
        cocina: 'Cocina.html',
        caja: 'Cajero.html'
    };
    const datosSesion = [
        'supabase_access_token',
        'rol',
        'id_empleado',
        'id_empresa',
        'nombre'
    ];
    let redireccionando = false;

    function normalizarRol(nombre) {
        const rol = String(nombre || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\s_-]+/g, '');
        if (['admin', 'administrador'].includes(rol)) return 'admin';
        if (['caja', 'cajero'].includes(rol)) return 'caja';
        if (['cocina', 'cocinero'].includes(rol)) return 'cocina';
        return '';
    }

    function cerrarSesion() {
        datosSesion.forEach(clave => localStorage.removeItem(clave));
    }

    function irAlLogin() {
        if (redireccionando) return;
        redireccionando = true;
        cerrarSesion();
        window.location.replace('/Index.html');
    }

    // Si abren un panel manualmente, los envía al panel correspondiente al rol.
    const archivoActual = decodeURIComponent(window.location.pathname.split('/').pop() || '').toLowerCase();
    const esPanel = Object.values(paginaPorRol).some(archivo => archivo.toLowerCase() === archivoActual);
    if (esPanel) {
        const token = localStorage.getItem('supabase_access_token');
        const rol = normalizarRol(localStorage.getItem('rol'));
        const paginaCorrecta = paginaPorRol[rol];
        if (!token || !paginaCorrecta) {
            irAlLogin();
            return;
        }
        if (paginaCorrecta.toLowerCase() !== archivoActual) {
            window.location.replace(`/${paginaCorrecta}`);
            return;
        }
    }

    window.fetch = async (input, init = {}) => {
        const inputUrl = typeof input === 'string'
            ? input
            : (input instanceof URL ? input.href : input.url);
        const url = new URL(inputUrl, window.location.href);
        const esApiPrivada = url.origin === window.location.origin &&
            url.pathname.startsWith('/api/') &&
            !url.pathname.startsWith('/api/auth/');
        if (!esApiPrivada) return fetchOriginal(input, init);

        const token = localStorage.getItem('supabase_access_token');
        if (!token) {
            irAlLogin();
            throw new Error('La sesión terminó. Inicia sesión de nuevo.');
        }

        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value));
        headers.set('Authorization', `Bearer ${token}`);

        const response = await fetchOriginal(input, { ...init, headers });
        if (response.status === 401) irAlLogin();
        return response;
    };
})();
