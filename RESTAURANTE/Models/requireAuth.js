const db = require('./database');

// Convierte los nombres del rol al identificador corto que usa la aplicación.
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

// Verifica el token de Supabase y carga el empleado activo asociado al correo.
async function requireAuth(req, res, next) {
    const token = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
        return res.status(401).json({ success: false, message: 'Inicia sesión para continuar.' });
    }

    let authUser;
    let employee;
    try {
        authUser = await db.auth.getUser(token);
        if (!authUser?.id || !authUser.email) {
            return res.status(401).json({ success: false, message: 'La sesión no es válida.' });
        }

        employee = (await db.select('empleado', {
            select: 'id_empleado,id_empresa,nombre,correo,id_rol,activo,rol(rol)',
            filters: {
                correo: { operator: 'ilike', value: authUser.email },
                activo: true
            },
            limit: 1
        }))[0];
        if (employee && !employee.id_empresa) {
            const firstCompany = (await db.select('empresa', {
                select: 'id_empresa',
                order: 'id_empresa.asc',
                limit: 1
            }))[0];
            employee.id_empresa = firstCompany?.id_empresa || null;
        }
    } catch (error) {
        const status = error.status === 401 ? 401 : 503;
        return res.status(status).json({
            success: false,
            message: status === 401
                ? 'La sesión expiró. Inicia sesión de nuevo.'
                : 'No se pudo verificar la sesión. Intenta de nuevo.'
        });
    }

    if (!employee) {
        return res.status(403).json({ success: false, message: 'Esta cuenta no tiene un perfil de empleado activo.' });
    }

    const rol = normalizarRol(employee.rol?.rol) || ({ 2: 'cocina', 3: 'caja' })[Number(employee.id_rol)] || '';
    if (!rol) {
        return res.status(403).json({ success: false, message: 'El empleado no tiene un rol válido asignado.' });
    }

    req.authUser = authUser;
    req.employee = { ...employee, rol: { ...employee.rol, rol } };
    return next();
}

// Permite que la ruta continúe únicamente cuando el empleado tenga uno de los roles indicados.
requireAuth.role = (...rolesPermitidos) => (req, res, next) => {
    const rol = normalizarRol(req.employee?.rol?.rol);
    const permitidos = rolesPermitidos.map(normalizarRol).filter(Boolean);
    if (!permitidos.includes(rol)) {
        return res.status(403).json({ success: false, message: 'No tienes permiso para realizar esta acción.' });
    }
    return next();
};

module.exports = requireAuth;
