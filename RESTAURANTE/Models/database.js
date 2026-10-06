// Cliente mínimo de Supabase REST para mantener las credenciales exclusivamente
// en el servidor. Las operaciones usan la clave secreta y nunca llegan al navegador.
// SUPABASE_URL normalmente es la URL raíz del proyecto, aunque algunas
// configuraciones locales la guardan con /rest/v1. Evita duplicar esa ruta.
const baseUrl = (process.env.SUPABASE_URL || '')
    .replace(/\/$/, '')
    .replace(/\/rest\/v1$/i, '');
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!baseUrl || !secretKey || !publishableKey) {
    throw new Error('Configura SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY y SUPABASE_SECRET_KEY en .env');
}

// Representa errores devueltos por Supabase con su HTTP status y código.
class SupabaseError extends Error {
    constructor(message, status = 500, code = 'SUPABASE_ERROR') {
        super(message);
        this.name = 'SupabaseError';
        this.status = status;
        this.code = code;
    }
}

// Envía una solicitud HTTP a Supabase, convierte la respuesta y normaliza los errores.
async function request(path, { method = 'GET', body, headers = {}, key = secretKey, bearerToken } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            apikey: key,
            // Las claves sb_* actuales no son JWT y solo deben ir en apikey.
            // Las claves anon/service_role heredadas sí son JWT.
            ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : (!key.startsWith('sb_') ? { Authorization: `Bearer ${key}` } : {})),
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
        try { data = JSON.parse(raw); } catch { data = raw; }
    }
    if (!response.ok) {
        const message = data?.message || data?.msg || data?.error_description || data?.error || `Supabase respondió HTTP ${response.status}`;
        throw new SupabaseError(message, response.status, data?.code);
    }
    return data;
}

// Construye los parámetros PostgREST para selección, filtros, orden y paginación.
function queryString({ select = '*', filters = {}, order, limit, offset } = {}) {
    const params = new URLSearchParams({ select });
    for (const [column, value] of Object.entries(filters)) {
        if (Array.isArray(value)) params.set(column, `in.(${value.join(',')})`);
        else if (value && typeof value === 'object' && value.operator) params.set(column, `${value.operator}.${value.value}`);
        else params.set(column, `eq.${value}`);
    }
    if (order) params.set('order', order);
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    return params.toString();
}

const db = {
    // Lee filas de una tabla aplicando las opciones recibidas.
    async select(table, options) {
        return (await request(`/rest/v1/${encodeURIComponent(table)}?${queryString(options)}`)) || [];
    },
    // Inserta una o varias filas y permite configurar conflictos de unicidad.
    async insert(table, values, { onConflict, ignoreDuplicates = false } = {}) {
        const params = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
        const resolution = ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates';
        const data = await request(`/rest/v1/${encodeURIComponent(table)}${params}`, {
            method: 'POST', body: Array.isArray(values) ? values : [values],
            headers: { Prefer: `return=representation${onConflict ? `,resolution=${resolution}` : ''}` }
        });
        return data || [];
    },
    // Actualiza filas que coinciden con los filtros indicados.
    async update(table, values, filters) {
        const query = queryString({ filters });
        return (await request(`/rest/v1/${encodeURIComponent(table)}?${query}`, {
            method: 'PATCH', body: values, headers: { Prefer: 'return=representation' }
        })) || [];
    },
    // Elimina filas que coinciden con los filtros indicados.
    async delete(table, filters) {
        const query = queryString({ filters });
        return (await request(`/rest/v1/${encodeURIComponent(table)}?${query}`, {
            method: 'DELETE', headers: { Prefer: 'return=representation' }
        })) || [];
    },
    // Inserta o actualiza filas usando la política de conflicto especificada.
    async upsert(table, values, onConflict) {
        return this.insert(table, values, { onConflict });
    },
    // Ejecuta una función PostgreSQL publicada como RPC en Supabase.
    async rpc(name, args = {}) {
        return request(`/rest/v1/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: args });
    },
    auth: {
        // Inicia sesión con email y contraseña y devuelve la sesión de Supabase Auth.
        async passwordLogin(email, password) {
            return request('/auth/v1/token?grant_type=password', {
                method: 'POST', body: { email, password }, key: publishableKey
            });
        },
        // Valida un token de sesión y recupera el usuario autenticado.
        async getUser(accessToken) {
            return request('/auth/v1/user', { key: publishableKey, bearerToken: accessToken });
        },
        // Crea una cuenta de Auth desde el backend y la confirma para el registro.
        async createUser(email, password, userMetadata = {}) {
            return request('/auth/v1/admin/users', {
                method: 'POST', body: { email, password, email_confirm: true, user_metadata: userMetadata }
            });
        },
        // Elimina una cuenta de Auth por su UUID.
        async deleteUser(id) {
            return request(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
        },
        // Busca una cuenta de Auth por correo en las páginas consultadas.
        async findUserByEmail(email) {
            const result = await request('/auth/v1/admin/users?page=1&per_page=1000');
            return (result?.users || []).find(user => user.email?.toLowerCase() === email.toLowerCase()) || null;
        },
        // Actualiza datos de perfil o credenciales de una cuenta de Auth.
        async updateUser(id, values) {
            return request(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: values });
        }
    }
};

db.SupabaseError = SupabaseError;
db.request = request;
module.exports = db;
