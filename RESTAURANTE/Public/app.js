// ============================================
// FOGONCLICK - CLIENTE DE API (FRONTEND)
// ============================================
// Su trabajo es: escuchar lo que hace el usuario en Index.html,

const URL_API = '';

// Cada función hace una petición HTTP (fetch) al backend. El backend recibe los datos, 
// revisa la BD y devuelve un JSON que decimos "respuesta".
const api = {
    
    /**
     * Envía email y contraseña al servidor para verificar si el usuario existe.
     * Si existe, el servidor devuelve el rol (admin, cocina, caja).
     */
    iniciarSesion: function(correo, contrasena) {
       
        return fetch(`${URL_API}/api/auth/login`, {
       
            method: 'POST',  
            headers: { 'Content-Type': 'application/json' }, // Le decimos al servidor que enviamos JSON
            body: JSON.stringify({ email: correo, password: contrasena }) // Convertimos el objeto a texto JSON
       
        })
        
        .then(respuesta => respuesta.json()); // Convertimos la respuesta del servidor de texto a objeto JavaScript
    },

    /**
     * Envía los datos de la empresa y del administrador para crear la cuenta.
     */
    registrar: function(datos) {
        
        return fetch(`${URL_API}/api/auth/register`, {
           
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
       
        })
       
        .then(respuesta => respuesta.json());
    },

    /**
     * Según el rol que devolvió el servidor, manda al usuario a su página correspondiente.
     * admin   → Panel de administrador.
     * cocina  → Pantalla de cocina.
     * caja    → Punto de ventas.
     */
    redirigir: function(rol) {
        
        const rutas = {
            admin: 'Administrador.html',
            cocina: 'Cocina.html',
            caja: 'Cajero.html'
        };

        const rolNormalizado = String(rol || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\s_-]+/g, '');
        const rolCanonico = ['admin', 'administrador'].includes(rolNormalizado)
            ? 'admin'
            : ['caja', 'cajero'].includes(rolNormalizado)
                ? 'caja'
                : ['cocina', 'cocinero'].includes(rolNormalizado)
                    ? 'cocina'
                    : '';
        const destino = rutas[rolCanonico];
        if (!destino) return '';
        localStorage.setItem('rol', rolCanonico);
        window.location.replace(`/${destino}`);
        return destino;
    }
};

