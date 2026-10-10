const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'Public')));
app.use('/reportes', express.static(path.join(__dirname, 'Reportes')));

// Ruta principal explícita para Index.html (con I mayúscula)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public', 'Index.html'));
});

// Rutas API
app.use('/api/auth', require('./Models/auth'));
const requireAuth = require('./Models/requireAuth');
app.use('/api/admin', requireAuth, require('./Models/admin'));
app.use('/api/caja', requireAuth, requireAuth.role('admin', 'caja'), require('./Models/Caja'));
app.use('/api/cocina', requireAuth, requireAuth.role('admin', 'cocina'), require('./Models/Cocina'));

// SOCKET.IO - CHAT
io.on('connection', (socket) => {
    const rol = socket.handshake.auth.rol || "Usuario";
    socket.data.rol = rol;

    console.log(`🟢 ${rol} conectado al chat.`);

    socket.on('chat message', (msg) => {
        console.log(`📨 ${rol} envió:`, msg); 
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log(`🔴 ${socket.data.rol} desconectado del chat.`);
    });
});

// ARRANQUE
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('🔥 FogonClick servidor corriendo en el puerto ' + PORT);
});
