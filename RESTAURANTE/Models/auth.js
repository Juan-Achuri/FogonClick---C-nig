const express = require('express');
const router = express.Router();
const db = require('./database');

// Devuelve el nombre de panel estándar a partir del rol guardado en el empleado.
function roleName(employee) {
    const role = String(employee.rol?.rol || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s_-]+/g, '');
    if (['admin', 'administrador'].includes(role)) return 'admin';
    if (['caja', 'cajero'].includes(role)) return 'caja';
    if (['cocina', 'cocinero'].includes(role)) return 'cocina';
    return ({ 2: 'cocina', 3: 'caja' })[Number(employee.id_rol)] || '';
}

// Inicia sesión con Auth o enlaza empleados antiguos cuya contraseña coincide con la tabla empleado.
async function loginEmployee(email, password, employee) {
    try {
        return await db.auth.passwordLogin(email, password);
    } catch (loginError) {
        const coincideConEmpleado = String(employee.password || '') === password;
        if (![400, 401].includes(loginError.status) || !coincideConEmpleado) throw loginError;

        let account = await db.auth.findUserByEmail(email);
        if (account) {
            await db.auth.updateUser(account.id, { password, email_confirm: true });
        } else {
            account = await db.auth.createUser(email, password, { nombre: employee.nombre });
        }

        if (!account?.id) throw new Error('No se pudo enlazar la cuenta de acceso del empleado.');
        return db.auth.passwordLogin(email, password);
    }
}

// Busca un rol por nombre y lo crea si todavía no existe.
async function findOrCreateRole(name) {
    const existing = await db.select('rol', { filters: { rol: name }, limit: 1 });
    if (existing.length) return existing[0].id_rol;
    return (await db.insert('rol', { rol: name }))[0].id_rol;
}

// Registra la empresa y su administrador en Auth y en las tablas del restaurante.
router.post('/register', async (req, res) => {
    const { empresa = {}, admin = {} } = req.body || {};
    const cedula = String(admin.cedula || admin.cc || '').trim();
    if (!admin.correo || !admin.contraseña || !admin.nombre || !cedula || !empresa.nit || !empresa.dv || !empresa.codigo_municipio || !empresa.tipo_organizacion) {
        return res.status(400).json({ success: false, message: 'Completa los datos obligatorios de la empresa y del administrador.' });
    }
    let authUser;
    let companyId;
    try {
        authUser = await db.auth.createUser(admin.correo, admin.contraseña, { nombre: admin.nombre });
        const company = (await db.insert('empresa', {
            nit: empresa.nit || null,
            dv: empresa.dv || null,
            tipo_organizacion: empresa.tipo_organizacion,
            razon_social: empresa.razon_social || null,
            nombre_comercial: empresa.nombre_comercial || empresa.nombre_empresa || null,
            nombres: empresa.nombres || null,
            apellidos: empresa.apellidos || null,
            codigo_registro_mercantil: empresa.codigo_registro_mercantil || null,
            actividad_economica: empresa.actividad_economica || null,
            telefono: empresa.telefono || null,
            correo_electronico: empresa.correo_electronico || admin.correo,
            direccion: empresa.direccion || null,
            codigo_tributo: empresa.codigo_tributo || null,
            codigo_municipio: empresa.codigo_municipio,
            responsabilidades_fiscales: empresa.responsabilidades_fiscales || null
        }))[0];
        companyId = company.id_empresa;
        const idRol = await findOrCreateRole('admin');
        const employee = (await db.insert('empleado', {
            id_empresa: companyId,
            cedula,
            password: admin.contraseña,
            activo: true,
            nombre: admin.nombre,
            correo: admin.correo,
            telefono: null,
            id_rol: idRol
        }))[0];
        return res.status(201).json({ success: true, message: 'Empresa y administrador creados correctamente', id_empresa: companyId, id_empleado: employee.id_empleado });
    } catch (error) {
        if (companyId) await db.delete('empresa', { id_empresa: companyId }).catch(() => {});
        if (authUser?.id) await db.auth.deleteUser(authUser.id).catch(() => {});
        return res.status(error.status || 500).json({ success: false, message: error.message || 'No se pudo crear la cuenta.' });
    }
});

// Autentica al usuario y devuelve su rol, perfil e identificador de sesión.
router.post('/login', async (req, res) => {
    const email = String(req.body?.email || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return res.status(400).json({ success: false, message: 'Ingresa correo y contraseña.' });
    try {
        const employees = await db.select('empleado', {
            select: 'id_empleado,id_empresa,nombre,correo,password,id_rol,activo,rol(rol)',
            filters: { correo: { operator: 'ilike', value: email }, activo: true }, limit: 1
        });
        if (!employees.length) return res.status(403).json({ success: false, message: 'La cuenta no tiene un perfil de empleado asociado.' });
        const employee = employees[0];
        const session = await loginEmployee(email, password, employee);
        const rol = roleName(employee);
        if (!rol) return res.status(403).json({ success: false, message: 'El empleado no tiene un rol de acceso válido.' });
        const company = employee.id_empresa
            ? { id_empresa: employee.id_empresa }
            : (await db.select('empresa', { select: 'id_empresa', order: 'id_empresa.asc', limit: 1 }))[0];
        res.json({
            success: true,
            id_empleado: employee.id_empleado,
            id_empresa: company?.id_empresa || null,
            rol,
            nombre: employee.nombre,
            access_token: session.access_token
        });
    } catch (error) {
        res.status(error.status === 400 || error.status === 401 ? 401 : (error.status || 500))
            .json({ success: false, message: error.status === 400 || error.status === 401 ? 'Correo o contraseña incorrectos.' : error.message });
    }
});

module.exports = router;