// Espera a que el HTML esté completamente cargado
// antes de intentar buscar botones y formularios.
document.addEventListener('DOMContentLoaded', function() {

    // ----------------------------------------
    // PESTAÑAS (Login / Registro)
    // ----------------------------------------
    // Busca todos los elementos con clase "tab".
    // Al hacer clic, oculta la sección anterior y muestra la nueva.
    document.querySelectorAll('.tab').forEach(pestana => {
        
        pestana.addEventListener('click', function() {
            
            // Quita la clase "active" de TODAS las pestañas y secciones
            document.querySelectorAll('.tab, .form-section').forEach(el => el.classList.remove('active'));
            
            // Activa solo la pestaña que se clickeó
            this.classList.add('active');
            
            // Muestra la sección correspondiente 
            document.getElementById(`${this.dataset.tab}-section`).classList.add('active');
        });

    });

    // ----------------------------------------
    // LINKS "¿Ya tienes cuenta?" / "¿No tienes cuenta?"
    // ----------------------------------------
    // Al hacer clic en estos links, simula un clic en la pestaña correspondiente.
    document.querySelectorAll('a[data-switch]').forEach(enlace => {
       
        enlace.addEventListener('click', function(evento) {
            
            evento.preventDefault(); // Evita que el navegador recargue la página
            document.querySelector(`.tab[data-tab="${this.dataset.switch}"]`).click();
        
        });

    });

    // ----------------------------------------
    // FORMULARIO DE LOGIN
    // ----------------------------------------
    // Cuando el usuario hace clic en "Iniciar sesión":
    // 1. Evita que el formulario recargue la página (preventDefault)
    // 2. Toma los valores de los campos
    // 3. Llama a api.iniciarSesion()
    // 4. Si el servidor dice success=true, redirige según el rol
    // 5. Si dice success=false, muestra el error
    const formularioLogin = document.getElementById('login-form');
    
    if (formularioLogin) {
    
        formularioLogin.addEventListener('submit', function(evento) {
    
            evento.preventDefault(); // Detiene el envío normal del formulario

            // Obtiene los valores que el usuario escribió
            const correo = document.getElementById('login-email').value;
            const contrasena = document.getElementById('login-password').value;

            // Envía al servidor
            api.iniciarSesion(correo, contrasena)
            .then(datos => {
                if (datos.success) {
    
                    // El servidor confirmó: usuario válido
                    localStorage.setItem('id_empleado', datos.id_empleado);
                    localStorage.setItem('id_empresa', datos.id_empresa);
                    localStorage.setItem('nombre', datos.nombre);
                    localStorage.setItem('supabase_access_token', datos.access_token);
                    if (!api.redirigir(datos.rol)) {
                        ['supabase_access_token', 'id_empleado', 'id_empresa', 'nombre', 'rol']
                            .forEach(clave => localStorage.removeItem(clave));
                        alert('Tu cuenta no tiene un rol de acceso válido. Pídele al administrador que lo revise.');
                    }
    
                } else {
    
                    // El servidor dijo: usuario no encontrado o contraseña incorrecta
                    alert(datos.message);
    
                }
            })
    
            .catch(() => alert('Error de conexión. ¿El servidor está encendido?'));
        });
    }

    // ----------------------------------------
    // FORMULARIO DE REGISTRO
    // ----------------------------------------
    // Cuando el usuario hace clic en "Registrarse":
    // 1. Recolecta los datos de EMPRESA y ADMIN
    // 2. Los empaqueta en un solo objeto
    // 3. Llama a api.registrar()
    // 4. Si funciona, muestra alerta y cambia a la pestaña de login
    const formularioRegistro = document.getElementById('register-form');

    const tipoOrganizacion = document.getElementById('reg-tipo-organizacion');
    const grupoRazonSocial = document.getElementById('grupo-razon-social');
    const grupoNombrePersona = document.getElementById('grupo-nombre-persona');

    function actualizarCamposTipoOrganizacion() {
        if (!tipoOrganizacion || !grupoRazonSocial || !grupoNombrePersona) return;

        const esPersonaJuridica = tipoOrganizacion.value === '1';
        grupoRazonSocial.hidden = !esPersonaJuridica;
        grupoNombrePersona.hidden = esPersonaJuridica;
        document.getElementById('reg-razon-social').required = esPersonaJuridica;
        document.getElementById('reg-nombres').required = !esPersonaJuridica;
        document.getElementById('reg-apellidos').required = !esPersonaJuridica;
    }

    if (tipoOrganizacion) {
        tipoOrganizacion.addEventListener('change', actualizarCamposTipoOrganizacion);
        actualizarCamposTipoOrganizacion();
    }
   
    if (formularioRegistro) {
   
        formularioRegistro.addEventListener('submit', function(evento) {
            evento.preventDefault();

            // ----------------------------------------
            // VALIDACIÓN DE CONTRASEÑAS ← AGREGADO
            // ----------------------------------------
            // Compara lo que escribió en "Contraseña" con "Confirmar".
            // Si no son iguales, muestra alerta y DETIENE el envío (return).
            // El backend nunca se entera de que intentó registrar algo.
            const contrasena = document.getElementById('reg-password').value;
            const confirmar  = document.getElementById('reg-password-confirm').value;

            if (contrasena !== confirmar) {
                alert('Las contraseñas no coinciden');
                return; // Detiene la función. No llega al fetch.
            }

            // Empaqueta los datos locales en español y el perfil con los nombres
            // exactos que acepta Factus en PUT /v2/companies.
            const esPersonaJuridica = tipoOrganizacion.value === '1';
            const razonSocial = document.getElementById('reg-razon-social').value.trim();
            const nombres = document.getElementById('reg-nombres').value.trim();
            const apellidos = document.getElementById('reg-apellidos').value.trim();
            const nombreComercial = document.getElementById('reg-nombre-empresa').value.trim();
            const nit = document.getElementById('reg-nit').value.trim();
            const dv = document.getElementById('reg-dv').value.trim();
            const telefono = document.getElementById('reg-telefono-local').value.trim();
            const correoEmpresa = document.getElementById('reg-correo-empresa').value.trim();
            const direccion = document.getElementById('reg-direccion').value.trim();
            const actividadEconomica = document.getElementById('reg-actividad-economica').value.trim();
            const codigoMunicipio = document.getElementById('reg-codigo-municipio').value.trim();
            const codigoTributo = document.getElementById('reg-codigo-tributo').value;
            const responsabilidades = document.getElementById('reg-responsabilidades').value.trim();
            const codigoRegistroMercantil = document.getElementById('reg-registro-mercantil').value.trim();

            if (!/^\d+$/.test(nit) || !/^\d$/.test(dv)) {
                alert('Ingresa el NIT solo con números y su dígito de verificación de un número.');
                document.getElementById('reg-nit').focus();
                return;
            }

            const datos = {
                
                empresa: {
                    // Campos que ya consume el registro actual de FogonClick.
                    nombre_empresa: nombreComercial,
                    nit,
                    dv,
                    direccion,
                    telefono,
                    logo: document.getElementById('reg-logo').value,

                    // Atributos de la tabla empresa en español.
                    tipo_organizacion: tipoOrganizacion.value,
                    razon_social: esPersonaJuridica ? razonSocial : null,
                    nombre_comercial: nombreComercial,
                    nombres: esPersonaJuridica ? null : nombres,
                    apellidos: esPersonaJuridica ? null : apellidos,
                    codigo_registro_mercantil: codigoRegistroMercantil || null,
                    actividad_economica: actividadEconomica || null,
                    correo_electronico: correoEmpresa || null,
                    codigo_tributo: codigoTributo || null,
                    codigo_municipio: codigoMunicipio,
                    responsabilidades_fiscales: responsabilidades || null,

                    // Contrato de Factus: el NIT/DV se conserva localmente y no
                    // forma parte del cuerpo documentado para actualizar empresa.
                    factus: {
                        legal_organization_code: tipoOrganizacion.value,
                        company: esPersonaJuridica ? razonSocial : null,
                        trade_name: nombreComercial || null,
                        names: esPersonaJuridica ? null : nombres,
                        surnames: esPersonaJuridica ? null : apellidos,
                        registration_code: codigoRegistroMercantil || null,
                        economic_activity: actividadEconomica || null,
                        phone: telefono || null,
                        email: correoEmpresa || null,
                        address: direccion || null,
                        tribute_code: codigoTributo || null,
                        municipality_code: codigoMunicipio,
                        responsibilities: responsabilidades || null
                    }
                },

                admin: {
                    cc: document.getElementById('reg-cedula').value,
                    nombre: document.getElementById('reg-nombre-admin').value,
                    correo: document.getElementById('reg-email').value,
                    contraseña: contrasena  // ← AGREGADO: usa la variable ya leída arriba
                }
            };

            // Envía al servidor
            api.registrar(datos)
            .then(datosRespuesta => {
               
                if (datosRespuesta.success) {
               
                    alert('Registro exitoso. Ahora inicia sesión.');
                
                    // Simula un clic en la pestaña "login" para cambiar de vista
                    document.querySelector('.tab[data-tab="login"]').click();
               
                } else {
               
                    alert(datosRespuesta.message);
                }
            })
            .catch(() => alert('Error de conexión. ¿El servidor está encendido?'));
        });
    }

});
